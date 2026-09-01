# Contributing

Thanks for improving `dsh-baize-rules`!

- Run `pnpm test` and `pnpm build` before opening a pull request.
- Keep any description, link, or claim accurate to the code — e.g. a command or API
  you name must actually exist.
- Keep pure logic in `src/rules.ts` / `src/core.ts` (dependency-free, testable)
  and thin dsh adapters in `src/index.ts` / `src/command.ts`.
- Bump the version + update the README example version when releasing.
