---
'@objectstack/spec': patch
---

docs(spec): the comment on the stack's never-residual collections names the readers that exist

Clause-②: no
Metadata-protocol: none

A comment-only change in `src/stack.zod.ts`, which the package ships as source. The comment on the set of top-level collections a `packages[]` stack never treats as residual (`data`, `datasets`, `jobs`) said `AppPlugin` consumes top-level `datasets` straight off the bundle. It does not: a package body's `datasets` are read by the engine's `registerApp` (`@objectstack/objectql`), and no boot reader takes a top-level `datasets` item that no body declares. The comment now says so. No schema, type, export or behaviour changes; nothing to migrate.
