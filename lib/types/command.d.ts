/**
 * Thin dsh adapter for the `/rules` command: feeds the live `view` + current
 * `defaultScope` into the dependency-free decision core (`core.ts`), then
 * persists the resulting `nextView` (global → disk, session → memory) and any
 * `/rules scope` default change.
 *
 * @module dsh-baize-rules/command
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands';
import type { RuleScope } from './rules.ts';
/** Runtime state the command handler needs from the plugin's `apply`. */
export interface RulesRuntime {
    readonly globalRulesPath?: string;
    readonly getScope: () => RuleScope;
    readonly setScope: (scope: RuleScope) => void;
}
/** The registered handler contract: adapt command input → core decision → persist. */
export declare function handle(ctx: Context, invocation: CommandInvocation, runtime: RulesRuntime): Promise<CommandResult>;
