/**
 * Baize rules client — the 规则 conversation tab.
 * Two panes: 规则 (对话/项目/全局, with tags and "save as template") and 模板
 * (the reusable template library: add/edit/delete, apply into any scope, and
 * import/export a JSON file). Hand-authored after @modusensus/dsh-mneme's client
 * bundle. The panel registers exactly one slot — the `conversation.view` tab; the
 * sidebar footer no longer carries a trigger button (0.2.4). Data goes
 * through the host HTTP API `/baize-rules.api` (same source of truth as the
 * `/baize-rules` command).
 *
 * @module dsh-baize-rules/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-baize-rules',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require('react');
    const { useState, useEffect, useCallback, useRef } = react;
    const h = react.createElement;

    const inject = ['slots', 'locale'];
    const NS = 'baize-rules';

    const dictionaries = {
      zh: {
        'rules.view.label': '规则',
        'rules.tab.rules': '规则',
        'rules.tab.templates': '模板',
        'rules.scope.session': '对话',
        'rules.scope.project': '项目',
        'rules.scope.global': '全局',
        'rules.add': '添加规则',
        'rules.remove': '删除',
        'rules.edit': '编辑',
        'rules.save': '保存',
        'rules.cancel': '取消',
        'rules.empty': '暂无规则',
        'rules.addHint': '输入规则，回车添加（如：用中文写注释）',
        'rules.error': '操作失败',
        'rules.tags.hint': '标签（空格分隔）',
        'rules.tags.all': '全部',
        'rules.editTitle': '编辑规则',
        'templates.editTitle': '编辑模板',
        'rules.noSession': '当前未绑定会话：只能编辑「全局」规则，对话/项目作用域已禁用。',
        'rules.scope.unavailable': '当前不可用（不在会话中）',
        'rules.saveAsTemplate': '存为模板',
        'rules.fromTemplate': '从模板',
        'rules.remove.confirm': '删除这条规则？',
        'rules.picker.title': '从模板添加规则',
        'rules.picker.search': '搜索模板…',
        'rules.picker.empty': '没有匹配的模板',
        'rules.picker.confirm': '添加所选',
        'templates.add': '添加模板',
        'templates.hint': '模板内容，回车添加',
        'templates.tags.hint': '标签（空格分隔）',
        'templates.edit': '编辑',
        'templates.remove': '删除',
        'templates.remove.confirm': '删除这个模板？',
        'templates.use': '加入规则',
        'templates.uses': '已用',
        'templates.empty': '暂无模板。可在规则列表点「存为模板」创建。',
        'templates.nomatch': '没有匹配的模板',
        'templates.search': '搜索模板…',
        'templates.export': '导出',
        'templates.import': '导入',
        'templates.import.merge': '合并',
        'templates.import.replace': '替换',
        'templates.import.confirm': '确认导入',
        'templates.import.cancel': '取消',
        // Panel notices + state labels. A successful op is phrased here instead
        // of echoing the host's English `text`, which used to mix languages in a
        // zh UI; a failed op keeps the host's own message (see `localizedNotice`).
        // Both dictionaries must stay key-for-key aligned — test/client.smoke.mjs
        // fails the build the moment they drift.
        'rules.added': '已添加规则',
        'rules.saved': '已保存规则',
        'rules.removed': '已删除规则',
        'rules.enabled': '已启用规则',
        'rules.disabled': '已停用规则',
        'rules.fromTemplate.added': '已从模板添加规则',
        'rules.enable': '启用',
        'rules.disable': '停用',
        'rules.disabled.mark': '(已停用)',
        'rules.conflict': '规则已在别处改动，本次未写入；请刷新页面后重试。',
        'problems.title': '规则文件告警',
        'templates.added': '已添加模板',
        'templates.saved': '已保存模板',
        'templates.removed': '已删除模板',
        'templates.exported': '已导出模板',
        'templates.imported': '已导入模板',
        'templates.import.readFailed': '无法读取导入文件',
      },
      en: {
        'rules.view.label': 'Rules',
        'rules.tab.rules': 'Rules',
        'rules.tab.templates': 'Templates',
        'rules.scope.session': 'Session',
        'rules.scope.project': 'Project',
        'rules.scope.global': 'Global',
        'rules.add': 'Add rule',
        'rules.remove': 'Remove',
        'rules.edit': 'Edit',
        'rules.save': 'Save',
        'rules.cancel': 'Cancel',
        'rules.empty': 'No rules',
        'rules.addHint': 'Type a rule and press Enter (e.g. write comments in Chinese)',
        'rules.error': 'Failed',
        'rules.tags.hint': 'Tags (space separated)',
        'rules.tags.all': 'All',
        'rules.editTitle': 'Edit rule',
        'templates.editTitle': 'Edit template',
        'rules.noSession': 'Not attached to a session: only global rules can be edited here.',
        'rules.scope.unavailable': 'unavailable (not in a session)',
        'rules.saveAsTemplate': 'Save as template',
        'rules.fromTemplate': 'From template',
        'rules.remove.confirm': 'Remove this rule?',
        'rules.picker.title': 'Add rules from templates',
        'rules.picker.search': 'Search templates…',
        'rules.picker.empty': 'No matching template',
        'rules.picker.confirm': 'Add selected',
        'templates.add': 'Add template',
        'templates.hint': 'Template body, press Enter to add',
        'templates.tags.hint': 'Tags (space separated)',
        'templates.edit': 'Edit',
        'templates.remove': 'Delete',
        'templates.remove.confirm': 'Delete this template?',
        'templates.use': 'Add to rules',
        'templates.uses': 'used',
        'templates.empty': 'No templates yet. Use “Save as template” on a rule.',
        'templates.nomatch': 'No matching template',
        'templates.search': 'Search templates…',
        'templates.export': 'Export',
        'templates.import': 'Import',
        'templates.import.merge': 'Merge',
        'templates.import.replace': 'Replace',
        'templates.import.confirm': 'Confirm import',
        'templates.import.cancel': 'Cancel',
        // Mirrors the zh block above, key for key.
        'rules.added': 'Rule added',
        'rules.saved': 'Rule saved',
        'rules.removed': 'Rule removed',
        'rules.enabled': 'Rule enabled',
        'rules.disabled': 'Rule disabled',
        'rules.fromTemplate.added': 'Rules added from templates',
        'rules.enable': 'Enable',
        'rules.disable': 'Disable',
        'rules.disabled.mark': '(disabled)',
        'rules.conflict': 'Rules changed elsewhere — nothing was written. Reload the page and try again.',
        'problems.title': 'Rule file problems',
        'templates.added': 'Template added',
        'templates.saved': 'Template saved',
        'templates.removed': 'Template deleted',
        'templates.exported': 'Templates exported',
        'templates.imported': 'Templates imported',
        'templates.import.readFailed': 'Could not read the import file',
      },
    };

    // --- Themed CSS for the panel. ---
    const RULES_CSS = [
      '.baize-seg{box-sizing:border-box;cursor:pointer;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:18px}',
      '.baize-seg:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.baize-seg.baize-seg-on{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.baize-seg[disabled]{opacity:.45;cursor:not-allowed;background:transparent}',
      '.baize-seg[disabled]:hover{background:transparent;color:var(--dsw-alias-label-primary)}',
      '.baize-ghost{box-sizing:border-box;cursor:pointer;padding:3px 8px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:16px}',
      '.baize-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      // Pane tabs (规则 / 模板) — the second level inside the panel.
      '.baize-tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:8px}',
      '.baize-tab{box-sizing:border-box;cursor:pointer;padding:5px 14px;border-radius:8px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:14px;line-height:20px}',
      '.baize-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.baize-tab.baize-tab-on{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}',
      // Rows (one rule / one template).
      '.baize-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid transparent}',
      '.baize-row-main{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-grow:1;min-width:0}',
      '.baize-row-text{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;word-break:break-word}',
      '.baize-row-actions{display:flex;gap:2px;flex:none}',
      '.baize-row-note{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
      // A disabled rule stays visible so it can be switched back on, but reads as
      // inert: muted text + a weak localized `(disabled)` marker. Enabled is the
      // default, so an enabled row carries no marker at all.
      '.baize-row-off .baize-row-text{color:var(--dsw-alias-label-secondary);opacity:.7}',
      '.baize-row-off .baize-chip{opacity:.7}',
      '.baize-off-mark{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
      // Non-fatal read failures (a corrupt rules file) reported by the host.
      '.baize-problem{color:var(--dsw-alias-state-warn-primary,#a60);font-size:12px;line-height:18px;margin:0 0 8px}',
      '.baize-editbox{display:flex;flex-direction:column;gap:6px;flex-grow:1;min-width:0}',
      '.baize-editrow{display:flex;gap:4px;align-items:center}',
      // Tag chips + the filter row.
      '.baize-chip{box-sizing:border-box;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11px;line-height:16px;padding:1px 8px}',
      '.baize-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.baize-chip.baize-chip-on{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.baize-chiprow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}',
      '.baize-input{box-sizing:border-box;flex-grow:1;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:18px}',
      '.baize-actions{display:flex;gap:4px;align-items:center;margin-bottom:12px}',
      '.baize-notice{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:4px 0}',
      '.baize-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px}',
      '.baize-modal{box-sizing:border-box;background:var(--dsw-alias-bg-base,#111);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;width:min(560px,100%);max-height:80vh;overflow:auto;font-family:inherit}',
      '.baize-modal-title{font-weight:600;margin-bottom:10px;color:var(--dsw-alias-label-primary)}',
      '.baize-pick{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px}',
      '.baize-importbox{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}',
      // Edit forms sit in a card so they read as their own surface instead of
      // blending into the list rows they replace.
      // The card uses the exact fill the shell paints its left workspace rail
      // with, so an edit form reads as a solid surface rather than a wash.
      '.baize-card{border:1px solid var(--dsw-alias-border-l3);border-radius:10px;padding:10px 12px;background:var(--dsw-specific-sidebar-fill)}',
      '.baize-card-title{font-size:12px;line-height:16px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px}',
    ].join('');
    let stylesInjected = false;
    function injectStyles() {
      if (stylesInjected || typeof document === 'undefined') return;
      stylesInjected = true;
      // Official plugin-css contract (see @deepseek-ai/dsh-client-ui-commands):
      // the style tag carries `data-plugin` (the package name) plus a unique
      // `data-plugin-css` id, and the id is what makes the injection idempotent —
      // an HMR reload re-runs this module, and without the query the old tag
      // would still be live and every rule would be applied twice.
      const tagId = 'dsh-baize-rules/client.css';
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-baize-rules';
      tag.dataset.pluginCss = tagId;
      tag.textContent = RULES_CSS;
      document.head.appendChild(tag);
    }
    // --- API (same-origin; host exposes /baize-rules.api). ---
    function rulesQuery(sessionId, project) {
      const q = new URLSearchParams();
      if (sessionId) q.set('sessionId', sessionId);
      if (project) q.set('project', project);
      const s = q.toString();
      return s ? '?' + s : '';
    }
    async function apiGet(sessionId, project) {
      const res = await fetch('/baize-rules.api' + rulesQuery(sessionId, project));
      // A non-JSON body (empty 500, proxy error page) must surface as the HTTP
      // failure it is, not as a SyntaxError from res.json().
      const body = await res.json().catch(() => null);
      if (!res.ok) throw apiError(res.status, body, 'get failed');
      return body || {};
    }
    async function apiPost(sessionId, project, payload) {
      const res = await fetch('/baize-rules.api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, project, ...payload }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw apiError(res.status, body, 'post failed');
      return body || {};
    }
    /** An HTTP failure carrying the host's own message plus its status, so the
     *  panel can single out 409 (a retryable concurrency conflict) from the rest. */
    function apiError(status, body, fallback) {
      const detail = body && (body.error || body.text);
      const err = new Error(detail || fallback + ' (HTTP ' + status + ')');
      err.status = status;
      return err;
    }

    // --- Small helpers shared by both panes. ---
    function parseTags(value) {
      return String(value || '')
        .split(/[\s,，]+/)
        .map((s) => s.replace(/^#+/, '').trim())
        .filter(Boolean);
    }
    function tagsText(tags) { return (tags || []).join(' '); }
    function sameTag(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
    /** Distinct tags across a list of rules/templates, most-used first. */
    function collectTags(items) {
      const counts = new Map();
      for (const item of items || []) {
        for (const tag of (item && item.tags) || []) {
          const key = String(tag).toLowerCase();
          const hit = counts.get(key);
          if (hit) hit.n += 1;
          else counts.set(key, { tag: tag, n: 1 });
        }
      }
      return Array.from(counts.values()).sort((a, b) => b.n - a.n).map((e) => e.tag);
    }

    /** i18n key for a *successful* op's notice.
     *
     *  The host answers every op with its own English `text` ("Added rule …").
     *  Rendering that verbatim is what made a zh panel half-Chinese/half-English,
     *  so a success notice is phrased locally from the request we just sent.
     *  `null` means "stay quiet" (an import preview already renders its own
     *  report). Failures never come through here — they keep the host's text,
     *  which is the diagnostic the user actually needs. */
    function noticeKey(payload) {
      const op = payload && payload.op;
      switch (op) {
        case 'rule.add': return 'rules.added';
        case 'rule.update': return 'rules.saved';
        case 'rule.setEnabled': return payload.enabled === false ? 'rules.disabled' : 'rules.enabled';
        case 'rule.addFromTemplates': return 'rules.fromTemplate.added';
        case 'rule.saveAsTemplate': return 'templates.added';
        // `raw` is only ever used for `remove <id>` now that add/enable have
        // structured ops of their own.
        case 'raw': return 'rules.removed';
        case 'template.create': return 'templates.added';
        case 'template.update': return 'templates.saved';
        case 'template.delete': return 'templates.removed';
        case 'template.export': return 'templates.exported';
        case 'template.import': return payload.dryRun === false ? 'templates.imported' : null;
        default: return null;
      }
    }

    /** Focusable descendants, in tab order — the modal's focus trap. */
    function focusablesIn(root) {
      if (!root || typeof root.querySelectorAll !== 'function') return [];
      const list = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      return Array.prototype.slice.call(list).filter((el) => !el.disabled);
    }

    function TagChips({ tags, active, onPick }) {
      const list = tags || [];
      if (list.length === 0) return null;
      return h(react.Fragment, null, list.map((tag) => h('button', {
        key: tag,
        type: 'button',
        className: 'baize-chip' + (active && sameTag(active, tag) ? ' baize-chip-on' : ''),
        onClick: onPick ? () => onPick(tag) : undefined,
        // Only a chip that filters is a toggle; a display-only chip (inside a
        // rule row) is a plain label and states no pressed state.
        'aria-pressed': onPick ? !!(active && sameTag(active, tag)) : undefined,
        title: tag,
      }, tag)));
    }

    function TagFilterRow({ t, tags, active, onPick }) {
      if (!tags || tags.length === 0) return null;
      return h('div', { className: 'baize-chiprow' },
        h('button', {
          type: 'button',
          className: 'baize-chip' + (active ? '' : ' baize-chip-on'),
          onClick: () => onPick(''),
          'aria-pressed': !active,
        }, t('rules.tags.all')),
        tags.map((tag) => h('button', {
          key: tag,
          type: 'button',
          className: 'baize-chip' + (active && sameTag(active, tag) ? ' baize-chip-on' : ''),
          onClick: () => onPick(active && sameTag(active, tag) ? '' : tag),
          'aria-pressed': !!(active && sameTag(active, tag)),
        }, tag))
      );
    }

    // One rule row: inline edit (text + tags), enable/disable, save-as-template, remove.
    function RuleRow({ rule, t, activeTag, onPickTag, onSave, onRemove, onSaveAsTemplate, onSetEnabled }) {
      const [editing, setEditing] = useState(false);
      const [val, setVal] = useState(rule.text);
      const [tagVal, setTagVal] = useState(tagsText(rule.tags));
      // Absent `enabled` means enabled (the store's own normalization), so an
      // older rules file reads as fully on rather than fully off.
      const enabled = rule.enabled !== false;
      const begin = () => { setVal(rule.text); setTagVal(tagsText(rule.tags)); setEditing(true); };
      const save = async () => {
        if (!val.trim()) return;
        // Stay in edit mode when the store refuses the write, so the typed text
        // is not silently thrown away.
        const ok = await onSave(rule.id, val.trim(), parseTags(tagVal));
        if (ok !== false) setEditing(false);
      };
      if (editing) {
        return h('li', { className: 'baize-row' },
          h('div', { className: 'baize-editbox baize-card' },
            h('div', { className: 'baize-card-title' }, t('rules.editTitle')),
            h('input', {
              className: 'baize-input', value: val, autoFocus: true,
              'aria-label': t('rules.editTitle'),
              onChange: (e) => setVal(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); },
            }),
            h('input', {
              className: 'baize-input', value: tagVal, placeholder: t('rules.tags.hint'),
              'aria-label': t('rules.tags.hint'),
              onChange: (e) => setTagVal(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); },
            }),
            h('div', { className: 'baize-editrow' },
              h('button', { type: 'button', className: 'baize-ghost', onClick: save }, t('rules.save')),
              h('button', { type: 'button', className: 'baize-ghost', onClick: () => setEditing(false) }, t('rules.cancel'))
            )
          )
        );
      }
      return h('li', { className: 'baize-row' + (enabled ? '' : ' baize-row-off') },
        h('div', { className: 'baize-row-main' },
          enabled ? null : h('span', { className: 'baize-off-mark' }, t('rules.disabled.mark')),
          h('span', { className: 'baize-row-text' }, rule.text),
          h(TagChips, { tags: rule.tags, active: activeTag, onPick: onPickTag })
        ),
        h('div', { className: 'baize-row-actions' },
          // Labelled by the action it performs (停用 when on, 启用 when off), so no
          // aria-pressed here: a pressed state next to an action name contradicts
          // itself for screen readers.
          h('button', {
            type: 'button', className: 'baize-ghost',
            onClick: () => onSetEnabled(rule.id, !enabled),
          }, enabled ? t('rules.disable') : t('rules.enable')),
          h('button', { type: 'button', className: 'baize-ghost', onClick: begin }, t('rules.edit')),
          h('button', { type: 'button', className: 'baize-ghost', onClick: () => onSaveAsTemplate(rule.id) }, t('rules.saveAsTemplate')),
          h('button', { type: 'button', className: 'baize-ghost', onClick: () => onRemove(rule.id) }, t('rules.remove'))
        )
      );
    }

    const SCOPE_KEYS = [
      ['session', 'rules.scope.session'],
      ['project', 'rules.scope.project'],
      ['global', 'rules.scope.global'],
    ];

    function RulesTab({ t, view, run, onOpenPicker, scopes }) {
      const [scope, setScope] = useState(scopes.indexOf('session') >= 0 ? 'session' : 'global');
      const [text, setText] = useState('');
      const [tagFilter, setTagFilter] = useState('');

      const rules = view[scope] || [];
      const chips = collectTags(rules);
      const shown = tagFilter
        ? rules.filter((r) => (r.tags || []).some((tag) => sameTag(tag, tagFilter)))
        : rules;

      async function add() {
        const body = text.trim();
        if (!body) return;
        // Structured op, never a command line: the host stores `text` whole, so a
        // rule body can no longer have a trailing word eaten by the old
        // `add <text> [scope]` grammar.
        const out = await run({ op: 'rule.add', scope: scope, text: body });
        // Clear the box only on success — a refused write (400/409) must leave
        // the typed rule in place so it can be fixed or retried.
        if (out) setText('');
      }
      async function saveRule(id, value, tags) {
        const out = await run({ op: 'rule.update', scope: scope, ruleId: id, text: value, tags: tags });
        return out !== null;
      }
      async function setEnabled(id, enabled) {
        await run({ op: 'rule.setEnabled', scope: scope, ruleId: id, enabled: enabled });
      }
      async function remove(id) {
        if (typeof window !== 'undefined' && !window.confirm(t('rules.remove.confirm'))) return;
        await run({ op: 'raw', raw: 'remove ' + id, scope: scope });
      }
      async function saveAsTemplate(id) {
        await run({ op: 'rule.saveAsTemplate', scope: scope, ruleId: id });
      }

      return h('div', null,
        scopes.length < SCOPE_KEYS.length
          ? h('div', { className: 'baize-notice' }, t('rules.noSession'))
          : null,
        h('div', { className: 'baize-actions', style: { marginBottom: 8 } },
          SCOPE_KEYS.map(([k, key]) => {
            const allowed = scopes.indexOf(k) >= 0;
            return h('button', {
              key: k, type: 'button',
              disabled: !allowed,
              title: allowed ? undefined : t('rules.scope.unavailable'),
              onClick: () => { if (!allowed) return; setScope(k); setTagFilter(''); },
              className: 'baize-seg' + (scope === k ? ' baize-seg-on' : ''),
            }, t(key));
          })
        ),
        h('div', { className: 'baize-actions' },
          h('input', {
            className: 'baize-input', value: text, placeholder: t('rules.addHint'),
            'aria-label': t('rules.addHint'),
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void add(); },
          }),
          h('button', { type: 'button', onClick: () => void add(), className: 'baize-seg baize-seg-on' }, t('rules.add')),
          h('button', { type: 'button', className: 'baize-seg', onClick: () => onOpenPicker(scope) }, t('rules.fromTemplate'))
        ),
        h(TagFilterRow, { t, tags: chips, active: tagFilter, onPick: setTagFilter }),
        shown.length === 0
          ? h('div', { className: 'baize-row-note' }, t('rules.empty'))
          : h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
            shown.map((r) => h(RuleRow, {
              key: r.id, rule: r, t, activeTag: tagFilter, onPickTag: (tag) => setTagFilter(sameTag(tag, tagFilter) ? '' : tag),
              onSave: (id, value, tags) => saveRule(id, value, tags),
              onRemove: (id) => void remove(id),
              onSaveAsTemplate: (id) => void saveAsTemplate(id),
              onSetEnabled: (id, enabled) => void setEnabled(id, enabled),
            }))
          )
      );
    }

    function TemplateRow({ t, item, editing, onBeginEdit, onCancelEdit, onSaveEdit, onRemove, onUse, useOpen, onToggleUse, scopes }) {
      const [val, setVal] = useState(item.text);
      const [tagVal, setTagVal] = useState(tagsText(item.tags));
      useEffect(() => { setVal(item.text); setTagVal(tagsText(item.tags)); }, [item.text, item.id]);
      if (editing) {
        return h('li', { className: 'baize-row' },
          h('div', { className: 'baize-editbox baize-card' },
            h('div', { className: 'baize-card-title' }, t('templates.editTitle')),
            h('input', {
              className: 'baize-input', value: val, autoFocus: true,
              'aria-label': t('templates.editTitle'),
              onChange: (e) => setVal(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') onSaveEdit(item.id, val.trim(), parseTags(tagVal)); if (e.key === 'Escape') onCancelEdit(); },
            }),
            h('input', {
              className: 'baize-input', value: tagVal, placeholder: t('templates.tags.hint'),
              'aria-label': t('templates.tags.hint'),
              onChange: (e) => setTagVal(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') onSaveEdit(item.id, val.trim(), parseTags(tagVal)); if (e.key === 'Escape') onCancelEdit(); },
            }),
            h('div', { className: 'baize-editrow' },
              h('button', { type: 'button', className: 'baize-ghost', onClick: () => onSaveEdit(item.id, val.trim(), parseTags(tagVal)) }, t('rules.save')),
              h('button', { type: 'button', className: 'baize-ghost', onClick: onCancelEdit }, t('rules.cancel'))
            )
          )
        );
      }
      return h('li', { className: 'baize-row' },
        h('div', { className: 'baize-row-main' },
          h('span', { className: 'baize-row-text' }, item.text),
          h(TagChips, { tags: item.tags }),
          item.uses > 0 ? h('span', { className: 'baize-row-note' }, t('templates.uses') + ' ' + item.uses) : null
        ),
        useOpen
          ? h('div', { className: 'baize-row-actions' },
              SCOPE_KEYS.filter(([k]) => scopes.indexOf(k) >= 0).map(([k, key]) => h('button', {
                key: k, type: 'button', className: 'baize-ghost', onClick: () => onUse(item.id, k),
              }, t(key))),
              h('button', { type: 'button', className: 'baize-ghost', onClick: onToggleUse }, t('rules.cancel'))
            )
          : h('div', { className: 'baize-row-actions' },
              h('button', { type: 'button', className: 'baize-ghost', onClick: () => onBeginEdit(item.id) }, t('templates.edit')),
              h('button', { type: 'button', className: 'baize-ghost', onClick: () => onRemove(item.id) }, t('templates.remove')),
              h('button', { type: 'button', className: 'baize-ghost', onClick: onToggleUse }, t('templates.use'))
            )
      );
    }

    function TemplatesTab({ t, templates, run, scopes, onError }) {
      const [text, setText] = useState('');
      const [tagInput, setTagInput] = useState('');
      const [query, setQuery] = useState('');
      const [tagFilter, setTagFilter] = useState('');
      const [editingId, setEditingId] = useState('');
      const [useFor, setUseFor] = useState('');
      const [importMode, setImportMode] = useState('merge');
      const [preview, setPreview] = useState(null);
      const fileRef = useRef(null);

      const chips = collectTags(templates);
      const q = query.trim().toLowerCase();
      const shown = templates
        .filter((item) => {
          if (tagFilter && !(item.tags || []).some((tag) => sameTag(tag, tagFilter))) return false;
          if (q && String(item.text).toLowerCase().indexOf(q) < 0) return false;
          return true;
        })
        .slice()
        .sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));

      async function add() {
        const body = text.trim();
        if (!body) return;
        const out = await run({ op: 'template.create', text: body, tags: parseTags(tagInput) });
        if (!out) return;
        setText('');
        setTagInput('');
      }
      async function saveEdit(id, value, tags) {
        const out = await run({ op: 'template.update', id: id, text: value, tags: tags });
        if (out) setEditingId('');
      }
      async function remove(id) {
        if (typeof window !== 'undefined' && !window.confirm(t('templates.remove.confirm'))) return;
        await run({ op: 'template.delete', id: id });
      }
      async function use(id, scope) {
        setUseFor('');
        await run({ op: 'rule.addFromTemplates', scope: scope, templateIds: [id] });
      }
      async function exportAll() {
        const out = await run({ op: 'template.export' });
        if (!out || typeof out.content !== 'string' || typeof document === 'undefined') return;
        const blob = new Blob([out.content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'baize-rules-templates-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      async function onFile(event) {
        const input = event.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        // `File.text()` rejects on a read error (file vanished, permission),
        // which used to escape as an unhandled rejection with no visible cause.
        let payload;
        try {
          payload = await file.text();
        } catch (e) {
          if (onError) onError(t('templates.import.readFailed') + ': ' + (e && e.message ? e.message : String(e)));
          return;
        }
        const out = await run({ op: 'template.import', payload: payload, mode: importMode, dryRun: true });
        // Freeze the mode into the preview: confirming must apply exactly what
        // was previewed, even if the user toggles merge/replace afterwards.
        if (out) setPreview({ payload: payload, text: out.text, mode: importMode });
      }
      async function confirmImport() {
        if (!preview) return;
        const out = await run({ op: 'template.import', payload: preview.payload, mode: preview.mode, dryRun: false });
        // Keep the preview and its dry-run report on screen when the write fails.
        if (out) setPreview(null);
      }

      return h('div', null,
        h('div', { className: 'baize-actions' },
          h('input', {
            className: 'baize-input', value: text, placeholder: t('templates.hint'),
            'aria-label': t('templates.hint'),
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void add(); },
          }),
          h('input', {
            className: 'baize-input', style: { flexGrow: 0, width: 160 }, value: tagInput, placeholder: t('templates.tags.hint'),
            'aria-label': t('templates.tags.hint'),
            onChange: (e) => setTagInput(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void add(); },
          }),
          h('button', { type: 'button', onClick: () => void add(), className: 'baize-seg baize-seg-on' }, t('templates.add'))
        ),
        h('div', { className: 'baize-actions' },
          h('input', {
            className: 'baize-input', value: query, placeholder: t('templates.search'),
            'aria-label': t('templates.search'),
            onChange: (e) => setQuery(e.target.value),
          }),
          h('button', { type: 'button', className: 'baize-seg', onClick: () => void exportAll() }, t('templates.export')),
          h('button', { type: 'button', className: 'baize-seg', onClick: () => fileRef.current && fileRef.current.click() }, t('templates.import')),
          h('button', {
            type: 'button', className: 'baize-ghost',
            onClick: () => setImportMode(importMode === 'merge' ? 'replace' : 'merge'),
            title: 'merge / replace',
          }, importMode === 'merge' ? t('templates.import.merge') : t('templates.import.replace')),
          h('input', { ref: fileRef, type: 'file', accept: '.json,application/json', style: { display: 'none' }, 'aria-label': t('templates.import'), onChange: (e) => void onFile(e) })
        ),
        preview
          ? h('div', null,
              h('div', { className: 'baize-importbox' }, preview.text),
              h('div', { className: 'baize-actions', style: { marginTop: 8 } },
                h('button', { type: 'button', className: 'baize-seg baize-seg-on', onClick: () => void confirmImport() }, t('templates.import.confirm')),
                h('button', { type: 'button', className: 'baize-seg', onClick: () => setPreview(null) }, t('templates.import.cancel'))
              )
            )
          : null,
        h(TagFilterRow, { t, tags: chips, active: tagFilter, onPick: setTagFilter }),
        shown.length === 0
          ? h('div', { className: 'baize-row-note' }, templates.length === 0 ? t('templates.empty') : t('templates.nomatch'))
          : h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
            shown.map((item) => h(TemplateRow, {
              key: item.id, t, item, scopes,
              editing: editingId === item.id,
              onBeginEdit: setEditingId,
              onCancelEdit: () => setEditingId(''),
              onSaveEdit: (id, value, tags) => void saveEdit(id, value, tags),
              onRemove: (id) => void remove(id),
              onUse: (id, scope) => void use(id, scope),
              useOpen: useFor === item.id,
              onToggleUse: () => setUseFor(useFor === item.id ? '' : item.id),
            }))
          )
      );
    }

    function TemplatePicker({ t, templates, onCancel, onConfirm }) {
      const [query, setQuery] = useState('');
      const [tagFilter, setTagFilter] = useState('');
      const [picked, setPicked] = useState([]);
      const modalRef = useRef(null);
      const titleId = 'baize-rules-picker-title';

      const chips = collectTags(templates);
      const q = query.trim().toLowerCase();
      const shown = templates.filter((item) => {
        if (tagFilter && !(item.tags || []).some((tag) => sameTag(tag, tagFilter))) return false;
        if (q && String(item.text).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      const toggle = (id) => setPicked(picked.indexOf(id) >= 0 ? picked.filter((x) => x !== id) : picked.concat([id]));

      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [onCancel]);

      // Dialog focus contract: remember who opened it, move focus inside, keep Tab
      // inside while open, and hand focus back to the opener on close. Without the
      // last step focus falls to <body> and the keyboard user restarts from the
      // top of the page. `autoFocus` is deliberately not used here: it would move
      // focus before this effect could record the opener.
      useEffect(() => {
        const modal = modalRef.current;
        const opener = typeof document === 'undefined' ? null : document.activeElement;
        const first = focusablesIn(modal)[0];
        if (first && typeof first.focus === 'function') first.focus();
        return () => {
          if (typeof document === 'undefined') return;
          if (opener && typeof opener.focus === 'function' && (!document.contains || document.contains(opener))) opener.focus();
        };
      }, []);

      // Tab cycles within the modal instead of walking out into the page behind it.
      const onKeyDown = (e) => {
        if (e.key !== 'Tab') return;
        const modal = modalRef.current;
        const items = focusablesIn(modal);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const inside = !!(modal && active && modal.contains(active));
        if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
      };

      return h('div', {
        className: 'baize-modal-mask',
        onClick: (e) => { if (e.target === e.currentTarget) onCancel(); },
      },
        h('div', {
          className: 'baize-modal',
          ref: modalRef,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': titleId,
          onKeyDown: onKeyDown,
        },
          h('div', { className: 'baize-modal-title', id: titleId }, t('rules.picker.title')),
          h('div', { className: 'baize-actions' },
            h('input', {
              className: 'baize-input', value: query, placeholder: t('rules.picker.search'),
              'aria-label': t('rules.picker.search'),
              onChange: (e) => setQuery(e.target.value),
            })
          ),
          h(TagFilterRow, { t, tags: chips, active: tagFilter, onPick: setTagFilter }),
          shown.length === 0
            ? h('div', { className: 'baize-row-note' }, templates.length === 0 ? t('templates.empty') : t('rules.picker.empty'))
            : h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
              shown.map((item) => h('li', { key: item.id, className: 'baize-pick', onClick: () => toggle(item.id) },
                h('input', {
                  type: 'checkbox',
                  checked: picked.indexOf(item.id) >= 0,
                  // The checkbox needs its own accessible name (the row's text is a
                  // sibling, not a <label>, because the row also holds tag chips).
                  'aria-label': item.text,
                  // Stop the click from reaching the row handler as well: without
                  // this a direct checkbox click toggled twice and appeared dead.
                  onClick: (e) => e.stopPropagation(),
                  onChange: () => toggle(item.id),
                }),
                h('span', { className: 'baize-row-text' }, item.text),
                h(TagChips, { tags: item.tags })
              ))
            ),
          h('div', { className: 'baize-actions', style: { marginTop: 12, marginBottom: 0 } },
            h('button', {
              type: 'button', className: 'baize-seg baize-seg-on',
              onClick: () => onConfirm(picked),
            }, t('rules.picker.confirm') + (picked.length ? ' (' + picked.length + ')' : '')),
            h('button', { type: 'button', className: 'baize-seg', onClick: onCancel }, t('rules.cancel'))
          )
        )
      );
    }

    function RulesPanel({ t, sessionId = '', project = '' }) {
      const [tab, setTab] = useState('rules');
      const [view, setView] = useState({ global: [], session: [], project: [] });
      const [templates, setTemplates] = useState([]);
      const [err, setErr] = useState('');
      const [notice, setNotice] = useState('');
      // Non-fatal read failures reported by the host (corrupt rules file, an
      // unreadable templates file). They are not errors — the panel still works —
      // but they explain a list that looks emptier than the user expects.
      const [problems, setProblems] = useState([]);
      const [pickerScope, setPickerScope] = useState('');
      // A sessionId is what decides availability. The `conversation.view` slot
      // hands over the framework standard kit (sessionId + hooks) and nothing
      // else, so `project` is normally empty even inside a conversation — the host
      // resolves that session's cwd itself when storing project rules
      // (resolveProject in the API). Gating `project` on a cwd prop disabled it
      // everywhere and mislabelled the reason as "no session".
      const hasSession = String(sessionId || '').length > 0;
      const scopes = hasSession ? ['session', 'project', 'global'] : ['global'];

      const load = useCallback(async () => {
        try {
          const data = await apiGet(sessionId, project);
          setView({ global: data.global || [], session: data.session || [], project: data.project || [] });
          setTemplates(data.templates || []);
          setProblems(data.problems || []);
          setErr('');
        } catch (e) {
          setErr(e && e.message ? e.message : String(e));
        }
      }, [sessionId, project]);
      useEffect(() => { void load(); }, [load]);

      // Every op returns the post-change view + template library, so one call
      // refreshes both panes (and the template picker) without a second fetch.
      const run = useCallback(async (payload) => {
        try {
          const body = await apiPost(sessionId, project, payload);
          if (body.view) setView(body.view);
          if (body.templates) setTemplates(body.templates);
          if (body.problems) setProblems(body.problems);
          // Success text is phrased locally; the host's English `text` is only
          // kept for failures, where it is the diagnostic.
          const key = noticeKey(payload);
          setNotice(key ? t(key) : '');
          setErr('');
          return body;
        } catch (e) {
          const message = e && e.message ? e.message : String(e);
          // 409 is a lost concurrency race: nothing was written and the same
          // request will succeed after a reload, so say so in the user's language
          // and keep the host's own sentence after it.
          setErr(e && e.status === 409 ? t('rules.conflict') + ' ' + message : message);
          setNotice('');
          return null;
        }
      }, [sessionId, project, t]);

      async function confirmPick(ids) {
        const scope = pickerScope;
        setPickerScope('');
        if (ids.length === 0) return;
        await run({ op: 'rule.addFromTemplates', scope: scope, templateIds: ids });
      }

      return h('div', { style: { padding: 16, fontFamily: 'inherit' } },
        // Top-of-panel warning for non-fatal read failures, so an unexpectedly
        // short list is explained instead of looking like data loss.
        problems.length > 0
          ? h('div', { className: 'baize-problem', role: 'alert' }, t('problems.title') + ': ' + problems.join(' · '))
          : null,
        h('div', { className: 'baize-tabs', role: 'tablist' },
          h('button', {
            type: 'button', className: 'baize-tab' + (tab === 'rules' ? ' baize-tab-on' : ''),
            role: 'tab', 'aria-selected': tab === 'rules',
            onClick: () => setTab('rules'),
          }, t('rules.tab.rules')),
          h('button', {
            type: 'button', className: 'baize-tab' + (tab === 'templates' ? ' baize-tab-on' : ''),
            role: 'tab', 'aria-selected': tab === 'templates',
            onClick: () => setTab('templates'),
          }, t('rules.tab.templates')),
          h('div', { style: { flexGrow: 1 } }),
          tab === 'rules'
            ? h('span', { className: 'baize-row-note' }, templates.length + ' ' + t('rules.tab.templates'))
            : null
        ),
        err ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary, #c33)', fontSize: 12, marginBottom: 8 } }, t('rules.error') + ': ' + err) : null,
        notice && !err ? h('div', { className: 'baize-notice' }, notice) : null,
        tab === 'rules'
          ? h(RulesTab, { t, view, run, onOpenPicker: setPickerScope, scopes })
          : h(TemplatesTab, {
              t, templates, run, scopes,
              onError: (message) => { setNotice(''); setErr(message); },
            }),
        pickerScope
          ? h(TemplatePicker, {
              t, templates,
              onCancel: () => setPickerScope(''),
              onConfirm: (ids) => void confirmPick(ids),
            })
          : null
      );
    }

    function apply(ctx) {
      injectStyles();
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'baize-rules: dictionaries');

      ctx.slots.inject('conversation.view', () => {
        const t = ctx.locale.bind(NS);
        return ctx.slots.register({
          name: 'conversation.view',
          id: 'baize-rules-rules',
          order: 30,
          locale: NS,
          label: () => t('rules.view.label')
          // The standard session kit is `{ sessionId, hooks }` — nothing else —
          // so the old `props.cwd ?? props.session?.header?.cwd ?? props.session?.cwd`
          // chain could never resolve and only pretended to have a cwd. The host
          // resolves this session's cwd itself (resolveProject in src/api.ts).
        }, (props) => h(RulesPanel, { t, sessionId: props?.sessionId ?? '' }));
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
