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
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "baize-rules-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
