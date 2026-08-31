/**
 * User-set rule data model, scope reconciliation, and the model-visible
 * rendering shared by the pre-step injection and the /rules command.
 *
 * @module @deepseek-ai/dsh-rules/rules
 */
export type RuleScope = 'global' | 'session' | 'project';
/** One user requirement. Rules are plain text — the must-do / must-not intent is
 *  expressed in the text itself (e.g. "用中文写注释" vs "不要改测试"), so there is
 *  no separate kind tag. */
export interface Rule {
    /** Stable id minted once; the /rules command addresses rules by it. */
    readonly id: string;
    readonly text: string;
    /** A rule may be temporarily paused without being deleted. */
    readonly enabled: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
}
/** Ordered, deduplicated rule sets per scope for a single session view. */
export interface RuleView {
    readonly global: readonly Rule[];
    readonly session: readonly Rule[];
    readonly project?: readonly Rule[];
}
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
/** Render the full model-visible <system-reminder> text, or undefined when empty.
 *  Sections are laid out specific-first (project > session > global) so prefix
 *  retention under {@link enforceBudget} keeps the specific rules and sheds the
 *  broadest (global) rules first. Returns undefined when no rule bullet survives
 *  the budget, so we never inject a boilerplate-only reminder. */
export declare function renderRules(view: RuleView, budgetBytes: number): string | undefined;
/** SHA-1 digest of the rendered text, used to suppress redundant injection. */
export declare function renderDigest(view: RuleView, budgetBytes: number): Promise<string | undefined>;
