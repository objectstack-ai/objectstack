---
"@objectstack/runtime": patch
"@objectstack/cli": patch
---

fix(runtime,cli): `projectRoot` reaches the metadata repository; stop compiling tests into the CLI's dist (#4065)

Two defects behind the last of #4065's stray `.objectstack/` directories — the
one under `packages/cli/`. Neither is cosmetic.

**1. `projectRoot` only got half the stack.** `createStandaloneStack`'s
`projectRoot` is documented as scoping a boot's on-disk state to the project
folder "so different examples / apps don't share a single database by accident",
and it did redirect the default sqlite database. But it was never passed to
`MetadataPlugin`, whose `FileSystemRepository` kept rooting at `process.cwd()`.
So one "project root" meant two different directories: a boot pointed at project
A wrote `A/.objectstack/data/` and `<cwd>/.objectstack/metadata/`. It now
forwards `rootDir`, and `bootSchemaStack` accepts a `projectRoot` to pass down
(defaulting to `process.cwd()`, which is right for every real `os migrate` — the
CLI runs from the project directory). The two migrate integration suites, which
build a fixture project in a tempdir, now scope their boots to it.

**2. The CLI compiled its own tests into `dist/` — and vitest ran them.**
`tsconfig.build.json` included all of `src` with no exclude, so every
`src/**/*.test.ts` was emitted as `dist/**/*.test.js`. Two consequences:

- `files: ["dist"]` **published** them.
- This package has no vitest config, so `vitest run` collected the compiled
  copies alongside the sources: **81 test files and 849 tests where the sources
  hold 58 and 581**. Every `src/` test also ran as a stale `dist/` twin built
  from whatever the source said at the last build.

That is not just noise — it silently defeats edits. A fix to a source test
appeared not to work, because the run was still executing the pre-fix compiled
duplicate; that is exactly how the `.objectstack` residue survived a correct
fix long enough to look like a different bug. It also means a source test could
be edited to pass while its stale twin kept asserting the old behaviour, and
neither would be obviously wrong. Test files are now excluded from the build.

No other package is affected: the rest build with `tsup`, which emits only
declared entry points. Verified by scanning every `packages/*/dist` for
`*.test.js` — the CLI was the only hit.
