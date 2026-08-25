---
'@objectstack/plugin-auth': minor
---

**BREAKING (public export removed):** `AUTH_SCIM_PROVIDER_SCHEMA` no longer exists. It was a `scimProvider` column mapping exported from `@objectstack/plugin-auth` (via `export * from './auth-schema-config.js'`) that nothing ever read — one repo-wide hit, its own declaration — and that nothing ever could: `@better-auth/scim` hardcodes its model and exposes no `schema` option, still true of the installed `@better-auth/scim@1.7.0-rc.1`, whose `SCIMOptions` declares no `schema`, `modelName` or `fields` member at all. Its sibling constants in the same file are genuinely passed to their plugins; this one had nowhere to go, by construction and by its own doc comment.

Removed under ADR-0049 enforce-or-remove, because it was a **second source of truth** for the same four column names. The load-bearing one is the adapter layer — `AUTH_MODEL_TO_PROTOCOL` plus the mechanical camelCase-to-snake_case field resolution in `objectql-adapter.ts`, over the `sys_scim_provider` platform object that declares the columns — and it is pinned by the dedicated sso/scim block in `better-auth-schema-parity.test.ts`. A dead copy is worse than none: nothing fails when it drifts from the live names, and the next reader cannot tell which of the two is authoritative. A comment in its place records why no such mapping exists and what owns the names instead, so it is not re-added.

Behaviour is unchanged. No SCIM column name, platform object, adapter mapping or wire shape moves.

Breaking ships as `minor` per the launch-window convention (`scripts/check-changeset-no-major.mjs`).

<!-- adr-0087: not-required (no-migration-prescription) A dead public constant is deleted; nothing consumed it in this repo, in the sibling repos or in the org (measured on origin/main and by org-wide code search, with a positive control on a live symbol in the same file), so no caller has code to rewrite. It is not a metadata surface: no Zod schema, no `packages/spec` declaration, no authorable key and no stored representation, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The column names it duplicated are unchanged and keep their real declaration on the `sys_scim_provider` platform object; an external importer, if one exists, is told by the compiler at the import line, which is more precise than a ledger entry. Nothing to migrate, so no migration is prescribed. -->
