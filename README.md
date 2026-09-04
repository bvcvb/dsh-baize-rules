# dsh-baize-rules

![npm version](https://img.shields.io/npm/v/dsh-baize-rules)
![license](https://img.shields.io/npm/l/dsh-baize-rules)

`dsh-baize-rules` (Baize) is a [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) plugin that injects **user-set, durable "must-do / must-not" requirements** — plain-text rules — into the model at conversation start as a *sourced* `user/message`.

The name comes from **Baize (白泽)** — a mythical beast said to "understand the nature of all creatures, know the names of all things, and comprehend the principles of everything." It carries the behavioral baseline that the user sets for the model.

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

---

## Installation

> dsh plugins are distributed from npm and installed into a profile via `dsh plugin`.

```bash
# Install from npm into the web profile (use the actual published version)
dsh plugin --profile web add dsh-baize-rules@0.1.3
pm2 restart dsh          # Reload when dsh is managed by pm2
dsh --profile web
```

Peer dependencies (`@deepseek-ai/*`, `react`, etc.) are provided by the dsh profile; if any are missing, pnpm resolves them against `peerDependencies` in the profile directory.

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
```

---

## Commands

All subcommands live under **`/baize-rules`**; no argument is equivalent to `list`.

```
/baize-rules [list|add <text>|remove <id>|edit <id> <text>|enable|disable <id>|scope <global|session|project>|clear <scope>|export]
```

| Subcommand | Syntax | Purpose |
|---|---|---|
| **list** | `/baize-rules list` | List the merged active rules (`Project`/`Global`/`Session` sections; shows `No active rules.` when empty) |
| **add** | `/baize-rules add <text>` | Append a rule to the target scope (default `scope`); the text *is* the rule |
| **remove** | `/baize-rules remove <id>` | Delete a rule by its **full id** |
| **edit** | `/baize-rules edit <id> <text>` | Change a rule's text |
| **enable** | `/baize-rules enable <id>` | Enable a disabled rule |
| **disable** | `/baize-rules disable <id>` | Disable a rule (keep but not active) |
| **scope** | `/baize-rules scope <global\|session\|project>` | Switch the default scope for subsequent commands (persistent for the current process) |
| **clear** | `/baize-rules clear <global\|session\|project>` | Clear all rules in a scope |
| **export** | `/baize-rules export` | Export `{ global, session }` as JSON |

**Argument details**

- `<text>`: the rule body, may contain spaces. Whether it's "must-do" or "must-not" is expressed by the body's language; there is no marker.
- `<id>`: a stable rule id (`crypto.randomUUID`). `list` shows the **first 8 characters** as an abbreviated id for readability;
  when running `remove`/`edit`/`enable`/`disable` please provide the **full id** (you can view it via `list` or `export`).

### Scope syntax

`add/remove/edit/enable/disable` support an **explicit scope**, two equivalent ways:

- **Prefix**: `/baize-rules global add Write in Chinese.`
- **Suffix**: `/baize-rules add Write in Chinese. global` (only when the scope is the **last token**)

> Only `add/remove/edit/enable/disable` recognize a trailing scope keyword as a scope modifier;
> the argument to `scope`/`clear` is itself a scope and won't be swallowed. So a scope word inside the body
> won't be misparsed (e.g. `/baize-rules add Writeglobal`).

When no scope is given, the default set by `/baize-rules scope` is used (initially from `Config.scope`, usually `session`).

---

## Injection behavior (how the model context changes)

- **Conversation-start baseline**: at the start of a session, `agent/pre-step` (`prepend:true`) inserts the active rules as a `user/message` into the request, framed as `<system-reminder>` with `source.kind='plugin'`, `plugin='baize-rules'`, `form='snapshot'`.
- **Specificity wins**: `project > session > global`; when the budget is tight the broader `global` rules are trimmed first.
- **Deduplication**: a SHA-1 digest is computed over the rendered text; unchanged rules aren't re-injected. `injectAtEveryStep:true` forces a refresh on each step.
- **Escape**: a literal `</system-reminder>` in a body is escaped via `escapeReminder`.
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

> `$DSH_HOME` is resolved by `@deepseek-ai/dsh-home-paths`, default `~/.dsh`.
> Reads/writes go through `ctx.fs` (`resolve/stat/readText/writeText`, auto-creating directories on write); missing is tolerated, corrupt files fail loudly.
> **Note**: `project` rules can be managed via the command and are persisted, but **the current pre-step injection view only includes `global` + `session`**, so `project` rules are not yet part of the model context (reserved/experimental).

---

## Client panel (optional)

The published package also exposes a dsh web client panel (`lib/client.js`; see the `./client` entry in `package.json` `exports`), talking to the same store/core as the command through the host HTTP API `/baize-rules.api`:

- `GET /baize-rules.api?sessionId=…&project=…` → `{ global, session, project }`
- `POST /baize-rules.api`, body `{ sessionId, raw, scope }` → `{ ok, text, view }`

---

## Module structure

```
src/rules.ts      Pure logic: Rule model + render/<system-reminder>/byte budget(specificity-wins)/digest/escapeReminder
src/core.ts       Pure logic: parseCommand/runCommand/scope resolution/CRUD (zero deps, unit-testable without dsh)
src/store.ts      Pure logic: global/session/project rule file persistence (ctx.fs + dshHomePath)
src/command.ts    Thin dsh adapter: feed view/defaultScope → core, persist nextView/defaultScope
src/index.ts      apply: agent/pre-step injection + /baize-rules command registration + API mount (inject: agents/commands/fs/webServer/sessions)
src/api.ts        Host HTTP API: GET/POST /baize-rules.api (for the front-end panel)
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

Releases are **single-source**: bump the version, push a `v*` tag, and GitHub Actions publishes to npm. **Don't run `npm publish` locally** — doing so alongside a tag would conflict, since a version can't be published twice.

```bash
# 1. Bump the version: update `version` in package.json + the install example in both READMEs
# 2. Verify locally
pnpm build && pnpm test
# 3. Commit and push the tag to trigger the CI publish job
git add -A && git commit -m "release: vX.Y.Z"
git tag vX.Y.Z && git push origin main --tags
```

The `publish` job in `.github/workflows/ci.yml` runs on `v*` tags, needs the `test` job to pass, and uses the GitHub `NPM_TOKEN` secret.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
