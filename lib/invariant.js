/**
 * Package-owned invariant companion for `dsh-baize-rules`.
 *
 * Follows the @deepseek-ai/dsh-invariants contract used by other dsh context
 * plugins (e.g. `@deepseek-ai/dsh-agent-instructions`): a Cordis companion that
 * exports `name` / `inject=['invariants']` / `apply`, and registers itself via
 * `ctx.invariants.register(PACKAGE_NAME, install)`.
 *
 * @module dsh-baize-rules/invariant
 */
const PACKAGE_NAME = 'dsh-baize-rules';
/** Cordis companion plugin name. */
export const name = 'baize-rules-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * M1 hook: install a real check that any rules-tagged `user/message` in the
 * session log carries the rules plugin's own source marker and reconstructs from
 * the current rule set. For now it is an explainable no-op so it never blocks a
 * session; the reference implementation's naive `registerInvariant` (a nonexistent
 * export from a wrong package name) is replaced by this contract-correct shape.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
