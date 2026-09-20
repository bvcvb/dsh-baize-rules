# Contributing

Thanks for improving `dsh-baize-rules`!

## Before opening a pull request

Run the gates CI runs (`.github/workflows/ci.yml`):

```bash
pnpm build                # tsc -p tsconfig.build.json → lib/
pnpm typecheck            # tsc --noEmit — CI fails on a type error, so run it locally
pnpm test                 # vitest run, then the client-panel smoke test
pnpm check:exports        # every path promised by package.json `exports` really exists
node --check lib/client.js  # the panel bundle is hand-authored and outside tsc
```

CI additionally asserts `git diff --exit-code -- lib` right after the build: the committed
`lib/` must be exactly what `src/` compiles to, so run `pnpm build` and commit the result.

Handy narrower loops (both are already covered by the commands above):

```bash
pnpm test:client    # just the client smoke test (node test/client.smoke.mjs)
pnpm test:watch     # vitest in watch mode
```

`test/client.smoke.mjs` exercises the shipped `lib/client.js` panel bundle (the hand-written
client entry, not a `tsc` output), so run it after touching the panel.

## Keeping the docs honest

- Keep any description, link, or claim accurate to the code — e.g. a command or API
  you name must actually exist.
- **Both READMEs must stay in sync.** `README.md` (English) and `README.zh.md` (Chinese)
  are kept section-for-section aligned: the same headings in the same order, with the
  same facts on both sides. A change to one that is not mirrored in the other is an
  incomplete change.
- **Record the change in `CHANGELOG.md`** under a new version heading, in the existing
  style (Keep a Changelog groups such as `Changed` / `Added` / `Fixed` / `Docs`, newest
  first). A user-visible behaviour change belongs there, and a breaking one must say so
  explicitly.
- Bump the version, update the install examples in **both** READMEs, and add the CHANGELOG
  entry — then tag `vX.Y.Z` (see README §Publishing for what actually ships a version).

## Layering

Keep the pure, dependency-free logic separate from the thin dsh adapters:

- **Pure logic (testable without dsh):** `src/rules.ts` (model + rendering),
  `src/core.ts` (command parsing/decisions, template library ops),
  `src/store.ts` (rule/template file persistence — tolerant reads that surface
  `problems`, and version-guarded writes that refuse a lost race).
- **Thin dsh adapters:** `src/index.ts` (plugin `apply`, pre-step injection, mounting),
  `src/command.ts` (command wiring + persist + `⚠ …` warnings),
  `src/api.ts` (host HTTP API: origin check, body cap, `409` on a stale write).
- **Client:** `lib/client.js` is the hand-authored panel bundle — it is edited directly,
  not compiled from a `src/` file.

Behaviour questions belong in the pure layer; adapters should only translate between dsh
and that layer.
