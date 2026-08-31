/**
 * Loop 0 unit tests for the dependency-free command core (`src/core.ts`).
 * Locks in parsing, scope resolution (incl. the fixed "global not misread from
 * rule text"), CRUD application, and the REAL `/rules scope` default update.
 *
 * @module dsh-baize-rules/core.spec
 */

import { describe, expect, it } from 'vitest'
import {
  addRule,
  formatList,
  newRule,
  parseCommand,
  removeRule,
  resolveScope,
  runCommand,
  type CommandInput,
} from '../src/core.ts'
import type { Rule, RuleView } from '../src/rules.ts'

function rule(partial: Partial<Rule> & Pick<Rule, 'id' | 'text'>): Rule {
  const now = Date.now()
  return { enabled: true, createdAt: now, updatedAt: now, ...partial }
}

function view(): RuleView {
  return {
    global: [rule({ id: 'g1', text: '用中文写注释。' })],
    session: [rule({ id: 's1', text: '别删测试。' })],
  }
}

function cmd(raw: string, v: RuleView = view(), defaultScope: 'global' | 'session' = 'session') {
  return runCommand({ raw, view: v, defaultScope })
}

describe('parseCommand', () => {
  it('returns an empty verb for an empty line', () => {
    expect(parseCommand('')).toEqual({ verb: undefined, args: [] })
  })

  it('recognizes a leading scope token', () => {
    const p = parseCommand('global add 用中文写注释')
    expect(p.verb).toBe('add')
    expect(p.scope).toBe('global')
    expect(p.args).toEqual(['用中文写注释'])
  })

  it('recognizes a trailing scope token (last arg only)', () => {
    const p = parseCommand('add 用中文写注释 global')
    expect(p.verb).toBe('add')
    expect(p.scope).toBe('global')
    expect(p.args).toEqual(['用中文写注释'])
  })

  it('does NOT misread rule text containing "global" as a scope', () => {
    const p = parseCommand('add 用global写')
    expect(p.scope).toBeUndefined()
    expect(p.args).toEqual(['用global写'])
  })

  it('isolates the scope token from following args', () => {
    const p = parseCommand('add 只 用 pnpm global')
    expect(p.scope).toBe('global')
    expect(p.args).toEqual(['只', '用', 'pnpm'])
  })
})

describe('resolveScope', () => {
  it('lets an explicit scope win over the default', () => {
    expect(resolveScope('global', 'session')).toBe('global')
  })

  it('falls back to the default when no explicit scope is given', () => {
    expect(resolveScope(undefined, 'session')).toBe('session')
  })
})

describe('runCommand · list / export', () => {
  it('lists global + session correctly', () => {
    const out = cmd('list')
    expect(out.ok).toBe(true)
    expect(out.text).toContain('Global:')
    expect(out.text).toContain('- 用中文写注释。'.slice(2)) // text fragment
    expect(out.text).toContain('Session:')
    expect(out.nextView).toBeUndefined()
  })

  it('exports a JSON snapshot', () => {
    const out = cmd('export')
    const parsed = JSON.parse(out.text)
    expect(parsed.global).toHaveLength(1)
    expect(parsed.session).toHaveLength(1)
  })
})

describe('runCommand · add', () => {
  it('appends a rule to the default scope', () => {
    const out = cmd('add 用中文写注释')
    expect(out.ok).toBe(true)
    expect(out.text).toContain('Added rule to session')
    expect(out.nextView!.session).toHaveLength(2)
  })

  it('appends to the explicit global scope', () => {
    const out = cmd('global add x')
    expect(out.text).toContain('to global')
    expect(out.nextView!.global).toHaveLength(2)
  })

  it('rejects an empty text', () => {
    expect(cmd('add').ok).toBe(false)
  })
})

describe('runCommand · remove / enable / disable', () => {
  it('removes by id', () => {
    const out = cmd('remove s1')
    expect(out.ok).toBe(true)
    expect(out.nextView!.session).toHaveLength(0)
  })

  it('disables a rule', () => {
    const out = cmd('disable s1')
    expect(out.nextView!.session[0].enabled).toBe(false)
  })

  it('enables a rule', () => {
    const out = cmd('enable s1')
    expect(out.nextView!.session[0].enabled).toBe(true)
  })
})

describe('runCommand · edit', () => {
  it('replaces a rule text by id', () => {
    const out = cmd('edit s1 只用 pnpm')
    expect(out.ok).toBe(true)
    expect(out.nextView!.session[0].text).toBe('只用 pnpm')
  })

  it('rejects a missing id / empty text', () => {
    expect(cmd('edit').ok).toBe(false)
    expect(cmd('edit s1').ok).toBe(false)
  })

  it('errors when the id is not found', () => {
    expect(cmd('edit nope x').ok).toBe(false)
  })
})

describe('runCommand · scope (real default update)', () => {
  it('returns the new default scope so the caller can persist it', () => {
    const out = cmd('scope global')
    expect(out.ok).toBe(true)
    expect(out.defaultScope).toBe('global')
    expect(out.text).toContain('Default scope is now global')
  })

  it('rejects an invalid scope', () => {
    expect(cmd('scope maybe').ok).toBe(false)
  })
})

describe('runCommand · clear', () => {
  it('clears the chosen scope', () => {
    const out = cmd('clear session')
    expect(out.nextView!.session).toHaveLength(0)
    expect(out.nextView!.global).toHaveLength(1)
  })
})

describe('pure CRUD helpers', () => {
  it('addRule / removeRule / newRule work immutably', () => {
    const r = newRule('只跑 pnpm')
    expect(r.id).toMatch(/[0-9a-f-]{36}/)
    expect(r.enabled).toBe(true)
    const v2 = addRule(view(), 'session', r)
    expect(v2.session).toHaveLength(2)
    expect(view().session).toHaveLength(1) // original untouched
    const v3 = removeRule(v2, 'session', r.id)
    expect(v3.session).toHaveLength(1)
  })

  it('formatList reports no active rules for an empty view', () => {
    expect(formatList({ global: [], session: [] })).toBe('No active rules.')
  })
})
