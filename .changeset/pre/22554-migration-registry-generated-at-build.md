---
'@objectstack/spec': patch
---

The migration registry `src/migrations/registry.ts` is generated at build and no longer committed

Clause-②: no

`src/migrations/registry.ts` keeps its path and its exports, and the built package carries the same
`./migrations` entry as before. What changes is where the file comes from in this repository: it is
git-ignored and written whole by `gen:migration-registry` from two committed sources,
`src/migrations/registry.ts.template` (the hand-written step rationale, doc comments and table
skeleton) and `src/migrations/entries/` (one file per entry). The generator runs on `pnpm install`
(the package's new `prepare` script), as the first step of `build`, and before `typecheck`, `test`
and `test:repo`; its self-test runs inside every generation. `check:migration-registry` is removed,
since there is no committed copy left to compare.

For a contributor: add a migration entry as a file under `src/migrations/entries/` and edit any other
registry prose in `registry.ts.template`. An edit to `registry.ts` itself is never committed, and the
next install or build overwrites it.

Measured with `pnpm pack` against the previous build: 2,070 files each, and 4 differ. Those are
`package.json`'s `scripts` (`build`, `typecheck`, `test` and `test:repo` now start with the generation,
and `check:migration-registry` is gone; `pnpm pack` leaves `prepare` out of the packed manifest) and the
three `.build-input-hash` stamps that record the build's inputs. Every `dist` file, declaration, source
map and JSON Schema is byte-identical. No schema, type, export or runtime behaviour changes.
