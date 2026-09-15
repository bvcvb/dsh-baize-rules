/**
 * User-set session/global must-do and must-not requirements injected at
 * conversation start. Named for 白泽 (Baize), the beast that knows all and
 * distinguishes right from wrong — hence the must/mustNot framing.
 *
 * @module dsh-baize-rules
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RuleScope } from './rules.ts'
import { renderDigest, renderRules } from './rules.ts'
import { view } from './store.ts'
import { handle, type RulesRuntime } from './command.ts'
import { registerRulesApi } from './api.ts'

/** Cordis plugin name used by loader diagnostics + the injected message source. */
export const name = 'baize-rules'

/** Services granted on `ctx` by cordis before `apply` runs. We use `ctx.agents`
 *  (agent-plane scoping), `ctx.commands` (register /baize-rules), `ctx.fs`
 *  (persist global + session rule files), and `ctx.webServer` (rules panel API);
 *  each must be declared in `inject`. */
export const inject = ['agents', 'commands', 'fs', 'webServer', 'sessions']

/** Policy for the rules plugin. Invalid values fail plugin load. */
export interface Config {
  /** Default scope that `/rules add|remove|...` edits when the line omits a scope keyword. */
  scope: 'global' | 'session'
  /** Model-visible byte budget; a tight budget sheds the broadest rules first. */
  maxBytes: number
  /** Override the global rules file path (default `$DSH_HOME/rules/global.json`). */
  globalRulesPath?: string
  /** When true, re-render an updated rules message on every step, not just on change. */
  injectAtEveryStep?: boolean
  /** When true, prefix each injected bullet with its `[tag,tag]` labels. Off by
   *  default: tags are a panel-side classification aid, and injecting them both
   *  spends the byte budget and adds noise to every request. */
  injectTags?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  scope: z.union([z.const('global'), z.const('session')]),
  maxBytes: z.number().required(),
  globalRulesPath: z.string(),
  injectAtEveryStep: z.boolean(),
  injectTags: z.boolean(),
})

/** Per-session digest of the last injected rules, used to suppress duplicate injection. */
const lastInjected = /* @__PURE__ */ new WeakMap<Agent['session'], string>()

/**
 * Register a prepended pre-step listener that injects the rendered rules as a
 * durable user message on conversation start, plus the `/rules` command.
 * @param ctx - plugin context; listener and command dispose with it.
 * @param config - scope, budget, and redundancy policy.
 */
export function apply(ctx: Context, config: Config): void {
  // `/rules scope` mutates this process-visible default, so the command and the
  // pre-step view always read the current choice.
  const mutableScope: { scope: RuleScope } = { scope: config.scope }

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const v = await view(ctx, agent, config)
    const render = { injectTags: config.injectTags === true }
    const text = renderRules(v, config.maxBytes, render)
    if (text === undefined) return decision
    const digest = await renderDigest(v, config.maxBytes, render)
    const previous = lastInjected.get(agent.session)
    if (!config.injectAtEveryStep && previous !== undefined && previous === digest) return decision
    lastInjected.set(agent.session, digest ?? '')
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })

  ctx.effect(function* () {
    const runtime: RulesRuntime = {
      globalRulesPath: config.globalRulesPath,
      getScope: () => mutableScope.scope,
      setScope: (scope) => { mutableScope.scope = scope },
    }
    yield ctx.commands.register({
      name: 'baize-rules',
      description: '查看/增删改 会话或全局的 必须/禁止 要求，并管理可复用的规则模板',
      input: {
        hint: 'list | add <text> | remove <id> | enable|disable <id> | tag <id> <tag…> | save <id> | from <id|#tag> | tmpl list|add|edit|rm|export|import | scope | clear | export',
      },
      handler: invocation => handle(ctx, invocation, runtime),
    })
  }, 'baize-rules lifecycle')

  // Host HTTP API for the rules panel (client reads/writes here).
  ctx.effect(() => registerRulesApi(ctx, { globalRulesPath: config.globalRulesPath }), 'baize-rules api')
}
