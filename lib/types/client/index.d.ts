/**
 * Hand-written declaration for the hand-written client bundle (`lib/client.js`).
 *
 * The client half of this plugin is authored directly in the
 * `window.__ModuleLoader__.load({ id, factory })` shape — there is no
 * `src/client.ts` for `tsc` to emit from (see the module comment at the top of
 * `lib/client.js`, and `tsconfig.build.json`, whose `include` is `src/**\/*.ts`).
 * This file exists so `exports["./client"].types` resolves to something real;
 * keep it in step with the bundle by hand.
 *
 * @module dsh-baize-rules/client
 */

/** Client services the bundle needs before `apply` runs. Service names, as the
 *  client runtime resolves them — not package names. */
export declare const inject: readonly string[]

/** Register the rules panel: the sidebar-footer trigger and the conversation view
 *  entry that renders the 规则 / 模板 panes. */
export declare function apply(ctx: unknown): void
