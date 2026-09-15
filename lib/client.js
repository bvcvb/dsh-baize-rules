/**
 * Baize rules client — the 规则 button (sidebar footer) + 规则 conversation tab.
 * Two panes: 规则 (对话/项目/全局, with tags and "save as template") and 模板
 * (the reusable template library: add/edit/delete, apply into any scope, and
 * import/export a JSON file). Hand-authored after @modusensus/dsh-mneme's client
 * bundle: click the footer button → click the matching conversation.view tab; if
 * there's no tab ring (new-chat hero) → open a full-viewport overlay. Data goes
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
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { useState, useEffect, useCallback, useRef } = react;
    const h = react.createElement;

    const inject = ['slots', 'locale'];
    const NS = 'baize-rules';

    const dictionaries = {
      zh: {
        'rules.sidebar.aria': '打开规则',
        'rules.panel.open': '规则',
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
        'rules.overlay.close': '关闭',
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
      },
      en: {
        'rules.sidebar.aria': 'Open rules',
        'rules.panel.open': 'Rules',
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
        'rules.overlay.close': 'Close',
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
      },
    };

    // --- Module-scoped overlay store (mirrors dsh-mneme's useOverlayOpen). ---
    let overlayOpen = false;
    const overlayListeners = new Set();
    function setOverlayOpen(open) { overlayOpen = open; overlayListeners.forEach((fn) => fn(open)); }
    function useRulesOverlay() {
      const [open, setOpen] = useState(overlayOpen);
      useEffect(() => {
        const fn = (v) => setOpen(v);
        overlayListeners.add(fn);
        return () => { overlayListeners.delete(fn); };
      }, []);
      return [open, setOverlayOpen];
    }

    // --- Themed CSS (mirrors dsh-mneme's .mneme-trigger) + a themed rules icon. ---
    const RULES_CSS = [
      // Sidebar-foot layout fix. The shell renders `sidebar.footer.action` as a
      // nowrap horizontal flex row (`.footerActions{display:flex}`, width 100%),
      // but every entry registered there is a *full-width foot row*: Baize's
      // `.baize-trigger` is `width:calc(100% + 4px); flex:none` (copied from
      // dsh-mneme's `.mneme-trigger`), and the wallet's ring is `width:100%`.
      // Two such rows in one unshrinkable strip overflow the column and push the
      // later entry (this button) outside the sidebar, so the strip must stack:
      // one plugin entry per row, each directly above Settings.
      //
      // Two rules, because changing a host container from a plugin is only safe
      // when it is *certainly* the right container. The first pins the shell's own
      // strip by its CSS-Modules name fragment, which CSS Modules keeps verbatim
      // (`hHd-Xa_footerActions`), so no other element can match it. The second is
      // the class-name-independent fallback: the slot renderer mounts list entries
      // in a Fragment and the per-entry error boundary renders children directly,
      // so this button is a DIRECT child of the strip — `:has(> …)` then pinpoints
      // it even if the shell renames its class. Either rule fails *silently*: the
      // old inline behaviour just returns. The `:not(.baize-rail)` guard leaves
      // the collapsed 56px rail an even row of circular icons.
      'div[class*="footerActions"]:has(.baize-trigger:not(.baize-rail)){flex-direction:column;align-items:stretch}',
      'div:has(> .baize-trigger:not(.baize-rail)){flex-direction:column;align-items:stretch}',
      '.baize-trigger{box-sizing:border-box;cursor:pointer;width:calc(100% + 4px);height:42px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:12px;flex:none;align-items:center;gap:8px;margin:4px -2px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden}',
      '.baize-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.baize-trigger.baize-rail{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:8px 0 10px;padding:0}',
      '.baize-trigger-label{white-space:nowrap;overflow:hidden}',
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
      const tag = document.createElement('style');
      tag.dataset.plugin = 'baize-rules';
      tag.textContent = RULES_CSS;
      document.head.appendChild(tag);
    }
    // Themed rules icon (list w/ checkmarks), stroke currentColor so it blends.
    const RulesIcon = ({ size = 16 }) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
      h('path', { d: 'M5 4.5 6.2 5.7 8.4 3.4M5 8.5 6.2 9.7 8.4 7.4M5 12.5 6.2 13.7 8.4 11.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M11 4.5h1.5M11 8.5h1.5M11 12.5h1.5', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })
    );

    // --- Tab activation: find the conversation.view tab by label and click it,
    // polling aria-selected (bounded) so a silent React gap isn't read as success. ---
    function findRulesTab(label) {
      const tabs = document.querySelectorAll('[role="tab"]');
      for (const tab of tabs) if ((tab.textContent || '').trim() === label) return tab;
      return null;
    }
    function activateRulesTab(label) {
      return new Promise((resolve) => {
        const tab = findRulesTab(label);
        if (!tab) { resolve(false); return; }
        tab.click();
        const deadline = Date.now() + 400;
        (function check() {
          if (tab.getAttribute('aria-selected') === 'true') { resolve(true); return; }
          if (Date.now() >= deadline) { resolve(false); return; }
          requestAnimationFrame(check);
        })();
      });
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
      if (!res.ok) throw new Error('get failed');
      return res.json();
    }
    async function apiPost(sessionId, project, payload) {
      const res = await fetch('/baize-rules.api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, project, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || body.text || 'post failed');
      return body;
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

    function TagChips({ tags, active, onPick }) {
      const list = tags || [];
      if (list.length === 0) return null;
      return h(react.Fragment, null, list.map((tag) => h('button', {
        key: tag,
        type: 'button',
        className: 'baize-chip' + (active && sameTag(active, tag) ? ' baize-chip-on' : ''),
        onClick: onPick ? () => onPick(tag) : undefined,
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
        }, t('rules.tags.all')),
        tags.map((tag) => h('button', {
          key: tag,
          type: 'button',
          className: 'baize-chip' + (active && sameTag(active, tag) ? ' baize-chip-on' : ''),
          onClick: () => onPick(active && sameTag(active, tag) ? '' : tag),
        }, tag))
      );
    }

    // One rule row: inline edit (text + tags), save-as-template, remove.
    function RuleRow({ rule, t, activeTag, onPickTag, onSave, onRemove, onSaveAsTemplate }) {
      const [editing, setEditing] = useState(false);
      const [val, setVal] = useState(rule.text);
      const [tagVal, setTagVal] = useState(tagsText(rule.tags));
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
              onChange: (e) => setVal(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); },
            }),
            h('input', {
              className: 'baize-input', value: tagVal, placeholder: t('rules.tags.hint'),
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
      return h('li', { className: 'baize-row' },
        h('div', { className: 'baize-row-main' },
          h('span', { className: 'baize-row-text' }, rule.text),
          h(TagChips, { tags: rule.tags, active: activeTag, onPick: onPickTag })
        ),
        h('div', { className: 'baize-row-actions' },
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
        if (!text.trim()) return;
        await run({ op: 'raw', raw: 'add ' + text.trim(), scope: scope });
        setText('');
      }
      async function saveRule(id, value, tags) {
        const out = await run({ op: 'rule.update', scope: scope, ruleId: id, text: value, tags: tags });
        return out !== null;
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
              onChange: (e) => setVal(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') onSaveEdit(item.id, val.trim(), parseTags(tagVal)); if (e.key === 'Escape') onCancelEdit(); },
            }),
            h('input', {
              className: 'baize-input', value: tagVal, placeholder: t('templates.tags.hint'),
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

    function TemplatesTab({ t, templates, run, scopes }) {
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
        await run({ op: 'template.create', text: body, tags: parseTags(tagInput) });
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
        const payload = await file.text();
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
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void add(); },
          }),
          h('input', {
            className: 'baize-input', style: { flexGrow: 0, width: 160 }, value: tagInput, placeholder: t('templates.tags.hint'),
            onChange: (e) => setTagInput(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void add(); },
          }),
          h('button', { type: 'button', onClick: () => void add(), className: 'baize-seg baize-seg-on' }, t('templates.add'))
        ),
        h('div', { className: 'baize-actions' },
          h('input', {
            className: 'baize-input', value: query, placeholder: t('templates.search'),
            onChange: (e) => setQuery(e.target.value),
          }),
          h('button', { type: 'button', className: 'baize-seg', onClick: () => void exportAll() }, t('templates.export')),
          h('button', { type: 'button', className: 'baize-seg', onClick: () => fileRef.current && fileRef.current.click() }, t('templates.import')),
          h('button', {
            type: 'button', className: 'baize-ghost',
            onClick: () => setImportMode(importMode === 'merge' ? 'replace' : 'merge'),
            title: 'merge / replace',
          }, importMode === 'merge' ? t('templates.import.merge') : t('templates.import.replace')),
          h('input', { ref: fileRef, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: (e) => void onFile(e) })
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

      return h('div', { className: 'baize-modal-mask', onClick: (e) => { if (e.target === e.currentTarget) onCancel(); } },
        h('div', { className: 'baize-modal' },
          h('div', { className: 'baize-modal-title' }, t('rules.picker.title')),
          h('div', { className: 'baize-actions' },
            h('input', {
              className: 'baize-input', value: query, placeholder: t('rules.picker.search'), autoFocus: true,
              onChange: (e) => setQuery(e.target.value),
            })
          ),
          h(TagFilterRow, { t, tags: chips, active: tagFilter, onPick: setTagFilter }),
          shown.length === 0
            ? h('div', { className: 'baize-row-note' }, templates.length === 0 ? t('templates.empty') : t('rules.picker.empty'))
            : h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
              shown.map((item) => h('li', { key: item.id, className: 'baize-pick', onClick: () => toggle(item.id) },
                h('input', { type: 'checkbox', checked: picked.indexOf(item.id) >= 0, onChange: () => toggle(item.id) }),
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
      const [pickerScope, setPickerScope] = useState('');
      // A sessionId is what decides availability. The `conversation.view` slot
      // hands over the framework standard kit (sessionId + useSession) but its
      // owner share carries NO cwd, so `project` is normally empty even inside a
      // conversation — the host resolves that session's cwd itself when storing
      // project rules (resolveProject in the API). Gating `project` on the cwd
      // prop disabled it everywhere and mislabelled the reason as "no session".
      const hasSession = String(sessionId || '').length > 0;
      const scopes = hasSession ? ['session', 'project', 'global'] : ['global'];

      const load = useCallback(async () => {
        try {
          const data = await apiGet(sessionId, project);
          setView({ global: data.global || [], session: data.session || [], project: data.project || [] });
          setTemplates(data.templates || []);
          setErr('');
        } catch (e) {
          setErr(String(e));
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
          setNotice(body.text || '');
          setErr('');
          return body;
        } catch (e) {
          setErr(String(e));
          return null;
        }
      }, [sessionId, project]);

      async function confirmPick(ids) {
        const scope = pickerScope;
        setPickerScope('');
        if (ids.length === 0) return;
        await run({ op: 'rule.addFromTemplates', scope: scope, templateIds: ids });
      }

      return h('div', { style: { padding: 16, fontFamily: 'inherit' } },
        h('div', { className: 'baize-tabs' },
          h('button', {
            type: 'button', className: 'baize-tab' + (tab === 'rules' ? ' baize-tab-on' : ''),
            onClick: () => setTab('rules'),
          }, t('rules.tab.rules')),
          h('button', {
            type: 'button', className: 'baize-tab' + (tab === 'templates' ? ' baize-tab-on' : ''),
            onClick: () => setTab('templates'),
          }, t('rules.tab.templates')),
          h('div', { style: { flexGrow: 1 } }),
          tab === 'rules'
            ? h('span', { className: 'baize-row-note' }, templates.length + ' ' + t('rules.tab.templates'))
            : null
        ),
        err ? h('div', { style: { color: 'var(--dsw-alias-state-error, #c33)', fontSize: 12, marginBottom: 8 } }, t('rules.error') + ': ' + err) : null,
        notice && !err ? h('div', { className: 'baize-notice' }, notice) : null,
        tab === 'rules'
          ? h(RulesTab, { t, view, run, onOpenPicker: setPickerScope, scopes })
          : h(TemplatesTab, { t, templates, run, scopes }),
        pickerScope
          ? h(TemplatePicker, {
              t, templates,
              onCancel: () => setPickerScope(''),
              onConfirm: (ids) => void confirmPick(ids),
            })
          : null
      );
    }

    // --- Sidebar foot trigger: clicks the rules tab; falls back to overlay. ---
    function RulesTrigger({ wide, t }) {
      const [, setOpen] = useRulesOverlay();
      return h('button', {
        type: 'button',
        className: wide ? 'baize-trigger' : 'baize-trigger baize-rail',
        'aria-label': t('rules.sidebar.aria'),
        title: t('rules.sidebar.aria'),
        onClick: () => { activateRulesTab(t('rules.view.label')).then((ok) => { if (!ok) setOpen(true); }); },
      },
        h(RulesIcon, { size: wide ? 16 : 18 }),
        wide ? h('span', { className: 'baize-trigger-label' }, t('rules.panel.open')) : null
      );
    }

    // Full-viewport fallback when there's no tab ring (new-chat hero). Esc closes.
    function RulesOverlay({ t }) {
      const [open, setOpen] = useRulesOverlay();
      useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open]);
      if (!open) return null;
      return h('div', { style: { position: 'fixed', inset: 0, background: 'var(--dsw-alias-bg-base, #111)', zIndex: 9999, overflow: 'auto' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--dsw-alias-border-l2, #333)' } },
          h('span', { style: { fontWeight: 600 } }, t('rules.view.label')),
          h('button', { type: 'button', className: 'baize-ghost', onClick: () => setOpen(false) }, t('rules.overlay.close'))
        ),
        h(RulesPanel, { t })
      );
    }

    function apply(ctx) {
      injectStyles();
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'baize-rules: dictionaries');

      ctx.slots.inject('sidebar.footer.action', () => {
        const t = ctx.locale.bind(NS);
        return ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'baize-rules',
          order: 1,
          label: () => t('rules.panel.open')
        }, (props) => h(react.Fragment, null,
          h(RulesTrigger, { ...props, t }),
          h(RulesOverlay, { t })
        ));
      });

      ctx.slots.inject('conversation.view', () => {
        const t = ctx.locale.bind(NS);
        return ctx.slots.register({
          name: 'conversation.view',
          id: 'baize-rules-rules',
          order: 30,
          locale: NS,
          label: () => t('rules.view.label')
        }, (props) => h(RulesPanel, { t, sessionId: props?.sessionId ?? '', project: props?.cwd ?? props?.session?.header?.cwd ?? props?.session?.cwd ?? '' }));
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
