---
'@objectstack/spec': patch
'@object-ui/plugin-form': patch
'@object-ui/app-shell': patch
---

perf(console): the first load no longer downloads spec schemas nobody reads, nor the form package for the record page

Clause-②: no
Metadata-protocol: none

The Console's first load (the chunks every page fetches before it can draw) is 97,612 bytes smaller gzipped: 1,899,348 across 123 chunks, from 1,996,960 across 124 on `main`.

- **`@objectstack/spec`.** The build now marks each module-scope initializer it cannot otherwise prove side-effect free (a spread of another schema's shape, an `.extend()` / `.pick()` chain, a table derived from a schema) as droppable, so a bundler that tree-shakes leaves out the ones an application never reads, together with the schema graphs they hold. Initializers that write into an object that already exists (`Object.assign(Existing, …)`, `Object.defineProperty(Existing, …)`) are never marked. Nothing changes for code that reads an export: every export that is used evaluates exactly as before. `TRANSLATABLE_METADATA_TYPES` is now built from a plain list of names instead of from the translator table, so reading it no longer keeps every metadata translator.
- **`@object-ui/plugin-form`.** `createKeepsField` is exported from the side-effect-free `@object-ui/plugin-form/core` too.
- **`@object-ui/app-shell`.** The record page's related-record actions read `createKeepsField` from `@object-ui/plugin-form/core`, so the form package is no longer part of the first load.

Nothing to migrate.
