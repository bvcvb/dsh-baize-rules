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
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Rule, RuleTemplate, RuleView } from './rules.ts';
/** Resolve one project's rules file (project = session cwd). Exported for tests
 *  and for docs that need to point a user at the exact file. */
export declare function projectRulesPath(projectId: unknown): string;
/** Resolve the shared template library file: `$DSH_HOME/rules/templates.json`. */
export declare function templatesPath(): string;
/** The working directory a session declares, or `''` when it has none. */
export declare function agentCwd(agent: Agent): string;
/** Validate a parsed array into well-formed templates, throwing on a malformed
 *  store entry: the file is ours, so a broken one must fail loud rather than
 *  silently drop part of the user's library. (Import files take the softer,
 *  collect-all-errors path in `core.ts` instead.) The throw is caught by
 *  {@link readArrayFile}, so it surfaces as a `problem`, not as a failed step. */
export declare function sanitizeTemplates(parsed: readonly unknown[]): RuleTemplate[];
/** Outcome of one tolerant read: the items, the file's freshness token (absent
 *  when the file does not exist), and a human-readable failure when the file is
 *  there but unusable. */
export interface FileRead<T> {
    readonly items: readonly T[];
    readonly version?: unknown;
    readonly problem?: string;
}
/** Read a project's rule set from its durable file (empty when missing). */
export declare function readProject(ctx: Context, projectId: unknown): Promise<Rule[]>;
/** Replace a project's rule set in its durable file. */
export declare function writeProject(ctx: Context, projectId: unknown, rules: readonly Rule[], guard?: unknown): Promise<void>;
/** Read the global rule set, tolerating a missing file and reporting a corrupt one. */
export declare function readGlobal(ctx: Context, config: {
    globalRulesPath?: string;
}): Promise<Rule[]>;
/** Write the global rule set. */
export declare function writeGlobal(ctx: Context, config: {
    globalRulesPath?: string;
}, rules: readonly Rule[], guard?: unknown): Promise<void>;
/** Read the per-session rule set from its durable file (empty when missing). */
export declare function readSession(ctx: Context, sessionId: unknown): Promise<Rule[]>;
/** Replace the per-session rule set in its durable file. */
export declare function writeSession(ctx: Context, sessionId: unknown, rules: readonly Rule[], guard?: unknown): Promise<void>;
/** Read the shared template library (empty when missing), with its freshness
 *  token so a write can be guarded against a concurrent panel edit. */
export declare function readTemplatesWithVersion(ctx: Context): Promise<FileRead<RuleTemplate>>;
/** Read the shared template library (empty when missing). */
export declare function readTemplates(ctx: Context): Promise<RuleTemplate[]>;
/** Replace the shared template library in its durable file. */
export declare function writeTemplates(ctx: Context, templates: readonly RuleTemplate[], guard?: unknown): Promise<void>;
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
export declare function storeProblems(ctx: Context): Promise<readonly string[]>;
/** Whether a failed write lost an optimistic-concurrency race: someone else
 *  created or edited the same file between our read and our write. Callers turn
 *  this into a 409 (HTTP) or a "reload and retry" message (command). */
export declare function isStaleWrite(e: unknown): boolean;
/** Assemble the merged view used for injection and `/baize-rules list`.
 *
 *  `project` joins the view whenever the session declares a working directory
 *  (or the caller passes one explicitly, as the HTTP API does), which is what
 *  makes project rules actually reach the model. Templates are deliberately NOT
 *  part of the view: they must never leak into the injection path or the list
 *  output. */
export declare function view(ctx: Context, agent: Agent, config: {
    globalRulesPath?: string;
}, projectOverride?: string): Promise<RuleView>;
