/**
 * Package-owned invariant companion for `dsh-baize-rules`.
 *
 * Follows the @deepseek-ai/dsh-invariants contract used by other dsh context
 * plugins (e.g. `@deepseek-ai/dsh-agent-instructions`): a Cordis companion that
 * exports `name` / `inject=['invariants']` / `apply`, and registers itself via
 * `ctx.invariants.register(PACKAGE_NAME, install)`.
 *
 * The check is real now: the runtime store deliberately degrades a corrupt file
 * to an empty scope so that a hand-edited file cannot fail every step of every
 * conversation (see `store.ts`). That is the right runtime behaviour — but it is
 * also silent, so this companion is where the damage becomes visible: with
 * invariants enabled, a store file that exists and cannot be read fails the
 * diagnostic with its path and reason instead of quietly costing someone their
 * rules.
 *
 * @module dsh-baize-rules/invariant
 */
import { storeProblems } from "./store.js";
const PACKAGE_NAME = 'dsh-baize-rules';
/** Cordis companion plugin name. */
export const name = 'baize-rules-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * Check that every singleton store file this plugin owns is readable as the JSON
 * array it is supposed to be. Reported through `fail`, so a violation carries the
 * package attribution the invariant registry expects; paths are included because
 * "which file" is the only actionable part of the message.
 *
 * Only `$DSH_HOME/rules/global.json` and `$DSH_HOME/rules/templates.json` are
 * checked — session and project stores need a live session, and a plugin invariant
 * cannot know the `globalRulesPath` override another instance was configured with.
 */
const install = Object.assign(async (ctx, fail) => {
    const problems = await storeProblems(ctx);
    for (const problem of problems)
        fail(problem);
}, { inject: ['fs'] });
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
