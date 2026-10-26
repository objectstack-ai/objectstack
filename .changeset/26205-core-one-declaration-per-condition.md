---
'@objectstack/core': patch
---

fix(core): one declaration serves both module formats, so the export map hands each condition its own `types`

Clause-②: no
Metadata-protocol: none

`@objectstack/core` used to emit two separate declarations of every class, `dist/index.d.ts` and `dist/index.d.cts`, and its export map served the ESM-kind `index.d.ts` to both conditions, so a TypeScript consumer resolving `require` was told the package is ESM (attw `FalseESM` on `.` and `./logger`). Serving the `.d.cts` to `require` was not possible while the two files declared `ObjectKernel` twice: its `private plugins` member makes the two copies incompatible types for any program that reaches core through both resolution modes.

Core's declaration build now runs once, for the CommonJS format. `dist/index.d.cts` and `dist/logger.d.cts` carry the declarations, and `dist/index.d.ts` and `dist/logger.d.ts` are one-line re-exports of them, so both conditions hand out the same classes. `exports` now gives types per condition, `{ import: { types, default }, require: { types, default } }`, on both subpaths. No subpath is added or removed, no JavaScript file changes, and the `dist` file names are unchanged. Nothing for a consumer to do.
