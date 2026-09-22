# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [0.2.3] - 2026-09-22

### Changed
- **The panel API origin check is off by default now** (`apiOriginCheck`, introduced in 0.2.1 with `default true`). The check refuses every request that does not arrive from loopback, and a web UI behind a **reverse proxy** is precisely that case — the request arrives from the proxy's address, not from loopback. So the old default silently broke the panel for the ordinary proxied deployment: `/baize-rules.api` answered `403 requests are accepted from this machine only` while the rest of the UI kept working (0.2.0 and earlier had no check and were unaffected). The check itself is **unchanged and still available**: set `apiOriginCheck: true` to enforce same-machine/same-origin only — appropriate when the port is reachable by others and no proxy layer authenticates the callers. Left off (the default), authentication belongs to the transport (dsh's own token) and to the proxy.
- Tests split by that default: one case asserts a non-loopback, cross-origin caller is **accepted** without config, and the two refusal cases (foreign address, cross-site `Origin`) now mount with `apiOriginCheck: true`.
- Docs (`README.md`, `README.zh.md`, `cordis.patch.yml`) carry the new default, and the `403` row of the API failure table is marked as appearing **only** with the check switched on.

## [0.2.2] - 2026-09-20

### Added
- **The rules now stay present in long conversations.** A snapshot whose text never changes used to be published once, at the start of the session, and then never again. Two refresh rules sit on top of that:
  - **A fresh copy after a session lifecycle change.** `agent/session-start` (`startup` / `resume` / `clear` / `compact`) drops that session's injection record, so the next step publishes a fresh full copy into the conversation as it now stands. This closes the one gap that could lose the rules for good: a compacted or cleared session may no longer carry the earlier message, and nothing used to bring it back.
  - **A fresh copy every `refreshAfterSteps` steps.** Once the last published copy is that many steps old it is republished even when the rendered text is byte-identical (default **20**, `0` disables the periodic refresh), so the rules are never stranded at the very top of a long thread. A step counter that restarts after compaction counts as stale too. Because the message is published as a `snapshot`, the model still sees a single copy — the refresh only moves it back to where the conversation is now.
- `refreshAfterSteps` joins the documented plugin config (README EN + ZH and `cordis.patch.yml`).
- `test/refresh.spec.ts` (7 cases) covers the policy: unchanged text stays quiet, a custom threshold and the default 20 republish, `0` disables, restarted numbering republishes, `compact` / `resume` / `clear` each republish, and a rule edit still publishes immediately.

### Changed
- The per-session injection record now carries the step that produced the last publication (`{ digest, step }`) instead of only the digest — that step is what the staleness comparison measures. The record is still in-memory; the two refresh rules above are what make that acceptable.

## [0.2.1] - 2026-09-20

### Changed
- **BREAKING — the trailing scope form is removed.** A scope keyword is recognized **only before the verb** (`/baize-rules global add 用中文写注释`). A trailing scope word is now plain rule text: `/baize-rules add 部署前先跑测试 global` stores the body `部署前先跑测试 global` in the **default** scope, where 0.2.0 silently dropped the word `global` from the body and wrote the rule into the `global` scope. The form was removed rather than kept as an alias precisely because it could not be made unambiguous: `add`/`edit`/`from` take free text, so a keyword at the end is text by definition. This affects `add`/`remove`/`edit`/`enable`/`disable`/`from` — `from` also loses its positional scope argument, so `/baize-rules from <id> project` becomes `/baize-rules project from <id>`. The trailing `#tag` run of `tag`/`untag`/`save`/`tmpl` is **unchanged**.
- **`project` rules now actually reach the model.** They were previously stored, listed and editable but never injected. The pre-step view includes the project scope whenever the session declares a working directory, rendered under `Project requirements (this directory only):` with the real `project > session > global` precedence. The "experimental / reserved" wording is gone from the docs because the behaviour is real.
- **A corrupt rule file no longer breaks a step.** Reads degrade instead of throwing: a missing file is an empty scope, and a broken or hand-edited file is an empty scope plus a `problems` entry. Command output gains `⚠ …` lines, the panel shows the warning, and the step always completes. Writing still replaces the whole file.
- **Empty files are no longer produced.** Only scopes that actually changed are rewritten, and an empty scope with no file on disk is not created at all — this is what used to leave a 3-byte `[]` file under `$DSH_HOME/rules/sessions/` for every session. Leftovers from older versions are harmless and can be deleted by hand.
- **Config is stricter and wider.** `scope` now also accepts `project` (resolved against the session cwd), and both `scope` and `maxBytes` are **schema-required**: omitting either fails the plugin load with an explicit error instead of silently using an undefined default.
- **Panel:** each rule row shows its enabled/disabled state and toggles it in one click; `problems` from the response are rendered as warnings; new rules are created through the structured `rule.add` op (so a typed body is never re-parsed as a command line); a failed submission no longer clears the input.
- **Templates are documented as content copies.** Applying a template creates a new rule from its body + tags, so editing the template afterwards does not rewrite the rules already added, and editing a rule does not change its source template.
- The command name is `/baize-rules` everywhere; the `/rules` residue in source comments is gone.

### Added
- `list [scope]` narrows the listing to one scope (`/baize-rules list project`; `<scope> list` is equivalent). For verbs where the scope is an **argument** rather than a modifier, both orders now work: `clear <scope>` ≡ `<scope> clear` and `scope <scope>` ≡ `<scope> scope`.
- **Concurrent-write protection.** Every write carries the freshness token of the file it read; if the file changed in between, the write is refused — the command returns a conflict message asking for a retry and the HTTP API answers `409` — instead of silently overwriting the other edit.
- **HTTP API:** `GET`/`POST` responses now carry `problems`; two structured ops were added, `rule.add { scope, text }` and `rule.setEnabled { scope, ruleId, enabled }`; and a refused request now answers with an explicit status instead of an ambiguous body — `400` (refused request, with `text`), `403` (origin refused, below), `409` (concurrency conflict, reload and retry), `413` (body too large, below) and `500` (`{ error }`).
- **Panel API origin check** (`apiOriginCheck`, default `true`). The API answers only requests that come from this machine and, when the browser states an `Origin`, from the host's own origin (or a local `file://` page); anything else is refused with `403`. The check exists because the global rule file reaches every conversation's prompt, so reachability of the port must not be enough. Behind a reverse proxy or when the UI is reached from another host — where the request arrives from a non-loopback address or carries a foreign `Origin` — set `apiOriginCheck: false` and let the proxy layer authenticate.
- **POST body cap.** A request body is limited to **1 MiB**; a larger one is refused with `413`. The panel posts whole template libraries, so the limit is far above any legitimate payload and only rejects a mistake or an attempt to exhaust memory.
- **Accessibility:** tab `role`/`aria` state, modal-dialog semantics with focus management, and `aria-pressed` on the tag chips.
- **Tests:** a client-panel smoke test (`test/client.smoke.mjs`, also wired into `pnpm test` via `pnpm test:client`) that exercises the shipped `lib/client.js` bundle, and `pnpm check:exports` for the paths promised by `package.json` `exports`.

### Fixed
- A trailing scope keyword can no longer truncate a rule body or mis-target a write (the 0.2.0 bug this release breaks compatibility to fix).
- A corrupt store file can no longer fail a conversation step.
- Two panels (or a panel and a CLI command) editing the same file can no longer lose one edit silently.
- Per-session `[]` files are no longer created for sessions that never had a rule.

### Docs
- README (EN + ZH, kept section-for-section aligned) covers the scope-before-verb rule and the removal of the trailing form, project-scope injection and the `Project requirements (this directory only):` section, tolerant reads and `problems`, version-guarded writes, the stricter `Config`, the real file-write behaviour, a manual mount example for the profile's `cordis.patch.yml`, the panel's three entry points, the template content-copy semantics with a 4-step panel path, the full API failure table, the project file naming rule (`\ / : * ? " < > |` → `_`, all-illegal → `_`, no cwd → nothing written, API `400`), and a neutral "how this compares to `AGENTS.md`" table against the built-in `@deepseek-ai/dsh-agent-instructions`. Install examples bumped to 0.2.1.
- Publishing section now says where credentials come from (`~/.npmrc` or environment variables) and that the repository-root `.npmrc` is gitignored and must not be committed.
- `CONTRIBUTING.md`: `pnpm typecheck` (which CI runs), the bilingual README + CHANGELOG sync requirement, `src/api.ts` / `src/store.ts` added to the layering description, and the client smoke test.
- `SECURITY.md`: supported-version table (0.2.x is the supported line) and a response-time commitment alongside the existing private-disclosure guidance.

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
- Docs: add the panel and slash-command screenshots to both READMEs, and rewrite the Publishing section to state what actually ships — the tag-driven CI `publish` job fails without the `NPM_TOKEN` secret, so a local `npm publish --access public` is the step that publishes (commit `4317d1a`, which landed after this entry was written and is folded in here).

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
