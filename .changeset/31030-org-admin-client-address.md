---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(plugin-auth)!: an organization administrator reads the client address their access-policy list is judged by, and the console's notices over the retired `require_mfa` column are gone

Clause-②: yes (narrowing) — the published `@object-ui/i18n` packs (all eleven) drop the `console.organizationMfa.needsTwoFactor` and `.nowRequired` keys, which had no reader outside the removed notices. The widening half: a new served read, `GET /api/v1/auth/client-address`.
Metadata-protocol: none
Skills-docs: none — `skills/**` teaches no access-policy key, client-address read or console notice, and `content/docs/**` teaches no per-organization access policy; its `allowed_ip_ranges` section in `permissions/authentication.mdx` is the deployment's own list, whose platform-admin read it names correctly.

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/locales/en.ts#TranslationKeys) the key type of the console's own translation catalogue: no Zod schema, no spec declaration and no stored metadata reads it, so the compiler is the channel that reaches every caller -->

**An organization administrator sees their judged address before saving their organization's Allowed IP ranges.** A save of `access_policy.allowed_ip_ranges` that leaves out the saving request's own address is refused, and until now an organization administrator learned that address only from the refusal: `GET /api/v1/auth/admin/client-address` answers platform administrators alone. `GET /api/v1/auth/client-address` answers the same `{ clientAddress, trustProxy }`, the address the save check judges (`server.trustProxy` deciding whether forwarded headers count; `null` when the server cannot establish one), to the caller who may save that list: `setup.write` in their current organization, resolved the way the settings door resolves a saving caller. It is the caller's own address only; the query set is closed and empty (`400 VALIDATION_ERROR`), the answer is `Cache-Control: no-store`. Anonymous: `401 UNAUTHENTICATED`. A held session: `403` with its posture's code. A member without `setup.write`: `403 PERMISSION_DENIED`. An unreachable permission store: `503 SERVICE_UNAVAILABLE`. The console's Access policy page does not read it yet.

**The organization's IP list is judged on an objectstack mount's own session read too.** The routes the auth plugin mounts itself under `/api/v1/auth` (the platform-admin routes, the authorized-AI-assistant routes, session revoke, add member and the others that read the caller's session in process) now carry the address the deployment's IP gate established for the request to that read, so a session whose organization's Allowed IP ranges no longer admit it is ended there (`revoke_reason: ip_not_allowed`), as it already was on a session read through better-auth's own routes. Data requests outside the auth mount are judged by neither list, as before.

`sys_session.revoke_reason`'s published vocabulary (the field description) now names `ip_not_allowed`.

**BREAKING** (`@object-ui/i18n`, TypeScript only): the exported `TranslationKeys` (`typeof en`) loses the two `console.organizationMfa.*` keys, in all eleven packs (ar, de, en, es, fr, ja, ko, pt-BR, ru, zh-Hans, zh-Hant). A `t()` call that names one still compiles, since its key is a `string`, and reads the key back.

| Removed key | Replacement |
|:---|:---|
| `console.organizationMfa.needsTwoFactor` | none: `sys_organization.require_mfa` is read-only and off the organization form; the multi-factor requirement is the access policy's `mfa_required` level, whose save refusal names two-factor itself |
| `console.organizationMfa.nowRequired` | none: the same column can no longer be turned on, so no save turns the requirement on from the organization form |
