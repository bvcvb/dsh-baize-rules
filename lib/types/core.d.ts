/**
 * Dependency-free rules-command core: parsing, scope resolution, and CRUD
 * application over a {@link RuleView}. No dsh runtime needed, so it is testable
 * in the Loop 0 harness (`pnpm test`). The dsh-facing adapter (`command.ts`)
 * feeds in the live `view` + `defaultScope` and persists `nextView`/`defaultScope`.
 *
 * @module dsh-baize-rules/core
 */
import type { Rule, RuleScope, RuleView } from './rules.ts';
export declare const RULE_SCOPES: readonly RuleScope[];
export type CommandVerb = 'list' | 'add' | 'remove' | 'enable' | 'disable' | 'edit' | 'scope' | 'clear' | 'export';
export interface ParsedCommand {
    readonly verb: CommandVerb | 'help' | undefined;
    readonly args: readonly string[];
    /** Explicit scope keyword (leading or trailing), if present. */
    readonly scope?: RuleScope;
}
export interface CommandInput {
    readonly raw: string;
    readonly view: RuleView;
    readonly defaultScope: RuleScope;
}
export interface CommandOutput {
    readonly ok: boolean;
    readonly text: string;
    /** Present when the store should be persisted to this new view. */
    readonly nextView?: RuleView;
    /** Present when `/rules scope` chose a new default scope. */
    readonly defaultScope?: RuleScope;
}
/** Parse a `/rules` line into a verb + args, isolating an explicit scope keyword.
 *  Scope is accepted as a **leading** token (`/rules global add …`) or a
 *  **trailing** token (`/rules add … global`, only the LAST arg qualifies),
 *  so a rule whose text merely contains "global" is never misread as a scope. */
export declare function parseCommand(raw: string): ParsedCommand;
/** Explicit scope wins, else the caller's default. */
export declare function resolveScope(scope: RuleScope | undefined, fallback: RuleScope): RuleScope;
/** Mint a fully-specified rule (dependency-free; uses global `crypto.randomUUID`). */
export declare function newRule(text: string, now?: number): Rule;
export declare function addRule(view: RuleView, scope: RuleScope, rule: Rule): RuleView;
/** Return a new view with a rule removed from one scope. */
export declare function removeRule(view: RuleView, scope: RuleScope, id: string): RuleView;
/** Mutate a copy of a scope's rules for the given id; returns whether found. */
export declare function mutate(view: RuleView, scope: RuleScope, id: string, fn: (rule: Rule) => Rule): RuleView;
/** Render a compact human-readable list of the active rules. */
export declare function formatList(view: RuleView): string;
/** Apply one parsed `/rules` command to the given view + default scope. */
export declare function runCommand(input: CommandInput): CommandOutput;
