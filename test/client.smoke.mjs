/**
 * Client-half smoke test — zero dependencies.
 *
 * `lib/client.js` is hand-authored (the official `clientBundle` tsdown preset is
 * not published, so a plugin outside the dsh repository writes the
 * `__ModuleLoader__.load({ id, factory })` shell itself). Nothing type-checks it
 * and nothing bundles it: a typo is a blank tab in the browser and nowhere else.
 * The sibling repo uses `react-test-renderer` for this; that package is not a
 * dependency here and is not worth adding, so this guards the contract instead
 * of the pixels — the four things that break silently:
 *
 *   1. it parses (`node --check`) and really loads through the module loader;
 *   2. every `op: '…'` it sends exists as a `case '…'` in `src/api.ts`
 *      (a renamed server op used to mean a silent "unknown op" in the panel);
 *   3. the zh/en dictionaries are key-for-key aligned and every `t('…')` literal
 *      resolves (a missing key renders the raw key to the user);
 *   4. the injected style tag carries `data-plugin-css`, which is what keeps an
 *      HMR reload from double-applying the whole stylesheet.
 *
 * Run: `node test/client.smoke.mjs` (exit code 1 on any failure).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const bundlePath = path.join(root, 'lib', 'client.js')
const apiPath = path.join(root, 'src', 'api.ts')

const source = fs.readFileSync(bundlePath, 'utf8')
const apiSource = fs.readFileSync(apiPath, 'utf8')

const NS = 'baize-rules'
const PACKAGE_NAME = 'dsh-baize-rules'
/** Modules the bundle is allowed to require; anything else is a new dependency. */
const ALLOWED_REQUIRES = ['react']

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
/** What the host actually guarantees to provide at runtime: everything the
 *  package declares as a dependency or a peer dependency. The host UI packages
 *  ship as devDependencies only, so a require() of one of those is an undeclared
 *  dependency that type-checks, bundles, and then fails in the browser. */
const DECLARED_MODULES = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
])
/** `const x = require(…)` whose binding is never referenced again: an undeclared
 *  import *and* dead code. This bundle once carried
 *  `const primitives = require('@deepseek-ai/dsh-client-ui-primitives')` that was
 *  never used and never declared — the shape this guard exists to keep out. */
function deadRequireBindings(text) {
  const dead = []
  for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/g)) {
    const name = match[1]
    const uses = text.match(new RegExp('\\b' + name + '\\b', 'g')) || []
    if (uses.length <= 1) dead.push(name)
  }
  return dead
}

// --- Tiny reporter: every assertion is printed, failures never abort the run. ---
let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok   ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  FAIL ' + name)
    console.log('       ' + String((e && e.message) || e).split('\n').join('\n       '))
  }
}
function section(title) { console.log('\n== ' + title) }
/** Diff two key sets so a mismatch names the offending keys instead of "not equal". */
function keyDiff(a, b) {
  const only = (x, y) => x.filter((k) => y.indexOf(k) < 0)
  return { aOnly: only(a, b), bOnly: only(b, a) }
}

// ---------------------------------------------------------------------------
section('1. syntax + module shell')
// ---------------------------------------------------------------------------

check('lib/client.js parses (node --check)', () => {
  execFileSync(process.execPath, ['--check', bundlePath], { stdio: 'pipe' })
})

check('lib/client.js evaluates as a script (new Function)', () => {
  // The bundle is a top-level `window.__ModuleLoader__.load({…})` call, so
  // compiling it must not depend on anything being in scope yet.
  new Function(source) // eslint-disable-line no-new-func
})

let definition = null
globalThis.window = {
  __ModuleLoader__: { load(d) { definition = d } },
  addEventListener() {},
  removeEventListener() {},
}
new Function(source)() // eslint-disable-line no-new-func

check('loader captured a definition with the package id', () => {
  assert.ok(definition, 'window.__ModuleLoader__.load was never called')
  assert.equal(definition.id, PACKAGE_NAME)
  assert.equal(typeof definition.factory, 'function')
})

// The bundle is loaded by the browser loader, not by ESM: react comes from the
// host's shared module table, every other host module is stubbed.
const React = require('react')
const requiredNames = []
const stubRequire = (name) => {
  requiredNames.push(name)
  if (name === 'react') return React
  return {}
}
/** Boot the bundle in a stubbed browser: each call gets a fresh module scope. */
function boot({ existingCssTags = [] } = {}) {
  const appends = []
  const doc = {
    head: { appendChild(node) { appends.push(node) } },
    createElement(tagName) { return { tagName, dataset: {}, textContent: '' } },
    // A node here simulates a style tag an earlier load (HMR) already injected.
    querySelector(selector) {
      return existingCssTags.length > 0 && String(selector).indexOf('style[data-plugin-css=') === 0
        ? existingCssTags[0]
        : null
    },
    activeElement: null,
    contains() { return false },
    querySelectorAll() { return [] },
  }
  globalThis.document = doc
  const mod = definition.factory(stubRequire)
  const registrations = []
  const seen = { dicts: null, effects: 0 }
  const ctx = {
    effect(fn) {
      seen.effects += 1
      const r = fn()
      if (r && typeof r.next === 'function') r.next()
    },
    locale: {
      register(ns, dict) { if (ns === NS) seen.dicts = dict; return () => {} },
      bind() { return (key) => key },
    },
    slots: {
      inject(name, cb) { cb() },
      register(meta, render) { registrations.push({ meta, render }); return () => {} },
    },
  }
  mod.apply(ctx)
  return { mod, appends, registrations, doc, seen, applyAgain: () => mod.apply(ctx) }
}

const booted = boot()
const mod = booted.mod

check('exports.apply is a function', () => {
  assert.equal(typeof mod.apply, 'function')
})

check('exports.inject is a non-empty array', () => {
  assert.ok(Array.isArray(mod.inject), 'inject must be an array')
  assert.ok(mod.inject.length > 0, 'inject must not be empty')
})

check('exports.name is absent or the package id', () => {
  if (mod.name !== undefined) assert.equal(mod.name, PACKAGE_NAME)
})

check('the bundle requires only react', () => {
  const unique = Array.from(new Set(requiredNames))
  const unexpected = unique.filter((n) => ALLOWED_REQUIRES.indexOf(n) < 0)
  assert.deepEqual(unexpected, [], 'unexpected requires: ' + unexpected.join(', ') + ' (no new dependencies)')
  assert.ok(unique.indexOf('react') >= 0, 'react must be required')
})

check('every required module is declared in package.json', () => {
  const unique = Array.from(new Set(requiredNames))
  const undeclared = unique.filter((n) => !DECLARED_MODULES.has(n))
  assert.deepEqual(undeclared, [],
    'required but not in dependencies/peerDependencies: ' + undeclared.join(', ') +
    ' (declare it as a peer dependency, or drop the import)')
})

check('no require binding is dead code', () => {
  const dead = deadRequireBindings(source)
  assert.deepEqual(dead, [], 'required but never used: ' + dead.join(', '))
})

check('apply registers the sidebar trigger and the conversation view', () => {
  const names = booted.registrations.map((r) => r.meta.name).sort()
  assert.deepEqual(names, ['conversation.view', 'sidebar.footer.action'])
  assert.equal(booted.seen.effects, 1, 'exactly one effect (dictionary registration)')
  assert.ok(booted.seen.dicts, 'dictionaries were never registered')
})

check('the conversation.view renderer forwards sessionId (no dead cwd chain)', () => {
  const view = booted.registrations.find((r) => r.meta.name === 'conversation.view')
  const el = view.render({ sessionId: 'sess-1', hooks: {} })
  assert.equal(el.props.sessionId, 'sess-1')
  // The session slot kit carries no cwd, so the panel must not pretend to have one.
  assert.equal(el.props.project, undefined)
  assert.ok(
    source.indexOf('props?.session?.header?.cwd') < 0,
    'the unreachable cwd fallback chain is back in the source',
  )
})

// ---------------------------------------------------------------------------
section('2. op contract vs src/api.ts')
// ---------------------------------------------------------------------------

const clientOps = Array.from(new Set(
  Array.from(source.matchAll(/\bop:\s*'([^']+)'/g)).map((m) => m[1]),
))
const serverOps = new Set(
  Array.from(apiSource.matchAll(/case\s+'([^']+)':/g)).map((m) => m[1]),
)

check('every op the client sends exists in api.ts', () => {
  assert.ok(clientOps.length > 0, 'no `op: …` literal found in lib/client.js')
  const missing = clientOps.filter((op) => !serverOps.has(op))
  assert.deepEqual(missing, [], 'ops missing from src/api.ts: ' + missing.join(', '))
})

check('noticeKey only switches on real ops', () => {
  const start = source.indexOf('function noticeKey(')
  assert.ok(start >= 0, 'noticeKey is gone — success notices would echo host English again')
  const end = source.indexOf('function focusablesIn(', start)
  const block = source.slice(start, end > start ? end : undefined)
  const cases = Array.from(new Set(Array.from(block.matchAll(/case\s+'([^']+)':/g)).map((m) => m[1])))
  assert.ok(cases.length > 0, 'noticeKey has no op cases')
  const unknown = cases.filter((op) => !serverOps.has(op))
  assert.deepEqual(unknown, [], 'noticeKey cases with no server op: ' + unknown.join(', '))
})

check('new rules use the structured rule.add op, not a command line', () => {
  assert.ok(clientOps.indexOf('rule.add') >= 0, 'rule.add is not used')
  assert.ok(
    source.indexOf("'add ' +") < 0,
    "the client still builds an `add <text>` command line",
  )
})

check('enabled is toggled through rule.setEnabled', () => {
  assert.ok(clientOps.indexOf('rule.setEnabled') >= 0, 'rule.setEnabled is not used')
})

// ---------------------------------------------------------------------------
section('3. i18n keys')
// ---------------------------------------------------------------------------

const dicts = booted.seen.dicts || {}
const zhKeys = Object.keys(dicts.zh || {}).sort()
const enKeys = Object.keys(dicts.en || {}).sort()

check('dictionaries carry zh and en', () => {
  assert.ok(dicts.zh && dicts.en, 'apply did not register both dictionaries')
  assert.ok(zhKeys.length > 0 && enKeys.length > 0, 'a dictionary is empty')
})

check('zh and en keys are exactly aligned', () => {
  const { aOnly, bOnly } = keyDiff(zhKeys, enKeys)
  assert.deepEqual(aOnly, [], 'zh-only keys: ' + aOnly.join(', '))
  assert.deepEqual(bOnly, [], 'en-only keys: ' + bOnly.join(', '))
})

check('every t(…) literal resolves to a dictionary key', () => {
  const used = Array.from(new Set(
    Array.from(source.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)).map((m) => m[1]),
  ))
  assert.ok(used.length > 0, 'no t(…) literal found')
  const missing = used.filter((k) => zhKeys.indexOf(k) < 0)
  assert.deepEqual(missing, [], 'keys used but not defined: ' + missing.join(', '))
})

check('success notices are localized, not the host’s English text', () => {
  const noticeKeys = ['rules.added', 'rules.saved', 'rules.removed', 'rules.enabled', 'rules.disabled',
    'templates.added', 'templates.saved', 'templates.removed', 'templates.imported', 'rules.conflict', 'problems.title']
  const missing = noticeKeys.filter((k) => zhKeys.indexOf(k) < 0 || enKeys.indexOf(k) < 0)
  assert.deepEqual(missing, [], 'notice keys missing from a dictionary: ' + missing.join(', '))
  assert.ok(
    source.indexOf('setNotice(body.text') < 0,
    'a success notice still echoes the server text verbatim',
  )
})

// ---------------------------------------------------------------------------
section('4. style injection')
// ---------------------------------------------------------------------------

check('style tag uses data-plugin / data-plugin-css', () => {
  assert.ok(source.indexOf('data-plugin-css') >= 0, 'the dedupe selector is gone')
  assert.ok(source.indexOf('dataset.pluginCss') >= 0, 'dataset.pluginCss is not set')
  assert.equal(booted.appends.length, 1, 'expected exactly one injected style tag')
  const tag = booted.appends[0]
  assert.equal(tag.tagName, 'style')
  assert.equal(tag.dataset.plugin, PACKAGE_NAME)
  assert.equal(typeof tag.dataset.pluginCss, 'string')
  assert.ok(tag.dataset.pluginCss.length > 0)
})

check('injected css keeps the sidebar layout patch', () => {
  const css = booted.appends[0].textContent
  assert.ok(css.indexOf('footerActions') >= 0, 'the footer layout rule is gone')
  assert.ok(css.indexOf(':has(') >= 0, 'the class-name-independent fallback rule is gone')
  assert.ok(css.indexOf('.baize-trigger{') >= 0, 'the trigger styles are gone')
})

check('a style tag left by an earlier load is not injected twice', () => {
  const again = boot({ existingCssTags: [{ dataset: { pluginCss: PACKAGE_NAME + '/client.css' } }] })
  assert.deepEqual(again.appends, [], 'HMR would double-apply the stylesheet')
})

check('re-applying on the same page injects nothing more', () => {
  booted.applyAgain()
  assert.equal(booted.appends.length, 1, 'a second apply re-injected the stylesheet')
})

// ---------------------------------------------------------------------------
// Exit code is what CI reads: 1 on any failure, 0 only when every check passed.
// The script writes nothing and opens no sockets — it only reads the bundle, the
// API source and package.json, plus one `node --check` child process.
console.log('')
if (failures.length > 0) {
  console.log(failures.length + ' of ' + (passed + failures.length) + ' checks FAILED:')
  for (const name of failures) console.log('  - ' + name)
  process.exitCode = 1
} else {
  console.log('all ' + passed + ' checks passed')
  process.exitCode = 0
}
