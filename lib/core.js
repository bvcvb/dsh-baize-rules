/**
 * Dependency-free rules-command core: parsing, scope resolution, CRUD
 * application over a {@link RuleView}, the template library operations, and the
 * template import/export transforms. No dsh runtime needed, so it is testable in
 * the Loop 0 harness (`pnpm test`). The dsh-facing adapters (`command.ts`,
 * `api.ts`) feed in the live `view` + `templates` and persist the returned
 * `nextView` / `nextTemplates`; all file IO stays in those adapters.
 *
 * @module dsh-baize-rules/core
 */
import { normalizeTags, tagKey } from "./rules.js";
export const RULE_SCOPES = ['global', 'session', 'project'];
const SCOPE_SET = new Set(RULE_SCOPES);
/** Verbs where a trailing scope token is a *target* to modify, not an argument.
 *  Deliberately excludes `tag`/`untag`/`save`: their trailing tokens are free
 *  tag text, and a tag literally named `project` must not be swallowed as a
 *  scope (use the leading form instead: `/baize-rules global tag <id> 前端`). */
const SCOPE_MODIFIER_VERBS = new Set(['add', 'remove', 'enable', 'disable', 'from']);
/** Verbs whose trailing `#tag` tokens are metadata rather than argument text.
 *  `add` is excluded on purpose: a rule body may legitimately end in `#123`, and
 *  silently eating it would corrupt the rule. */
const TAG_AWARE_VERBS = new Set(['tag', 'untag', 'save', 'tmpl', 'from']);
const USAGE = 'Usage: /baize-rules [list|add <text>|remove <id>|edit <id> <text>|enable|disable <id>'
    + '|tag|untag <id> <tag…>|save <id> [#tag…]|from <id|#tag> [scope]'
    + '|tmpl list|add|edit|rm|export|import|scope <global|session|project>|clear <scope>|export]';
/** Parse a `/rules` line into a verb + args, isolating an explicit scope keyword.
 *  Scope is accepted as a **leading** token (`/rules global add …`) or a
 *  **trailing** token (`/rules add … global`, only the LAST arg qualifies),
 *  so a rule whose text merely contains "global" is never misread as a scope.
 *  For tag-aware verbs the trailing `#tag` run is split off into `tags`. */
export function parseCommand(raw) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0)
        return { verb: undefined, args: [], tags: [] };
    let verb;
    let scope;
    let rest;
    if (SCOPE_SET.has(tokens[0])) {
        scope = tokens[0];
        verb = tokens[1];
        rest = tokens.slice(2);
    }
    else {
        verb = tokens[0];
        rest = tokens.slice(1);
        // Strip a trailing scope only for verbs that take a *target* scope modifier,
        // never for `scope`/`clear` where the scope is the argument itself.
        if (verb !== undefined && SCOPE_MODIFIER_VERBS.has(verb) && rest.length > 0
            && SCOPE_SET.has(rest[rest.length - 1])) {
            scope = rest[rest.length - 1];
            rest = rest.slice(0, -1);
        }
    }
    // A trailing run of `#tag` tokens is tag metadata, not rule text. Only the
    // trailing run is taken, so a `#123` in the middle of a body stays untouched.
    let tags = [];
    if (verb !== undefined && TAG_AWARE_VERBS.has(verb)) {
        let cut = rest.length;
        while (cut > 0 && rest[cut - 1].startsWith('#') && rest[cut - 1].length > 1)
            cut -= 1;
        tags = normalizeTags(rest.slice(cut));
        rest = rest.slice(0, cut);
    }
    return scope === undefined
        ? { verb, args: rest.filter(Boolean), tags }
        : { verb, args: rest.filter(Boolean), scope, tags };
}
/** Explicit scope wins, else the caller's default. */
export function resolveScope(scope, fallback) {
    return scope ?? fallback;
}
/** Mint a fully-specified rule (dependency-free; uses global `crypto.randomUUID`). */
export function newRule(text, now = Date.now(), tags = []) {
    return {
        id: crypto.randomUUID(),
        text,
        tags: normalizeTags(tags),
        enabled: true,
        createdAt: now,
        updatedAt: now,
    };
}
/** Mint a fully-specified template. */
export function newTemplate(text, tags = [], now = Date.now()) {
    return {
        id: crypto.randomUUID(),
        text,
        tags: normalizeTags(tags),
        createdAt: now,
        updatedAt: now,
        uses: 0,
    };
}
/** Return a new view with one rule appended to a scope. */
function listOf(view, scope) {
    return scope === 'global' ? view.global : scope === 'project' ? (view.project ?? []) : view.session;
}
function withList(view, scope, list) {
    if (scope === 'global')
        return { ...view, global: [...list] };
    if (scope === 'project')
        return { ...view, project: [...list] };
    return { ...view, session: [...list] };
}
export function addRule(view, scope, rule) {
    return withList(view, scope, [...listOf(view, scope), rule]);
}
/** Return a new view with a rule removed from one scope. */
export function removeRule(view, scope, id) {
    return withList(view, scope, listOf(view, scope).filter(rule => rule.id !== id));
}
/** Mutate a copy of a scope's rules for the given id; returns whether found. */
export function mutate(view, scope, id, fn) {
    return withList(view, scope, listOf(view, scope).map(rule => rule.id === id ? fn(rule) : rule));
}
/** Look one rule up by its exact id inside a scope. */
export function findRule(view, scope, id) {
    return listOf(view, scope).find(rule => rule.id === id);
}
/** Resolve a rule reference inside one scope: the exact id, else a **unique** id
 *  prefix (the 8-char form `list` prints). An ambiguous prefix is an error rather
 *  than a silent first match, so `list` → `remove` never hits the wrong rule. */
export function resolveRuleRef(view, scope, ref) {
    const list = listOf(view, scope);
    if (list.some(rule => rule.id === ref))
        return { ok: true, id: ref };
    const hits = list.filter(rule => rule.id.startsWith(ref));
    if (hits.length === 1)
        return { ok: true, id: hits[0].id };
    if (hits.length === 0)
        return { ok: false, error: `Rule ${ref} not found in ${scope}.` };
    return {
        ok: false,
        error: `Rule ${ref} is ambiguous: ${hits.map(rule => rule.id.slice(0, 8)).join(', ')}.`,
    };
}
/** Every tag used in a scope, most-used first — the panel's filter chip row. */
export function tagsOf(rules) {
    const counts = new Map();
    for (const rule of rules) {
        for (const tag of rule.tags ?? []) {
            const key = tagKey(tag);
            const hit = counts.get(key);
            if (hit === undefined)
                counts.set(key, { tag, n: 1 });
            else
                hit.n += 1;
        }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).map(entry => entry.tag);
}
/** Render a compact human-readable list of the rules in one view. */
export function formatList(view) {
    const line = (rule) => {
        const tags = rule.tags ?? [];
        const badge = tags.length > 0 ? `{${tags.join(',')}} ` : '';
        return `[${rule.id.slice(0, 8)}] ${badge}${rule.enabled ? '' : '(disabled) '}${rule.text}`;
    };
    const parts = [];
    if (view.project && view.project.length > 0) {
        parts.push('Project:');
        parts.push(...view.project.map(line));
    }
    if (view.global.length > 0) {
        parts.push('Global:');
        parts.push(...view.global.map(line));
    }
    if (view.session.length > 0) {
        parts.push('Session:');
        parts.push(...view.session.map(line));
    }
    return parts.length === 0 ? 'No active rules.' : parts.join('\n');
}
/** Render the template library, optionally filtered to one tag. */
export function formatTemplates(templates, filter) {
    const wanted = filter === undefined ? undefined : tagKey(filter.replace(/^#+/, '').trim());
    const kept = wanted === undefined
        ? templates
        : templates.filter(t => t.tags.some(tag => tagKey(tag) === wanted));
    if (kept.length === 0) {
        return filter === undefined ? 'No templates.' : `No templates tagged ${filter}.`;
    }
    return kept.map((t) => {
        const badge = t.tags.length > 0 ? `{${t.tags.join(',')}} ` : '';
        const uses = t.uses !== undefined && t.uses > 0 ? ` · used ${t.uses}×` : '';
        return `[${t.id.slice(0, 8)}] ${badge}${t.text}${uses}`;
    }).join('\n');
}
/** Same text, ignoring surrounding whitespace — the identity used to dedupe a
 *  rule against a template and a template against an imported one. */
function sameText(a, b) {
    return a.trim() === b.trim();
}
/** Create a template, or merge tags into the existing same-text one. */
export function createTemplate(templates, text, tags = [], now = Date.now()) {
    const body = text.trim();
    if (body.length === 0) {
        return { templates, text: 'Template text is empty.', ok: false, created: false, changed: false };
    }
    const wanted = normalizeTags(tags);
    const existing = templates.find(t => sameText(t.text, body));
    if (existing !== undefined) {
        const merged = normalizeTags([...existing.tags, ...wanted]);
        // Re-adding the very same thing is a SUCCESS (the template is there) but not
        // a change: it must not bump updatedAt or rewrite the file.
        if (merged.length === existing.tags.length) {
            return {
                templates,
                text: 'Template already existed with the same tags.',
                ok: true,
                created: false,
                changed: false,
            };
        }
        return {
            templates: templates.map(t => t.id === existing.id ? { ...t, tags: merged, updatedAt: now } : t),
            text: `Template already existed; merged tag(s) ${merged.join(', ')}.`,
            ok: true,
            created: false,
            changed: true,
        };
    }
    return {
        templates: [...templates, newTemplate(body, wanted, now)],
        text: `Added template: ${body}`,
        ok: true,
        created: true,
        changed: true,
    };
}
/** Update one template's text and/or tags. An empty `text` keeps the old body;
 *  `tags === undefined` keeps the old tags while an explicit array — including
 *  `[]` — replaces them (the panel needs a way to clear tags). */
export function updateTemplate(templates, ref, text, tags, now = Date.now()) {
    const hit = selectTemplates(templates, [ref]);
    if (hit.picked.length !== 1) {
        return {
            templates,
            text: hit.errors.join(' ') || `Template ${ref} not found.`,
            ok: false, created: false, changed: false,
        };
    }
    const target = hit.picked[0];
    const body = text.trim().length > 0 ? text.trim() : target.text;
    const nextTags = tags === undefined ? target.tags : normalizeTags(tags);
    const sameBody = body === target.text;
    const sameTags = nextTags.length === target.tags.length
        && nextTags.every((tag, index) => tag === target.tags[index]);
    if (sameBody && sameTags) {
        return {
            templates,
            text: `Template ${target.id.slice(0, 8)} already up to date.`,
            ok: true, created: false, changed: false,
        };
    }
    return {
        templates: templates.map(t => t.id === target.id ? { ...t, text: body, tags: nextTags, updatedAt: now } : t),
        text: `Updated template ${target.id.slice(0, 8)}.`,
        ok: true, created: false, changed: true,
    };
}
/** Delete one template by exact id or unique id prefix. */
export function deleteTemplate(templates, ref) {
    const hit = selectTemplates(templates, [ref]);
    if (hit.picked.length !== 1) {
        return {
            templates,
            text: hit.errors.join(' ') || `Template ${ref} not found.`,
            ok: false, created: false, changed: false,
        };
    }
    const target = hit.picked[0];
    return {
        templates: templates.filter(t => t.id !== target.id),
        text: `Removed template ${target.id.slice(0, 8)}.`,
        ok: true, created: false, changed: true,
    };
}
/** Store a rule (its text plus its own tags and any extra tags) as a template. */
export function saveRuleAsTemplate(templates, rule, extraTags = [], now = Date.now()) {
    return createTemplate(templates, rule.text, [...(rule.tags ?? []), ...extraTags], now);
}
/** Resolve template references. A `#tag` ref selects every template carrying that
 *  tag; anything else is an id or a unique id prefix (matching what `tmpl list`
 *  prints). An ambiguous prefix is an error, never a silent first match. */
export function selectTemplates(templates, refs) {
    const picked = new Map();
    const errors = [];
    for (const ref of refs) {
        const raw = ref.trim();
        if (raw.length === 0)
            continue;
        if (raw.startsWith('#')) {
            const key = tagKey(raw.replace(/^#+/, '').trim());
            const matches = templates.filter(t => t.tags.some(tag => tagKey(tag) === key));
            if (matches.length === 0) {
                errors.push(`No template tagged ${raw}.`);
                continue;
            }
            for (const t of matches)
                picked.set(t.id, t);
            continue;
        }
        const exact = templates.find(t => t.id === raw);
        if (exact !== undefined) {
            picked.set(exact.id, exact);
            continue;
        }
        const prefixed = templates.filter(t => t.id.startsWith(raw));
        if (prefixed.length === 1) {
            picked.set(prefixed[0].id, prefixed[0]);
            continue;
        }
        if (prefixed.length === 0) {
            errors.push(`Template ${raw} not found.`);
            continue;
        }
        errors.push(`Template ${raw} is ambiguous: ${prefixed.map(t => t.id.slice(0, 8)).join(', ')}.`);
    }
    return { picked: [...picked.values()], errors };
}
/** Add the referenced templates as rules in one scope. A rule whose text already
 *  exists in that scope is skipped, so adding from a template twice never piles
 *  up duplicates. Every template actually applied bumps its `uses`. */
export function applyTemplates(view, scope, templates, refs, now = Date.now()) {
    const { picked, errors } = selectTemplates(templates, refs);
    if (picked.length === 0) {
        return {
            ok: false,
            text: errors.length > 0 ? errors.join(' ') : 'No template selected.',
            view, templates, selected: 0, added: 0, skipped: 0,
        };
    }
    let next = view;
    let added = 0;
    let skipped = 0;
    const used = new Set();
    for (const template of picked) {
        const current = listOf(next, scope);
        if (current.some(rule => sameText(rule.text, template.text))) {
            skipped += 1;
            continue;
        }
        next = addRule(next, scope, newRule(template.text, now, template.tags));
        used.add(template.id);
        added += 1;
    }
    const nextTemplates = used.size === 0
        ? templates
        : templates.map(t => used.has(t.id) ? { ...t, uses: (t.uses ?? 0) + 1 } : t);
    const notes = [
        `Added ${added} rule(s) to ${scope}.`,
        skipped > 0 ? `Skipped ${skipped} duplicate(s).` : '',
        ...errors,
    ].filter(Boolean);
    return { ok: true, text: notes.join(' '), view: next, templates: nextTemplates, selected: picked.length, added, skipped };
}
// --- Template import / export ---
/** Discriminator written into every exported template file. */
export const TEMPLATE_EXPORT_KIND = 'dsh-baize-rules-templates';
/** Envelope version of the template exchange format. */
export const TEMPLATE_EXPORT_VERSION = 1;
/** Serialize the library for exchange. Ids are deliberately dropped: on import
 *  every template is minted a fresh id, which is what makes an exported file
 *  safe to move between machines and sessions. */
export function exportTemplates(templates, now = new Date()) {
    const envelope = {
        kind: TEMPLATE_EXPORT_KIND,
        schemaVersion: TEMPLATE_EXPORT_VERSION,
        exportedAt: now.toISOString(),
        templates: templates.map(t => ({
            text: t.text,
            tags: [...t.tags],
            uses: t.uses ?? 0,
        })),
    };
    return `${JSON.stringify(envelope, null, 2)}\n`;
}
/** Parse an exchange file. Accepts the envelope or a bare template array (a
 *  hand-written or pre-envelope file). Collects EVERY problem — an import must
 *  never end up applying half a file. */
export function parseTemplateImport(payload) {
    let parsed;
    try {
        parsed = JSON.parse(payload);
    }
    catch (e) {
        return { errors: [`not valid JSON (${String(e)})`] };
    }
    let list;
    if (Array.isArray(parsed)) {
        list = parsed;
    }
    else if (typeof parsed === 'object' && parsed !== null) {
        const envelope = parsed;
        if (envelope.kind !== undefined && envelope.kind !== TEMPLATE_EXPORT_KIND) {
            return { errors: [`unexpected kind: ${String(envelope.kind)}`] };
        }
        list = envelope.templates;
    }
    else {
        return { errors: ['expected a template array or an export envelope'] };
    }
    if (!Array.isArray(list))
        return { errors: ['envelope carries no templates array'] };
    const entries = [];
    const errors = [];
    list.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) {
            errors.push(`#${index}: entry is not an object`);
            return;
        }
        const entry = item;
        if (typeof entry.text !== 'string' || entry.text.trim().length === 0) {
            errors.push(`#${index}: missing string text`);
            return;
        }
        entries.push({
            text: entry.text.trim(),
            tags: normalizeTags(entry.tags),
            uses: typeof entry.uses === 'number' && entry.uses > 0 ? Math.floor(entry.uses) : 0,
        });
    });
    if (errors.length > 0)
        return { errors };
    return { entries, errors: [] };
}
/** Apply a parsed import to the library. `merge` dedupes by text and unions tags
 *  (`uses` takes the max); `replace` swaps the whole library. With `dryRun` the
 *  caller learns what would happen and nothing is persisted. */
export function importTemplates(payload, current, mode = 'merge', dryRun = true, now = Date.now()) {
    const { entries, errors } = parseTemplateImport(payload);
    if (entries === undefined) {
        return { ok: false, text: `Import failed: ${errors.join('; ')}` };
    }
    if (mode === 'replace') {
        const next = entries.map(entry => ({
            ...newTemplate(entry.text, entry.tags, now),
            uses: entry.uses,
        }));
        const report = `Import (replace): ${next.length} template(s) replace ${current.length}.`;
        if (dryRun)
            return { ok: true, text: `${report} Dry run — nothing written.` };
        return { ok: true, text: report, templates: next };
    }
    let added = 0;
    let merged = 0;
    let unchanged = 0;
    let next = [...current];
    for (const entry of entries) {
        const existing = next.find(t => sameText(t.text, entry.text));
        if (existing === undefined) {
            next = [...next, { ...newTemplate(entry.text, entry.tags, now), uses: entry.uses }];
            added += 1;
            continue;
        }
        const union = normalizeTags([...existing.tags, ...entry.tags]);
        const uses = Math.max(existing.uses ?? 0, entry.uses);
        if (union.length === existing.tags.length && uses === (existing.uses ?? 0)) {
            unchanged += 1;
            continue;
        }
        next = next.map(t => t.id === existing.id ? { ...t, tags: union, uses, updatedAt: now } : t);
        merged += 1;
    }
    const report = `Import (merge): +${added} new, ~${merged} merged, =${unchanged} unchanged (of ${entries.length}).`;
    if (dryRun)
        return { ok: true, text: `${report} Dry run — nothing written.` };
    return { ok: true, text: report, templates: next };
}
// --- The command dispatcher ---
/** Apply one parsed `/rules` command to the given view + template library. */
export function runCommand(input) {
    const { verb, args, tags, scope } = parseCommand(input.raw);
    if (verb === undefined || verb === 'list') {
        return { ok: true, text: formatList(input.view) };
    }
    const chosen = resolveScope(scope, input.defaultScope);
    const templates = input.templates ?? [];
    switch (verb) {
        case 'add': {
            const text = args.join(' ');
            if (text.length === 0) {
                return { ok: false, text: USAGE };
            }
            return {
                ok: true,
                text: `Added rule to ${chosen}: ${text}`,
                nextView: addRule(input.view, chosen, newRule(text)),
            };
        }
        case 'remove': {
            const ref = args[0] ?? '';
            if (ref.length === 0)
                return { ok: false, text: USAGE };
            const hit = resolveRuleRef(input.view, chosen, ref);
            if (!hit.ok)
                return { ok: false, text: hit.error };
            return {
                ok: true,
                text: `Removed rule ${hit.id} from ${chosen}.`,
                nextView: removeRule(input.view, chosen, hit.id),
            };
        }
        case 'enable':
        case 'disable': {
            const ref = args[0] ?? '';
            if (ref.length === 0)
                return { ok: false, text: USAGE };
            const hit = resolveRuleRef(input.view, chosen, ref);
            if (!hit.ok)
                return { ok: false, text: hit.error };
            const enable = verb === 'enable';
            const next = mutate(input.view, chosen, hit.id, rule => ({ ...rule, enabled: enable, updatedAt: Date.now() }));
            return { ok: true, text: `${enable ? 'Enabled' : 'Disabled'} rule ${hit.id}.`, nextView: next };
        }
        case 'edit': {
            const ref = args[0] ?? '';
            const text = args.slice(1).join(' ');
            if (ref.length === 0 || text.length === 0)
                return { ok: false, text: USAGE };
            const hit = resolveRuleRef(input.view, chosen, ref);
            if (!hit.ok)
                return { ok: false, text: hit.error };
            const next = mutate(input.view, chosen, hit.id, rule => ({ ...rule, text, updatedAt: Date.now() }));
            return { ok: true, text: `Updated rule ${hit.id}.`, nextView: next };
        }
        case 'tag':
        case 'untag': {
            const ref = args[0] ?? '';
            const wanted = normalizeTags([...args.slice(1), ...tags]);
            if (ref.length === 0 || wanted.length === 0)
                return { ok: false, text: USAGE };
            const hit = resolveRuleRef(input.view, chosen, ref);
            if (!hit.ok)
                return { ok: false, text: hit.error };
            const rule = findRule(input.view, chosen, hit.id);
            const next = verb === 'tag'
                ? normalizeTags([...(rule.tags ?? []), ...wanted])
                : (rule.tags ?? []).filter(tag => !new Set(wanted.map(tagKey)).has(tagKey(tag)));
            return {
                ok: true,
                text: `Rule ${hit.id} tags: ${next.join(', ') || '(none)'}.`,
                nextView: mutate(input.view, chosen, hit.id, r => ({ ...r, tags: next, updatedAt: Date.now() })),
            };
        }
        case 'save': {
            const ref = args[0] ?? '';
            const extra = normalizeTags([...args.slice(1), ...tags]);
            if (ref.length === 0)
                return { ok: false, text: USAGE };
            const hit = resolveRuleRef(input.view, chosen, ref);
            if (!hit.ok)
                return { ok: false, text: hit.error };
            const rule = findRule(input.view, chosen, hit.id);
            const out = saveRuleAsTemplate(templates, rule, extra);
            return { ok: true, text: out.text, nextTemplates: out.templates };
        }
        case 'from': {
            const refs = [...args, ...tags.map(tag => `#${tag}`)];
            if (refs.length === 0)
                return { ok: false, text: USAGE };
            const out = applyTemplates(input.view, chosen, templates, refs);
            if (!out.ok)
                return { ok: false, text: out.text };
            return { ok: true, text: out.text, nextView: out.view, nextTemplates: out.templates };
        }
        case 'tmpl':
            return runTemplateCommand(args, tags, templates, input);
        case 'scope': {
            const nextScope = args[0];
            if (nextScope === undefined || !SCOPE_SET.has(nextScope))
                return { ok: false, text: USAGE };
            return { ok: true, text: `Default scope is now ${nextScope}.`, defaultScope: nextScope };
        }
        case 'clear': {
            const clearScope = args[0];
            if (clearScope === undefined || !SCOPE_SET.has(clearScope))
                return { ok: false, text: USAGE };
            return {
                ok: true,
                text: `Cleared ${clearScope} rules.`,
                nextView: withList(input.view, clearScope, []),
            };
        }
        case 'export': {
            const snapshot = { global: input.view.global, session: input.view.session };
            if (input.view.project !== undefined)
                snapshot.project = input.view.project;
            return { ok: true, text: JSON.stringify(snapshot, null, 2) };
        }
        default:
            return { ok: false, text: USAGE };
    }
}
/** The `tmpl` sub-command family: list / add / edit / rm / export / import. */
function runTemplateCommand(args, tags, templates, input) {
    const sub = args[0] ?? 'list';
    switch (sub) {
        case 'list': {
            return { ok: true, text: formatTemplates(templates, args[1] ?? tags[0]) };
        }
        case 'add': {
            const text = args.slice(1).join(' ');
            if (text.trim().length === 0)
                return { ok: false, text: USAGE };
            const out = createTemplate(templates, text, tags);
            // `ok` — not `created`: re-adding an existing template SUCCEEDS (with the
            // tags merged), so it must not surface as a command error.
            return {
                ok: out.ok,
                text: out.text,
                ...(out.changed ? { nextTemplates: out.templates } : {}),
            };
        }
        case 'edit': {
            const ref = args[1] ?? '';
            if (ref.length === 0)
                return { ok: false, text: USAGE };
            // No `#tag` on the line means "keep the current tags"; an explicit list
            // (which may be empty for a clear) would replace them.
            const out = updateTemplate(templates, ref, args.slice(2).join(' '), tags.length > 0 ? tags : undefined);
            return {
                ok: out.ok,
                text: out.text,
                ...(out.changed ? { nextTemplates: out.templates } : {}),
            };
        }
        case 'rm':
        case 'remove': {
            const ref = args[1] ?? '';
            if (ref.length === 0)
                return { ok: false, text: USAGE };
            const out = deleteTemplate(templates, ref);
            return {
                ok: out.ok,
                text: out.text,
                ...(out.changed ? { nextTemplates: out.templates } : {}),
            };
        }
        case 'export': {
            const path = args[1] ?? '';
            const content = exportTemplates(templates);
            if (path.length === 0)
                return { ok: true, text: content };
            return {
                ok: true,
                text: `Exported ${templates.length} template(s) to ${path}.`,
                exportFile: { path, content },
            };
        }
        case 'import': {
            const path = args[1] ?? '';
            if (path.length === 0)
                return { ok: false, text: USAGE };
            if (input.importPayload === undefined)
                return { ok: false, text: `Cannot read ${path}.` };
            const mode = args.includes('--replace') ? 'replace' : 'merge';
            // Dry run by default: a real write needs an explicit --yes, so a mistyped
            // path can never overwrite the library by accident.
            const dryRun = !args.includes('--yes');
            const out = importTemplates(input.importPayload, templates, mode, dryRun);
            if (!out.ok)
                return { ok: false, text: out.text };
            return { ok: true, text: out.text, nextTemplates: out.templates };
        }
        default:
            return { ok: false, text: USAGE };
    }
}
