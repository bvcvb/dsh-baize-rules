/**
 * Thin dsh adapter for the `/rules` command: feeds the live `view` + current
 * `defaultScope` into the dependency-free decision core (`core.ts`), then
 * persists the resulting `nextView` (global → disk, session → memory) and any
 * `/rules scope` default change.
 *
 * @module dsh-baize-rules/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { RuleScope } from './rules.ts'
import { runCommand } from './core.ts'
import { view, writeGlobal, writeSession, readProject, writeProject } from './store.ts'

/** Runtime state the command handler needs from the plugin's `apply`. */
export interface RulesRuntime {
  readonly globalRulesPath?: string
  readonly getScope: () => RuleScope
  readonly setScope: (scope: RuleScope) => void
}

/** The registered handler contract: adapt command input → core decision → persist. */
export async function handle(
  ctx: Context,
  invocation: CommandInvocation,
  runtime: RulesRuntime,
): Promise<CommandResult> {
  const cwd = (invocation.agent.session?.header as { cwd?: string } | undefined)?.cwd ?? ''
  const v = await view(ctx, invocation.agent, { globalRulesPath: runtime.globalRulesPath })
  const viewWithProject = cwd ? { ...v, project: await readProject(ctx, cwd) } : v
  const out = runCommand({
    raw: invocation.rawInput,
    view: viewWithProject,
    defaultScope: runtime.getScope(),
  })

  if (out.nextView !== undefined) {
    await writeGlobal(ctx, { globalRulesPath: runtime.globalRulesPath }, out.nextView.global)
    await writeSession(ctx, invocation.agent.id, out.nextView.session)
    if (cwd) await writeProject(ctx, cwd, out.nextView.project ?? [])
  }
  if (out.defaultScope !== undefined) runtime.setScope(out.defaultScope)

  return out.ok ? { kind: 'success', text: out.text } : { kind: 'error', text: out.text }
}
