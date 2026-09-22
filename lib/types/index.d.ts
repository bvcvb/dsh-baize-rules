/**
 * User-set session/global must-do and must-not requirements injected at
 * conversation start. Named for 白泽 (Baize), the beast that knows all and
 * distinguishes right from wrong — hence the must/mustNot framing.
 *
 * @module dsh-baize-rules
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RuleScope } from './rules.ts';
/** Cordis plugin name used by loader diagnostics + the injected message source. */
export declare const name = "baize-rules";
/** Services granted on `ctx` by cordis before `apply` runs. We use `ctx.agents`
 *  (agent-plane scoping), `ctx.commands` (register /baize-rules), `ctx.fs`
 *  (persist global + session rule files), and `ctx.webServer` (rules panel API);
 *  each must be declared in `inject`. */
export declare const inject: string[];
/** Policy for the rules plugin. Invalid values fail plugin load. */
export interface Config {
    /** Default scope that `/baize-rules add|remove|…` edits when the line omits a
     *  scope keyword. Any of the three scopes is a valid default, `project`
     *  included: it resolves against the session's working directory. */
    scope: RuleScope;
    /** Model-visible byte budget; a tight budget sheds the broadest rules first. */
    maxBytes: number;
    /** Override the global rules file path (default `$DSH_HOME/rules/global.json`). */
    globalRulesPath?: string;
    /** When true, re-render an updated rules message on every step, not just on change. */
    injectAtEveryStep?: boolean;
    /** When true, prefix each injected bullet with its `[tag,tag]` labels. Off by
     *  default: tags are a panel-side classification aid, and injecting them both
     *  spends the byte budget and adds noise to every request. */
    injectTags?: boolean;
    /** When true, the panel API accepts only requests from this machine whose
     *  browser Origin is the host's own; anything else is refused with `403`. Off by
     *  default: the web UI is routinely reached through a reverse proxy, where the
     *  request arrives from the proxy's address instead of loopback. Turn it on when
     *  the port is reachable by others and no proxy layer authenticates the callers. */
    apiOriginCheck?: boolean;
    /** Republish the snapshot after this many steps even when nothing changed, so
     *  the rules never sit only at the very start of a long conversation. `0`
     *  disables the periodic refresh. Defaults to 20. */
    refreshAfterSteps?: number;
}
/** Schemastery validation for {@link Config}. Both `scope` and `maxBytes` are
 *  required: a missing one is a configuration mistake, and silently falling back
 *  to an undefined default scope is worse than failing the plugin load. */
export declare const Config: z<Config>;
/**
 * Register a prepended pre-step listener that injects the rendered rules as a
 * durable user message on conversation start, plus the `/baize-rules` command.
 * @param ctx - plugin context; listener and command dispose with it.
 * @param config - scope, budget, and redundancy policy.
 */
export declare function apply(ctx: Context, config: Config): void;
