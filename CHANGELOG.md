# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [0.1.4] - 2026-09-03
- Add dsh-plugin.org `listed` badge to the README (EN + ZH).

## [0.1.3] - 2026-09-03
- Expand npm `keywords` (`deepseek-harness`, `agent-rules`, `system-reminder`, `developer`) and bump to v0.1.3.

## [0.1.2] - 2026-09-01
- Add a bilingual README: `README.md` (English, main) + `README.zh.md` (Chinese), and ship `README.zh.md` in the npm package (`files`).
- Make publishing single-source: releases are driven by a `v*` tag through GitHub Actions (no manual local `npm publish`).
- Bump to v0.1.2.

## [0.1.1] - 2026-08-31
- Link the package to GitHub: add `repository`, `homepage`, `bugs`, `author` and `keywords`.
- Rebuilt and republished to npm.

## [0.1.0] - 2026-08-31
- Initial release: inject user-set session/global **must-do / must-not** requirements at conversation start.
- `/baize-rules` command (`list|add|remove|edit|enable|disable|scope|clear|export`).
- Persistent `global`/`session`/`project` rule files under `$DSH_HOME/rules/`.
