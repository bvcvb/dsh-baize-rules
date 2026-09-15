# dsh-baize-rules

**[English](README.md) | [简体中文](README.zh.md)**　—　中文说明见 [README.zh.md](README.zh.md)。

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/bvcvb/dsh-baize-rules)
![npm version](https://img.shields.io/npm/v/dsh-baize-rules)
![license](https://img.shields.io/npm/l/dsh-baize-rules)

`dsh-baize-rules` (Baize) is a [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) plugin that injects **user-set, durable "must-do / must-not" requirements** — plain-text rules — into the model at conversation start as a *sourced* `user/message`.

The name comes from **Baize (白泽)** — a mythical beast said to "understand the nature of all creatures, know the names of all things, and comprehend the principles of everything." It carries the behavioral baseline that the user sets for the model.

![The rules panel in the dsh web UI — scope tabs (conversation / project / global), the add-rule field, and the active rules listed](https://raw.githubusercontent.com/bvcvb/dsh-baize-rules/HEAD/assets/001-rules-panel.png)

- Rules are **plain text** with no `must`/`mustNot` markers — whether something is "must-do" or "must-not" is expressed by the language of the body itself (e.g. `Write comments in Chinese.` = must, `Do not delete the tests.` = must-not).
- Injection happens at the **start of a conversation**: the currently active rules are injected into the model request as a **persistent** `user/message`, wrapped in a `<system-reminder>` frame, with `source.kind='plugin'` and `plugin='baize-rules'`.
- **No rules → no injection**; if the byte budget shrinks such that all rules are cut, it returns `undefined` and never injects an empty reminder shell.

---

## Features

| Feature | Description |
|---|---|
| **Three scopes** | `global` (all sessions) / `session` (current session) / `project` (per session working directory, **experimental**) |
| **Persistence** | Everything is written to `$DSH_HOME` (default `~/.dsh`); survives across sessions and restarts |
| **Specificity wins** | Render order `project > session > global`; when the byte budget is tight, the more specific rules are preserved first |
| **Deduplication** | Suppresses duplicate injection by SHA-1 digest of the rendered text; optional `injectAtEveryStep` forces a refresh on every step |
| **Escape protection** | Literal `</system-reminder>` in rule bodies is escaped so user text can't close the plugin's frame |
| **Command + API share the same source** | The `/baize-rules` command and the front-end panel use the same store/core, so there is always a single source of truth |
| **Tags** | Rules can carry free-text tags (`flow`, `#frontend`) that the panel filters by. Panel-only by default — tags cost no model-context budget (`injectTags` opts in) |
| **Template library** | Save frequently used rules as templates (body + tags) and apply them to any scope; export/import the library as JSON to move it across machines and sessions |

---

## Installation

> dsh plugins are distributed from npm and installed into a profile via `dsh plugin`.

```bash
# Install from npm into the web profile (use the actual published version)
dsh plugin --profile web add dsh-baize-rules@0.2.0
pm2 restart dsh          # Reload when dsh is managed by pm2
dsh --profile web
```

Peer dependencies (`@deepseek-ai/*`, `react`, etc.) are provided by the dsh profile; if any are missing, pnpm resolves them against `peerDependencies` in the profile directory.

### Uninstall

```bash
# Remove the plugin from the profile
dsh plugin --profile web remove dsh-baize-rules
pm2 restart dsh          # Reload when dsh is managed by pm2
```

If the entry lingers in the profile's `dsh.profile.bundles`, delete that line from
`$DSH_HOME/profiles/web/package.json` and restart dsh again. Your rule files under
`$DSH_HOME/rules/` are not touched — delete them by hand if you want a clean slate.

### Try it without touching your running setup

Install into a **separate profile** so your currently running dsh stays unchanged:

```bash
dsh plugin --profile smoke add dsh-baize-rules@0.2.0
dsh --profile smoke --dump-config   # read & compose the config only — does not boot dsh
```

`--dump-config` only composes and prints the tree; it does not start a server, so it is safe to run
alongside your live dsh. To actually try the plugin in that profile, run `dsh --profile smoke`.

> Note on `pm2 restart dsh`: it reloads the profile you are running. Install/remove only changes the
> profile on disk — nothing takes effect until the next boot (or that restart).

### Local development (link)

If you haven't published yet, or want to pick up source changes live, use this directory as a link dependency:

```jsonc
// /home/abc/.dsh/profiles/web/package.json
"dependencies": {
  "dsh-baize-rules": "link:/home/abc/work/plugin/dsh-baize-rules"
}
```

Then run `pnpm install` in the profile directory and add `dsh-baize-rules` to `dsh.profile.bundles`.

---

## Quick Start

```bash
/baize-rules                                   # Same as /baize-rules list: show the currently active rules
/baize-rules add Write comments in Chinese.    # Add to the default scope (usually session)
/baize-rules global add Don't delete or rewrite existing tests.  # Explicitly add to global
/baize-rules list                              # Show global + session (with abbreviated id / disabled markers)
/baize-rules edit <id> Use pnpm to build only. # Edit a rule's text
/baize-rules disable <id>                      # Disable one (keep it, don't delete)
/baize-rules enable <id>                       # Re-enable
/baize-rules scope global                      # Subsequent commands default to global
/baize-rules clear session                     # Clear the current session's rules
/baize-rules export                            # Export all rules as JSON
# --- tags ---
/baize-rules tag <id> flow release              # Tag a rule (idempotent, deduped)
/baize-rules untag <id> release                 # Drop one tag
# --- templates ---
/baize-rules save <id>                          # Store this rule as a template
/baize-rules tmpl list                          # List the template library (optionally by tag)
/baize-rules from <id|#tag>                     # Add rules from templates (#tag = all with that tag)
/baize-rules tmpl export ./templates.json       # Export the library to a JSON file
/baize-rules tmpl import ./templates.json --yes # Import (dry run by default; --yes writes)
```

---

## Commands

All subcommands live under **`/baize-rules`**; no argument is equivalent to `list`.

```
/baize-rules [list|add <text>|remove <id>|edit <id> <text>|enable|disable <id>|tag|untag <id> <tag…>|save <id> [#tag…]|from <id|#tag> [scope]|tmpl <list|add|edit|rm|export|import>|scope <global|session|project>|clear <scope>|export]
```

![`/baize-rules` in the slash-command menu, described as "查看/增删改 会话或全局的 必须/禁止 要求"](https://raw.githubusercontent.com/bvcvb/dsh-baize-rules/HEAD/assets/002-command.png)

| Subcommand | Syntax | Purpose |
|---|---|---|
| **list** | `/baize-rules list` | List the merged active rules (`Project`/`Global`/`Session` sections; shows `No active rules.` when empty) |
| **add** | `/baize-rules add <text>` | Append a rule to the target scope (default `scope`); the text *is* the rule |
| **remove** | `/baize-rules remove <id>` | Delete a rule (id or **unique prefix**) |
| **edit** | `/baize-rules edit <id> <text>` | Change a rule's text |
| **enable** | `/baize-rules enable <id>` | Enable a disabled rule |
| **disable** | `/baize-rules disable <id>` | Disable a rule (keep but not active) |
| **tag** | `/baize-rules tag <id> <tag…>` | Append tags to a rule (idempotent, deduped, case-insensitive) |
| **untag** | `/baize-rules untag <id> <tag…>` | Remove the named tags |
| **save** | `/baize-rules save <id> [#tag…]` | Store the rule as a template; merges tags if a same-text template exists |
| **from** | `/baize-rules from <id\|#tag> [scope]` | Add rules from templates; `#tag` adds **every** template carrying that tag |
| **tmpl** | `/baize-rules tmpl <subcommand>` | Template library management (below) |
| **scope** | `/baize-rules scope <global\|session\|project>` | Switch the default scope for subsequent commands (persistent for the current process) |
| **clear** | `/baize-rules clear <global\|session\|project>` | Clear all rules in a scope |
| **export** | `/baize-rules export` | Export `{ global, session, project }` as JSON |

**`tmpl` subcommands**

| Subcommand | Syntax | Purpose |
|---|---|---|
| **list** | `/baize-rules tmpl list [tag]` | List templates (abbreviated id, tags, use count), optionally filtered by tag |
| **add** | `/baize-rules tmpl add <text> [#tag…]` | Create a template |
| **edit** | `/baize-rules tmpl edit <id> [<text>] [#tag…]` | Change body and/or tags; omit `<text>` to retag only |
| **rm** | `/baize-rules tmpl rm <id>` | Delete a template |
| **export** | `/baize-rules tmpl export [<file>]` | Export the library (prints JSON when no path is given) |
| **import** | `/baize-rules tmpl import <file> [--merge\|--replace] [--dry-run] [--yes]` | Import a library (**dry run by default**; only `--yes` writes) |

**Argument details**

- `<text>`: the rule body, may contain spaces. Whether it's "must-do" or "must-not" is expressed by the body's language; there is no marker.
- `<id>`: a stable rule id (`crypto.randomUUID`). `list` shows the **first 8 characters** as an abbreviated id for readability;
  `remove`/`edit`/`enable`/`disable`/`tag`/`untag`/`save` all accept the **full id or a unique prefix**.
  An ambiguous prefix reports `ambiguous` and lists the candidates — it never guesses. Same for `tmpl rm`/`tmpl edit`.
- `<tag…>`: free-text tags, space separated, `#` prefix optional (`#flow` ≡ `flow`). At most **8 tags** per item,
  **24 characters** each; dedupe and filtering are **case-insensitive**, while the stored spelling is what you first typed.
- `from` duplicate guard: a rule whose text already exists in the target scope is skipped
  (`Skipped N duplicate(s)`), so re-adding from a template never piles up duplicates. A template that is
  actually applied gets its **use count +1**.

### Scope syntax

`add/remove/edit/enable/disable/from` support an **explicit scope**, two equivalent ways:

- **Prefix**: `/baize-rules global add Write in Chinese.`
- **Suffix**: `/baize-rules add Write in Chinese. global` (only when the scope is the **last token**)

> Only `add/remove/edit/enable/disable/from` recognize a trailing scope keyword as a scope modifier;
> the argument to `scope`/`clear` is itself a scope and won't be swallowed. So a scope word inside the body
> won't be misparsed (e.g. `/baize-rules add Writeglobal`).
>
> Verbs that take free tag text (`tag`/`untag`/`save`) support the **prefix form only**:
> `/baize-rules global tag <id> frontend`. That way a tag literally named `project`/`global`/`session`
> is never swallowed as a scope.

When no scope is given, the default set by `/baize-rules scope` is used (initially from `Config.scope`, usually `session`).

---

## Injection behavior (how the model context changes)

- **Conversation-start baseline**: at the start of a session, `agent/pre-step` (`prepend:true`) inserts the active rules as a `user/message` into the request, framed as `<system-reminder>` with `source.kind='plugin'`, `plugin='baize-rules'`, `form='snapshot'`.
- **Specificity wins**: `project > session > global`; when the budget is tight the broader `global` rules are trimmed first.
- **Deduplication**: a SHA-1 digest is computed over the rendered text; unchanged rules aren't re-injected. `injectAtEveryStep:true` forces a refresh on each step.
- **Escape**: a literal `</system-reminder>` in a body is escaped via `escapeReminder`.
- **Tags stay out of the model**: tags are **not** injected by default (`injectTags:false`), so tagging or retagging a rule neither changes the text the model sees nor triggers a redundant re-injection.
- **Empty / fully trimmed**: when there are no rules, or the budget cuts all of them, it returns `undefined` (i.e. does not inject that message).

### What the model actually sees

```markdown
<system-reminder>
The following user requirements apply to every step of this conversation. Obey them.
More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

Session requirements (this conversation only):
- Always test the plugin in isolation before deploying.

Global requirements:
- Write comments in Chinese.
- Do not delete or rewrite existing tests.
</system-reminder>
```

---

## Configuration (`Config`)

On startup the plugin validates `Config` with `@deepseek-ai/schemastery`; an invalid value makes the plugin fail to load.

| Config | Default | Description |
|---|---|---|
| `scope` | — (required) | Default scope, used when `/baize-rules` doesn't specify one; only `global`/`session` allowed |
| `maxBytes` | — (required) | Byte cap visible to the model; trimmed with specificity-wins when exceeded |
| `globalRulesPath` | `$DSH_HOME/rules/global.json` | Override the global rules file path |
| `injectAtEveryStep` | `false` | Force re-render on every step (debugging); default only patches on change |
| `injectTags` | `false` | When `true`, render tags into the model context (`- [flow,release] body`). Off by default: tags are a human-facing classifier, and injecting them spends budget and adds noise |

### Mount metadata (`cordis.patch.yml`)

The published npm package ships `dsh.bundle.patch`, wired up automatically by dsh when you install `dsh-baize-rules@<version>`:
`cordis.patch.yml` inserts a single plugin line with default `scope: session` and `maxBytes: 8192`. To adjust the default scope / budget, change it there.

---

## Data location

| Scope | Storage | When written | Persistence |
|---|---|---|---|
| global | `$DSH_HOME/rules/global.json` | On any command / API submission | ✅ across restarts |
| session | `$DSH_HOME/rules/sessions/<sessionId>.json` | Same | ✅ across restarts |
| project | `$DSH_HOME/rules/projects/<slug>.json` (slug from the session cwd) | Same | ✅ across restarts |
| templates | `$DSH_HOME/rules/templates.json` (global, not bound to any scope) | On template create/update/delete, import, or an apply that bumps the use count | ✅ across restarts |

> `$DSH_HOME` is resolved by `@deepseek-ai/dsh-home-paths`, default `~/.dsh`.
> Reads/writes go through `ctx.fs` (`resolve/stat/readText/writeText`, auto-creating directories on write); missing is tolerated, corrupt files fail loudly.
> **Note**: `project` rules can be managed via the command and are persisted, but **the current pre-step injection view only includes `global` + `session`**, so `project` rules are not yet part of the model context (reserved/experimental).

---

## Client panel (optional)

The published package also exposes a dsh web client panel (`lib/client.js`; see the `./client` entry in `package.json` `exports`), talking to the same store/core as the command through the host HTTP API `/baize-rules.api`.

The panel has two panes:

- **Rules**: scope switch, tag-chip filtering, per-row `Edit / Save as template / Remove`, and a **From template** picker for adding several templates at once.
- **Templates**: create/edit (body + tags)/delete, `Add to rules` (pick a scope and apply), `Export` (download JSON) and `Import` (choose a file → dry-run preview → confirm).

> **Scope availability**: the panel only offers session/project when it is **attached to a conversation** — opened from the new-chat page (no session yet) those two buttons are disabled with a hint and only global rules can be edited, which avoids the old behaviour where a rule looked added and then vanished.
>
> The project directory does **not** come from the panel: the host resolves the session's cwd itself (`resolveProject`), so project rules are available whenever you are in a conversation.

API:

- `GET /baize-rules.api?sessionId=…&project=…` → `{ global, session, project, templates }`
- `POST /baize-rules.api`, body `{ sessionId, project, op, … }` → `{ ok, text, view, templates }`
  - `op: 'raw'` (the default, and what older panels send) `{ raw, scope }` — one command line through the same core as `/baize-rules`
  - rules: `rule.update`, `rule.setTags`, `rule.saveAsTemplate`, `rule.addFromTemplates`
  - templates: `template.create`, `template.update`, `template.delete`, `template.export`, `template.import`
  - every op returns the post-change `view` and `templates`, so one call refreshes both panes

---

## Module structure

```
src/rules.ts      Pure logic: Rule/RuleTemplate models + tag normalization + render/<system-reminder>/byte budget(specificity-wins)/digest/escapeReminder
src/core.ts       Pure logic: parseCommand/runCommand/scope resolution/CRUD/template library ops/template import-export (zero deps, unit-testable without dsh)
src/store.ts      Pure logic: global/session/project rule files + templates.json persistence (ctx.fs + dshHomePath)
src/command.ts    Thin dsh adapter: feed view/templates/defaultScope → core, persist nextView/nextTemplates; file IO for tmpl export|import
src/index.ts      apply: agent/pre-step injection + /baize-rules command registration + API mount (inject: agents/commands/fs/webServer/sessions)
src/api.ts        Host HTTP API: GET + POST(op dispatch) /baize-rules.api (for the front-end panel)
src/invariant.ts  dsh-invariants contract companion (name/inject/apply)
scripts/dev-render.ts  Loop 0 demo
test/*.spec.ts    rules/core/composition tests
cordis.patch.yml  Mount metadata (inserts the baize-rules plugin line + default config)
```

**Public entry points** (see `package.json` `exports`): `.` (index), `./invariant`, `./client`, `./src/*`.

---

## Development & instant feedback

```bash
pnpm dev:render            # Print the <system-reminder> text the model will actually see (supports budget args)
pnpm test                  # Run unit + REAL-composition tests
pnpm test:watch            # Re-run on save
pnpm build                 # tsc -p tsconfig.build.json → lib/
pnpm typecheck             # npx tsc --noEmit
```

Change the pure functions in `src/rules.ts` (rendering) or `src/core.ts` (command decisions), then re-run `pnpm dev:render` to see the change — the **fastest feedback loop** (sub-second, without touching dsh).

---

## Publishing

Releases are driven from a `v*` tag, but **the publish itself is a local command**. The `publish` job in `.github/workflows/ci.yml` requires the `NPM_TOKEN` secret, which is not configured in this repository — so it fails with `npm error code ENEEDAUTH` on every tag (verified on v0.1.3, v0.1.4 and v0.1.5). Until that secret is set, `npm publish --access public` is the step that actually ships a version.

```bash
# 1. Bump the version: update `version` in package.json + the install example in both READMEs
# 2. Verify locally
pnpm build && pnpm typecheck && pnpm test
# 3. Commit, tag, and push both (the tag run still gives you the CI build+test gate)
git add -A && git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main && git push origin vX.Y.Z
# 4. Publish — this is the step that actually ships
npm publish --access public
```

The `publish` job runs on `v*` tags and needs the `test` job to pass; it will keep reporting failure until `NPM_TOKEN` is added to the repository secrets.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
