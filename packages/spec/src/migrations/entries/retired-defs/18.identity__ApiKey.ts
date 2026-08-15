// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8715 — identity/identity.zod.ts `ApiKeySchema`, retired whole (ADR-0049
// enforce-or-remove; maintainer ruling 2026-08-15, disposition B: delete).
// The schema documented better-auth's `apiKey` PLUGIN shape — a plugin this
// platform does not load: `start`, `lastRefetchAt`, `enabled` (the real
// column is `revoked`, opposite polarity), the four per-key rate-limit keys
// (no such surface exists anywhere), `permissions`, `metadata`, camelCase
// `organizationId`. Zero consumers in framework, cloud or objectui outside
// its own unit test; the live `sys_api_key` table is declared by
// `@objectstack/platform-objects` (`identity/sys-api-key.object.ts`) and
// read by `core/src/security/api-key.ts` / `runtime/src/domains/keys.ts` in
// snake_case, never through this schema — one table had two declarations and
// the published one was fiction. Route 3: no carrier key, no authored
// document for a D2 conversion to rewrite, so no tombstone and no
// conversion — this table plus the D3 semantic entry
// `identity-api-key-schema-retired` ARE the declaration.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8586 / PR #8702 precedent).
export const entry = 'identity/ApiKey';
