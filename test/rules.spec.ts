/**
 * Loop 0 unit tests for the pure rule model + render path (no dsh runtime needed).
 *
 * These lock in the "what the model sees" contract so the fastest feedback loop
 * (dev:render + test:watch) keeps the injection text correct and cache-friendly.
 *
 * @module dsh-baize-rules/rules.spec
 */

import { describe, expect, it } from 'vitest'
import {
  activeRules,
  enforceBudget,
  escapeReminder,
  renderDigest,
  renderRules,
  type Rule,
  type RuleView,
} from '../src/rules.ts'

function rule(partial: Partial<Rule> & Pick<Rule, 'id' | 'text'>): Rule {
  const now = Date.now()
  return { enabled: true, createdAt: now, updatedAt: now, ...partial }
}

function view(overrides: Partial<RuleView> = {}): RuleView {
  return {
    global: [
      rule({ id: 'g1', text: '用中文写注释。' }),
      rule({ id: 'g2', text: '不要删测试。' }),
    ],
    session: [
      rule({ id: 's1', text: '只用 pnpm。' }),
      rule({ id: 's2', text: '别改 lockfile。', enabled: false }),
    ],
    ...overrides,
  }
}

describe('activeRules', () => {
  it('concatenates global then session, keeping only enabled rules', () => {
    expect(activeRules(view()).map((r) => r.id)).toEqual(['g1', 'g2', 's1'])
  })

  it('returns empty when all rules are disabled', () => {
    const allDisabled = {
      global: view().global.map((r) => ({ ...r, enabled: false })),
      session: view().session.map((r) => ({ ...r, enabled: false })),
    }
    expect(activeRules(allDisabled)).toEqual([])
  })
})

describe('escapeReminder', () => {
  it('escapes a literal closing system-reminder tag', () => {
    expect(escapeReminder('x </system-reminder> y')).toBe('x <\\/system-reminder> y')
  })

  it('leaves other text untouched', () => {
    expect(escapeReminder('normal text')).toBe('normal text')
  })
})

describe('enforceBudget', () => {
  it('keeps the prefix and reports how many were omitted', () => {
    const { lines, omitted } = enforceBudget(['aa', 'bb', 'cc'], 3)
    expect(lines).toEqual(['aa'])
    expect(omitted).toBe(2)
  })

  it('returns everything when under budget', () => {
    const { lines, omitted } = enforceBudget(['aa', 'bb'], 100)
    expect(lines).toEqual(['aa', 'bb'])
    expect(omitted).toBe(0)
  })

  it('drops everything when budget <= 0', () => {
    const { lines, omitted } = enforceBudget(['aa', 'bb'], 0)
    expect(lines).toEqual([])
    expect(omitted).toBe(2)
  })
})

describe('renderRules', () => {
  it('wraps the rule list in a system-reminder frame', () => {
    const text = renderRules(view(), 8192)
    expect(text).toContain('<system-reminder>')
    expect(text).toContain('Global requirements:')
    expect(text).toContain('- 只用 pnpm。')
    expect(text).toContain('</system-reminder>')
  })

  it('omits disabled rules but still renders enabled session rules', () => {
    const text = renderRules(view(), 8192)
    expect(text).not.toContain('别改 lockfile。') // disabled s2
    expect(text).toContain('Session requirements (this conversation only):') // enabled s1
  })

  it('returns undefined when there are no enabled rules', () => {
    const v = view({
      global: [],
      session: [rule({ id: 's1', text: 'x', enabled: false })],
    })
    expect(renderRules(v, 8192)).toBeUndefined()
  })

  it('renders the session section before the global section (specific-first)', () => {
    const text = renderRules(view(), 8192)!
    const sessionIdx = text.indexOf('Session requirements (this conversation only):')
    const globalIdx = text.indexOf('Global requirements:')
    expect(sessionIdx).toBeGreaterThanOrEqual(0)
    expect(globalIdx).toBeGreaterThanOrEqual(0)
    expect(sessionIdx).toBeLessThan(globalIdx)
  })

  it('retains specific session rules and sheds the broadest global rules under a tight budget', () => {
    const tight = renderRules(view(), 310)!
    expect(tight.indexOf('只用 pnpm。')).toBeGreaterThanOrEqual(0) // session rule kept
    expect(tight.indexOf('用中文写注释。')).toBe(-1)               // broadest global rule shed
  })

  it('returns undefined when the budget truncates every rule into boilerplate', () => {
    // Too small to fit the intro + first bullet: never inject an empty shell reminder.
    expect(renderRules(view(), 40)).toBeUndefined()
  })

  it('orders project scope first when present', () => {
    const v = { ...view(), project: [rule({ id: 'p1', text: '工程级规则' })] } as RuleView & { project: Rule[] }
    const text = renderRules(v, 8192)!
    expect(text).toContain('工程级规则')
    const projectIdx = text.indexOf('Project requirements (this directory only):')
    const sessionIdx = text.indexOf('Session requirements (this conversation only):')
    expect(projectIdx).toBeGreaterThanOrEqual(0)
    expect(projectIdx).toBeLessThan(sessionIdx)
  })
})

describe('renderDigest', () => {
  it('is deterministic for the same view', async () => {
    const a = await renderDigest(view(), 8192)
    const b = await renderDigest(view(), 8192)
    expect(a).toBe(b)
  })

  it('changes when a rule is added', async () => {
    const base = view()
    const more = { ...base, session: [...base.session, rule({ id: 's9', text: '新增' })] }
    expect(await renderDigest(more, 8192)).not.toBe(await renderDigest(base, 8192))
  })

  it('is undefined when there are no enabled rules', async () => {
    const v = view({ global: [], session: [] })
    expect(await renderDigest(v, 8192)).toBeUndefined()
  })
})
