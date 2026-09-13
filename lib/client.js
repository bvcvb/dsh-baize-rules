/**
 * Baize rules client — the 规则 button (sidebar footer) + 规则 conversation tab
 * (对话/项目/全局). Hand-authored after @modusensus/dsh-mneme's client bundle:
 * click the footer button → click the matching conversation.view tab; if there's
 * no tab ring (new-chat hero) → open a full-viewport overlay. Data goes through
 * the host HTTP API `/baize-rules.api` (same source of truth as /baize-rules).
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
    const { useState, useEffect, useCallback } = react;
    const h = react.createElement;

    const inject = ['slots', 'locale'];
    const NS = 'baize-rules';

    const dictionaries = {
      zh: {
        'rules.sidebar.aria': '打开规则',
        'rules.panel.open': '规则',
        'rules.view.label': '规则',
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
      },
      en: {
        'rules.sidebar.aria': 'Open rules',
        'rules.panel.open': 'Rules',
        'rules.view.label': 'Rules',
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
      '.baize-ghost{box-sizing:border-box;cursor:pointer;padding:3px 8px;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:16px}',
      '.baize-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
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
    async function apiPost(sessionId, project, raw, scope) {
      const res = await fetch('/baize-rules.api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, project, raw, scope }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || body.text || 'post failed');
      return body;
    }

    // One rule row with inline edit (编辑 → input + 保存/取消), instead of delete+re-add.
    function RuleRow({ rule, onSave, onRemove, t }) {
      const [editing, setEditing] = useState(false);
      const [val, setVal] = useState(rule.text);
      const begin = () => { setVal(rule.text); setEditing(true); };
      const save = () => { if (val.trim()) onSave(rule.id, val.trim()); setEditing(false); };
      return h('li', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' } },
        editing
          ? h(react.Fragment, null,
              h('input', { value: val, onChange: (e) => setVal(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }, style: { flexGrow: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-primary)' } }),
              h('button', { type: 'button', className: 'baize-ghost', onClick: save }, t('rules.save')),
              h('button', { type: 'button', className: 'baize-ghost', onClick: () => setEditing(false) }, t('rules.cancel'))
            )
          : h(react.Fragment, null,
              h('span', { style: { flexGrow: 1, color: 'var(--dsw-alias-label-primary)' } }, rule.text),
              h('button', { type: 'button', className: 'baize-ghost', onClick: begin }, t('rules.edit')),
              h('button', { type: 'button', className: 'baize-ghost', onClick: () => onRemove(rule.id) }, t('rules.remove'))
            )
      );
    }

    function ScopeSection({ scopeLabel, rules, onSave, onRemove, t }) {
      return h('div', { style: { margin: '8px 0' } },
        h('div', { style: { fontWeight: 600, marginBottom: 4 } }, scopeLabel),
        rules.length === 0
          ? h('div', { style: { color: 'var(--dsw-alias-label-secondary, #888)', fontSize: 12 } }, t('rules.empty'))
          : h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
            rules.map(r => h(RuleRow, { key: r.id, rule: r, onSave, onRemove, t }))
          )
      );
    }

    function RulesPanel({ t, sessionId, project }) {
      const [scope, setScope] = useState('session');
      const [view, setView] = useState({ global: [], session: [], project: [] });
      const [text, setText] = useState('');
      const [err, setErr] = useState('');

      const load = useCallback(async () => {
        try { setView(await apiGet(sessionId, project)); setErr(''); }
        catch (e) { setErr(String(e)); }
      }, [sessionId]);
      useEffect(() => { void load(); }, [load]);

      async function add() {
        if (!text.trim()) return;
        try { const r = await apiPost(sessionId, project, 'add ' + text.trim(), scope); setView(r.view); setText(''); setErr(''); }
        catch (e) { setErr(String(e)); }
      }
      async function remove(id) {
        try { const r = await apiPost(sessionId, project, 'remove ' + id, scope); setView(r.view); }
        catch (e) { setErr(String(e)); }
      }
      async function saveRule(id, text) {
        try { const r = await apiPost(sessionId, project, 'edit ' + id + ' ' + text, scope); setView(r.view); setErr(''); }
        catch (e) { setErr(String(e)); }
      }

      const scopeKeys = [
        ['session', 'rules.scope.session'],
        ['project', 'rules.scope.project'],
        ['global', 'rules.scope.global'],
      ];
      const activeRules = view[scope] || [];
      const activeLabelKey = (scopeKeys.find(([k]) => k === scope) || ['session'])[1];
      return h('div', { style: { padding: 16, fontFamily: 'inherit' } },
        h('div', { style: { display: 'flex', gap: 4, marginBottom: 12 } },
          scopeKeys.map(([k, key]) => h('button', {
            key: k, type: 'button', onClick: () => setScope(k),
            className: 'baize-seg' + (scope === k ? ' baize-seg-on' : ''),
          }, t(key)))
        ),
        h('div', { style: { display: 'flex', gap: 4, marginBottom: 12 } },
          h('input', { value: text, onChange: (e) => setText(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') add(); }, placeholder: t('rules.addHint'), style: { flexGrow: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-primary)' } }),
          h('button', { type: 'button', onClick: add, className: 'baize-seg baize-seg-on', style: { padding: '6px 12px' } }, t('rules.add'))
        ),
        err ? h('div', { style: { color: 'var(--dsw-alias-state-error, #c33)', fontSize: 12 } }, err) : null,
        h(ScopeSection, { t, scopeLabel: t(activeLabelKey), rules: activeRules, onSave: (id, text) => { void saveRule(id, text); }, onRemove: (id) => { void remove(id); } })
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
