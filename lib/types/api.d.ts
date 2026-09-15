/**
 * Host HTTP API for the rules panel. The client (`lib/client.js`) fetches rules
 * and templates via GET and applies mutations via POST, reusing the same store +
 * core as the `/baize-rules` command (so the panel and the command are the same
 * source of truth).
 *
 * Routes (json):
 *   GET  /baize-rules.api?sessionId=&project=
 *        -> { global, session, project, templates }
 *   POST /baize-rules.api { op?, sessionId, project, … }
 *        -> { ok, text, view, templates, … }
 *
 * `op` defaults to `raw` — the pre-templates contract `{ raw, scope }` still
 * works unchanged. The other ops exist because the panel drives structured
 * edits (tags, template CRUD, template apply, import/export) that would be
 * awkward to express as command lines.
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
