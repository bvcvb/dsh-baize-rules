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
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { normalizeTags } from "./rules.js";
/** Resolve the global rules path (config override, else `$DSH_HOME/rules/global.json`). */
function globalRulesPath(ctx, config) {
    return config.globalRulesPath ?? dshHomePath('rules', 'global.json');
}
/** Resolve one session's rules file: `$DSH_HOME/rules/sessions/<sessionId>.json`. */
function sessionRulesPath(sessionId) {
    return dshHomePath('rules', 'sessions', `${String(sessionId)}.json`);
}
/** Slug a project (cwd) into a safe filename for `$DSH_HOME/rules/projects/<slug>.json`. */
function projectSlug(projectId) {
    return String(projectId).replace(/[\\/:*?"<>|]/g, '_').replace(/^_+|_+$/g, '') || '_';
}
/** Resolve one project's rules file (project = session cwd). Exported for tests
 *  and for docs that need to point a user at the exact file. */
export function projectRulesPath(projectId) {
    return dshHomePath('rules', 'projects', `${projectSlug(projectId)}.json`);
}
/** Resolve the shared template library file: `$DSH_HOME/rules/templates.json`. */
export function templatesPath() {
    return dshHomePath('rules', 'templates.json');
}
/** The working directory a session declares, or `''` when it has none. */
export function agentCwd(agent) {
    const header = agent?.session?.header;
    return typeof header?.cwd === 'string' ? header.cwd : '';
}
/** One rule as it lands on disk: `tags` is omitted when empty, so a file that
 *  never used tags stays byte-identical to the pre-tags format. */
function serializeRule(rule) {
    const out = { id: rule.id, text: rule.text };
    if (rule.tags !== undefined && rule.tags.length > 0)
        out.tags = [...rule.tags];
    out.enabled = rule.enabled;
    out.createdAt = rule.createdAt;
    out.updatedAt = rule.updatedAt;
    return out;
}
/** One template as it lands on disk (`uses` always present, defaulting to 0). */
function serializeTemplate(template) {
    return {
        id: template.id,
        text: template.text,
        tags: [...template.tags],
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        uses: template.uses ?? 0,
    };
}
/** Pretty-print a collection the way every store file is written. */
function stringify(items) {
    return `${JSON.stringify(items, null, 2)}\n`;
}
/** Validate a parsed array into well-formed rules; drop the malformed entries loudly.
 *  Rules are plain text — there is no `kind` field anymore, but legacy stored
 *  entries that carried `kind` are accepted (the field is ignored on rewrite).
 *  `tags` is optional: a file written before tags existed loads as an empty list. */
function sanitizeRules(parsed) {
    return parsed.flatMap((item) => {
        if (typeof item !== 'object' || item === null)
            throw new Error('rules: entry is not an object');
        const rule = item;
        const { text, id } = rule;
        if (typeof text !== 'string' || typeof id !== 'string') {
            throw new Error('rules: entry must carry string id and text');
        }
        return [{
                id,
                text,
                tags: normalizeTags(rule.tags),
                enabled: rule.enabled !== false,
                createdAt: typeof rule.createdAt === 'number' ? rule.createdAt : 0,
                updatedAt: typeof rule.updatedAt === 'number' ? rule.updatedAt : 0,
            }];
    });
}
/** Validate a parsed array into well-formed templates, throwing on a malformed
 *  store entry: the file is ours, so a broken one must fail loud rather than
 *  silently drop part of the user's library. (Import files take the softer,
 *  collect-all-errors path in `core.ts` instead.) The throw is caught by
 *  {@link readArrayFile}, so it surfaces as a `problem`, not as a failed step. */
export function sanitizeTemplates(parsed) {
    return parsed.map((item) => {
        if (typeof item !== 'object' || item === null)
            throw new Error('rules: template entry is not an object');
        const template = item;
        const { text, id } = template;
        if (typeof text !== 'string' || typeof id !== 'string') {
            throw new Error('rules: template entry must carry string id and text');
        }
        return {
            id,
            text,
            tags: normalizeTags(template.tags),
            createdAt: typeof template.createdAt === 'number' ? template.createdAt : 0,
            updatedAt: typeof template.updatedAt === 'number' ? template.updatedAt : 0,
            uses: typeof template.uses === 'number' && template.uses > 0 ? Math.floor(template.uses) : 0,
        };
    });
}
function describe(e) {
    return e instanceof Error ? e.message : String(e);
}
/** Read a store file, degrading instead of throwing: a missing file is empty, a
 *  corrupt one is empty + `problem`. Shared by rules and templates. */
async function readArrayFile(ctx, path, label, sanitize) {
    if (ctx.fs === undefined)
        return { items: [] };
    const target = await ctx.fs.resolve(path);
    let version;
    try {
        const info = await ctx.fs.stat(target);
        if (info === undefined)
            return { items: [] };
        version = info.version;
        const raw = await ctx.fs.readText(target);
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return { items: [], version, problem: `${label} file is not a JSON array: ${path}` };
        }
        return { items: sanitize(parsed), version };
    }
    catch (e) {
        return { items: [], version, problem: `${label}: ${describe(e)} (${path})` };
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
async function writeArrayFile(ctx, path, items, serialize, guard) {
    if (ctx.fs === undefined)
        return;
    if (items.length === 0 && guard === undefined)
        return;
    const target = await ctx.fs.resolve(path);
    const expected = guard === undefined
        ? { kind: 'createIfAbsent' }
        : { kind: 'replaceIfVersion', version: guard };
    await ctx.fs.writeText(target, stringify(items.map(serialize)), expected);
}
/** Read a project's rule set from its durable file (empty when missing). */
export async function readProject(ctx, projectId) {
    if (ctx.fs === undefined || projectId === undefined || String(projectId).length === 0)
        return [];
    return [...(await readArrayFile(ctx, projectRulesPath(projectId), 'project rules', sanitizeRules)).items];
}
/** Replace a project's rule set in its durable file. */
export async function writeProject(ctx, projectId, rules, guard) {
    if (ctx.fs === undefined || projectId === undefined || String(projectId).length === 0)
        return;
    await writeArrayFile(ctx, projectRulesPath(projectId), rules, serializeRule, guard);
}
/** Read the global rule set, tolerating a missing file and reporting a corrupt one. */
export async function readGlobal(ctx, config) {
    if (ctx.fs === undefined)
        return [];
    return [...(await readArrayFile(ctx, globalRulesPath(ctx, config), 'global rules', sanitizeRules)).items];
}
/** Write the global rule set. */
export async function writeGlobal(ctx, config, rules, guard) {
    if (ctx.fs === undefined)
        return;
    await writeArrayFile(ctx, globalRulesPath(ctx, config), rules, serializeRule, guard);
}
/** Read the per-session rule set from its durable file (empty when missing). */
export async function readSession(ctx, sessionId) {
    if (ctx.fs === undefined)
        return [];
    return [...(await readArrayFile(ctx, sessionRulesPath(sessionId), 'session rules', sanitizeRules)).items];
}
/** Replace the per-session rule set in its durable file. */
export async function writeSession(ctx, sessionId, rules, guard) {
    if (ctx.fs === undefined)
        return;
    await writeArrayFile(ctx, sessionRulesPath(sessionId), rules, serializeRule, guard);
}
/** Read the shared template library (empty when missing), with its freshness
 *  token so a write can be guarded against a concurrent panel edit. */
export async function readTemplatesWithVersion(ctx) {
    return readArrayFile(ctx, templatesPath(), 'templates', sanitizeTemplates);
}
/** Read the shared template library (empty when missing). */
export async function readTemplates(ctx) {
    return [...(await readTemplatesWithVersion(ctx)).items];
}
/** Replace the shared template library in its durable file. */
export async function writeTemplates(ctx, templates, guard) {
    if (ctx.fs === undefined)
        return;
    await writeArrayFile(ctx, templatesPath(), templates, serializeTemplate, guard);
}
/** Whether a failed write lost an optimistic-concurrency race: someone else
 *  created or edited the same file between our read and our write. Callers turn
 *  this into a 409 (HTTP) or a "reload and retry" message (command). */
export function isStaleWrite(e) {
    const code = e?.code;
    return code === 'FS_STALE_VERSION' || code === 'FS_NOT_OBSERVED';
}
/** Assemble the merged view used for injection and `/baize-rules list`.
 *
 *  `project` joins the view whenever the session declares a working directory
 *  (or the caller passes one explicitly, as the HTTP API does), which is what
 *  makes project rules actually reach the model. Templates are deliberately NOT
 *  part of the view: they must never leak into the injection path or the list
 *  output. */
export async function view(ctx, agent, config, projectOverride) {
    const cwd = projectOverride !== undefined && projectOverride.length > 0 ? projectOverride : agentCwd(agent);
    const globalRead = await readArrayFile(ctx, globalRulesPath(ctx, config), 'global rules', sanitizeRules);
    const sessionRead = await readArrayFile(ctx, sessionRulesPath(agent.id), 'session rules', sanitizeRules);
    const projectRead = cwd.length > 0
        ? await readArrayFile(ctx, projectRulesPath(cwd), 'project rules', sanitizeRules)
        : undefined;
    const problems = [globalRead, sessionRead, projectRead]
        .flatMap(read => (read?.problem === undefined ? [] : [read.problem]));
    const versions = {
        global: globalRead.version,
        session: sessionRead.version,
        ...(projectRead === undefined ? {} : { project: projectRead.version }),
    };
    return {
        global: [...globalRead.items],
        session: [...sessionRead.items],
        ...(projectRead === undefined ? {} : { project: [...projectRead.items] }),
        ...(problems.length === 0 ? {} : { problems }),
        versions,
    };
}
