/**
 * 0.2.1 regression suite — the fixes from the 2026-09-20 audit, each pinned by a
 * test that fails on the old behaviour:
 *
 *  1. scope is only parsed BEFORE the verb, so a rule body ending in a scope
 *     word is stored intact and lands in the requested scope;
 *  2. project rules actually reach the injected `<system-reminder>`;
 *  3. a corrupt store file degrades the injection instead of failing the step;
 *  4. writes carry a freshness guard (a lost race is reported, not swallowed) and
 *     an unchanged scope is not rewritten — which is what used to leave an empty
 *     `sessions/<id>.json` behind for every conversation.
 *
 * @module dsh-baize-rules/regression.spec
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import * as plugin from '../src/index'
import * as invariant from '../src/invariant'
import { handle } from '../src/command'
import { formatList, runCommand } from '../src/core'
import { isStaleWrite, projectRulesPath } from '../src/store'
import type { Rule, RuleView } from '../src/rules'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber?.dispose()
  ctx = undefined
})

/** A fake `ctx.fs` with real version tracking and the two guard rejections the
 *  host raises. Enough to prove the store writes under optimistic control. */
class FakeFsError extends Error {
  constructor(message: string, readonly code: string) { super(message) }
}

interface FakeFs {
  files: Map<string, { content: string; version: number }>
  service: {
    resolve(p: string): Promise<string>
    stat(p: string): Promise<{ version: number; type: 'file'; size: number } | undefined>
    readText(p: string): Promise<string>
    writeText(p: string, c: string, expected?: { kind: string; version?: number }): Promise<unknown>
  }
}

function makeFs(seed: Record<string, string> = {}, raceBeforeWriteOf?: string): FakeFs {
  const files = new Map<string, { content: string; version: number }>()
  for (const [path, content] of Object.entries(seed)) files.set(path, { content, version: 1 })
  let raced = false
  return {
    files,
    service: {
      resolve: async (p: string) => p,
      stat: async (p: string) => {
        const hit = files.get(p)
        return hit === undefined ? undefined : { version: hit.version, type: 'file' as const, size: hit.content.length }
      },
      readText: async (p: string) => {
        const hit = files.get(p)
        if (hit === undefined) throw new FakeFsError('missing', 'FS_NOT_FOUND')
        return hit.content
      },
      writeText: async (p: string, c: string, expected?: { kind: string; version?: number }) => {
        // Simulate the other writer landing between our read and our write.
        if (!raced && raceBeforeWriteOf !== undefined && p === raceBeforeWriteOf) {
          raced = true
          const other = files.get(p)
          if (other !== undefined) files.set(p, { content: other.content, version: other.version + 1 })
        }
        const hit = files.get(p)
        if (expected !== undefined) {
          if (expected.kind === 'createIfAbsent' && hit !== undefined) {
            throw new FakeFsError('already there', 'FS_NOT_OBSERVED')
          }
          if (expected.kind === 'replaceIfVersion' && (hit === undefined || hit.version !== expected.version)) {
            throw new FakeFsError('moved on', 'FS_STALE_VERSION')
          }
        }
        const version = (hit?.version ?? 0) + 1
        files.set(p, { content: c, version })
        return { operation: hit === undefined ? 'create' : 'update', version, before: null }
      },
    },
  }
}

interface Harness {
  readonly ctx: Context
  readonly fs: FakeFs
  readonly rulesPath: string
  readonly agent: { id: string; session: { header: { cwd: string } } }
}

function mount(fs: FakeFs, options: { cwd?: string; globalJson?: string } = {}): Harness {
  const rulesPath = '/__probe__/rules/global.json'
  const c = new Context()
  c.provide('fs', fs.service)
  c.provide('commands', { register: () => () => {} })
  c.provide('agents', {})
  c.provide('webServer', { register: () => () => {} })
  c.provide('sessions', { get: () => undefined })
  ctx = c
  void c.plugin(plugin, { scope: 'session', maxBytes: 8192, globalRulesPath: rulesPath })
  return {
    ctx: c,
    fs,
    rulesPath,
    agent: { id: '__test__', session: { header: { cwd: options.cwd ?? '' } } },
  }
}

async function preStep(h: Harness) {
  const base = { kind: 'enter', messages: [] as unknown[] } as const
  return h.ctx.serial(
    'agent/pre-step',
    { agent: h.agent as any, signal: new AbortController().signal } as any,
    () => base,
  ) as Promise<{ kind: string; messages: { content: { text: string }[] }[] }>
}

function rule(id: string, text: string, extra: Partial<Rule> = {}): Rule {
  return { id, text, enabled: true, createdAt: 0, updatedAt: 0, ...extra }
}
const rulesJson = (...rules: Rule[]): string => JSON.stringify(rules, null, 2)

describe('0.2.1 · a scope is only a scope before the verb', () => {
  it('stores a body ending in a scope word intact, in the requested scope', () => {
    const v: RuleView = { global: [], session: [] }
    const out = runCommand({ raw: 'add 部署前先跑测试 global', view: v, defaultScope: 'session' })
    expect(out.ok).toBe(true)
    expect(out.nextView!.session.map(r => r.text)).toEqual(['部署前先跑测试 global'])
    expect(out.nextView!.global).toHaveLength(0)
  })

  it('still honours a scope written before the verb', () => {
    const v: RuleView = { global: [], session: [] }
    const out = runCommand({ raw: 'global add 只用 pnpm', view: v, defaultScope: 'session' })
    expect(out.nextView!.global.map(r => r.text)).toEqual(['只用 pnpm'])
    expect(out.nextView!.session).toHaveLength(0)
  })

  it('keeps a scope word in the middle of a body', () => {
    const v: RuleView = { global: [], session: [] }
    const out = runCommand({ raw: 'add 先切到 global 分支再改', view: v, defaultScope: 'session' })
    expect(out.nextView!.session[0].text).toBe('先切到 global 分支再改')
  })

  it('accepts the scope before or after the verb for clear and scope', () => {
    const v: RuleView = { global: [rule('g1', 'x')], session: [rule('s1', 'y')] }
    const trailing = runCommand({ raw: 'clear global', view: v, defaultScope: 'session' })
    expect(trailing.nextView!.global).toHaveLength(0)
    expect(trailing.nextView!.session).toHaveLength(1)
    const leading = runCommand({ raw: 'global clear', view: v, defaultScope: 'session' })
    expect(leading.nextView!.global).toHaveLength(0)
    expect(runCommand({ raw: 'scope project', view: v, defaultScope: 'session' }).defaultScope).toBe('project')
    expect(runCommand({ raw: 'project scope', view: v, defaultScope: 'session' }).defaultScope).toBe('project')
  })

  it('narrows `list` to a named scope and keeps precedence order', () => {
    const v: RuleView = {
      global: [rule('g1', '全局规则')],
      session: [rule('s1', '会话规则')],
      project: [rule('p1', '项目规则')],
    }
    const onlyProject = runCommand({ raw: 'list project', view: v, defaultScope: 'session' })
    expect(onlyProject.text).toBe('Project:\n[p1] 项目规则')
    expect(runCommand({ raw: 'project list', view: v, defaultScope: 'session' }).text).toBe(onlyProject.text)
    // Same order as the model-visible reminder: specific first.
    expect(formatList(v).split('\n')[0]).toBe('Project:')
    expect(formatList(v).split('\n')[2]).toBe('Session:')
  })
})

describe('0.2.1 · project rules reach the model', () => {
  const cwd = '/home/someone/work/app'

  it('injects the project section when the session has a working directory', async () => {
    const fs = makeFs({
      '/__probe__/rules/global.json': rulesJson(rule('g1', '全局规则')),
      [projectRulesPath(cwd)]: rulesJson(rule('p1', '项目规则：先跑测试')),
    })
    const h = mount(fs, { cwd })
    await h.ctx.fiber
    const result = await preStep(h)
    const text = result.messages[0].content[0].text
    expect(text).toContain('Project requirements (this directory only):')
    expect(text).toContain('- 项目规则：先跑测试')
    // Project renders before the global section (specific-first).
    expect(text.indexOf('项目规则：先跑测试')).toBeLessThan(text.indexOf('全局规则'))
  })

  it('omits the project section when the session has no working directory', async () => {
    const fs = makeFs({ '/__probe__/rules/global.json': rulesJson(rule('g1', '全局规则')) })
    const h = mount(fs, { cwd: '' })
    await h.ctx.fiber
    const text = (await preStep(h)).messages[0].content[0].text
    expect(text).toContain('全局规则')
    expect(text).not.toContain('Project requirements')
  })
})

describe('0.2.1 · a corrupt store file cannot break the conversation', () => {
  it('degrades to an empty scope, reports it, and still enters the step', async () => {
    const fs = makeFs({ '/__probe__/rules/global.json': '{ this is not json' })
    const h = mount(fs)
    await h.ctx.fiber
    const result = await preStep(h)
    expect(result.kind).toBe('enter')
    expect(result.messages).toEqual([])
  })

  it('appends the problem to the command output instead of throwing', async () => {
    const fs = makeFs({ '/__probe__/rules/global.json': '[{"id":42}]' })
    const h = mount(fs)
    await h.ctx.fiber
    const out = await handle(h.ctx, { agent: h.agent, rawInput: 'list' } as any, {
      globalRulesPath: h.rulesPath,
      getScope: () => 'session',
      setScope: () => {},
    })
    expect(out.kind).toBe('success')
    expect(out.text).toContain('⚠')
    expect(out.text).toContain('global rules')
  })
})

describe('0.2.1 · writes are guarded and minimal', () => {
  it('reports a lost race instead of overwriting the newer file', async () => {
    const globalPath = '/__probe__/rules/global.json'
    const fs = makeFs({ [globalPath]: rulesJson(rule('g1', '旧规则')) }, globalPath)
    const h = mount(fs)
    await h.ctx.fiber
    const out = await handle(h.ctx, { agent: h.agent, rawInput: 'global add 新规则' } as any, {
      globalRulesPath: h.rulesPath,
      getScope: () => 'session',
      setScope: () => {},
    })
    expect(out.kind).toBe('error')
    expect(out.text).toContain('changed elsewhere')
    // The other writer's content survived.
    expect(JSON.parse(fs.files.get(globalPath)!.content)).toHaveLength(1)
    expect(isStaleWrite(new FakeFsError('x', 'FS_STALE_VERSION'))).toBe(true)
    expect(isStaleWrite(new Error('nope'))).toBe(false)
  })

  it('does not create an empty session file for an untouched scope', async () => {
    const fs = makeFs({ '/__probe__/rules/global.json': rulesJson() })
    const h = mount(fs, { cwd: '/home/someone/work/app' })
    await h.ctx.fiber
    const out = await handle(h.ctx, { agent: h.agent, rawInput: 'global add 只用 pnpm' } as any, {
      globalRulesPath: h.rulesPath,
      getScope: () => 'session',
      setScope: () => {},
    })
    expect(out.kind).toBe('success')
    expect([...fs.files.keys()].some(k => k.includes('/rules/sessions/'))).toBe(false)
    expect([...fs.files.keys()].some(k => k.includes('/rules/projects/'))).toBe(false)
  })
})

describe('0.2.1 · the invariant companion surfaces a corrupt store', () => {
  /** Mount only the companion and capture the installer it registers. */
  async function installer(fs: FakeFs) {
    const captured: { installer: (ctx: unknown, fail: (m: string) => void) => unknown }[] = []
    const c = new Context()
    c.provide('fs', fs.service)
    c.provide('invariants', {
      register: (_name: string, install: never) => { captured.push({ installer: install }); return () => {} },
    })
    ctx = c
    await c.plugin(invariant)
    return captured[0].installer
  }

  it('fails with the file path when a store file cannot be read', async () => {
    const globalPath = dshHomePath('rules', 'global.json')
    const fs = makeFs({ [globalPath]: '{ not json' })
    const install = await installer(fs)
    const failures: string[] = []
    await install({ fs: fs.service }, (m: string) => { failures.push(m) })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('global rules')
    expect(failures[0]).toContain(globalPath)
  })

  it('stays silent for a healthy store', async () => {
    const fs = makeFs({
      [dshHomePath('rules', 'global.json')]: rulesJson(rule('g1', '全局规则')),
      [dshHomePath('rules', 'templates.json')]: '[]',
    })
    const install = await installer(fs)
    const failures: string[] = []
    await install({ fs: fs.service }, (m: string) => { failures.push(m) })
    expect(failures).toEqual([])
  })
})

describe('0.2.1 · the panel API guards its own port', () => {
  const globalPath = '/__probe__/rules/global.json'

  /** Minimal IncomingMessage stand-in: what `readBody` + `authorize` actually use. */
  function fakeReq(o: {
    method: string
    url: string
    body?: string
    remoteAddress?: string
    origin?: string
  }) {
    const req = {
      method: o.method,
      url: o.url,
      headers: {
        host: '127.0.0.1:3080',
        ...(o.origin === undefined ? {} : { origin: o.origin }),
      },
      socket: { remoteAddress: o.remoteAddress ?? '127.0.0.1' },
      on(event: string, cb: (chunk?: unknown) => void) {
        if (event === 'data' && o.body !== undefined) queueMicrotask(() => cb(o.body))
        if (event === 'end') queueMicrotask(() => cb())
        return req
      },
      destroy() {},
    }
    return req
  }

  function fakeRes() {
    const captured = { status: 0, body: '' }
    return {
      captured,
      res: {
        writeHead(status: number) { captured.status = status },
        end(body: string) { captured.body = body },
      },
    }
  }

  async function mountApi(fs: FakeFs, config: Record<string, unknown> = {}) {
    let route: { handler: (req: unknown, res: unknown) => Promise<void> } | undefined
    const c = new Context()
    c.provide('fs', fs.service)
    c.provide('commands', { register: () => () => {} })
    c.provide('agents', {})
    c.provide('sessions', { get: () => undefined })
    c.provide('webServer', { register: (r: never) => { route = r; return () => {} } })
    ctx = c
    void c.plugin(plugin, {
      scope: 'session',
      maxBytes: 8192,
      globalRulesPath: globalPath,
      ...config,
    })
    await c.fiber
    return route!
  }

  const parse = (body: string) => JSON.parse(body) as Record<string, unknown>

  it('does not check the caller unless the config asks for it (default off)', async () => {
    const route = await mountApi(makeFs({ [globalPath]: rulesJson() }))
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({
      method: 'GET',
      url: '/baize-rules.api',
      remoteAddress: '10.0.0.9',
      origin: 'https://evil.example',
    }), res)
    expect(captured.status).toBe(200)
  })

  it('refuses a request that did not come from this machine when switched on', async () => {
    const route = await mountApi(makeFs({ [globalPath]: rulesJson() }), { apiOriginCheck: true })
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({ method: 'GET', url: '/baize-rules.api', remoteAddress: '10.0.0.9' }), res)
    expect(captured.status).toBe(403)
    expect(parse(captured.body).text).toContain('this machine only')
  })

  it('refuses a cross-origin browser request when switched on', async () => {
    const route = await mountApi(makeFs({ [globalPath]: rulesJson() }), { apiOriginCheck: true })
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({ method: 'POST', url: '/baize-rules.api', body: '{}', origin: 'https://evil.example' }), res)
    expect(captured.status).toBe(403)
    expect(parse(captured.body).text).toContain('cross-origin')
  })

  it('serves a same-origin GET with templates and problems', async () => {
    const route = await mountApi(makeFs({
      [globalPath]: '{ broken',
      [dshHomePath('rules', 'templates.json')]: '[]',
    }))
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({ method: 'GET', url: '/baize-rules.api?sessionId=s1' }), res)
    expect(captured.status).toBe(200)
    const body = parse(captured.body)
    expect(body.templates).toEqual([])
    expect((body.problems as string[])[0]).toContain('global rules')
  })

  it('accepts a structured rule.add and persists it', async () => {
    const fs = makeFs({ [globalPath]: rulesJson() })
    const route = await mountApi(fs)
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({
      method: 'POST',
      url: '/baize-rules.api',
      body: JSON.stringify({ op: 'rule.add', scope: 'global', text: '只用 pnpm' }),
    }), res)
    expect(captured.status).toBe(200)
    expect(parse(captured.body).ok).toBe(true)
    expect(JSON.parse(fs.files.get(globalPath)!.content)[0].text).toBe('只用 pnpm')
  })

  it('answers 409 when the write loses a race', async () => {
    const sessionPath = dshHomePath('rules', 'sessions', 's1.json')
    const fs = makeFs({ [globalPath]: rulesJson(), [sessionPath]: rulesJson() }, sessionPath)
    const route = await mountApi(fs)
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({
      method: 'POST',
      url: '/baize-rules.api',
      body: JSON.stringify({ op: 'rule.add', scope: 'session', sessionId: 's1', text: '新规则' }),
    }), res)
    expect(captured.status).toBe(409)
    expect(parse(captured.body).text).toContain('changed in another window')
  })

  it('rejects an oversized body with 413', async () => {
    const route = await mountApi(makeFs({ [globalPath]: rulesJson() }))
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({
      method: 'POST',
      url: '/baize-rules.api',
      body: 'x'.repeat(1024 * 1024 + 16),
    }), res)
    expect(captured.status).toBe(413)
    expect(parse(captured.body).text).toContain('exceeds')
  })

  it('accepts a proxied caller when the check is explicitly off', async () => {
    const route = await mountApi(makeFs({ [globalPath]: rulesJson() }), { apiOriginCheck: false })
    const { captured, res } = fakeRes()
    await route.handler(fakeReq({ method: 'GET', url: '/baize-rules.api', remoteAddress: '10.0.0.9' }), res)
    expect(captured.status).toBe(200)
  })
})
