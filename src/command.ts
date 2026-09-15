/**
 * Thin dsh adapter for the `/baize-rules` command: feeds the live `view`, the
 * template library, and the current `defaultScope` into the dependency-free
 * decision core (`core.ts`), then persists the resulting `nextView` /
 * `nextTemplates` and any `/rules scope` default change. The file IO behind
 * `tmpl export <file>` / `tmpl import <file>` also lives here — the core never
 * touches the filesystem.
 *
 * @module dsh-baize-rules/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { RuleScope } from './rules.ts'
import { parseCommand, runCommand } from './core.ts'
import {
  readProject,
  readTemplates,
  view,
  writeGlobal,
  writeProject,
  writeSession,
  writeTemplates,
} from './store.ts'

/** Runtime state the command handler needs from the plugin's `apply`. */
export interface RulesRuntime {
  readonly globalRulesPath?: string
  readonly getScope: () => RuleScope
  readonly setScope: (scope: RuleScope) => void
}

/** Read a text file through `ctx.fs`, or undefined when it is absent/unreadable. */
async function readTextFile(ctx: Context, path: string): Promise<string | undefined> {
  if (ctx.fs === undefined) return undefined
  try {
    const target = await ctx.fs.resolve(path)
    const info = await ctx.fs.stat(target)
    if (info === undefined) return undefined
    return await ctx.fs.readText(target)
  } catch {
    return undefined
  }
}

/** Write a text file through `ctx.fs` (creates parent directories). */
async function writeTextFile(ctx: Context, path: string, content: string): Promise<void> {
  if (ctx.fs === undefined) throw new Error('rules: filesystem service is unavailable')
  const target = await ctx.fs.resolve(path)
  await ctx.fs.writeText(target, content)
}

/** Resolve a user-supplied path against the session cwd (absolute paths win). */
function resolveUserPath(path: string, cwd: string): string {
  if (isAbsolute(path)) return path
  return cwd.length > 0 ? resolvePath(cwd, path) : path
}

/** The file named by a `tmpl import <file>` line, when the line is one. */
function importPathOf(raw: string): string | undefined {
  const parsed = parseCommand(raw)
  if (parsed.verb !== 'tmpl' || (parsed.args[0] ?? '') !== 'import') return undefined
  const path = parsed.args[1]
  return path !== undefined && path.length > 0 ? path : undefined
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
  const templates = await readTemplates(ctx)

  const raw = invocation.rawInput
  const importArg = importPathOf(raw)
  const importPayload = importArg === undefined
    ? undefined
    : await readTextFile(ctx, resolveUserPath(importArg, cwd))

  const out = runCommand({
    raw,
    view: viewWithProject,
    defaultScope: runtime.getScope(),
    templates,
    importPayload,
  })

  if (out.nextView !== undefined) {
    await writeGlobal(ctx, { globalRulesPath: runtime.globalRulesPath }, out.nextView.global)
    await writeSession(ctx, invocation.agent.id, out.nextView.session)
    if (cwd) await writeProject(ctx, cwd, out.nextView.project ?? [])
  }
  if (out.nextTemplates !== undefined) await writeTemplates(ctx, out.nextTemplates)
  if (out.exportFile !== undefined) {
    await writeTextFile(ctx, resolveUserPath(out.exportFile.path, cwd), out.exportFile.content)
  }
  if (out.defaultScope !== undefined) runtime.setScope(out.defaultScope)

  return out.ok ? { kind: 'success', text: out.text } : { kind: 'error', text: out.text }
}
