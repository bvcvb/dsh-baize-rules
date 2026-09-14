# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

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
