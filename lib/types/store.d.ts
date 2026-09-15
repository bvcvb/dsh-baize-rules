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
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Rule, RuleTemplate, RuleView } from './rules.ts';
/** Resolve the shared template library file: `$DSH_HOME/rules/templates.json`. */
export declare function templatesPath(): string;
/** Validate a parsed array into well-formed templates, throwing on a malformed
 *  store entry: the file is ours, so a broken one must fail loud rather than
 *  silently drop part of the user's library. (Import files take the softer,
 *  collect-all-errors path in `core.ts` instead.) */
export declare function sanitizeTemplates(parsed: readonly unknown[]): RuleTemplate[];
/** Read a project's rule set from its durable file (empty when missing). */
export declare function readProject(ctx: Context, projectId: unknown): Promise<Rule[]>;
/** Replace a project's rule set in its durable file. */
export declare function writeProject(ctx: Context, projectId: unknown, rules: readonly Rule[]): Promise<void>;
/** Read the global rule set, tolerating a missing file and failing loud on a malformed store. */
export declare function readGlobal(ctx: Context, config: {
    globalRulesPath?: string;
}): Promise<Rule[]>;
/** Write the global rule set. */
export declare function writeGlobal(ctx: Context, config: {
    globalRulesPath?: string;
}, rules: readonly Rule[]): Promise<void>;
/** Read the per-session rule set from its durable file (empty when missing). */
export declare function readSession(ctx: Context, sessionId: unknown): Promise<Rule[]>;
/** Replace the per-session rule set in its durable file. */
export declare function writeSession(ctx: Context, sessionId: unknown, rules: readonly Rule[]): Promise<void>;
/** Read the shared template library (empty when missing). */
export declare function readTemplates(ctx: Context): Promise<RuleTemplate[]>;
/** Replace the shared template library in its durable file. */
export declare function writeTemplates(ctx: Context, templates: readonly RuleTemplate[]): Promise<void>;
/** Assemble the merged view used for injection and `/rules list`. Templates are
 *  deliberately NOT part of the view: they must never leak into the injection
 *  path or the list output. */
export declare function view(ctx: Context, agent: Agent, config: {
    globalRulesPath?: string;
}): Promise<RuleView>;
