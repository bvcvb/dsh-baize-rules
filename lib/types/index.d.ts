/**
 * User-set session/global must-do and must-not requirements injected at
 * conversation start. Named for 白泽 (Baize), the beast that knows all and
 * distinguishes right from wrong — hence the must/mustNot framing.
 *
 * @module dsh-baize-rules
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics + the injected message source. */
export declare const name = "baize-rules";
/** Services granted on `ctx` by cordis before `apply` runs. We use `ctx.agents`
 *  (agent-plane scoping), `ctx.commands` (register /baize-rules), `ctx.fs`
 *  (persist global + session rule files), and `ctx.webServer` (rules panel API);
 *  each must be declared in `inject`. */
export declare const inject: string[];
/** Policy for the rules plugin. Invalid values fail plugin load. */
export interface Config {
    /** Default scope that `/rules add|remove|...` edits when the line omits a scope keyword. */
    scope: 'global' | 'session';
    /** Model-visible byte budget; a tight budget sheds the broadest rules first. */
    maxBytes: number;
    /** Override the global rules file path (default `$DSH_HOME/rules/global.json`). */
    globalRulesPath?: string;
    /** When true, re-render an updated rules message on every step, not just on change. */
    injectAtEveryStep?: boolean;
}
/** Schemastery validation for {@link Config}. */
export declare const Config: z<Config>;
/**
 * Register a prepended pre-step listener that injects the rendered rules as a
 * durable user message on conversation start, plus the `/rules` command.
 * @param ctx - plugin context; listener and command dispose with it.
 * @param config - scope, budget, and redundancy policy.
 */
export declare function apply(ctx: Context, config: Config): void;
