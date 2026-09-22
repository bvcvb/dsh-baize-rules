/**
 * Host HTTP API for the rules panel. The client (`lib/client.js`) fetches rules
 * and templates via GET and applies mutations via POST, reusing the same store +
 * core as the `/baize-rules` command (so the panel and the command are the same
 * source of truth).
 *
 * Routes (json):
 *   GET  /baize-rules.api?sessionId=&project=
 *        -> { global, session, project, templates, problems }
 *   POST /baize-rules.api { op?, sessionId, project, … }
 *        -> { ok, text, view, templates, problems, … }
 *
 * `op` defaults to `raw` — the pre-templates contract `{ raw, scope }` still
 * works unchanged. The other ops exist because the panel drives structured
 * edits (tags, template CRUD, template apply, import/export) that would be
 * awkward to express as command lines.
 *
 * Three properties this layer owns:
 *   - **Origin.** The global rule file reaches every conversation's prompt, so a
 *     request must come from this machine and, when the browser states one, from
 *     the host's own origin. See {@link authorize}.
 *   - **Body size.** The panel posts whole template libraries; a body is capped
 *     at {@link MAX_BODY_BYTES} and a larger one is refused with 413.
 *   - **Concurrency.** Every write carries the freshness token read with the
 *     view, and a lost race answers 409 instead of overwriting silently.
 *
 * @module dsh-baize-rules/api
 */
import type { Context } from '@deepseek-ai/cordis';
type RulesApiOptions = {
    globalRulesPath?: string;
    /** Enforce {@link authorize}. Off unless the plugin config turns it on: behind a
     *  reverse proxy the request arrives from the proxy's address, not from loopback. */
    originCheck?: boolean;
};
/** Register the rules panel API on the host web server. */
export declare function registerRulesApi(ctx: Context, options?: RulesApiOptions): () => void;
export {};
