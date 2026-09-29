---
'@objectstack/spec': patch
---

Provenance comments in the rest of `src/` were re-anchored

The remaining comment and docblock lines in 21 files under `src/` (among
them `api/rest-server.zod.ts`, `system/i18n-resolver.ts`,
`system/operation-message.ts`, `shared/identifiers.zod.ts`, the root
`index.ts` and `data/driver/turso.zod.ts`) cited tracker numbers that no
longer resolve on GitHub. They now cite the commit in this repository's
history that decided the matter, or the ADR amendment that records the
ruling, and say in their own words what was decided. Comments only: no type,
schema, export, message-catalog string or runtime behaviour changes.
