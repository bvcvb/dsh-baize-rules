/**
 * User-set rule data model, scope reconciliation, and the model-visible
 * rendering shared by the pre-step injection and the /rules command.
 *
 * @module @deepseek-ai/dsh-rules/rules
 */
/** Upper bound on tags per rule/template. Keeps the panel chip row readable and
 *  the single-line `/baize-rules tag <id> …` command usable. */
export const MAX_TAGS_PER_ITEM = 8;
/** Upper bound on one tag's length, in characters. */
export const MAX_TAG_LENGTH = 24;
/** Case-insensitive identity key for one tag: `Frontend` and `frontend` are the
 *  same tag for dedupe/filter purposes, while the stored spelling stays as the
 *  user first typed it. */
export function tagKey(tag) {
    return tag.toLowerCase();
}
/** Normalize user-supplied tags: drop non-strings, strip a leading `#`, collapse
 *  inner whitespace, trim, dedupe case-insensitively (first spelling wins), and
 *  cap both count ({@link MAX_TAGS_PER_ITEM}) and length ({@link MAX_TAG_LENGTH}).
 *  Dependency-free, so the command core and the store sanitizer share one rule. */
export function normalizeTags(input) {
    if (!Array.isArray(input))
        return [];
    const seen = new Set();
    const out = [];
    for (const raw of input) {
        if (typeof raw !== 'string')
            continue;
        const tag = raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
        if (tag.length === 0)
            continue;
        const key = tagKey(tag);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= MAX_TAGS_PER_ITEM)
            break;
    }
    return out;
}
/** Concatenate global then session rules, honoring scope precedence. */
export function activeRules(view) {
    return [...view.global, ...view.session].filter(rule => rule.enabled);
}
/** Escape literal closing tags so user text cannot close the plugin frame. */
export function escapeReminder(text) {
    return text.replace(/<\/(?:system-reminder)\s*>/gi, '<\\/system-reminder>');
}
/** Enforce the configured byte budget by keeping the *prefix* (up to `budgetBytes`
 *  UTF-8 bytes) and dropping the tail. Precedence is thus decided by callers:
 *  {@link renderRules} lays the most specific section first, so a tight budget
 *  sheds the broadest (global) rules before any specific (session/project) rule. */
export function enforceBudget(lines, budgetBytes) {
    if (budgetBytes <= 0)
        return { lines: [], omitted: lines.length };
    let bytes = 0;
    const kept = [];
    for (const line of lines) {
        const next = bytes + Buffer.byteLength(line, 'utf8');
        if (next > budgetBytes) {
            return { lines: kept, omitted: lines.length - kept.length };
        }
        kept.push(line);
        bytes = next;
    }
    return { lines: kept, omitted: 0 };
}
/** Section order by precedence, most specific first. Global stays last so a tight
 *  budget drops the broadest rules before any specific (session/project) rule. */
const SCOPE_ORDER = ['project', 'session', 'global'];
function sectionHeader(scope) {
    switch (scope) {
        case 'project': return 'Project requirements (this directory only):';
        case 'session': return 'Session requirements (this conversation only):';
        default: return 'Global requirements:';
    }
}
const RULE_BULLET = /^- /;
/** Render the full model-visible <system-reminder> text, or undefined when empty.
 *  Sections are laid out specific-first (project > session > global) so prefix
 *  retention under {@link enforceBudget} keeps the specific rules and sheds the
 *  broadest (global) rules first. Returns undefined when no rule bullet survives
 *  the budget, so we never inject a boilerplate-only reminder. */
export function renderRules(view, budgetBytes, options = {}) {
    const enabled = (rules) => (rules ?? []).filter(rule => rule.enabled);
    const sections = SCOPE_ORDER
        .map(scope => ({
        scope,
        rules: enabled(scope === 'project' ? view.project
            : scope === 'session' ? view.session : view.global),
    }))
        .filter(section => section.rules.length > 0);
    if (sections.length === 0)
        return undefined;
    const bullet = (rule) => {
        const tags = options.injectTags === true ? (rule.tags ?? []) : [];
        const prefix = tags.length > 0 ? `[${tags.join(',')}] ` : '';
        return `- ${prefix}${escapeReminder(rule.text)}`;
    };
    const lines = [
        'The following user requirements apply to every step of this conversation. Obey them.',
        'More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.',
    ];
    for (const section of sections) {
        lines.push('', sectionHeader(section.scope));
        lines.push(...section.rules.map(bullet));
    }
    const { lines: kept } = enforceBudget(lines, budgetBytes);
    if (!kept.some(line => RULE_BULLET.test(line)))
        return undefined;
    return `<system-reminder>\n${kept.join('\n')}\n</system-reminder>`;
}
/** SHA-1 digest of the rendered text, used to suppress redundant injection.
 *  With tags off (the default) retagging a rule does NOT change the digest, so a
 *  tag edit never triggers a redundant re-injection. */
export async function renderDigest(view, budgetBytes, options = {}) {
    const text = renderRules(view, budgetBytes, options);
    if (text === undefined)
        return undefined;
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
