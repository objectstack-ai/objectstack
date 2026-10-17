---
"@objectstack/spec": minor
"@objectstack/plugin-auth": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
"@objectstack/cloud-connection": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-storage": patch
---

feat(spec): the remaining `getSession` readers read `AuthSessionApi`'s declared result, and none reads a top-level `activeOrganizationId`

Clause-②: yes (widening)

- **`@objectstack/spec/contracts` — `AuthSessionApi.getSession`'s result gains three optional `user` members**, each declared for a named reader: `isPlatformAdmin` (`boolean`, the ADR-0068 D2 rung plugin-auth's `customSession` derives) and `role` (`string | null`, better-auth's `admin` plugin scalar), both read by `judgePlatformAdmin` in `@objectstack/plugin-auth`; and `name` (`string`), read by the runtime dispatcher's AI-route `req.user` resolver as the display name. Every member is optional, so every implementer and caller typechecks unchanged.
- **The readers read through the declared type instead of `any` or a cast** (types only, runtime behaviour unchanged): `judgePlatformAdmin` and the four platform-admin mounts in `@objectstack/plugin-auth` (better-auth's own session type now has to fit the declaration at those reads), the REST server's two session reads (`@objectstack/rest`), the dispatcher's posture read, `resolveSessionData` and both `HttpDispatcher` reads (`@objectstack/runtime`), the cloud-connection and install-local session reads (`@objectstack/cloud-connection`), the webhook redeliver door (`@objectstack/plugin-webhooks`), and the storage session bridge (`@objectstack/service-storage`).
- **Fix — the top-level `activeOrganizationId` fallback is removed** from the storage upload stamp (`@objectstack/service-storage`) and from install-local's `resolveActiveOrgId` (`@objectstack/cloud-connection`). The active organization is read from `session.activeOrganizationId` alone, where the contract declares it. No in-process producer answers a top-level `activeOrganizationId` (better-auth's read is `{ user, session }`), so for the shipped auth plugin nothing changes. An auth service that answered only the flattened shape now gets no organization: the upload is not stamped, and install-local reports no active organization. To fix it, answer the active organization on `session.activeOrganizationId`, as `AuthSessionApi` declares it.
