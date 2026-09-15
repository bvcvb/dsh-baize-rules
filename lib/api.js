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
import { normalizeTags } from "./rules.js";
import { applyTemplates, createTemplate, deleteTemplate, exportTemplates, findRule, importTemplates, mutate, runCommand, saveRuleAsTemplate, updateTemplate, } from "./core.js";
import { readProject, readTemplates, view, writeGlobal, writeProject, writeSession, writeTemplates, } from "./store.js";
function sendJson(res, status, payload) {
    const r = res;
    r.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    r.end(JSON.stringify(payload));
}
function readBody(req) {
    return new Promise((resolve) => {
        const r = req;
        let body = '';
        r.on('data', (chunk) => { body += chunk; });
        r.on('end', () => resolve(body));
        r.on('error', () => resolve(''));
    });
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
            const query = new URLSearchParams(url.split('?')[1] ?? '');
            const sessionId = query.get('sessionId') ?? '';
            const project = await resolveProject(ctx, sessionId, query.get('project') ?? '');
            if (method === 'GET') {
                try {
                    const v = await viewFor(ctx, sessionId, project, options);
                    sendJson(res, 200, { ...v, templates: await readTemplates(ctx) });
                }
                catch (e) {
                    sendJson(res, 500, { error: String(e) });
                }
                return;
            }
            if (method === 'POST') {
                const body = parseBody(await readBody(req));
                if (body === undefined) {
                    sendJson(res, 400, { ok: false, text: 'invalid JSON body' });
                    return;
                }
                const pSessionId = String(body.sessionId ?? '');
                const pProject = await resolveProject(ctx, pSessionId, String(body.project ?? ''));
                try {
                    const v = await viewFor(ctx, pSessionId, pProject, options);
                    const templates = await readTemplates(ctx);
                    const out = await applyOp(ctx, String(body.op ?? 'raw'), body, v, templates, options, pSessionId, pProject);
                    sendJson(res, out.ok ? 200 : 400, {
                        ok: out.ok,
                        text: out.text,
                        view: out.view,
                        templates: out.templates,
                        ...out.extra,
                    });
                }
                catch (e) {
                    // A refused write is a client-side problem (the panel asked to store
                    // rules somewhere that does not exist), not a server fault.
                    if (e instanceof UnstorableScopeError)
                        sendJson(res, 400, { ok: false, text: e.message });
                    else
                        sendJson(res, 500, { error: String(e) });
                }
                return;
            }
            sendJson(res, 405, { error: 'method not allowed' });
        },
    });
}
/** Persist whatever an op decided to change (both stores are whole-file writes).
 *
 *  Refuses — before writing anything — an edit to a scope this request has no
 *  storage key for: `core` builds each scope immutably, so an untouched scope
 *  keeps its identity and a changed reference is exactly "this scope was
 *  edited". Checking first also keeps the write all-or-nothing. */
async function persist(ctx, options, sessionId, project, before, nextView, nextTemplates) {
    if (nextView !== undefined) {
        if (nextView.session !== before.session && sessionId.length === 0) {
            throw new UnstorableScopeError('No session to store session rules in — this panel is not attached to a conversation. Use the global scope instead.');
        }
        if (nextView.project !== before.project && project.length === 0) {
            throw new UnstorableScopeError('No project directory to store project rules in — this panel has no working directory. Use the global scope instead.');
        }
        await writeGlobal(ctx, options, nextView.global);
        if (sessionId)
            await writeSession(ctx, sessionId, nextView.session);
        if (project)
            await writeProject(ctx, project, nextView.project ?? []);
    }
    if (nextTemplates !== undefined)
        await writeTemplates(ctx, nextTemplates);
}
/** Dispatch one panel op. Every branch returns the (post-change) view and
 *  template library so the panel can re-render both panes from one response. */
async function applyOp(ctx, op, body, v, templates, options, sessionId, project) {
    const fail = (text) => ({ ok: false, text, view: v, templates });
    const scope = scopeOf(body.scope);
    switch (op) {
        case 'raw': {
            const raw = String(body.raw ?? '');
            if (!raw.trim())
                return fail('empty raw');
            const out = runCommand({ raw, view: v, defaultScope: scope, templates });
            await persist(ctx, options, sessionId, project, v, out.nextView, out.nextTemplates);
            return {
                ok: out.ok,
                text: out.text,
                view: out.nextView ?? v,
                templates: out.nextTemplates ?? templates,
            };
        }
        case 'rule.setTags': {
            const id = String(body.ruleId ?? '');
            if (!id)
                return fail('ruleId required');
            if (findRule(v, scope, id) === undefined)
                return fail(`Rule ${id} not found in ${scope}.`);
            const tags = normalizeTags(body.tags);
            const nextView = mutate(v, scope, id, r => ({ ...r, tags, updatedAt: Date.now() }));
            await persist(ctx, options, sessionId, project, v, nextView, undefined);
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
            await persist(ctx, options, sessionId, project, v, nextView, undefined);
            return { ok: true, text: `Updated rule ${id}.`, view: nextView, templates };
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
                await persist(ctx, options, sessionId, project, v, undefined, out.templates);
            return { ok: true, text: out.text, view: v, templates: out.templates };
        }
        case 'rule.addFromTemplates': {
            const refs = Array.isArray(body.templateIds) ? body.templateIds.map(String) : [];
            if (refs.length === 0)
                return fail('templateIds required');
            const out = applyTemplates(v, scope, templates, refs);
            if (!out.ok)
                return fail(out.text);
            await persist(ctx, options, sessionId, project, v, out.view, out.templates);
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
                await persist(ctx, options, sessionId, project, v, undefined, out.templates);
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
                await persist(ctx, options, sessionId, project, v, undefined, out.templates);
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
                await persist(ctx, options, sessionId, project, v, undefined, out.templates);
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
            await persist(ctx, options, sessionId, project, v, undefined, out.templates);
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
/** Load global (disk) + session (per-session file) + project (per-cwd file) rules. */
async function viewFor(ctx, sessionId, project, options) {
    const v = await view(ctx, { id: sessionId }, options);
    const proj = project ? await readProject(ctx, project) : [];
    return { ...v, project: proj };
}
