/**
 * Refresh policy for the injected snapshot (0.2.1+).
 *
 * The rules are published as a `snapshot`, so a copy that stays unchanged is not
 * repeated every step — but "only at the very top of a long conversation" is not
 * good enough either: the copy drifts away from the model's attention, and a
 * compacted or cleared session can drop it entirely. Three rules pin that down:
 *
 *  1. text changed            → publish immediately (covered in regression.spec);
 *  2. `refreshAfterSteps` old → publish again even when the text is identical;
 *  3. `agent/session-start`   → forget the record, so `compact` / `resume` /
 *     `clear` (or a step counter that restarts) publishes a fresh copy.
 *
 * @module dsh-baize-rules/refresh.spec
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber?.dispose()
  ctx = undefined
})

interface Harness {
  ctx: Context
  memory: Map<string, string>
  rulesPath: string
  agent: { id: string; session: object }
}

function mount(config: Record<string, unknown> = {}): Harness {
  const memory = new Map<string, string>()
  const rulesPath = '/__probe__/rules/global.json'
  memory.set(rulesPath, JSON.stringify([
    { id: 'g1', text: '全局规则', enabled: true, createdAt: 0, updatedAt: 0 },
  ]))
  const fs = {
    resolve: async (p: string) => p,
    stat: async (p: string) => memory.has(p)
      ? { version: 1, type: 'file' as const, size: memory.get(p)!.length }
      : undefined,
    readText: async (p: string) => memory.get(p) ?? '',
    writeText: async (p: string, c: string) => {
      memory.set(p, c)
      return { operation: 'create', version: 1, before: null }
    },
  }
  const c = new Context()
  c.provide('fs', fs)
  c.provide('commands', { register: () => () => {} })
  c.provide('agents', {})
  c.provide('sessions', { get: () => undefined })
  c.provide('webServer', { register: () => () => {} })
  ctx = c
  void c.plugin(plugin, { scope: 'session', maxBytes: 8192, globalRulesPath: rulesPath, ...config })
  return { ctx: c, memory, rulesPath, agent: { id: 'sess-refresh', session: {} } }
}

/** Run one pre-step at the given step number; returns how many messages were added. */
async function step(h: Harness, stepNo: number): Promise<number> {
  const base = { kind: 'enter', messages: [] as unknown[] }
  const result = await h.ctx.serial(
    'agent/pre-step',
    { agent: h.agent as never, step: stepNo, signal: new AbortController().signal } as never,
    (() => base) as never,
  ) as unknown as { messages: unknown[] }
  return result.messages.length
}

/** Tell the plugin a session lifecycle began (what the host emits on startup / resume / clear / compact). */
async function sessionStart(h: Harness, source: string): Promise<void> {
  await h.ctx.emit('agent/session-start', { agent: h.agent, source } as never)
}

describe('refresh policy', () => {
  it('stays quiet while the text is unchanged and the record is fresh', async () => {
    const h = mount()
    await h.ctx.fiber
    expect(await step(h, 1)).toBe(1)    // first publication
    expect(await step(h, 2)).toBe(0)
    expect(await step(h, 19)).toBe(0)
  })

  it('publishes again once the copy is refreshAfterSteps old', async () => {
    const h = mount({ refreshAfterSteps: 5 })
    await h.ctx.fiber
    expect(await step(h, 1)).toBe(1)
    expect(await step(h, 5)).toBe(0)    // 4 steps later — still fresh
    expect(await step(h, 6)).toBe(1)    // 5 steps later — refreshed
    expect(await step(h, 7)).toBe(0)
    expect(await step(h, 11)).toBe(1)
  })

  it('defaults to refreshing every 20 steps', async () => {
    const h = mount()
    await h.ctx.fiber
    expect(await step(h, 1)).toBe(1)
    expect(await step(h, 20)).toBe(0)   // 19 steps later
    expect(await step(h, 21)).toBe(1)   // 20 steps later
  })

  it('can switch the periodic refresh off with refreshAfterSteps: 0', async () => {
    const h = mount({ refreshAfterSteps: 0 })
    await h.ctx.fiber
    expect(await step(h, 1)).toBe(1)
    expect(await step(h, 500)).toBe(0)
  })

  it('publishes again when the step counter goes backwards (compaction / clear)', async () => {
    const h = mount({ refreshAfterSteps: 0 })
    await h.ctx.fiber
    expect(await step(h, 40)).toBe(1)
    expect(await step(h, 41)).toBe(0)
    expect(await step(h, 2)).toBe(1)    // numbering restarted → republish
    expect(await step(h, 3)).toBe(0)
  })

  it('publishes a fresh copy after the host restarts the session scope', async () => {
    const h = mount()
    await h.ctx.fiber
    expect(await step(h, 1)).toBe(1)
    expect(await step(h, 2)).toBe(0)
    await sessionStart(h, 'compact')
    expect(await step(h, 3)).toBe(1)
    await sessionStart(h, 'resume')
    expect(await step(h, 4)).toBe(1)
    await sessionStart(h, 'clear')
    expect(await step(h, 5)).toBe(1)
  })

  it('re-publishes the updated text right after a rule edit', async () => {
    const h = mount()
    await h.ctx.fiber
    expect(await step(h, 1)).toBe(1)
    expect(await step(h, 2)).toBe(0)
    h.memory.set(h.rulesPath, JSON.stringify([
      { id: 'g1', text: '全局规则', enabled: true, createdAt: 0, updatedAt: 0 },
      { id: 'g2', text: '中途新增的规则', enabled: true, createdAt: 0, updatedAt: 0 },
    ]))
    expect(await step(h, 3)).toBe(1)
    expect(await step(h, 4)).toBe(0)
  })
})
