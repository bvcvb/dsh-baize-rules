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
import { digestOfText, renderRules } from './rules.ts'
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
  /** Default scope that `/baize-rules add|remove|…` edits when the line omits a
   *  scope keyword. Any of the three scopes is a valid default, `project`
   *  included: it resolves against the session's working directory. */
  scope: RuleScope
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

/** Schemastery validation for {@link Config}. Both `scope` and `maxBytes` are
 *  required: a missing one is a configuration mistake, and silently falling back
 *  to an undefined default scope is worse than failing the plugin load. */
export const Config: z<Config> = z.object({
  scope: z.union([z.const('global'), z.const('session'), z.const('project')]).required(),
  maxBytes: z.number().required(),
  globalRulesPath: z.string(),
  injectAtEveryStep: z.boolean(),
  injectTags: z.boolean(),
})

/** Per-session digest of the last injected rules, used to suppress duplicate injection. */
const lastInjected = /* @__PURE__ */ new WeakMap<Agent['session'], string>()

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
async function renderFor(
  ctx: Context,
  agent: Agent,
  config: Config,
  reportProblems: (problems: readonly string[] | undefined) => void,
): Promise<{ text: string; digest: string } | undefined> {
  try {
    const v = await view(ctx, agent, config)
    reportProblems(v.problems)
    const text = renderRules(v, config.maxBytes, { injectTags: config.injectTags === true })
    if (text === undefined) return undefined
    return { text, digest: await digestOfText(text) }
  } catch (e) {
    reportProblems([`injection failed: ${e instanceof Error ? e.message : String(e)}`])
    return undefined
  }
}

/** Best-effort warning through the host logger; a context without one is fine. */
function warnMissing(ctx: Context, message: string): void {
  try {
    const logger = (ctx as Context & { logger?: { warn?: (m: string) => void } }).logger
    logger?.warn?.(message)
  } catch {
    // Logging is never allowed to break injection.
  }
}

/**
 * Register a prepended pre-step listener that injects the rendered rules as a
 * durable user message on conversation start, plus the `/baize-rules` command.
 * @param ctx - plugin context; listener and command dispose with it.
 * @param config - scope, budget, and redundancy policy.
 */
export function apply(ctx: Context, config: Config): void {
  // `/baize-rules scope` mutates this process-visible default, so the command and
  // the pre-step view always read the current choice.
  const mutableScope: { scope: RuleScope } = { scope: config.scope }
  // One warning per distinct problem per plugin lifetime: a corrupt file is read
  // on every step, and repeating the same line each time would drown the log.
  const reported = new Set<string>()
  const reportProblems = (problems: readonly string[] | undefined): void => {
    if (problems === undefined) return
    for (const problem of problems) {
      if (reported.has(problem)) continue
      reported.add(problem)
      warnMissing(ctx, `[${name}] ${problem}`)
    }
  }

  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const injected = await renderFor(ctx, agent, config, reportProblems)
    if (injected === undefined) return decision
    const previous = lastInjected.get(agent.session)
    if (!config.injectAtEveryStep && previous !== undefined && previous === injected.digest) return decision
    lastInjected.set(agent.session, injected.digest)
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: injected.text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text: injected.text }] },
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
