---
'create-objectstack': patch
'@objectstack/cli': patch
'@objectstack/skills': patch
---

feat(scaffold): new projects run their tests in CI

Clause-②: no
Metadata-protocol: none

`npm create objectstack` projects now run `pnpm test` in `.github/workflows/ci.yml`, after `validate`, `lint` and `typecheck`, so the starter `note.test.ts` and every test you add run on each push.

`os init -t app` and `os init -t empty` now declare a `test` script (`vitest run`), list `vitest` in `devDependencies`, and ship one starter test (`app.test.ts`, `project.test.ts`) that reads the project's definition, so the same CI workflow passes on a project made either way. To test what the engine does with a record, add `@objectstack/verify` and boot the stack with `bootStack`; the `objectstack-project` skill shows how.

Existing projects are not changed. To take the CI step, add `- run: pnpm test` after `- run: pnpm typecheck` in your `ci.yml`; a project with no `test` script adds vitest and the script first.
