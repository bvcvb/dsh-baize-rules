/**
 * Loop 1: REAL-composition smoke test — boot the plugin against the real dsh
 * runtime surfaces it touches (cordis context, dsh-llm `createUserMessage`,
 * real `store`/`core` semantics) with minimal stub services for `fs`,
 * `commands`, and `agents`. Proves the plugin actually wires its pre-step
 * injection and `/rules` command registration, with the model-visible message
 * source correctly attributed to `plugin='baize-rules'` / form `snapshot`.
 *
 * @module dsh-baize-rules/composition.spec
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Context as ContextType } from '@deepseek-ai/cordis'
import * as plugin from '../src/index'
import { handle } from '../src/command'

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
  defaultScope: 'global' | 'session'
}

function mount(globalJson?: string): Harness {
  const memory = new Map<string, string>()
  const rulesPath = '/__probe__/rules/global.json'
  if (globalJson !== undefined) memory.set(rulesPath, globalJson)

  const fs = {
    resolve: async (p: string) => p,
    stat: async (p: string) => memory.has(p) ? { size: memory.get(p)!.length } : undefined,
    readText: async (p: string) => memory.get(p) ?? '',
    writeText: async (p: string, c: string) => { memory.set(p, c) },
  }
  const c = new Context()
  c.provide('fs', fs)
  c.provide('commands', { register: () => () => {} })
  c.provide('agents', {}); c.provide('webServer', { register: () => () => {} }); c.provide('sessions', { get: () => undefined })
  ctx = c

  const defaultScope: 'global' | 'session' = 'session'
  void c.plugin(plugin, { scope: defaultScope, maxBytes: 8192, globalRulesPath: rulesPath })
  return { ctx: c, memory, rulesPath, agent: { id: '__test__', session: {} }, defaultScope }
}

async function preStep(h: Harness) {
  const base = { kind: 'enter', messages: [] as any[] } as const
  // The typed agent/pre-step event requires a full Agent; our stub only needs
  // `.session` (as both store and index use it as a WeakMap key). Cast to any.
  return h.ctx.serial('agent/pre-step', { agent: h.agent as any, signal: new AbortController().signal } as any, () => base) as any
}

describe('REAL-composition: plugin apply + pre-step injection', () => {
  it('registers the /rules command', async () => {
    let name = ''
    const memory = new Map<string, string>()
    const rulesPath = '/__probe__/rules/global.json'
    const fs = {
      resolve: async (p: string) => p,
      stat: async (p: string) => memory.has(p) ? {} : undefined,
      readText: async (p: string) => memory.get(p) ?? '',
      writeText: async (p: string, c: string) => { memory.set(p, c) },
    }
    const c = new Context()
    c.provide('fs', fs)
    c.provide('commands', { register: (def: any) => { name = def.name; return () => {} } })
    c.provide('agents', {}); c.provide('webServer', { register: () => () => {} }); c.provide('sessions', { get: () => undefined })
    ctx = c
    await c.plugin(plugin, { scope: 'session', maxBytes: 8192, globalRulesPath: rulesPath })
    expect(name).toBe('baize-rules')
  })

  it('injects a rules user/message with the plugin snapshot source', async () => {
    const h = mount(JSON.stringify([
      { id: 'g1', text: '用中文写注释。', enabled: true, createdAt: 0, updatedAt: 0 },
    ]))
    await h.ctx.fiber
    const result = await preStep(h)
    expect(result.kind).toBe('enter')
    const msg = result.messages[0]
    expect(msg.source.kind).toBe('plugin')
    expect(msg.source.plugin).toBe('baize-rules')
    expect(msg.source.form).toBe('snapshot')
    expect(msg.content[0].text).toContain('<system-reminder>')
    expect(msg.content[0].text).toContain('- 用中文写注释。')
  })

  it('does NOT inject when there are no rules', async () => {
    const h = mount(JSON.stringify([]))
    await h.ctx.fiber
    const result = await preStep(h)
    expect(result.kind).toBe('enter')
    expect(result.messages).toEqual([])
  })

  it('persists a global add through the command handler', async () => {
    const h = mount(JSON.stringify([]))
    await h.ctx.fiber
    const out = await handle(h.ctx, { agent: h.agent, rawInput: 'global add 只用 pnpm' } as any, {
      globalRulesPath: h.rulesPath,
      getScope: () => h.defaultScope,
      setScope: () => {},
    })
    expect(out.kind).toBe('success')
    expect(out.text).toContain('Added rule to global')
    // The global file persisted to the stub fs.
    const written = JSON.parse(h.memory.get(h.rulesPath)!)
    expect(written).toHaveLength(1)
    expect(written[0].text).toBe('只用 pnpm')
  })

  it('persists a session-scope add to its own durable file (survives restart)', async () => {
    const h = mount(JSON.stringify([]))
    await h.ctx.fiber
    const out = await handle(h.ctx, { agent: h.agent, rawInput: 'add 只用 pnpm' } as any, {
      globalRulesPath: h.rulesPath,
      getScope: () => 'session',
      setScope: () => {},
    })
    expect(out.kind).toBe('success')
    // A session rules file under $DSH_HOME/rules/sessions/ was written.
    const sessionKey = [...h.memory.keys()].find(k => k.includes('/rules/sessions/'))
    expect(sessionKey).toBeTruthy()
    expect(JSON.parse(h.memory.get(sessionKey!)!)[0].text).toBe('只用 pnpm')
  })
})
