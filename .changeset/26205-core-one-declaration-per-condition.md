---
'@objectstack/core': patch
---

fix(core): one declaration serves both module formats, so the export map hands each condition its own `types`

Clause-②: no
Metadata-protocol: none

`@objectstack/core` used to emit two separate declarations of every class, `dist/index.d.ts` and `dist/index.d.cts`, and its export map served the ESM-kind `index.d.ts` to both conditions, so a TypeScript consumer resolving `require` was told the package is ESM (attw `FalseESM` on `.` and `./logger`). Serving the `.d.cts` to `require` was not possible while the two files declared `ObjectKernel` twice: its `private plugins` member makes the two copies incompatible types for any program that reaches core through both resolution modes.

Core's declaration build now runs once, for the ESM format. `dist/index.d.ts` and `dist/logger.d.ts` carry the declarations, as before, and `dist/index.d.cts` and `dist/logger.d.cts` are one-line re-exports of them, so both conditions hand out the same classes. `exports` now gives types per condition, `{ import: { types, default }, require: { types, default } }`, on both subpaths. No subpath is added or removed, no JavaScript file changes, and the `dist` file names are unchanged.

A CommonJS consumer compiling with `module: node16` (or with TypeScript older than 6 under `nodenext`) used to get TS1479 at its own `import ... from '@objectstack/core'`. That diagnostic now sits inside core's `.d.cts`, where `skipLibCheck` silences it. Nothing else for a consumer to do.
