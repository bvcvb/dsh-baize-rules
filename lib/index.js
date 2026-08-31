/**
 * User-set session/global must-do and must-not requirements injected at
 * conversation start. Named for 白泽 (Baize), the beast that knows all and
 * distinguishes right from wrong — hence the must/mustNot framing.
 *
 * @module dsh-baize-rules
 */
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { renderDigest, renderRules } from "./rules.js";
import { view } from "./store.js";
import { handle } from "./command.js";
import { registerRulesApi } from "./api.js";
/** Cordis plugin name used by loader diagnostics + the injected message source. */
export const name = 'baize-rules';
/** Services granted on `ctx` by cordis before `apply` runs. We use `ctx.agents`
 *  (agent-plane scoping), `ctx.commands` (register /baize-rules), `ctx.fs`
 *  (persist global + session rule files), and `ctx.webServer` (rules panel API);
 *  each must be declared in `inject`. */
export const inject = ['agents', 'commands', 'fs', 'webServer', 'sessions'];
/** Schemastery validation for {@link Config}. */
export const Config = z.object({
    scope: z.union([z.const('global'), z.const('session')]),
    maxBytes: z.number().required(),
    globalRulesPath: z.string(),
    injectAtEveryStep: z.boolean(),
});
/** Per-session digest of the last injected rules, used to suppress duplicate injection. */
const lastInjected = /* @__PURE__ */ new WeakMap();
/**
 * Register a prepended pre-step listener that injects the rendered rules as a
 * durable user message on conversation start, plus the `/rules` command.
 * @param ctx - plugin context; listener and command dispose with it.
 * @param config - scope, budget, and redundancy policy.
 */
export function apply(ctx, config) {
    // `/rules scope` mutates this process-visible default, so the command and the
    // pre-step view always read the current choice.
    const mutableScope = { scope: config.scope };
    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted)
            return decision;
        const v = await view(ctx, agent, config);
        const text = renderRules(v, config.maxBytes);
        if (text === undefined)
            return decision;
        const digest = await renderDigest(v, config.maxBytes);
        const previous = lastInjected.get(agent.session);
        if (!config.injectAtEveryStep && previous !== undefined && previous === digest)
            return decision;
        lastInjected.set(agent.session, digest ?? '');
        return {
            kind: 'enter',
            messages: [
                ...decision.messages,
                createUserMessage({
                    content: [{ type: 'text', text }],
                    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
                }),
            ],
        };
    }, { prepend: true });
    ctx.effect(function* () {
        const runtime = {
            globalRulesPath: config.globalRulesPath,
            getScope: () => mutableScope.scope,
            setScope: (scope) => { mutableScope.scope = scope; },
        };
        yield ctx.commands.register({
            name: 'baize-rules',
            description: '查看/增删改 会话或全局的 必须/禁止 要求',
            input: {
                hint: 'list | add <text> | remove <id> | enable|disable <id> | scope <global|session|project> | clear <scope> | export',
            },
            handler: invocation => handle(ctx, invocation, runtime),
        });
    }, 'baize-rules lifecycle');
    // Host HTTP API for the rules panel (client reads/writes here).
    ctx.effect(() => registerRulesApi(ctx, { globalRulesPath: config.globalRulesPath }), 'baize-rules api');
}
