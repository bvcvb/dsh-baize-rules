/**
 * Thin dsh adapter for the `/baize-rules` command: feeds the live `view`, the
 * template library, and the current `defaultScope` into the dependency-free
 * decision core (`core.ts`), then persists the resulting `nextView` /
 * `nextTemplates` and any `/baize-rules scope` default change. The file IO behind
 * `tmpl export <file>` / `tmpl import <file>` also lives here — the core never
 * touches the filesystem.
 *
 * Persistence is deliberately narrow:
 *  - only the scopes whose array identity actually changed are rewritten
 *    (`core` builds each scope immutably, so an untouched scope keeps its
 *    reference), which is also what keeps empty per-session files from piling up;
 *  - every write carries the freshness token captured by `view`, so a concurrent
 *    panel edit surfaces as a retryable conflict instead of a lost update.
 *
 * @module dsh-baize-rules/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { RuleScope, RuleView } from './rules.ts'
import { parseCommand, runCommand, type CommandOutput } from './core.ts'
import {
  agentCwd,
  isStaleWrite,
  readTemplatesWithVersion,
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

/** Shown when a write lost a concurrency race; nothing was persisted. */
const STALE_MESSAGE =
  'Rules changed elsewhere while this command ran — nothing was written. Run it again.'

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

/** Persist whatever the core decided to change, scope by scope. */
async function persist(
  ctx: Context,
  runtime: RulesRuntime,
  sessionId: unknown,
  cwd: string,
  before: RuleView,
  out: CommandOutput,
  templatesVersion: unknown,
): Promise<void> {
  if (out.nextView !== undefined) {
    if (out.nextView.global !== before.global) {
      await writeGlobal(ctx, { globalRulesPath: runtime.globalRulesPath }, out.nextView.global, before.versions?.global)
    }
    if (out.nextView.session !== before.session) {
      await writeSession(ctx, sessionId, out.nextView.session, before.versions?.session)
    }
    const project = out.nextView.project
    if (project !== undefined && project !== before.project && cwd.length > 0) {
      await writeProject(ctx, cwd, project, before.versions?.project)
    }
  }
  if (out.nextTemplates !== undefined) await writeTemplates(ctx, out.nextTemplates, templatesVersion)
}

/** The registered handler contract: adapt command input → core decision → persist. */
export async function handle(
  ctx: Context,
  invocation: CommandInvocation,
  runtime: RulesRuntime,
): Promise<CommandResult> {
  const cwd = agentCwd(invocation.agent)
  const v = await view(ctx, invocation.agent, { globalRulesPath: runtime.globalRulesPath }, cwd)
  const templatesRead = await readTemplatesWithVersion(ctx)

  const raw = invocation.rawInput
  const importArg = importPathOf(raw)
  const importPayload = importArg === undefined
    ? undefined
    : await readTextFile(ctx, resolveUserPath(importArg, cwd))

  const out = runCommand({
    raw,
    view: v,
    defaultScope: runtime.getScope(),
    templates: templatesRead.items,
    importPayload,
  })

  try {
    await persist(ctx, runtime, invocation.agent.id, cwd, v, out, templatesRead.version)
  } catch (e) {
    if (isStaleWrite(e)) return { kind: 'error', text: STALE_MESSAGE }
    throw e
  }
  if (out.exportFile !== undefined) {
    await writeTextFile(ctx, resolveUserPath(out.exportFile.path, cwd), out.exportFile.content)
  }
  if (out.defaultScope !== undefined) runtime.setScope(out.defaultScope)

  // A corrupt store file never fails the command, but the user must see it.
  const problems = [
    ...(v.problems ?? []),
    ...(templatesRead.problem === undefined ? [] : [templatesRead.problem]),
  ]
  const text = problems.length === 0 ? out.text : `${out.text}\n⚠ ${problems.join('\n⚠ ')}`
  return out.ok ? { kind: 'success', text } : { kind: 'error', text }
}
