/**
 * User-set session/global must-do and must-not requirements injected at
 * conversation start. Named for 白泽 (Baize), the beast that knows all and
 * distinguishes right from wrong — hence the must/mustNot framing.
 *
 * @module dsh-baize-rules
 */
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { digestOfText, renderRules } from "./rules.js";
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
/** Schemastery validation for {@link Config}. Both `scope` and `maxBytes` are
 *  required: a missing one is a configuration mistake, and silently falling back
 *  to an undefined default scope is worse than failing the plugin load. */
export const Config = z.object({
    scope: z.union([z.const('global'), z.const('session'), z.const('project')]).required(),
    maxBytes: z.number().required(),
    globalRulesPath: z.string(),
    injectAtEveryStep: z.boolean(),
    injectTags: z.boolean(),
    apiOriginCheck: z.boolean(),
    refreshAfterSteps: z.number(),
});
/** Re-publish the snapshot after this many steps even when the rendered text is
 *  unchanged, so a long conversation never keeps the rules only in its distant
 *  past. Overridable per deployment; `0` disables the periodic refresh. */
const DEFAULT_REFRESH_AFTER_STEPS = 20;
/** Per-session record of the last injected snapshot, used to suppress duplicate
 *  injection within this process.
 *
 *  Correctness does not depend on it: the message is published with
 *  `form: 'snapshot'`, and the host supersedes an earlier snapshot from the same
 *  producer with the later one (see `ContextForm` in `@deepseek-ai/dsh-llm`). What
 *  it saves is one redundant durable message per step. Only the rendered text is
 *  digested, so with `injectTags` off a pure retag does not re-publish.
 *
 *  It lives in memory, which is exactly why two refresh rules exist around it:
 *  `agent/session-start` drops the record (a compacted, cleared, or resumed
 *  session may no longer carry the earlier snapshot in its context), and a record
 *  older than `refreshAfterSteps` steps is republished so the rules are never
 *  stranded at the top of a long conversation. */
const lastInjected = /* @__PURE__ */ new WeakMap();
/**
 * Render the current rules once and digest that same string, or return undefined
 * when nothing should be injected (no enabled rule survives the byte budget).
 *
 * Never throws: the store degrades a corrupt file to an empty scope and reports
 * it as a `problem`, and anything unforeseen is contained here too. This runs on
 * every conversation's pre-step, so a broken JSON file must cost the injection,
 * not the step.
 *
 * @param ctx - plugin context (carries `fs`).
 * @param agent - the agent whose session scopes the view.
 * @param config - byte budget and tag-rendering policy.
 * @param reportProblems - called with non-fatal read failures, deduplicated by the caller.
 */
async function renderFor(ctx, agent, config, reportProblems) {
    try {
        const v = await view(ctx, agent, config);
        reportProblems(v.problems);
        const text = renderRules(v, config.maxBytes, { injectTags: config.injectTags === true });
        if (text === undefined)
            return undefined;
        return { text, digest: await digestOfText(text) };
    }
    catch (e) {
        reportProblems([`injection failed: ${e instanceof Error ? e.message : String(e)}`]);
        return undefined;
    }
}
/** Best-effort warning through the host logger; a context without one is fine. */
function warnMissing(ctx, message) {
    try {
        const logger = ctx.logger;
        logger?.warn?.(message);
    }
    catch {
        // Logging is never allowed to break injection.
    }
}
/**
 * Register a prepended pre-step listener that injects the rendered rules as a
 * durable user message on conversation start, plus the `/baize-rules` command.
 * @param ctx - plugin context; listener and command dispose with it.
 * @param config - scope, budget, and redundancy policy.
 */
export function apply(ctx, config) {
    // `/baize-rules scope` mutates this process-visible default, so the command and
    // the pre-step view always read the current choice.
    const mutableScope = { scope: config.scope };
    // One warning per distinct problem per plugin lifetime: a corrupt file is read
    // on every step, and repeating the same line each time would drown the log.
    const reported = new Set();
    const reportProblems = (problems) => {
        if (problems === undefined)
            return;
        for (const problem of problems) {
            if (reported.has(problem))
                continue;
            reported.add(problem);
            warnMissing(ctx, `[${name}] ${problem}`);
        }
    };
    // A compacted, cleared, or resumed session may no longer carry the earlier
    // snapshot in its context. Dropping the record makes the next step publish a
    // fresh full copy into the conversation as it stands now — this is the one case
    // where the rules could otherwise be lost for good.
    ctx.on('agent/session-start', ({ agent }) => {
        lastInjected.delete(agent.session);
    });
    ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
        const decision = await next();
        if (decision.kind === 'reject' || signal.aborted)
            return decision;
        const injected = await renderFor(ctx, agent, config, reportProblems);
        if (injected === undefined)
            return decision;
        const previous = lastInjected.get(agent.session);
        const unchanged = previous !== undefined && previous.digest === injected.digest;
        // Publish again when the text changed, when the last copy is `refreshAfterSteps`
        // steps old, or when the step counter went backwards (a compacted or cleared
        // session restarts its numbering).
        const refreshAfter = Math.max(0, config.refreshAfterSteps ?? DEFAULT_REFRESH_AFTER_STEPS);
        const stale = previous !== undefined
            && (step < previous.step || (refreshAfter > 0 && step - previous.step >= refreshAfter));
        if (!config.injectAtEveryStep && unchanged && !stale)
            return decision;
        lastInjected.set(agent.session, { digest: injected.digest, step });
        return {
            kind: 'enter',
            messages: [
                ...decision.messages,
                createUserMessage({
                    content: [{ type: 'text', text: injected.text }],
                    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text: injected.text }] },
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
            description: '查看/增删改 会话或全局的 必须/禁止 要求，并管理可复用的规则模板',
            input: {
                hint: 'list | add <text> | remove <id> | enable|disable <id> | tag <id> <tag…> | save <id> | from <id|#tag> | tmpl list|add|edit|rm|export|import | scope | clear | export',
            },
            handler: invocation => handle(ctx, invocation, runtime),
        });
    }, 'baize-rules lifecycle');
    // Host HTTP API for the rules panel (client reads/writes here).
    ctx.effect(() => registerRulesApi(ctx, {
        globalRulesPath: config.globalRulesPath,
        originCheck: config.apiOriginCheck !== false,
    }), 'baize-rules api');
}
