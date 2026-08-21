---
"@objectstack/rest": patch
---

**Behaviour change (tightening) — a capability is now required on the external-datasource federation family** (`/api/v1/datasources/:name/external/*`, #9901). These routes previously admitted **any authenticated caller**; four of the five now also require a platform capability. Maintainer ruling, 2026-08-20 (verbatim: 「其他接受你的建议。」).

**This is published SDK surface.** `datasources.external.*` on `ObjectStackClient` reaches exactly these routes, and the CLI's `datasource` commands go through them. An existing integration that presents a valid credential — a better-auth session or a `sys_api_key` — and holds neither capability was served before and is **refused now**. Nothing about the credential itself changed; what changed is what the credential must carry.

| route | SDK call | now requires |
| --- | --- | --- |
| `GET /:name/external/tables` | `datasources.external.listTables` | `manage_platform_settings` |
| `POST /:name/external/tables/:remote/draft` | `datasources.external.draft` | `manage_platform_settings` |
| `POST /:name/external/tables/:remote/import` | `datasources.external.import` | `manage_metadata` |
| `POST /:name/external/refresh-catalog` | `datasources.external.refreshCatalog` | `manage_metadata` |
| `POST /:name/external/validate` | `datasources.external.validate` | *(unchanged — authentication only)* |

A refusal is **`403` with the standard catalog code `PERMISSION_DENIED`** (ADR-0112; deliberately not the grandfathered `FORBIDDEN` synonym), and the message names the missing capability so the caller knows which grant to request. The anonymous floor is unchanged: no identity is still `401 UNAUTHENTICATED`.

**Why these two capabilities.** The first two routes are the declared twins of `GET /:name/remote-tables` and `POST /:name/object-draft` on the datasource-admin spelling, which has required `manage_platform_settings` since #9593 — the same operation was reachable through two mounted routes with two different admission policies, so an agent or integration refused at one spelling was served at the other. The two write routes have no twin and create live metadata (the import mounts a runtime-origin federated object; the refresh rewrites the cached catalog snapshot), so they take `manage_metadata`, this package's existing gate for metadata creation.

**Migration.** Grant the caller's permission set the capability its routes need — `manage_platform_settings` for remote-schema introspection, `manage_metadata` for import/refresh. The platform's `admin_full_access` set already carries both, so admin-credentialed integrations are unaffected; a purpose-built operator set is the case to check.
