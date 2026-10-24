---
'@objectstack/spec': patch
---

build(spec): every entry point shares one module graph, so a schema two entries reach ships once and is the same object through either

Clause-②: no
Metadata-protocol: none

`@objectstack/spec`'s JS outputs used to be one self-contained bundle per entry point. A consumer that imported several subpaths bundled one copy of every schema those subpaths share (`FieldSchema` was defined in 14 published `.mjs` files), and the same symbol reached through two subpaths was two different objects (`defineConnector` from `@objectstack/spec` was not `defineConnector` from `@objectstack/spec/integration`).

The build now emits shared chunks (`dist/chunk-<hash>.mjs` and `dist/chunk-<hash>.js`) that every entry imports. Measured on the console's own import list (256 value imports across 11 subpaths, esbuild `bundle` + `minify` + `platform: browser`, gzip level 9): 1,628.4 KB gzipped from the per-entry layout, 602.9 KB from this one. `FieldSchema` is defined once. Across the 119 export names two entries both expose, all 119 are now the same object under the `browser` condition, and 114 under Node, against 0 before. The 5 that still differ under Node are the metadata-collection normalizers reached through both `@objectstack/spec` and `@objectstack/spec/shared`: they sit on the path to the Node-only postgres URL grammar, so the Node outputs of the `browser`-conditioned entries keep their own copy of them.

What to do: nothing. The `exports` map and the type declarations are unchanged. Import only through the `exports` map: the chunk files are not entry points, and their names change from build to build.
