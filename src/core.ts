/**
 * Dependency-free rules-command core: parsing, scope resolution, and CRUD
 * application over a {@link RuleView}. No dsh runtime needed, so it is testable
 * in the Loop 0 harness (`pnpm test`). The dsh-facing adapter (`command.ts`)
 * feeds in the live `view` + `defaultScope` and persists `nextView`/`defaultScope`.
 *
 * @module dsh-baize-rules/core
 */

import type { Rule, RuleScope, RuleView } from './rules.ts'

export const RULE_SCOPES: readonly RuleScope[] = ['global', 'session', 'project']
const SCOPE_SET = new Set<RuleScope>(RULE_SCOPES)
/** Verbs where a trailing scope token is a *target* to modify, not an argument. */
const SCOPE_MODIFIER_VERBS = new Set<CommandVerb>(['add', 'remove', 'enable', 'disable'])

export type CommandVerb =
  | 'list' | 'add' | 'remove' | 'enable' | 'disable' | 'edit' | 'scope' | 'clear' | 'export'

export interface ParsedCommand {
  readonly verb: CommandVerb | 'help' | undefined
  readonly args: readonly string[]
  /** Explicit scope keyword (leading or trailing), if present. */
  readonly scope?: RuleScope
}

export interface CommandInput {
  readonly raw: string
  readonly view: RuleView
  readonly defaultScope: RuleScope
}

export interface CommandOutput {
  readonly ok: boolean
  readonly text: string
  /** Present when the store should be persisted to this new view. */
  readonly nextView?: RuleView
  /** Present when `/rules scope` chose a new default scope. */
  readonly defaultScope?: RuleScope
}

const USAGE =
  'Usage: /rules [list|add <text>|remove <id>|edit <id> <text>|enable|disable <id>|scope <global|session|project>|clear <scope>|export]'

/** Parse a `/rules` line into a verb + args, isolating an explicit scope keyword.
 *  Scope is accepted as a **leading** token (`/rules global add …`) or a
 *  **trailing** token (`/rules add … global`, only the LAST arg qualifies),
 *  so a rule whose text merely contains "global" is never misread as a scope. */
export function parseCommand(raw: string): ParsedCommand {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { verb: undefined, args: [] }

  let verb: CommandVerb | 'help' | undefined
  let scope: RuleScope | undefined
  let rest: string[]

  if (SCOPE_SET.has(tokens[0] as RuleScope)) {
    scope = tokens[0] as RuleScope
    verb = tokens[1] as CommandVerb | undefined
    rest = tokens.slice(2)
  } else {
    verb = tokens[0] as CommandVerb | undefined
    rest = tokens.slice(1)
    // Strip a trailing scope only for verbs that take a *target* scope modifier,
    // never for `scope`/`clear` where the scope is the argument itself.
    if (verb !== undefined && SCOPE_MODIFIER_VERBS.has(verb) && rest.length > 0
      && SCOPE_SET.has(rest[rest.length - 1] as RuleScope)) {
      scope = rest[rest.length - 1] as RuleScope
      rest = rest.slice(0, -1)
    }
  }
  return { verb, args: rest.filter(Boolean), scope }
}

/** Explicit scope wins, else the caller's default. */
export function resolveScope(scope: RuleScope | undefined, fallback: RuleScope): RuleScope {
  return scope ?? fallback
}

/** Mint a fully-specified rule (dependency-free; uses global `crypto.randomUUID`). */
export function newRule(text: string, now = Date.now()): Rule {
  return {
    id: crypto.randomUUID(),
    text,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** Return a new view with one rule appended to a scope. */
function listOf(view: RuleView, scope: RuleScope): readonly Rule[] {
  return scope === 'global' ? view.global : scope === 'project' ? (view.project ?? []) : view.session
}
function withList(view: RuleView, scope: RuleScope, list: readonly Rule[]): RuleView {
  if (scope === 'global') return { ...view, global: [...list] }
  if (scope === 'project') return { ...view, project: [...list] }
  return { ...view, session: [...list] }
}

export function addRule(view: RuleView, scope: RuleScope, rule: Rule): RuleView {
  return withList(view, scope, [...listOf(view, scope), rule])
}

/** Return a new view with a rule removed from one scope. */
export function removeRule(view: RuleView, scope: RuleScope, id: string): RuleView {
  return withList(view, scope, listOf(view, scope).filter(rule => rule.id !== id))
}

/** Mutate a copy of a scope's rules for the given id; returns whether found. */
export function mutate(view: RuleView, scope: RuleScope, id: string, fn: (rule: Rule) => Rule): RuleView {
  return withList(view, scope, listOf(view, scope).map(rule => rule.id === id ? fn(rule) : rule))
}

/** Render a compact human-readable list of the active rules. */
export function formatList(view: RuleView): string {
  const line = (rule: Rule) =>
    `[${rule.id.slice(0, 8)}] ${rule.enabled ? '' : '(disabled) '}${rule.text}`
  const parts: string[] = []
  if (view.project && view.project.length > 0) { parts.push('Project:'); parts.push(...view.project.map(line)) }
  if (view.global.length > 0) { parts.push('Global:'); parts.push(...view.global.map(line)) }
  if (view.session.length > 0) { parts.push('Session:'); parts.push(...view.session.map(line)) }
  return parts.length === 0 ? 'No active rules.' : parts.join('\n')
}

/** Apply one parsed `/rules` command to the given view + default scope. */
export function runCommand(input: CommandInput): CommandOutput {
  const { verb, args, scope } = parseCommand(input.raw)
  if (verb === undefined || verb === 'list') {
    return { ok: true, text: formatList(input.view) }
  }

  const chosen = resolveScope(scope, input.defaultScope)

  switch (verb) {
    case 'add': {
      const text = args.join(' ')
      if (text.length === 0) {
        return { ok: false, text: USAGE }
      }
      return {
        ok: true,
        text: `Added rule to ${chosen}: ${text}`,
        nextView: addRule(input.view, chosen, newRule(text)),
      }
    }

    case 'remove': {
      const id = args[0] ?? ''
      if (id.length === 0) return { ok: false, text: USAGE }
      return {
        ok: true,
        text: `Removed rule ${id} from ${chosen}.`,
        nextView: removeRule(input.view, chosen, id),
      }
    }

    case 'enable':
    case 'disable': {
      const id = args[0] ?? ''
      if (id.length === 0) return { ok: false, text: USAGE }
      const enable = verb === 'enable'
      const next = mutate(input.view, chosen, id, rule => ({ ...rule, enabled: enable, updatedAt: Date.now() }))
      return { ok: true, text: `${enable ? 'Enabled' : 'Disabled'} rule ${id}.`, nextView: next }
    }

    case 'edit': {
      const id = args[0] ?? ''
      const text = args.slice(1).join(' ')
      if (id.length === 0 || text.length === 0) return { ok: false, text: USAGE }
      const list = listOf(input.view, chosen)
      if (!list.some(rule => rule.id === id)) return { ok: false, text: `Rule ${id} not found.` }
      const next = mutate(input.view, chosen, id, rule => ({ ...rule, text, updatedAt: Date.now() }))
      return { ok: true, text: `Updated rule ${id}.`, nextView: next }
    }

    case 'scope': {
      const nextScope = args[0] as RuleScope | undefined
      if (nextScope === undefined || !SCOPE_SET.has(nextScope)) return { ok: false, text: USAGE }
      return { ok: true, text: `Default scope is now ${nextScope}.`, defaultScope: nextScope }
    }

    case 'clear': {
      const clearScope = args[0] as RuleScope | undefined
      if (clearScope === undefined || !SCOPE_SET.has(clearScope)) return { ok: false, text: USAGE }
      const next = clearScope === 'global' ? { ...input.view, global: [] } : { ...input.view, session: [] }
      return { ok: true, text: `Cleared ${clearScope} rules.`, nextView: next }
    }

    case 'export': {
      return { ok: true, text: JSON.stringify({ global: input.view.global, session: input.view.session }, null, 2) }
    }

    default:
      return { ok: false, text: USAGE }
  }
}
