/**
 * Dependency-free rules-command core: parsing, scope resolution, CRUD
 * application over a {@link RuleView}, the template library operations, and the
 * template import/export transforms. No dsh runtime needed, so it is testable in
 * the Loop 0 harness (`pnpm test`). The dsh-facing adapters (`command.ts`,
 * `api.ts`) feed in the live `view` + `templates` and persist the returned
 * `nextView` / `nextTemplates`; all file IO stays in those adapters.
 *
 * @module dsh-baize-rules/core
 */
import type { Rule, RuleScope, RuleTemplate, RuleView } from './rules.ts';
export declare const RULE_SCOPES: readonly RuleScope[];
export type CommandVerb = 'list' | 'add' | 'remove' | 'enable' | 'disable' | 'edit' | 'scope' | 'clear' | 'export' | 'tag' | 'untag' | 'save' | 'tmpl' | 'from';
export interface ParsedCommand {
    readonly verb: CommandVerb | 'help' | undefined;
    readonly args: readonly string[];
    /** Explicit scope keyword (leading or trailing), if present. */
    readonly scope?: RuleScope;
    /** `#tag` tokens stripped off the end of a tag-aware verb, normalized. */
    readonly tags: readonly string[];
}
export interface CommandInput {
    readonly raw: string;
    readonly view: RuleView;
    readonly defaultScope: RuleScope;
    /** Current template library (defaults to empty for callers that have none). */
    readonly templates?: readonly RuleTemplate[];
    /** Pre-read content of the file named by `tmpl import <file>`. The adapter
     *  owns all IO so this core stays dependency-free and unit-testable. */
    readonly importPayload?: string;
}
export interface CommandOutput {
    readonly ok: boolean;
    readonly text: string;
    /** Present when the rule store should be persisted to this new view. */
    readonly nextView?: RuleView;
    /** Present when the template library should be persisted to this new set. */
    readonly nextTemplates?: readonly RuleTemplate[];
    /** Present when `/baize-rules scope` chose a new default scope. */
    readonly defaultScope?: RuleScope;
    /** Present when `tmpl export <file>` should write this content to this path. */
    readonly exportFile?: {
        readonly path: string;
        readonly content: string;
    };
}
/** The scope a verb acts on: an explicit leading keyword wins, else the caller's
 *  default. Trailing scope words are deliberately NOT parsed as scopes — a rule
 *  body is free text, and `/baize-rules add 部署前先跑测试 global` used to lose
 *  the word `global` from the body and write the rule to the global scope. */
export declare function resolveScope(scope: RuleScope | undefined, fallback: RuleScope): RuleScope;
/** Parse a `/baize-rules` line into a verb + args, isolating an explicit scope
 *  keyword.
 *
 *  Scope is accepted only as a **leading** token (`/baize-rules global add …`).
 *  A trailing scope word is never stripped: it is part of the text or an
 *  argument. That is the whole point — `add` takes free text, and treating its
 *  last word as a scope silently truncated rule bodies and mis-targeted writes.
 *  For tag-aware verbs the trailing `#tag` run is split off into `tags`. */
export declare function parseCommand(raw: string): ParsedCommand;
/** Mint a fully-specified rule (dependency-free; uses global `crypto.randomUUID`). */
export declare function newRule(text: string, now?: number, tags?: readonly string[]): Rule;
/** Mint a fully-specified template. */
export declare function newTemplate(text: string, tags?: readonly string[], now?: number): RuleTemplate;
export declare function addRule(view: RuleView, scope: RuleScope, rule: Rule): RuleView;
/** Return a new view with a rule removed from one scope. */
export declare function removeRule(view: RuleView, scope: RuleScope, id: string): RuleView;
/** Mutate a copy of a scope's rules for the given id; returns whether found. */
export declare function mutate(view: RuleView, scope: RuleScope, id: string, fn: (rule: Rule) => Rule): RuleView;
/** Look one rule up by its exact id inside a scope. */
export declare function findRule(view: RuleView, scope: RuleScope, id: string): Rule | undefined;
/** Resolve a rule reference inside one scope: the exact id, else a **unique** id
 *  prefix (the 8-char form `list` prints). An ambiguous prefix is an error rather
 *  than a silent first match, so `list` → `remove` never hits the wrong rule. */
export declare function resolveRuleRef(view: RuleView, scope: RuleScope, ref: string): {
    readonly ok: true;
    readonly id: string;
} | {
    readonly ok: false;
    readonly error: string;
};
/** Every tag used in a scope, most-used first — the panel's filter chip row. */
export declare function tagsOf(rules: readonly Rule[]): string[];
/** Render a compact human-readable list of the rules in one view, optionally
 *  narrowed to a single scope (`list project`). */
export declare function formatList(view: RuleView, only?: RuleScope): string;
/** Render the template library, optionally filtered to one tag. */
export declare function formatTemplates(templates: readonly RuleTemplate[], filter?: string): string;
export interface TemplateWriteResult {
    readonly templates: readonly RuleTemplate[];
    readonly text: string;
    /** Whether the operation itself succeeded. Callers MUST branch on this, never
     *  on the wording of `text`. On failure `templates` is the untouched input, so
     *  an adapter that persists `templates` unconditionally still cannot corrupt
     *  the library — but it should skip the write entirely. */
    readonly ok: boolean;
    /** True only when a brand-new template was appended. */
    readonly created: boolean;
    /** True when `templates` actually differs from the input. A no-op success
     *  (same body, same tags) reports false so the caller skips the write and the
     *  file's `updatedAt` stays put. */
    readonly changed: boolean;
}
/** Create a template, or merge tags into the existing same-text one. */
export declare function createTemplate(templates: readonly RuleTemplate[], text: string, tags?: readonly string[], now?: number): TemplateWriteResult;
/** Update one template's text and/or tags. An empty `text` keeps the old body;
 *  `tags === undefined` keeps the old tags while an explicit array — including
 *  `[]` — replaces them (the panel needs a way to clear tags). */
export declare function updateTemplate(templates: readonly RuleTemplate[], ref: string, text: string, tags?: readonly string[], now?: number): TemplateWriteResult;
/** Delete one template by exact id or unique id prefix. */
export declare function deleteTemplate(templates: readonly RuleTemplate[], ref: string): TemplateWriteResult;
/** Store a rule (its text plus its own tags and any extra tags) as a template. */
export declare function saveRuleAsTemplate(templates: readonly RuleTemplate[], rule: Rule, extraTags?: readonly string[], now?: number): TemplateWriteResult;
export interface SelectResult {
    readonly picked: readonly RuleTemplate[];
    readonly errors: readonly string[];
}
/** Resolve template references. A `#tag` ref selects every template carrying that
 *  tag; anything else is an id or a unique id prefix (matching what `tmpl list`
 *  prints). An ambiguous prefix is an error, never a silent first match. */
export declare function selectTemplates(templates: readonly RuleTemplate[], refs: readonly string[]): SelectResult;
export interface ApplyTemplatesResult {
    readonly ok: boolean;
    readonly text: string;
    readonly view: RuleView;
    readonly templates: readonly RuleTemplate[];
    readonly selected: number;
    readonly added: number;
    readonly skipped: number;
}
/** Add the referenced templates as rules in one scope. A rule whose text already
 *  exists in that scope is skipped, so adding from a template twice never piles
 *  up duplicates. Every template actually applied bumps its `uses`. */
export declare function applyTemplates(view: RuleView, scope: RuleScope, templates: readonly RuleTemplate[], refs: readonly string[], now?: number): ApplyTemplatesResult;
/** Discriminator written into every exported template file. */
export declare const TEMPLATE_EXPORT_KIND = "dsh-baize-rules-templates";
/** Envelope version of the template exchange format. */
export declare const TEMPLATE_EXPORT_VERSION = 1;
export type TemplateImportMode = 'merge' | 'replace';
/** Serialize the library for exchange. Ids are deliberately dropped: on import
 *  every template is minted a fresh id, which is what makes an exported file
 *  safe to move between machines and sessions. */
export declare function exportTemplates(templates: readonly RuleTemplate[], now?: Date): string;
interface ParsedImport {
    readonly entries?: readonly {
        text: string;
        tags: string[];
        uses: number;
    }[];
    readonly errors: readonly string[];
}
/** Parse an exchange file. Accepts the envelope or a bare template array (a
 *  hand-written or pre-envelope file). Collects EVERY problem — an import must
 *  never end up applying half a file. */
export declare function parseTemplateImport(payload: string): ParsedImport;
export interface ImportResult {
    readonly ok: boolean;
    readonly text: string;
    /** Present only when the import should actually be written (never on a dry run). */
    readonly templates?: readonly RuleTemplate[];
}
/** Apply a parsed import to the library. `merge` dedupes by text and unions tags
 *  (`uses` takes the max); `replace` swaps the whole library. With `dryRun` the
 *  caller learns what would happen and nothing is persisted. */
export declare function importTemplates(payload: string, current: readonly RuleTemplate[], mode?: TemplateImportMode, dryRun?: boolean, now?: number): ImportResult;
/** Apply one parsed `/baize-rules` command to the given view + template library. */
export declare function runCommand(input: CommandInput): CommandOutput;
export {};
