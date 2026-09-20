/**
 * Loop 0 unit tests for the dependency-free command core (`src/core.ts`).
 * Locks in parsing, scope resolution (incl. the fixed "global not misread from
 * rule text"), CRUD application, and the REAL `/baize-rules scope` default update.
 *
 * @module dsh-baize-rules/core.spec
 */

import { describe, expect, it } from 'vitest'
import {
  addRule,
  deleteTemplate,
  exportTemplates,
  formatList,
  formatTemplates,
  importTemplates,
  newRule,
  parseCommand,
  parseTemplateImport,
  removeRule,
  resolveScope,
  runCommand,
  tagsOf,
  updateTemplate,
  type CommandInput,
} from '../src/core.ts'
import { normalizeTags, renderRules, type Rule, type RuleTemplate, type RuleView } from '../src/rules.ts'

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
    expect(parseCommand('')).toEqual({ verb: undefined, args: [], tags: [] })
  })

  it('recognizes a leading scope token', () => {
    const p = parseCommand('global add 用中文写注释')
    expect(p.verb).toBe('add')
    expect(p.scope).toBe('global')
    expect(p.args).toEqual(['用中文写注释'])
  })

  it('treats a trailing scope word as rule text, never as a scope', () => {
    // Regression: `/baize-rules add 部署前先跑测试 global` used to silently drop
    // the word `global` from the body AND write the rule to the global scope.
    const p = parseCommand('add 用中文写注释 global')
    expect(p.verb).toBe('add')
    expect(p.scope).toBeUndefined()
    expect(p.args).toEqual(['用中文写注释', 'global'])
  })

  it('does NOT misread rule text containing "global" as a scope', () => {
    const p = parseCommand('add 用global写')
    expect(p.scope).toBeUndefined()
    expect(p.args).toEqual(['用global写'])
  })

  it('keeps a scope word at the end of a longer body', () => {
    const p = parseCommand('add 只 用 pnpm global')
    expect(p.scope).toBeUndefined()
    expect(p.args).toEqual(['只', '用', 'pnpm', 'global'])
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

// --- tags ---

function taggedView(): RuleView {
  return { ...view(), session: [rule({ id: 's1', text: '别删测试。', tags: ['中文', '测试'] })] }
}

describe('tags · parsing', () => {
  it('strips a trailing #tag run on tag-aware verbs', () => {
    const p = parseCommand('tag s1 前端 #流程 #发布')
    expect(p.verb).toBe('tag')
    expect(p.args).toEqual(['s1', '前端'])
    expect(p.tags).toEqual(['流程', '发布'])
  })

  it('never strips #tokens from `add` (a body may contain a hash)', () => {
    const p = parseCommand('add 提交信息带 issue #123')
    expect(p.tags).toEqual([])
    expect(p.args).toEqual(['提交信息带', 'issue', '#123'])
  })

  it('keeps a bare # in the middle of a template body', () => {
    const p = parseCommand('tmpl add 标题以 # 开头 #风格')
    expect(p.tags).toEqual(['风格'])
    expect(p.args).toEqual(['add', '标题以', '#', '开头'])
  })
})

describe('tags · normalize', () => {
  it('drops the leading hash, dedupes case-insensitively, caps the count', () => {
    expect(normalizeTags(['#中文', '中文', 'Frontend', 'frontend'])).toEqual(['中文', 'Frontend'])
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).toHaveLength(8)
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags(['   '])).toEqual([])
  })
})

describe('runCommand · tag / untag', () => {
  it('appends tags to an existing rule', () => {
    const out = cmd('tag s1 前端')
    expect(out.ok).toBe(true)
    expect(out.nextView!.session[0].tags).toEqual(['前端'])
  })

  it('keeps a tag literally named like a scope keyword', () => {
    const out = cmd('tag s1 project')
    expect(out.ok).toBe(true)
    expect(out.nextView!.session[0].tags).toEqual(['project'])
  })

  it('accepts the leading scope form', () => {
    const out = cmd('global tag g1 全局标签')
    expect(out.nextView!.global[0].tags).toEqual(['全局标签'])
  })

  it('removes tags case-insensitively', () => {
    const out = cmd('untag s1 中文', taggedView())
    expect(out.nextView!.session[0].tags).toEqual(['测试'])
  })

  it('requires at least one tag and an existing rule', () => {
    expect(cmd('tag s1').ok).toBe(false)
    expect(cmd('tag nope 前端').ok).toBe(false)
  })

  it('collects a scope tag row by frequency', () => {
    const v: RuleView = {
      global: [],
      session: [rule({ id: 'a', text: 'A', tags: ['常用'] }), rule({ id: 'b', text: 'B', tags: ['常用', '罕见'] })],
    }
    expect(tagsOf(v.session)).toEqual(['常用', '罕见'])
  })
})

// --- templates ---

function library(): RuleTemplate[] {
  return [
    { id: 'aaaaaaa1-0000-4000-8000-000000000001', text: '思考和回答必须用中文', tags: ['语言'], createdAt: 1, updatedAt: 1, uses: 2 },
    { id: 'bbbbbbb2-0000-4000-8000-000000000002', text: '只用 pnpm', tags: ['工具'], createdAt: 1, updatedAt: 1, uses: 0 },
  ]
}

function cmdT(
  raw: string,
  v: RuleView = view(),
  t: readonly RuleTemplate[] = library(),
  defaultScope: 'global' | 'session' = 'session',
) {
  return runCommand({ raw, view: v, defaultScope, templates: t })
}

describe('formatTemplates', () => {
  it('reports an empty library and an empty filter result', () => {
    expect(formatTemplates([])).toBe('No templates.')
    expect(formatTemplates(library(), '不存在')).toBe('No templates tagged 不存在.')
  })

  it('shows the use count and tag badge', () => {
    expect(formatTemplates(library())).toContain('{语言} 思考和回答必须用中文 · used 2×')
  })
})

describe('runCommand · save (rule → template)', () => {
  it('stores the rule text and its tags as a new template', () => {
    const out = cmdT('save s1', taggedView())
    expect(out.ok).toBe(true)
    expect(out.nextTemplates).toHaveLength(3)
    const added = out.nextTemplates![2]
    expect(added.text).toBe('别删测试。')
    expect(added.tags).toEqual(['中文', '测试'])
  })

  it('merges tags into an existing same-text template', () => {
    const v: RuleView = { ...view(), session: [rule({ id: 's1', text: '只用 pnpm', tags: ['额外'] })] }
    const out = cmdT('save s1', v)
    expect(out.nextTemplates).toHaveLength(2)
    expect(out.nextTemplates!.find(t => t.text === '只用 pnpm')!.tags).toEqual(['工具', '额外'])
  })

  it('errors when the rule is missing', () => {
    expect(cmdT('save nope').ok).toBe(false)
  })
})

describe('runCommand · tmpl', () => {
  it('lists templates and filters by tag', () => {
    expect(cmdT('tmpl list').text).toContain('思考和回答必须用中文')
    const filtered = cmdT('tmpl list 工具')
    expect(filtered.text).toContain('只用 pnpm')
    expect(filtered.text).not.toContain('思考和回答必须用中文')
  })

  it('adds a template with tags', () => {
    const out = cmdT('tmpl add 先跑测试再提交 #流程 #纪律')
    expect(out.ok).toBe(true)
    const added = out.nextTemplates![2]
    expect(added.text).toBe('先跑测试再提交')
    expect(added.tags).toEqual(['流程', '纪律'])
  })

  it('refuses an empty body', () => {
    expect(cmdT('tmpl add').ok).toBe(false)
  })

  it('edits text and tags by id prefix', () => {
    const out = cmdT('tmpl edit aaaaaaa1 改后的内容 #新标签')
    expect(out.ok).toBe(true)
    const edited = out.nextTemplates!.find(t => t.id.startsWith('aaaaaaa1'))!
    expect(edited.text).toBe('改后的内容')
    expect(edited.tags).toEqual(['新标签'])
  })

  it('keeps the body when only tags are given', () => {
    const out = cmdT('tmpl edit aaaaaaa1 #只改标签')
    const edited = out.nextTemplates!.find(t => t.id.startsWith('aaaaaaa1'))!
    expect(edited.text).toBe('思考和回答必须用中文')
    expect(edited.tags).toEqual(['只改标签'])
  })

  it('removes a template', () => {
    const out = cmdT('tmpl rm bbbbbbb2')
    expect(out.ok).toBe(true)
    expect(out.nextTemplates).toHaveLength(1)
  })

  it('reports an unknown template', () => {
    expect(cmdT('tmpl rm zzzzzzzz').ok).toBe(false)
  })
})

describe('runCommand · from (template → rule)', () => {
  it('adds one template by id prefix and bumps its uses', () => {
    const out = cmdT('from aaaaaaa1')
    expect(out.ok).toBe(true)
    expect(out.nextView!.session).toHaveLength(2)
    expect(out.nextView!.session[1].text).toBe('思考和回答必须用中文')
    expect(out.nextView!.session[1].tags).toEqual(['语言'])
    expect(out.nextTemplates!.find(t => t.id.startsWith('aaaaaaa1'))!.uses).toBe(3)
  })

  it('adds every template carrying a tag', () => {
    const out = cmdT('from #语言')
    expect(out.nextView!.session).toHaveLength(2)
  })

  it('skips a rule whose text already exists in that scope', () => {
    const v: RuleView = { global: [], session: [rule({ id: 's9', text: '只用 pnpm' })] }
    const out = cmdT('from bbbbbbb2', v)
    expect(out.nextView!.session).toHaveLength(1)
    expect(out.text).toContain('Skipped 1 duplicate')
  })

  it('accepts an explicit scope written before the verb', () => {
    const out = cmdT('global from aaaaaaa1')
    expect(out.nextView!.global).toHaveLength(2)
  })

  it('errors on an unknown tag', () => {
    expect(cmdT('from #不存在').ok).toBe(false)
  })
})

describe('template export / import', () => {
  it('exports an envelope without ids', () => {
    const parsed = JSON.parse(exportTemplates(library(), new Date('2026-09-15T00:00:00Z')))
    expect(parsed.kind).toBe('dsh-baize-rules-templates')
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.exportedAt).toBe('2026-09-15T00:00:00.000Z')
    expect(parsed.templates).toHaveLength(2)
    expect(parsed.templates[0]).toEqual({ text: '思考和回答必须用中文', tags: ['语言'], uses: 2 })
  })

  it('merges by text and unions tags, idempotently', () => {
    const payload = JSON.stringify({
      kind: 'dsh-baize-rules-templates',
      templates: [
        { text: '只用 pnpm', tags: ['额外'], uses: 5 },
        { text: '全新规则', tags: ['新'] },
      ],
    })
    const out = importTemplates(payload, library(), 'merge', false)
    expect(out.ok).toBe(true)
    expect(out.templates).toHaveLength(3)
    const merged = out.templates!.find(t => t.text === '只用 pnpm')!
    expect(merged.tags).toEqual(['工具', '额外'])
    expect(merged.uses).toBe(5)
    const again = importTemplates(payload, out.templates!, 'merge', false)
    expect(again.templates).toHaveLength(3)
    expect(again.text).toContain('+0 new')
  })

  it('replaces the whole library in replace mode with fresh ids', () => {
    const out = importTemplates(JSON.stringify([{ text: '唯一模板' }]), library(), 'replace', false)
    expect(out.templates).toHaveLength(1)
    expect(out.templates![0].text).toBe('唯一模板')
    expect(out.templates![0].id).not.toBe(library()[0].id)
  })

  it('writes nothing on a dry run', () => {
    const out = importTemplates(JSON.stringify([{ text: '唯一模板' }]), library(), 'replace', true)
    expect(out.ok).toBe(true)
    expect(out.templates).toBeUndefined()
    expect(out.text).toContain('Dry run')
  })

  it('collects every entry error and applies nothing', () => {
    const payload = JSON.stringify([{ text: '好的' }, { tags: ['x'] }, 'nope'])
    const parsed = parseTemplateImport(payload)
    expect(parsed.entries).toBeUndefined()
    expect(parsed.errors).toHaveLength(2)
    const out = importTemplates(payload, library(), 'merge', false)
    expect(out.ok).toBe(false)
    expect(out.templates).toBeUndefined()
  })

  it('rejects a foreign envelope and broken JSON', () => {
    expect(parseTemplateImport('{').errors[0]).toContain('not valid JSON')
    expect(parseTemplateImport('{"kind":"other","templates":[]}').errors[0]).toContain('unexpected kind')
  })

  it('drives import through the command, dry by default and writing with --yes', () => {
    const payload = exportTemplates(library())
    const dry = runCommand({
      raw: 'tmpl import /tmp/x.json', view: view(), defaultScope: 'session', templates: library(), importPayload: payload,
    })
    expect(dry.ok).toBe(true)
    expect(dry.nextTemplates).toBeUndefined()
    const wet = runCommand({
      raw: 'tmpl import /tmp/x.json --yes', view: view(), defaultScope: 'session', templates: library(), importPayload: payload,
    })
    expect(wet.nextTemplates).toHaveLength(2)
  })

  it('errors when the file could not be read', () => {
    expect(runCommand({ raw: 'tmpl import /tmp/nope.json', view: view(), defaultScope: 'session', templates: [] }).ok).toBe(false)
  })
})

describe('runCommand · clear (project scope fix)', () => {
  const full: RuleView = {
    global: [rule({ id: 'g1', text: 'G' })],
    session: [rule({ id: 's1', text: 'S' })],
    project: [rule({ id: 'p1', text: 'P' })],
  }

  it('clears the project scope, not session', () => {
    const out = cmd('clear project', full)
    expect(out.ok).toBe(true)
    expect(out.nextView!.project).toHaveLength(0)
    expect(out.nextView!.session).toHaveLength(1)
    expect(out.nextView!.global).toHaveLength(1)
  })

  it('still clears session and global', () => {
    expect(cmd('clear session', full).nextView!.session).toHaveLength(0)
    expect(cmd('clear global', full).nextView!.global).toHaveLength(0)
  })
})

describe('runCommand · export includes project', () => {
  it('adds the project section when the view has one', () => {
    const full: RuleView = { global: [], session: [], project: [rule({ id: 'p1', text: 'P' })] }
    expect(JSON.parse(cmd('export', full).text).project).toHaveLength(1)
  })

  it('omits the project key when the view has none', () => {
    expect(JSON.parse(cmd('export').text).project).toBeUndefined()
  })
})

describe('renderRules · tags stay out of the model by default', () => {
  const v: RuleView = { global: [rule({ id: 'g1', text: '用中文写注释', tags: ['语言'] })], session: [] }

  it('omits tags (and therefore keeps the pre-tags byte stream)', () => {
    const off = renderRules(v, 10000)
    expect(off).toContain('- 用中文写注释')
    expect(off).not.toContain('语言')
  })

  it('prefixes tags when injectTags is enabled', () => {
    expect(renderRules(v, 10000, { injectTags: true })).toContain('- [语言] 用中文写注释')
  })
})

describe('runCommand · unique id prefix', () => {
  const v: RuleView = {
    global: [],
    session: [rule({ id: 'abcdef1234-0000', text: 'A' }), rule({ id: 'abcdef9999-1111', text: 'B' })],
  }

  it('resolves a unique prefix (the 8-char form `list` prints)', () => {
    const out = cmd('remove abcdef1234', v)
    expect(out.ok).toBe(true)
    expect(out.nextView!.session).toHaveLength(1)
  })

  it('reports an ambiguous prefix instead of guessing', () => {
    const out = cmd('remove abcdef', v)
    expect(out.ok).toBe(false)
    expect(out.text).toContain('ambiguous')
  })

  it('still fails for an unknown id', () => {
    expect(cmd('remove zzzz', v).ok).toBe(false)
  })

  it('applies the same resolution to tag and save', () => {
    const tagged = cmd('tag abcdef1234 短id', v)
    expect(tagged.ok).toBe(true)
    expect(tagged.nextView!.session[0].tags).toEqual(['短id'])
    const saved = cmdT('save abcdef1234', v)
    expect(saved.ok).toBe(true)
    expect(saved.nextTemplates).toHaveLength(3)
  })
})

describe('template writes report ok/changed explicitly (no text sniffing)', () => {
  const dup = [
    { id: 'ffff0001-0000', text: 'A', tags: [], createdAt: 1, updatedAt: 1, uses: 0 },
    { id: 'ffff0002-0000', text: 'B', tags: [], createdAt: 1, updatedAt: 1, uses: 0 },
  ]

  it('treats re-adding an existing template as SUCCESS with no write', () => {
    const out = cmdT('tmpl add 只用 pnpm') // exists already, tags identical
    expect(out.ok).toBe(true)
    expect(out.text).toContain('already existed')
    expect(out.nextTemplates).toBeUndefined() // changed=false → nothing to persist
  })

  it('merges new tags on re-add and reports the change', () => {
    const out = cmdT('tmpl add 只用 pnpm #额外 #工具')
    expect(out.ok).toBe(true)
    expect(out.nextTemplates).toBeDefined()
    expect(out.nextTemplates!.find(t => t.text === '只用 pnpm')!.tags).toEqual(['工具', '额外'])
  })

  it('fails an empty body with no side effects', () => {
    const out = cmdT('tmpl add   ')
    expect(out.ok).toBe(false)
    expect(out.nextTemplates).toBeUndefined()
  })

  it('reports a failed tmpl edit with NO nextTemplates', () => {
    const out = cmdT('tmpl edit zzzz9999 改后')
    expect(out.ok).toBe(false)
    expect(out.nextTemplates).toBeUndefined()
  })

  it('reports an ambiguous tmpl rm with NO nextTemplates', () => {
    const out = cmdT('tmpl rm ffff', view(), dup)
    expect(out.ok).toBe(false)
    expect(out.text).toContain('ambiguous')
    expect(out.nextTemplates).toBeUndefined()
  })

  it('treats a no-op tmpl edit as success without a write', () => {
    const out = cmdT('tmpl edit aaaaaaa1 思考和回答必须用中文') // same body, tags omitted
    expect(out.ok).toBe(true)
    expect(out.text).toContain('already up to date')
    expect(out.nextTemplates).toBeUndefined()
  })

  it('keeps existing tags when tmpl edit omits them, and clears them on an explicit []', () => {
    const kept = updateTemplate(library(), 'aaaaaaa1', '新正文')
    expect(kept.ok).toBe(true)
    expect(kept.templates[0].tags).toEqual(['语言'])
    const cleared = updateTemplate(library(), 'aaaaaaa1', '新正文', [])
    expect(cleared.ok).toBe(true)
    expect(cleared.changed).toBe(true)
    expect(cleared.templates[0].tags).toEqual([])
  })

  it('never flags a failed update/delete as ok or changed', () => {
    expect(updateTemplate(library(), 'zzzz', 'x').ok).toBe(false)
    expect(updateTemplate(library(), 'zzzz', 'x').changed).toBe(false)
    expect(deleteTemplate(library(), 'zzzz').ok).toBe(false)
    expect(deleteTemplate(library(), 'zzzz').changed).toBe(false)
  })
})
