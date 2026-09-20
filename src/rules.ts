/**
 * User-set rule data model, scope reconciliation, and the model-visible
 * rendering shared by the pre-step injection and the /baize-rules command.
 *
 * @module dsh-baize-rules/rules
 */

export type RuleScope = 'global' | 'session' | 'project'

/** Upper bound on tags per rule/template. Keeps the panel chip row readable and
 *  the single-line `/baize-rules tag <id> …` command usable. */
export const MAX_TAGS_PER_ITEM = 8
/** Upper bound on one tag's length, in characters. */
export const MAX_TAG_LENGTH = 24

/** One user requirement. Rules are plain text — the must-do / must-not intent is
 *  expressed in the text itself (e.g. "用中文写注释" vs "不要改测试"), so there is
 *  no separate kind tag. */
export interface Rule {
  /** Stable id minted once; the /baize-rules command addresses rules by it. */
  readonly id: string
  readonly text: string
  /** Free-text classification tags. Panel-only by default: they drive grouping
   *  and filtering, and reach the model only when `injectTags` is enabled. */
  readonly tags?: readonly string[]
  /** A rule may be temporarily paused without being deleted. */
  readonly enabled: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

/** A reusable rule snippet, stored once in the global template library
 *  (`$DSH_HOME/rules/templates.json`) and freely applied to any scope. Templates
 *  carry no scope of their own — that is exactly what makes them reusable across
 *  sessions and projects. */
export interface RuleTemplate {
  readonly id: string
  /** The rule body. It doubles as the template's display name (no separate name
   *  field, so a name can never drift from the content). */
  readonly text: string
  readonly tags: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
  /** Times this template was applied into a scope; drives default ordering. */
  readonly uses?: number
}

/** Freshness tokens captured when a view was read, one per scope. Written back
 *  as `FsWriteIntent` guards so a concurrent edit cannot be silently dropped.
 *  Opaque here on purpose: `rules.ts` stays free of any `ctx.fs` dependency. */
export interface ScopeVersions {
  readonly global?: unknown
  readonly session?: unknown
  readonly project?: unknown
}

/** Ordered, deduplicated rule sets per scope for a single session view.
 *
 *  `problems` carries non-fatal read failures (a hand-edited or truncated store
 *  file) so callers can show them; a corrupt scope degrades to empty rather
 *  than throwing, because the pre-step of every conversation reads this view. */
export interface RuleView {
  readonly global: readonly Rule[]
  readonly session: readonly Rule[]
  readonly project?: readonly Rule[]
  readonly problems?: readonly string[]
  readonly versions?: ScopeVersions
}

/** Case-insensitive identity key for one tag: `Frontend` and `frontend` are the
 *  same tag for dedupe/filter purposes, while the stored spelling stays as the
 *  user first typed it. */
export function tagKey(tag: string): string {
  return tag.toLowerCase()
}

/** Normalize user-supplied tags: drop non-strings, strip a leading `#`, collapse
 *  inner whitespace, trim, dedupe case-insensitively (first spelling wins), and
 *  cap both count ({@link MAX_TAGS_PER_ITEM}) and length ({@link MAX_TAG_LENGTH}).
 *  Dependency-free, so the command core and the store sanitizer share one rule. */
export function normalizeTags(input: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const tag = raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim()
    if (tag.length === 0) continue
    const key = tagKey(tag)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= MAX_TAGS_PER_ITEM) break
  }
  return out
}

/** Concatenate global then session rules, honoring scope precedence. */
export function activeRules(view: RuleView): readonly Rule[] {
  return [...view.global, ...view.session].filter(rule => rule.enabled)
}

/** Escape literal closing tags so user text cannot close the plugin frame. */
export function escapeReminder(text: string): string {
  return text.replace(/<\/(?:system-reminder)\s*>/gi, '<\\/system-reminder>')
}

/** Enforce the configured byte budget by keeping the *prefix* (up to `budgetBytes`
 *  UTF-8 bytes) and dropping the tail. Precedence is thus decided by callers:
 *  {@link renderRules} lays the most specific section first, so a tight budget
 *  sheds the broadest (global) rules before any specific (session/project) rule. */
export function enforceBudget(
  lines: readonly string[],
  budgetBytes: number,
): { lines: readonly string[]; omitted: number } {
  if (budgetBytes <= 0) return { lines: [], omitted: lines.length }
  let bytes = 0
  const kept: string[] = []
  for (const line of lines) {
    const next = bytes + Buffer.byteLength(line, 'utf8')
    if (next > budgetBytes) {
      return { lines: kept, omitted: lines.length - kept.length }
    }
    kept.push(line)
    bytes = next
  }
  return { lines: kept, omitted: 0 }
}

/** Section order by precedence, most specific first. Global stays last so a tight
 *  budget drops the broadest rules before any specific (session/project) rule. */
const SCOPE_ORDER: readonly RuleScope[] = ['project', 'session', 'global']

function sectionHeader(scope: RuleScope): string {
  switch (scope) {
    case 'project': return 'Project requirements (this directory only):'
    case 'session': return 'Session requirements (this conversation only):'
    default:        return 'Global requirements:'
  }
}

const RULE_BULLET = /^- /

/** Rendering options for {@link renderRules} / {@link renderDigest}. */
export interface RenderOptions {
  /** Prefix each bullet with `[tag,tag] `. Off by default: tags exist so the
   *  user can classify rules in the panel, and injecting them spends the byte
   *  budget plus adds noise to every request. */
  readonly injectTags?: boolean
}

/** Render the full model-visible <system-reminder> text, or undefined when empty.
 *  Sections are laid out specific-first (project > session > global) so prefix
 *  retention under {@link enforceBudget} keeps the specific rules and sheds the
 *  broadest (global) rules first. Returns undefined when no rule bullet survives
 *  the budget, so we never inject a boilerplate-only reminder. */
export function renderRules(
  view: RuleView,
  budgetBytes: number,
  options: RenderOptions = {},
): string | undefined {
  const enabled = (rules: readonly Rule[] | undefined): readonly Rule[] =>
    (rules ?? []).filter(rule => rule.enabled)

  const sections = SCOPE_ORDER
    .map(scope => ({
      scope,
      rules: enabled(scope === 'project' ? view.project
        : scope === 'session' ? view.session : view.global),
    }))
    .filter(section => section.rules.length > 0)
  if (sections.length === 0) return undefined

  const bullet = (rule: Rule): string => {
    const tags = options.injectTags === true ? (rule.tags ?? []) : []
    const prefix = tags.length > 0 ? `[${tags.join(',')}] ` : ''
    return `- ${prefix}${escapeReminder(rule.text)}`
  }
  const lines: string[] = [
    'The following user requirements apply to every step of this conversation. Obey them.',
    'More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.',
  ]
  for (const section of sections) {
    lines.push('', sectionHeader(section.scope))
    lines.push(...section.rules.map(bullet))
  }

  const { lines: kept } = enforceBudget(lines, budgetBytes)
  if (!kept.some(line => RULE_BULLET.test(line))) return undefined
  return `<system-reminder>\n${kept.join('\n')}\n</system-reminder>`
}

/** SHA-1 digest of the rendered text, used to suppress redundant injection.
 *  With tags off (the default) retagging a rule does NOT change the digest, so a
 *  tag edit never triggers a redundant re-injection. */
export async function renderDigest(
  view: RuleView,
  budgetBytes: number,
  options: RenderOptions = {},
): Promise<string | undefined> {
  const text = renderRules(view, budgetBytes, options)
  return text === undefined ? undefined : digestOfText(text)
}

/** SHA-1 of already-rendered text. The pre-step renders once and digests that
 *  string, so it never pays for a second `renderRules`. */
export async function digestOfText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-1', bytes)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
