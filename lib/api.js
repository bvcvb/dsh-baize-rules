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
import { normalizeTags } from "./rules.js";
import { applyTemplates, createTemplate, deleteTemplate, exportTemplates, findRule, importTemplates, mutate, runCommand, saveRuleAsTemplate, updateTemplate, } from "./core.js";
import { isStaleWrite, readTemplatesWithVersion, view, writeGlobal, writeProject, writeSession, writeTemplates, } from "./store.js";
/** Largest accepted POST body. A whole exported template library is far below
 *  this; anything bigger is a mistake or an attempt to exhaust memory. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Shown when a write lost a concurrency race; nothing was persisted. */
const STALE_MESSAGE = 'Rules changed in another window while you were editing — nothing was written. Reload and try again.';
function sendJson(res, status, payload) {
    const r = res;
    r.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    r.end(JSON.stringify(payload));
}
/** Thrown when a request body exceeds {@link MAX_BODY_BYTES}. */
class BodyTooLargeError extends Error {
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const r = req;
        let size = 0;
        let body = '';
        r.on('data', (chunk) => {
            size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk?.length ?? 0;
            if (size > MAX_BODY_BYTES) {
                r.destroy?.();
                reject(new BodyTooLargeError('request body too large'));
                return;
            }
            body += chunk;
        });
        r.on('end', () => resolve(body));
        r.on('error', () => resolve(''));
    });
}
const LOOPBACK_ADDRESS = /^(?:::1|::ffff:127(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3})$/;
/** Whether a stated browser origin belongs to this host (or to a local page,
 *  which is how the Electron shell reaches the port). */
function originAllowed(origin, host) {
    if (origin === 'null')
        return true; // file:// pages carry a null origin
    try {
        const parsed = new URL(origin);
        if (typeof host === 'string' && parsed.host === host)
            return true;
        return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    }
    catch {
        return false;
    }
}
/** Deny a request that is neither from this machine nor from the page the host
 *  itself served. The panel can rewrite the global rule file, and global rules
 *  reach every conversation's prompt, so "anything that can reach the port" must
 *  not be enough.
 *
 *  Opt-in (`apiOriginCheck: true`) and **off by default**: a reverse proxy in
 *  front of the web UI delivers the request from the proxy's own address rather
 *  than from loopback, so enforcing this by default breaks the panel for the
 *  ordinary proxied deployment. Turn it on when the port is reachable by others
 *  and the proxy layer does not authenticate the callers.
 *  @returns the refusal reason, or undefined when the request may proceed. */
function authorize(req, method, enabled) {
    if (!enabled)
        return undefined;
    if (method !== 'GET' && method !== 'POST')
        return undefined;
    const remote = req.socket?.remoteAddress ?? '';
    if (remote.length > 0 && !LOOPBACK_ADDRESS.test(remote)) {
        return 'requests are accepted from this machine only';
    }
    const { origin, host } = req.headers;
    if (typeof origin === 'string' && origin.length > 0 && !originAllowed(origin, host)) {
        return 'cross-origin request refused';
    }
    return undefined;
}
/** Parse the request body. `undefined` means "not a JSON object" — the caller
 *  reports that explicitly instead of silently degrading to `{}` (which used to
 *  surface as a baffling "empty raw" for a malformed body). */
function parseBody(text) {
    try {
        const parsed = JSON.parse(text || '{}');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
/** Thrown when an op edited a scope whose storage key the request never supplied
 *  (no sessionId / no project). Without this the op would answer `ok:true` while
 *  the change silently evaporated — the panel showed the rule, then it was gone. */
class UnstorableScopeError extends Error {
}
/** Coerce a request field into a valid scope (defaulting to `session`). */
function scopeOf(value) {
    return value === 'global' || value === 'project' || value === 'session' ? value : 'session';
}
/** Non-fatal read failures from both stores, for the panel to show. */
function problemsOf(v, templates) {
    return [
        ...(v.problems ?? []),
        ...(templates.problem === undefined ? [] : [templates.problem]),
    ];
}
/** Register the rules panel API on the host web server. */
export function registerRulesApi(ctx, options = {}) {
    if (ctx.webServer === undefined)
        return () => { };
    return ctx.webServer.register({
        kind: 'exact',
        path: '/baize-rules.api',
        handler: async (req, res) => {
            const method = req.method ?? '';
            const url = req.url ?? '';
            const refused = authorize(req, method, options.originCheck === true);
            if (refused !== undefined) {
                sendJson(res, 403, { ok: false, text: refused });
                return;
            }
            const query = new URLSearchParams(url.split('?')[1] ?? '');
            const sessionId = query.get('sessionId') ?? '';
            const project = await resolveProject(ctx, sessionId, query.get('project') ?? '');
            if (method === 'GET') {
                try {
                    const v = await viewFor(ctx, sessionId, project, options);
                    const templates = await readTemplatesWithVersion(ctx);
                    sendJson(res, 200, { ...v, templates: templates.items, problems: problemsOf(v, templates) });
                }
                catch (e) {
                    sendJson(res, 500, { error: String(e) });
                }
                return;
            }
            if (method === 'POST') {
                let raw;
                try {
                    raw = await readBody(req);
                }
                catch (e) {
                    if (e instanceof BodyTooLargeError) {
                        sendJson(res, 413, { ok: false, text: `request body exceeds ${MAX_BODY_BYTES} bytes` });
                        return;
                    }
                    throw e;
                }
                const body = parseBody(raw);
                if (body === undefined) {
                    sendJson(res, 400, { ok: false, text: 'invalid JSON body' });
                    return;
                }
                const pSessionId = String(body.sessionId ?? '');
                const pProject = await resolveProject(ctx, pSessionId, String(body.project ?? ''));
                try {
                    const v = await viewFor(ctx, pSessionId, pProject, options);
                    const templates = await readTemplatesWithVersion(ctx);
                    const out = await applyOp(ctx, String(body.op ?? 'raw'), body, v, templates, options, pSessionId, pProject);
                    sendJson(res, out.ok ? 200 : 400, {
                        ok: out.ok,
                        text: out.text,
                        view: out.view,
                        templates: out.templates,
                        problems: problemsOf(out.view, templates),
                        ...out.extra,
                    });
                }
                catch (e) {
                    // A refused write is a client-side problem (the panel asked to store
                    // rules somewhere that does not exist), not a server fault.
                    if (e instanceof UnstorableScopeError)
                        sendJson(res, 400, { ok: false, text: e.message });
                    // A lost race is retryable, and the client is told exactly that.
                    else if (isStaleWrite(e))
                        sendJson(res, 409, { ok: false, text: STALE_MESSAGE });
                    else
                        sendJson(res, 500, { error: String(e) });
                }
                return;
            }
            sendJson(res, 405, { error: 'method not allowed' });
        },
    });
}
/** Persist whatever an op decided to change.
 *
 *  Refuses — before writing anything — an edit to a scope this request has no
 *  storage key for: `core` builds each scope immutably, so an untouched scope
 *  keeps its identity and a changed reference is exactly "this scope was
 *  edited". Checking first also keeps the write all-or-nothing, and an unchanged
 *  scope is never rewritten (that is what stops empty session files piling up). */
async function persist(ctx, options, sessionId, project, before, nextView, templatesVersion, nextTemplates) {
    if (nextView !== undefined) {
        if (nextView.session !== before.session && sessionId.length === 0) {
            throw new UnstorableScopeError('No session to store session rules in — this panel is not attached to a conversation. Use the global scope instead.');
        }
        if (nextView.project !== before.project && project.length === 0) {
            throw new UnstorableScopeError('No project directory to store project rules in — this panel has no working directory. Use the global scope instead.');
        }
        if (nextView.global !== before.global) {
            await writeGlobal(ctx, options, nextView.global, before.versions?.global);
        }
        if (nextView.session !== before.session) {
            await writeSession(ctx, sessionId, nextView.session, before.versions?.session);
        }
        if (nextView.project !== before.project && project.length > 0) {
            await writeProject(ctx, project, nextView.project ?? [], before.versions?.project);
        }
    }
    if (nextTemplates !== undefined)
        await writeTemplates(ctx, nextTemplates, templatesVersion);
}
/** Dispatch one panel op. Every branch returns the (post-change) view and
 *  template library so the panel can re-render both panes from one response. */
async function applyOp(ctx, op, body, v, templatesRead, options, sessionId, project) {
    const templates = templatesRead.items;
    const fail = (text) => ({ ok: false, text, view: v, templates });
    const scope = scopeOf(body.scope);
    const persistTemplates = (next) => persist(ctx, options, sessionId, project, v, undefined, templatesRead.version, next);
    switch (op) {
        case 'raw': {
            const raw = String(body.raw ?? '');
            if (!raw.trim())
                return fail('empty raw');
            const out = runCommand({ raw, view: v, defaultScope: scope, templates });
            await persist(ctx, options, sessionId, project, v, out.nextView, templatesRead.version, out.nextTemplates);
            return {
                ok: out.ok,
                text: out.text,
                view: out.nextView ?? v,
                templates: out.nextTemplates ?? templates,
            };
        }
        case 'rule.add': {
            // Structured add: the panel sends the scope and the text it collected, so a
            // rule body can never be re-parsed as a command line (and can never lose a
            // trailing word to a scope keyword).
            const text = String(body.text ?? '').trim();
            if (text.length === 0)
                return fail('text required');
            const out = runCommand({
                raw: 'add ' + text,
                view: v,
                defaultScope: scope,
                templates,
            });
            await persist(ctx, options, sessionId, project, v, out.nextView, templatesRead.version, undefined);
            return { ok: out.ok, text: out.text, view: out.nextView ?? v, templates };
        }
        case 'rule.setTags': {
            const id = String(body.ruleId ?? '');
            if (!id)
                return fail('ruleId required');
            const rule = findRule(v, scope, id);
            if (rule === undefined)
                return fail(`Rule ${id} not found in ${scope}.`);
            const tags = normalizeTags(body.tags);
            const nextView = mutate(v, scope, id, r => ({ ...r, tags, updatedAt: Date.now() }));
            await persist(ctx, options, sessionId, project, v, nextView, templatesRead.version, undefined);
            return { ok: true, text: `Rule ${id} tags: ${tags.join(', ') || '(none)'}.`, view: nextView, templates };
        }
        case 'rule.update': {
            const id = String(body.ruleId ?? '');
            if (!id)
                return fail('ruleId required');
            const rule = findRule(v, scope, id);
            if (rule === undefined)
                return fail(`Rule ${id} not found in ${scope}.`);
            const text = String(body.text ?? '').trim();
            const tags = body.tags === undefined ? rule.tags : normalizeTags(body.tags);
            const nextView = mutate(v, scope, id, r => ({
                ...r,
                text: text.length > 0 ? text : r.text,
                tags: tags ?? [],
                updatedAt: Date.now(),
            }));
            await persist(ctx, options, sessionId, project, v, nextView, templatesRead.version, undefined);
            return { ok: true, text: `Updated rule ${id}.`, view: nextView, templates };
        }
        case 'rule.setEnabled': {
            const id = String(body.ruleId ?? '');
            if (!id)
                return fail('ruleId required');
            const rule = findRule(v, scope, id);
            if (rule === undefined)
                return fail(`Rule ${id} not found in ${scope}.`);
            const enabled = body.enabled !== false;
            const nextView = mutate(v, scope, id, r => ({ ...r, enabled, updatedAt: Date.now() }));
            await persist(ctx, options, sessionId, project, v, nextView, templatesRead.version, undefined);
            return {
                ok: true,
                text: `${enabled ? 'Enabled' : 'Disabled'} rule ${id}.`,
                view: nextView,
                templates,
                extra: { enabled },
            };
        }
        case 'rule.saveAsTemplate': {
            const id = String(body.ruleId ?? '');
            if (!id)
                return fail('ruleId required');
            const rule = findRule(v, scope, id);
            if (rule === undefined)
                return fail(`Rule ${id} not found in ${scope}.`);
            const out = saveRuleAsTemplate(templates, rule, normalizeTags(body.tags));
            if (!out.ok)
                return fail(out.text);
            if (out.changed)
                await persistTemplates(out.templates);
            return { ok: true, text: out.text, view: v, templates: out.templates };
        }
        case 'rule.addFromTemplates': {
            const refs = Array.isArray(body.templateIds) ? body.templateIds.map(String) : [];
            if (refs.length === 0)
                return fail('templateIds required');
            const out = applyTemplates(v, scope, templates, refs);
            if (!out.ok)
                return fail(out.text);
            await persist(ctx, options, sessionId, project, v, out.view, templatesRead.version, out.templates);
            return {
                ok: true,
                text: out.text,
                view: out.view,
                templates: out.templates,
                extra: { selected: out.selected, added: out.added, skipped: out.skipped },
            };
        }
        case 'template.create': {
            const out = createTemplate(templates, String(body.text ?? ''), normalizeTags(body.tags));
            if (!out.ok)
                return fail(out.text);
            // A no-op re-add is a success that changes nothing — don't rewrite the file.
            if (out.changed)
                await persistTemplates(out.templates);
            return { ok: true, text: out.text, view: v, templates: out.templates };
        }
        case 'template.update': {
            const id = String(body.id ?? '');
            if (!id)
                return fail('id required');
            // An absent `tags` keeps the current ones; an explicit array (even empty)
            // replaces them, so the panel can clear tags.
            const nextTags = body.tags === undefined
                ? undefined
                : normalizeTags(body.tags);
            const out = updateTemplate(templates, id, String(body.text ?? ''), nextTags);
            if (!out.ok)
                return fail(out.text);
            if (out.changed)
                await persistTemplates(out.templates);
            return { ok: true, text: out.text, view: v, templates: out.templates };
        }
        case 'template.delete': {
            const id = String(body.id ?? '');
            if (!id)
                return fail('id required');
            const out = deleteTemplate(templates, id);
            if (!out.ok)
                return fail(out.text);
            if (out.changed)
                await persistTemplates(out.templates);
            return { ok: true, text: out.text, view: v, templates: out.templates };
        }
        case 'template.export': {
            return {
                ok: true,
                text: `Exported ${templates.length} template(s).`,
                view: v,
                templates,
                extra: { content: exportTemplates(templates), count: templates.length },
            };
        }
        case 'template.import': {
            const payload = typeof body.payload === 'string' ? body.payload : '';
            if (payload.length === 0)
                return fail('payload required');
            const mode = body.mode === 'replace' ? 'replace' : 'merge';
            const dryRun = body.dryRun !== false;
            const out = importTemplates(payload, templates, mode, dryRun);
            if (!out.ok)
                return fail(out.text);
            await persistTemplates(out.templates);
            return {
                ok: true,
                text: out.text,
                view: v,
                templates: out.templates ?? templates,
                extra: { dryRun },
            };
        }
        default:
            return fail(`unknown op: ${op}`);
    }
}
/** Resolve the project key (cwd) from an explicit `project`, else the session's header cwd. */
async function resolveProject(ctx, sessionId, project) {
    if (project)
        return project;
    if (!sessionId)
        return '';
    try {
        const sess = ctx.sessions?.get?.(sessionId);
        return (sess && sess.header?.cwd) || '';
    }
    catch {
        return '';
    }
}
/** Load global + session + project rules for one panel request. */
async function viewFor(ctx, sessionId, project, options) {
    // `Agent.id` is the session identity (see dsh-agent runtime-types), so the
    // store can resolve the session file from an id-only stand-in.
    return view(ctx, { id: sessionId }, options, project);
}
