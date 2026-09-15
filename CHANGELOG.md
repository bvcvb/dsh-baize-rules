# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [0.2.0] - 2026-09-15
- **Rule tags.** A rule (and a template) can carry free-text tags: `tag`/`untag` on the command side, chip editing + chip filtering in the panel. Tags are **panel-only by default** — `injectTags: true` opts into rendering them as `- [tag,tag] body`, and with the default off the injected `<system-reminder>` is byte-identical to 0.1.6, so retagging never triggers a redundant re-injection. Stored tags are optional and normalized (max 8 per rule, 24 chars each, case-insensitive dedupe), so pre-tag rule files load unchanged and are rewritten byte-identically.
- **Template library** (`$DSH_HOME/rules/templates.json`, global, not bound to a scope): `tmpl list|add|edit|rm`, `save <id>` to store a rule as a template, and `from <id|#tag> [scope]` to apply templates as rules (a `#tag` ref applies every template carrying that tag; a same-text rule already in the target scope is skipped, so re-applying never piles up duplicates; applied templates bump a use counter).
- **Template import/export.** `tmpl export [<file>]` writes a versioned envelope (`kind`/`schemaVersion`/`exportedAt`) that deliberately omits ids; `tmpl import <file> [--merge|--replace] [--dry-run] [--yes]` is dry-run by default, dedupes by text, unions tags, and collects every entry error before writing anything.
- **Panel: two panes.** 规则 (scope switch, tag chips, per-row `Edit / Save as template / Remove`, and a "From template" multi-select picker) and 模板 (create/edit body+tags, delete, apply into a scope, export to file, import with a dry-run preview). Both panes refresh from a single response.
- **HTTP API grows an `op` dispatch** (`rule.update`, `rule.setTags`, `rule.saveAsTemplate`, `rule.addFromTemplates`, `template.create|update|delete|export|import`) while `POST { raw, scope }` keeps working unchanged for older panels; `GET` now also returns `templates`.
- **Rule ids accept a unique prefix.** `remove`/`edit`/`enable`/`disable`/`tag`/`untag`/`save` take the abbreviated 8-char id that `list` prints; an ambiguous prefix reports `ambiguous` with the candidates instead of guessing.
- **Fixes.** `/baize-rules clear project` cleared the **session** scope instead of project (`clear` only branched on `global`), and `export` omitted the project section. Both are corrected.
- **Review fixes** (all found by auditing the feature before release):
  - The panel **silently dropped** session/project edits when it had no `sessionId`/cwd (the new-chat overlay renders the panel that way): the op answered `ok:true` and the rule showed up, then it was gone on the next fetch — nothing was persisted. The API now refuses that write with a 400 that explains it, and the panel disables the scopes it cannot store (session/project) with a hint, defaulting to global.
  - `tmpl add` reported an already-existing template as a command **error**, while the HTTP API treated the same call as success. Both paths now branch on an explicit `ok`/`changed` result instead of matching on message text; a failed template write no longer carries a `nextTemplates` side effect.
  - Template **import froze the mode** into the dry-run preview: toggling merge/replace after previewing used to apply something different from what was shown. Confirming now always applies exactly the previewed mode.
  - A failed template/rule edit no longer exits edit mode (it used to discard the typed text), and a failed import no longer dismisses the dry-run report.
  - A malformed JSON request body reported `empty raw`; it now reports `invalid JSON body`.
  - `template.update` can now **clear** tags (an explicit empty list replaces them; omitting tags still keeps them), a no-op write no longer bumps `updatedAt` or rewrites the file, and template ordering gained an `updatedAt` tie-break.
  - **Follow-up to the scope fix:** gating availability on the docs' `cwd` was wrong — the `conversation.view` slot's owner share carries only `inspect`/`onInspectDone` (verified in the shipped `dsh-client-ui-conversation` bundle), so `project` was empty even **inside** a conversation, the project scope got disabled everywhere, and the hint wrongly claimed "not attached to a session". Availability now keys off `sessionId` alone: the host resolves that session's cwd itself when storing project rules (`resolveProject`), which was verified end-to-end — a request with a real sessionId and no `project` wrote `projects/<cwd-slug>.json` successfully. Only a genuinely session-less panel is limited to global.
- Docs: README (EN + ZH) cover tags, templates, the new commands, `injectTags`, the template file location and the extended API; install examples bumped to 0.2.0.

## [0.1.6] - 2026-09-14
- Add the `dsh-plugin` npm keyword so the package surfaces in npm's on-site search; GitHub topics already carried it. Verified first that this keyword is *not* a directory-listing requirement — `@modusensus/dsh-mneme`, `deepseek-harness-wallet` and `dsh-better-sidebar` are all listed without it.
- Docs only, no runtime change: correct the release dates below to the actual npm publish times, and fix the 0.1.2 entry that claimed releases were published automatically by CI.

## [0.1.5] - 2026-09-13
- Client UI: fix the sidebar footer so plugin entries stack one per row instead of being laid out in a single nowrap flex strip. The shell's `.footerActions` row is unshrinkable, so a second full-width entry (Baize's trigger next to the wallet ring) overflowed the column and pushed the later button outside the sidebar. Two rules are injected: one pinning the shell strip by its CSS-Modules name fragment, and one class-name-independent `:has(> …)` fallback; both are guarded with `:not(.baize-rail)` so the collapsed 56px rail keeps its even row of circular icons. Either rule fails silently, falling back to the previous inline behaviour.
- README: add a prominent link to the Chinese README (`README.zh.md`) from the top of `README.md` (and vice versa).
- README: document uninstall, and a safe try-out path (`--dump-config`) that does not touch the running dsh; clarify `pm2 restart dsh`.

## [0.1.4] - 2026-09-07
- Add dsh-plugin.org `listed` badge to the README (EN + ZH).

## [0.1.3] - 2026-09-04
- Expand npm `keywords` (`deepseek-harness`, `agent-rules`, `system-reminder`, `developer`) and bump to v0.1.3.

## [0.1.2] - 2026-09-01
- Add a bilingual README: `README.md` (English, main) + `README.zh.md` (Chinese), and ship `README.zh.md` in the npm package (`files`).
- Wire publishing to a `v*` tag through GitHub Actions. **Correction (2026-09-14):** this never actually published anything — the `publish` job fails with `npm error code ENEEDAUTH` because the `NPM_TOKEN` secret is unset, so every release up to and including 0.1.5 was pushed by a local `npm publish`. The tag still provides a CI build+test gate.
- Bump to v0.1.2.

## [0.1.1] - 2026-08-31
- Link the package to GitHub: add `repository`, `homepage`, `bugs`, `author` and `keywords`.
- Rebuilt and republished to npm.

## [0.1.0] - 2026-08-31
- Initial release: inject user-set session/global **must-do / must-not** requirements at conversation start.
- `/baize-rules` command (`list|add|remove|edit|enable|disable|scope|clear|export`).
- Persistent `global`/`session`/`project` rule files under `$DSH_HOME/rules/`.
