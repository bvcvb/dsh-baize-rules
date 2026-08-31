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
import { runCommand } from "./core.js";
import { view, writeGlobal, writeSession, writeProject, readProject } from "./store.js";
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
function parseBody(text) {
    try {
        return JSON.parse(text || '{}');
    }
    catch {
        return {};
    }
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
                    sendJson(res, 200, await viewFor(ctx, sessionId, project, options));
                }
                catch (e) {
                    sendJson(res, 500, { error: String(e) });
                }
                return;
            }
            if (method === 'POST') {
                const body = parseBody(await readBody(req));
                const pSessionId = String(body.sessionId ?? '');
                const pProject = await resolveProject(ctx, pSessionId, String(body.project ?? ''));
                const raw = String(body.raw ?? '');
                const defaultScope = (body.scope ?? 'session');
                if (!raw.trim()) {
                    sendJson(res, 400, { error: 'empty raw' });
                    return;
                }
                try {
                    const v = await viewFor(ctx, pSessionId, pProject, options);
                    const out = runCommand({ raw, view: v, defaultScope });
                    if (out.nextView !== undefined) {
                        await writeGlobal(ctx, options, out.nextView.global);
                        if (pSessionId)
                            await writeSession(ctx, pSessionId, out.nextView.session);
                        if (pProject)
                            await writeProject(ctx, pProject, out.nextView.project ?? []);
                    }
                    sendJson(res, out.ok ? 200 : 400, { ok: out.ok, text: out.text, view: out.nextView ?? v });
                }
                catch (e) {
                    sendJson(res, 500, { error: String(e) });
                }
                return;
            }
            sendJson(res, 405, { error: 'method not allowed' });
        },
    });
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
