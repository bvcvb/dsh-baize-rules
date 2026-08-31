/**
 * Host HTTP API for the rules panel. The client (`lib/client.js`) fetches rules
 * via GET and applies mutations via POST, reusing the same store + core as the
 * `/baize-rules` command (so the panel and command are the same source of truth).
 *
 * Routes (json):
 *   GET  /baize-rules.api?sessionId=...  -> { global, session }
 *   POST /baize-rules.api { sessionId, raw, scope } -> { ok, text, view }
 *
 * @module dsh-baize-rules/api
 */
import type { Context } from '@deepseek-ai/cordis';
type RulesApiOptions = {
    globalRulesPath?: string;
};
/** Register the rules panel API on the host web server. */
export declare function registerRulesApi(ctx: Context, options?: RulesApiOptions): () => void;
export {};
