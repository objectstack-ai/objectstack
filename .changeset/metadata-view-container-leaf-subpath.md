---
'@objectstack/metadata': minor
'@objectstack/objectql': patch
---

feat(metadata): `deriveViewContainerObject` gets a leaf `/view-container` subpath, so objectql's lean ADR-0076 entry stops loading the manager, chokidar, glob and js-yaml for a six-line pure function

`packages/objectql/src/engine.ts` reached `deriveViewContainerObject` through
`@objectstack/metadata`'s ROOT entry. `core.ts` — the ADR-0076 lean entry —
re-exports `engine.ts`, so `@objectstack/objectql/core`'s module-init closure
inherited the whole root entry: `MetadataPlugin` -> `NodeMetadataManager` ->
`chokidar`, plus `glob`, `js-yaml` and `readdirp`.

The same file already carried the answer 79 lines above, at its
`@objectstack/metadata/errors` import: that leaf subpath exists "precisely so a
cross-package consumer gets the predicate without the manager, the loaders or
the YAML/filesystem machinery behind the root entry". This is that pattern,
taken a second time.

**Measured on the built artifacts, not asserted** — every module Node actually
evaluates when `@objectstack/objectql/core` is loaded in a fresh process,
recorded through a `module.registerHooks` load hook (ESM and CJS) plus
`require.cache`, byte sizes from `statSync`:

| `@objectstack/objectql/core` | modules | bytes |
|:---|---:|---:|
| before (ESM `dist/core.mjs`) | 190 | 12,348,424 |
| after (ESM `dist/core.mjs`) | 185 | 11,849,808 |
| **delta** | **-5** | **-498,616 (-486.9 KiB)** |
| before (CJS `dist/core.js`) | 188 | 12,654,238 |
| after (CJS `dist/core.js`) | 183 | 12,141,034 |
| **delta** | **-5** | **-513,204 (-501.2 KiB)** |

Six modules stop loading — `packages/metadata/dist/index.js` (237,747 B),
`js-yaml` (114,610 B), `glob` (82,749 B), `chokidar` (2 files, 54,220 B) and
`readdirp` (9,836 B) — and one 469-byte module takes their place. Marginal
module-init time for that root entry, measured on a warm lean closure, was
~22 ms (median of 7; 20.4-27.5 ms) out of ~630 ms.

⚠️ The figure the finding was argued on — "~3.6 KB to ~450 KB" — is right about
the delta and wrong about the baseline: the lean entry's closure was already
~11.5 MiB before this import existed, dominated by `@objectstack/spec`
(9,587,914 B) and `zod` (567,918 B), neither of which the metadata root entry
contributes. What the root import cost was ~487 KiB *on top of* that, not a
closure of 450 KB.

The derivation itself moves to `packages/metadata/src/view-container.ts`, a
module with **no imports at all**, and `view-container-expansion.ts` imports
and re-exports it, so `index.ts`'s root export and `plugin.ts` keep their
spelling and the symbol stays on the root entry — this subpath is an additional
door, not a relocation. A re-export shim onto `view-container-expansion.ts` was
tried first and rejected on measurement: esbuild tree-shakes the unused
`expandRuntimeViewContainer` but keeps its two `@objectstack/spec` import
statements, so that shim's own closure was 84 modules / 3,035 KiB. The real
leaf's is 1 module / 469 B.

`expandRuntimeViewContainer` is deliberately not exported from the new subpath:
`metadata-manager.ts` is its only caller, the root entry does not export it
either, and it is the half that carries the spec machinery.
