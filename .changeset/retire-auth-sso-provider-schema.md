---
'@objectstack/plugin-auth': minor
---

**BREAKING (public export removed):** `AUTH_SSO_PROVIDER_SCHEMA` no longer exists. It was an `ssoProvider` column mapping exported from `@objectstack/plugin-auth` (via `export * from './auth-schema-config.js'`) that nothing ever read — four repo-wide hits: its own declaration, two frozen CHANGELOG lines and one comment, measured against a positive control on a live sibling symbol in the same file, and corroborated by an org-wide code search that returned only this repo's own two files.

Unlike its scim sibling (removed the same way), this one was not inert by construction: `@better-auth/sso@1.7.1` genuinely accepts a schema option (`SSOOptions.schema.ssoProvider.{modelName,fields,additionalFields}`, honoured at runtime), and the mapping was still never handed to it — unused by choice (#10074, ruling A: the bridge stays at the adapter layer). Removed under ADR-0049 enforce-or-remove because it was a **second source of truth** for the same column names. The load-bearing one is the adapter layer — `AUTH_MODEL_TO_PROTOCOL` plus the mechanical camelCase-to-snake_case field resolution in `objectql-adapter.ts`, over the `sys_sso_provider` platform object that declares the columns — pinned by the dedicated sso/scim block in `better-auth-schema-parity.test.ts`. A dead copy is worse than none: nothing fails when it drifts from the live names, and the next reader cannot tell which of the two is authoritative.

A NOTE in its place keeps what outlives the constant: the `domainVerified` / ADR-0024 ② knowledge (the eighth field domain verification adds, its `domain_verified` column, and that the one-time `domainVerificationToken` is not a provider column), and the fact that the `sso()` schema option exists and is deliberately unused — so the absence reads as a choice, not as "sso accepts no schema option" (the stale claim #8224 swept).

Behaviour is unchanged. No SSO column name, platform object, adapter mapping or wire shape moves.

Breaking ships as `minor` per the launch-window convention (`scripts/check-changeset-no-major.mjs`).

<!-- adr-0087: not-required (no-migration-prescription) A dead public constant is deleted; nothing consumed it in this repo (measured on origin/main at 090f2302e with a positive control on a live symbol in the same file) or anywhere in the org (code search returned only this repo's own declaration and a comment), so no caller has code to rewrite. It is not a metadata surface: no Zod schema, no packages/spec declaration, no authorable key and no stored representation, so objectstack migrate meta has nothing to visit and there is no tombstone to mint. The column names it duplicated are unchanged and keep their real declaration on the sys_sso_provider platform object under the adapter's mechanical field rule; an external importer, if one exists, is told by the compiler at the import line, which is more precise than a ledger entry. Nothing to migrate, so no migration is prescribed. -->
