---
---

chore(create-objectstack): drop the deprecated `@types/tar` devDependency

`tar` v7 ships its own TypeScript declarations (its `types` field points at
`dist/commonjs/index.d.ts`), so the standalone `@types/tar` package is
deprecated and redundant — it only emitted a `WARN deprecated @types/tar` line
on every `pnpm install`. `import * as tar from 'tar'` in `src/index.ts` now
resolves against tar's bundled types, and the package still builds and
type-checks clean.

devDependency-only change: it is not shipped to consumers and `dist/` is
byte-identical, so this releases nothing (empty changeset, no version bump —
`create-objectstack` is in the lockstep `fixed` group and must not drag the
whole stack up a patch for a no-op).
