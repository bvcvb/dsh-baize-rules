/**
 * User-set rule data model, scope reconciliation, and the model-visible
 * rendering shared by the pre-step injection and the /rules command.
 *
 * @module @deepseek-ai/dsh-rules/rules
 */
export type RuleScope = 'global' | 'session' | 'project';
/** Upper bound on tags per rule/template. Keeps the panel chip row readable and
 *  the single-line `/baize-rules tag <id> …` command usable. */
export declare const MAX_TAGS_PER_ITEM = 8;
/** Upper bound on one tag's length, in characters. */
export declare const MAX_TAG_LENGTH = 24;
/** One user requirement. Rules are plain text — the must-do / must-not intent is
 *  expressed in the text itself (e.g. "用中文写注释" vs "不要改测试"), so there is
 *  no separate kind tag. */
export interface Rule {
    /** Stable id minted once; the /rules command addresses rules by it. */
    readonly id: string;
    readonly text: string;
    /** Free-text classification tags. Panel-only by default: they drive grouping
     *  and filtering, and reach the model only when `injectTags` is enabled. */
    readonly tags?: readonly string[];
    /** A rule may be temporarily paused without being deleted. */
    readonly enabled: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
/** A reusable rule snippet, stored once in the global template library
 *  (`$DSH_HOME/rules/templates.json`) and freely applied to any scope. Templates
 *  carry no scope of their own — that is exactly what makes them reusable across
 *  sessions and projects. */
export interface RuleTemplate {
    readonly id: string;
    /** The rule body. It doubles as the template's display name (no separate name
     *  field, so a name can never drift from the content). */
    readonly text: string;
    readonly tags: readonly string[];
    readonly createdAt: number;
    readonly updatedAt: number;
    /** Times this template was applied into a scope; drives default ordering. */
    readonly uses?: number;
}
/** Ordered, deduplicated rule sets per scope for a single session view. */
export interface RuleView {
    readonly global: readonly Rule[];
    readonly session: readonly Rule[];
    readonly project?: readonly Rule[];
}
/** Case-insensitive identity key for one tag: `Frontend` and `frontend` are the
 *  same tag for dedupe/filter purposes, while the stored spelling stays as the
 *  user first typed it. */
export declare function tagKey(tag: string): string;
/** Normalize user-supplied tags: drop non-strings, strip a leading `#`, collapse
 *  inner whitespace, trim, dedupe case-insensitively (first spelling wins), and
 *  cap both count ({@link MAX_TAGS_PER_ITEM}) and length ({@link MAX_TAG_LENGTH}).
 *  Dependency-free, so the command core and the store sanitizer share one rule. */
export declare function normalizeTags(input: readonly unknown[] | undefined): string[];
/** Concatenate global then session rules, honoring scope precedence. */
export declare function activeRules(view: RuleView): readonly Rule[];
/** Escape literal closing tags so user text cannot close the plugin frame. */
export declare function escapeReminder(text: string): string;
/** Enforce the configured byte budget by keeping the *prefix* (up to `budgetBytes`
 *  UTF-8 bytes) and dropping the tail. Precedence is thus decided by callers:
 *  {@link renderRules} lays the most specific section first, so a tight budget
 *  sheds the broadest (global) rules before any specific (session/project) rule. */
export declare function enforceBudget(lines: readonly string[], budgetBytes: number): {
    lines: readonly string[];
    omitted: number;
};
/** Rendering options for {@link renderRules} / {@link renderDigest}. */
export interface RenderOptions {
    /** Prefix each bullet with `[tag,tag] `. Off by default: tags exist so the
     *  user can classify rules in the panel, and injecting them spends the byte
     *  budget plus adds noise to every request. */
    readonly injectTags?: boolean;
}
/** Render the full model-visible <system-reminder> text, or undefined when empty.
 *  Sections are laid out specific-first (project > session > global) so prefix
 *  retention under {@link enforceBudget} keeps the specific rules and sheds the
 *  broadest (global) rules first. Returns undefined when no rule bullet survives
 *  the budget, so we never inject a boilerplate-only reminder. */
export declare function renderRules(view: RuleView, budgetBytes: number, options?: RenderOptions): string | undefined;
/** SHA-1 digest of the rendered text, used to suppress redundant injection.
 *  With tags off (the default) retagging a rule does NOT change the digest, so a
 *  tag edit never triggers a redundant re-injection. */
export declare function renderDigest(view: RuleView, budgetBytes: number, options?: RenderOptions): Promise<string | undefined>;
