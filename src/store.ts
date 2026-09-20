/**
 * Durable rule store: `global`, `project`, and per-session rules all persist to
 * JSON files under DSH_HOME — `global` to `$DSH_HOME/rules/global.json`, each
 * session's rules to `$DSH_HOME/rules/sessions/<sessionId>.json`, and each
 * project's rules to `$DSH_HOME/rules/projects/<slug>.json` (slug from the
 * session cwd). Files are read on every view/pre-step and written on every
 * mutating command/API call, so every scope survives process restarts.
 * `ctx.fs.writeText` creates parent dirs.
 *
 * Two durability rules live here and are load-bearing:
 *
 * 1. **Reading never throws.** A missing file is an empty scope; a hand-edited
 *    or truncated file yields an empty scope plus a `problem` string the caller
 *    surfaces. Every conversation's pre-step reads these files, so a corrupt one
 *    must degrade the injection, never fail the step.
 * 2. **Writing is guarded and minimal.** Each write carries the freshness token
 *    captured when the view was read (`replaceIfVersion`), so a concurrent panel
 *    click or CLI command cannot silently drop an update — the loser gets
 *    `FS_STALE_VERSION` instead. A scope that did not change is not rewritten at
 *    all, and an empty scope with nothing on disk is not written either (that is
 *    what used to leave a 3-byte `[]` file behind for every session).
 *
 * The template library lives beside them in `$DSH_HOME/rules/templates.json` —
 * the same bare-array shape, so one sanitize/serialize pair covers both and the
 * file stays hand-editable.
 *
 * Note: an event-sourced `rules/set` session event (方案 A) would be the cleanest
 * "model-visible ⟺ logged" guarantee, but the public `Session.append` cannot mark
 * an out-of-repo event type `ignorable`, so a harness reading such a log would
 * refuse to reconstruct it. The per-session file is the pragmatic durable path.
 *
 * Pure CRUD helpers (addRule/removeRule/mutate/newRule) live in `core.ts`.
 *
 * @module dsh-baize-rules/store
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs' // augments Context with `fs`
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Rule, RuleTemplate, RuleView, ScopeVersions } from './rules.ts'
import { normalizeTags } from './rules.ts'

/** Resolve the global rules path (config override, else `$DSH_HOME/rules/global.json`). */
function globalRulesPath(ctx: Context, config: { globalRulesPath?: string }): string {
  return config.globalRulesPath ?? dshHomePath('rules', 'global.json')
}

/** Resolve one session's rules file: `$DSH_HOME/rules/sessions/<sessionId>.json`. */
function sessionRulesPath(sessionId: unknown): string {
  return dshHomePath('rules', 'sessions', `${String(sessionId)}.json`)
}

/** Slug a project (cwd) into a safe filename for `$DSH_HOME/rules/projects/<slug>.json`. */
function projectSlug(projectId: unknown): string {
  return String(projectId).replace(/[\\/:*?"<>|]/g, '_').replace(/^_+|_+$/g, '') || '_'
}

/** Resolve one project's rules file (project = session cwd). Exported for tests
 *  and for docs that need to point a user at the exact file. */
export function projectRulesPath(projectId: unknown): string {
  return dshHomePath('rules', 'projects', `${projectSlug(projectId)}.json`)
}

/** Resolve the shared template library file: `$DSH_HOME/rules/templates.json`. */
export function templatesPath(): string {
  return dshHomePath('rules', 'templates.json')
}

/** The working directory a session declares, or `''` when it has none. */
export function agentCwd(agent: Agent): string {
  const header = (agent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header
  return typeof header?.cwd === 'string' ? header.cwd : ''
}

/** One rule as it lands on disk: `tags` is omitted when empty, so a file that
 *  never used tags stays byte-identical to the pre-tags format. */
function serializeRule(rule: Rule): Record<string, unknown> {
  const out: Record<string, unknown> = { id: rule.id, text: rule.text }
  if (rule.tags !== undefined && rule.tags.length > 0) out.tags = [...rule.tags]
  out.enabled = rule.enabled
  out.createdAt = rule.createdAt
  out.updatedAt = rule.updatedAt
  return out
}

/** One template as it lands on disk (`uses` always present, defaulting to 0). */
function serializeTemplate(template: RuleTemplate): Record<string, unknown> {
  return {
    id: template.id,
    text: template.text,
    tags: [...template.tags],
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    uses: template.uses ?? 0,
  }
}

/** Pretty-print a collection the way every store file is written. */
function stringify(items: readonly unknown[]): string {
  return `${JSON.stringify(items, null, 2)}\n`
}

/** Validate a parsed array into well-formed rules; drop the malformed entries loudly.
 *  Rules are plain text — there is no `kind` field anymore, but legacy stored
 *  entries that carried `kind` are accepted (the field is ignored on rewrite).
 *  `tags` is optional: a file written before tags existed loads as an empty list. */
function sanitizeRules(parsed: readonly unknown[]): Rule[] {
  return parsed.flatMap((item) => {
    if (typeof item !== 'object' || item === null) throw new Error('rules: entry is not an object')
    const rule = item as Record<string, unknown>
    const { text, id } = rule
    if (typeof text !== 'string' || typeof id !== 'string') {
      throw new Error('rules: entry must carry string id and text')
    }
    return [{
      id,
      text,
      tags: normalizeTags(rule.tags as readonly unknown[] | undefined),
      enabled: rule.enabled !== false,
      createdAt: typeof rule.createdAt === 'number' ? rule.createdAt : 0,
      updatedAt: typeof rule.updatedAt === 'number' ? rule.updatedAt : 0,
    } satisfies Rule]
  })
}

/** Validate a parsed array into well-formed templates, throwing on a malformed
 *  store entry: the file is ours, so a broken one must fail loud rather than
 *  silently drop part of the user's library. (Import files take the softer,
 *  collect-all-errors path in `core.ts` instead.) The throw is caught by
 *  {@link readArrayFile}, so it surfaces as a `problem`, not as a failed step. */
export function sanitizeTemplates(parsed: readonly unknown[]): RuleTemplate[] {
  return parsed.map((item) => {
    if (typeof item !== 'object' || item === null) throw new Error('rules: template entry is not an object')
    const template = item as Record<string, unknown>
    const { text, id } = template
    if (typeof text !== 'string' || typeof id !== 'string') {
      throw new Error('rules: template entry must carry string id and text')
    }
    return {
      id,
      text,
      tags: normalizeTags(template.tags as readonly unknown[] | undefined),
      createdAt: typeof template.createdAt === 'number' ? template.createdAt : 0,
      updatedAt: typeof template.updatedAt === 'number' ? template.updatedAt : 0,
      uses: typeof template.uses === 'number' && template.uses > 0 ? Math.floor(template.uses) : 0,
    } satisfies RuleTemplate
  })
}

/** Outcome of one tolerant read: the items, the file's freshness token (absent
 *  when the file does not exist), and a human-readable failure when the file is
 *  there but unusable. */
export interface FileRead<T> {
  readonly items: readonly T[]
  readonly version?: unknown
  readonly problem?: string
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Read a store file, degrading instead of throwing: a missing file is empty, a
 *  corrupt one is empty + `problem`. Shared by rules and templates. */
async function readArrayFile<T>(
  ctx: Context,
  path: string,
  label: string,
  sanitize: (parsed: readonly unknown[]) => T[],
): Promise<FileRead<T>> {
  if (ctx.fs === undefined) return { items: [] }
  const target = await ctx.fs.resolve(path)
  let version: FsVersion | undefined
  try {
    const info = await ctx.fs.stat(target)
    if (info === undefined) return { items: [] }
    version = info.version
    const raw = await ctx.fs.readText(target)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return { items: [], version, problem: `${label} file is not a JSON array: ${path}` }
    }
    return { items: sanitize(parsed), version }
  } catch (e) {
    return { items: [], version, problem: `${label}: ${describe(e)} (${path})` }
  }
}

/** Replace a store file under an optimistic-concurrency guard.
 *
 *  `guard` is the token from {@link FileRead.version}: present means "the file
 *  existed with this content when we read it", absent means "we observed no
 *  file". The write is refused (`FS_STALE_VERSION` / `FS_NOT_OBSERVED`) when
 *  reality moved on, so two panels editing at once cannot silently lose one
 *  edit. An empty collection with no file on disk is skipped entirely: there is
 *  nothing to persist, and writing it would only add a 3-byte `[]` file. */
async function writeArrayFile<T>(
  ctx: Context,
  path: string,
  items: readonly T[],
  serialize: (item: T) => Record<string, unknown>,
  guard: unknown,
): Promise<void> {
  if (ctx.fs === undefined) return
  if (items.length === 0 && guard === undefined) return
  const target = await ctx.fs.resolve(path)
  const expected: FsWriteIntent = guard === undefined
    ? { kind: 'createIfAbsent' }
    : { kind: 'replaceIfVersion', version: guard as FsVersion }
  await ctx.fs.writeText(target, stringify(items.map(serialize)), expected)
}

/** Read a project's rule set from its durable file (empty when missing). */
export async function readProject(ctx: Context, projectId: unknown): Promise<Rule[]> {
  if (ctx.fs === undefined || projectId === undefined || String(projectId).length === 0) return []
  return [...(await readArrayFile(ctx, projectRulesPath(projectId), 'project rules', sanitizeRules)).items]
}

/** Replace a project's rule set in its durable file. */
export async function writeProject(
  ctx: Context,
  projectId: unknown,
  rules: readonly Rule[],
  guard?: unknown,
): Promise<void> {
  if (ctx.fs === undefined || projectId === undefined || String(projectId).length === 0) return
  await writeArrayFile(ctx, projectRulesPath(projectId), rules, serializeRule, guard)
}

/** Read the global rule set, tolerating a missing file and reporting a corrupt one. */
export async function readGlobal(ctx: Context, config: { globalRulesPath?: string }): Promise<Rule[]> {
  if (ctx.fs === undefined) return []
  return [...(await readArrayFile(ctx, globalRulesPath(ctx, config), 'global rules', sanitizeRules)).items]
}

/** Write the global rule set. */
export async function writeGlobal(
  ctx: Context,
  config: { globalRulesPath?: string },
  rules: readonly Rule[],
  guard?: unknown,
): Promise<void> {
  if (ctx.fs === undefined) return
  await writeArrayFile(ctx, globalRulesPath(ctx, config), rules, serializeRule, guard)
}

/** Read the per-session rule set from its durable file (empty when missing). */
export async function readSession(ctx: Context, sessionId: unknown): Promise<Rule[]> {
  if (ctx.fs === undefined) return []
  return [...(await readArrayFile(ctx, sessionRulesPath(sessionId), 'session rules', sanitizeRules)).items]
}

/** Replace the per-session rule set in its durable file. */
export async function writeSession(
  ctx: Context,
  sessionId: unknown,
  rules: readonly Rule[],
  guard?: unknown,
): Promise<void> {
  if (ctx.fs === undefined) return
  await writeArrayFile(ctx, sessionRulesPath(sessionId), rules, serializeRule, guard)
}

/** Read the shared template library (empty when missing), with its freshness
 *  token so a write can be guarded against a concurrent panel edit. */
export async function readTemplatesWithVersion(ctx: Context): Promise<FileRead<RuleTemplate>> {
  return readArrayFile(ctx, templatesPath(), 'templates', sanitizeTemplates)
}

/** Read the shared template library (empty when missing). */
export async function readTemplates(ctx: Context): Promise<RuleTemplate[]> {
  return [...(await readTemplatesWithVersion(ctx)).items]
}

/** Replace the shared template library in its durable file. */
export async function writeTemplates(
  ctx: Context,
  templates: readonly RuleTemplate[],
  guard?: unknown,
): Promise<void> {
  if (ctx.fs === undefined) return
  await writeArrayFile(ctx, templatesPath(), templates, serializeTemplate, guard)
}

/** Diagnostics entry point for the invariant companion: every store file that
 *  exists but cannot be read as a rules/templates array.
 *
 *  Runtime reading degrades such a file to an empty scope (see {@link readArrayFile}),
 *  which keeps conversations working — and also keeps the damage invisible until
 *  someone asks. This is what asks. It never throws, so an invariant can report the
 *  problems it finds instead of failing on the way to them.
 *
 *  Only the two singleton files are checked: session and project rules need a live
 *  session, so their health is reported on the paths that read them (the command
 *  output and the panel). */
export async function storeProblems(ctx: Context): Promise<readonly string[]> {
  if (ctx.fs === undefined) return []
  const [global, templates] = await Promise.all([
    readArrayFile(ctx, dshHomePath('rules', 'global.json'), 'global rules', sanitizeRules),
    readArrayFile(ctx, templatesPath(), 'templates', sanitizeTemplates),
  ])
  return [global.problem, templates.problem].filter((problem): problem is string => problem !== undefined)
}

/** Whether a failed write lost an optimistic-concurrency race: someone else
 *  created or edited the same file between our read and our write. Callers turn
 *  this into a 409 (HTTP) or a "reload and retry" message (command). */
export function isStaleWrite(e: unknown): boolean {
  const code = (e as { code?: unknown } | undefined)?.code
  return code === 'FS_STALE_VERSION' || code === 'FS_NOT_OBSERVED'
}

/** Assemble the merged view used for injection and `/baize-rules list`.
 *
 *  `project` joins the view whenever the session declares a working directory
 *  (or the caller passes one explicitly, as the HTTP API does), which is what
 *  makes project rules actually reach the model. Templates are deliberately NOT
 *  part of the view: they must never leak into the injection path or the list
 *  output. */
export async function view(
  ctx: Context,
  agent: Agent,
  config: { globalRulesPath?: string },
  projectOverride?: string,
): Promise<RuleView> {
  const cwd = projectOverride !== undefined && projectOverride.length > 0 ? projectOverride : agentCwd(agent)
  const globalRead = await readArrayFile(ctx, globalRulesPath(ctx, config), 'global rules', sanitizeRules)
  const sessionRead = await readArrayFile(ctx, sessionRulesPath(agent.id), 'session rules', sanitizeRules)
  const projectRead = cwd.length > 0
    ? await readArrayFile(ctx, projectRulesPath(cwd), 'project rules', sanitizeRules)
    : undefined

  const problems = [globalRead, sessionRead, projectRead]
    .flatMap(read => (read?.problem === undefined ? [] : [read.problem]))
  const versions: ScopeVersions = {
    global: globalRead.version,
    session: sessionRead.version,
    ...(projectRead === undefined ? {} : { project: projectRead.version }),
  }

  return {
    global: [...globalRead.items],
    session: [...sessionRead.items],
    ...(projectRead === undefined ? {} : { project: [...projectRead.items] }),
    ...(problems.length === 0 ? {} : { problems }),
    versions,
  }
}
