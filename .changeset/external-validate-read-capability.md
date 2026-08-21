---
"@objectstack/rest": patch
---

**Behaviour change (tightening) — `POST /datasources/:name/external/validate` now requires `manage_platform_settings`** (#10255, completing the #9901 federation-family gate). This was the one route of the external-datasource federation family still admitting **any authenticated caller**; it now requires the same capability as the family's two read routes. Maintainer ruling, 2026-08-20 (verbatim: 「同意你的意见。」, accepting option A on #10255).

**This is published SDK surface.** `datasources.external.validate` on `ObjectStackClient` and the CLI's `os datasource validate` reach exactly this route. An existing integration that presents a valid credential — a better-auth session or a `sys_api_key` — and does not hold `manage_platform_settings` was served before and is **refused now**: `403` with the standard catalog code `PERMISSION_DENIED` (ADR-0112), the message naming the missing capability so the caller knows which grant to request. The anonymous floor is unchanged: no identity is still `401 UNAUTHENTICATED`.

**Why the read capability.** `validateAll` drives the same live remote-schema introspection the family's gated read routes expose (`introspect` per datasource), and its report — schema diffs naming remote columns and types, driver error strings for unreachable remotes — is a read of the same federation surface. An unentitled caller refused at `GET /:name/external/tables` could previously still trigger live remote introspection through this route and read what it found. One family, one door-type: reads on `manage_platform_settings`, writes on `manage_metadata`.

**Migration.** Grant the calling credential's permission set `manage_platform_settings` — the same grant the family's read routes have required since #10254, so an integration already migrated for those is covered. The platform's `admin_full_access` set carries it; a purpose-built operator set is the case to check.
