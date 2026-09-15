/**
 * Durable rule store: `global` and `session` rules both persist to JSON files
 * under DSH_HOME — `global` to `$DSH_HOME/rules/global.json`, and each session's
 * rules to `$DSH_HOME/rules/sessions/<sessionId>.json`. Files are read lazily at
 * every view/pre-step and written on every mutating `/rules` command, so both
 * scopes survive process restarts. `ctx.fs.writeText` creates parent dirs.
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
import type {} from '@deepseek-ai/dsh-fs' // augments Context with `fs`
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Rule, RuleTemplate, RuleView } from './rules.ts'
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
/** Resolve one project's rules file (project = session cwd). */
function projectRulesPath(projectId: unknown): string {
  return dshHomePath('rules', 'projects', `${projectSlug(projectId)}.json`)
}

/** Resolve the shared template library file: `$DSH_HOME/rules/templates.json`. */
export function templatesPath(): string {
  return dshHomePath('rules', 'templates.json')
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
 *  collect-all-errors path in `core.ts` instead.) */
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

/** Read a project's rule set from its durable file (empty when missing). */
export async function readProject(ctx: Context, projectId: unknown): Promise<Rule[]> {
  if (ctx.fs === undefined || projectId === undefined || String(projectId).length === 0) return []
  const path = projectRulesPath(projectId)
  const target = await ctx.fs.resolve(path)
  const info = await ctx.fs.stat(target)
  if (info === undefined) return []
  const raw = await ctx.fs.readText(target)
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error(`rules: project rules file is not a JSON array: ${path}`)
  return sanitizeRules(parsed)
}

/** Replace a project's rule set in its durable file. */
export async function writeProject(ctx: Context, projectId: unknown, rules: readonly Rule[]): Promise<void> {
  if (ctx.fs === undefined || projectId === undefined || String(projectId).length === 0) return
  const path = projectRulesPath(projectId)
  const target = await ctx.fs.resolve(path)
  await ctx.fs.writeText(target, stringify(rules.map(serializeRule)))
}

/** Read the global rule set, tolerating a missing file and failing loud on a malformed store. */
export async function readGlobal(ctx: Context, config: { globalRulesPath?: string }): Promise<Rule[]> {
  if (ctx.fs === undefined) return []
  const path = globalRulesPath(ctx, config)
  const target = await ctx.fs.resolve(path)
  const info = await ctx.fs.stat(target)
  if (info === undefined) return []
  const raw = await ctx.fs.readText(target)
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error(`rules: global rules file is not a JSON array: ${path}`)
  return sanitizeRules(parsed)
}

/** Write the global rule set. */
export async function writeGlobal(ctx: Context, config: { globalRulesPath?: string }, rules: readonly Rule[]): Promise<void> {
  if (ctx.fs === undefined) return
  const path = globalRulesPath(ctx, config)
  const target = await ctx.fs.resolve(path)
  await ctx.fs.writeText(target, stringify(rules.map(serializeRule)))
}

/** Read the per-session rule set from its durable file (empty when missing). */
export async function readSession(ctx: Context, sessionId: unknown): Promise<Rule[]> {
  if (ctx.fs === undefined) return []
  const path = sessionRulesPath(sessionId)
  const target = await ctx.fs.resolve(path)
  const info = await ctx.fs.stat(target)
  if (info === undefined) return []
  const raw = await ctx.fs.readText(target)
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error(`rules: session rules file is not a JSON array: ${path}`)
  return sanitizeRules(parsed)
}

/** Replace the per-session rule set in its durable file. */
export async function writeSession(ctx: Context, sessionId: unknown, rules: readonly Rule[]): Promise<void> {
  if (ctx.fs === undefined) return
  const path = sessionRulesPath(sessionId)
  const target = await ctx.fs.resolve(path)
  await ctx.fs.writeText(target, stringify(rules.map(serializeRule)))
}

/** Read the shared template library (empty when missing). */
export async function readTemplates(ctx: Context): Promise<RuleTemplate[]> {
  if (ctx.fs === undefined) return []
  const path = templatesPath()
  const target = await ctx.fs.resolve(path)
  const info = await ctx.fs.stat(target)
  if (info === undefined) return []
  const raw = await ctx.fs.readText(target)
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error(`rules: templates file is not a JSON array: ${path}`)
  return sanitizeTemplates(parsed)
}

/** Replace the shared template library in its durable file. */
export async function writeTemplates(ctx: Context, templates: readonly RuleTemplate[]): Promise<void> {
  if (ctx.fs === undefined) return
  const path = templatesPath()
  const target = await ctx.fs.resolve(path)
  await ctx.fs.writeText(target, stringify(templates.map(serializeTemplate)))
}

/** Assemble the merged view used for injection and `/rules list`. Templates are
 *  deliberately NOT part of the view: they must never leak into the injection
 *  path or the list output. */
export async function view(ctx: Context, agent: Agent, config: { globalRulesPath?: string }): Promise<RuleView> {
  return {
    global: await readGlobal(ctx, config),
    session: await readSession(ctx, agent.id),
  }
}
