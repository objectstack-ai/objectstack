---
'@objectstack/metadata-core': patch
'@objectstack/runtime': patch
'@objectstack/rest': patch
---

REST `/meta` write doors now carry the caller's organization, so audit rows are no longer stamped environment-wide

`PUT /meta/:type/:name` (both arities), `DELETE /meta/:type/:name`,
`POST /meta/:type/:name/publish` and `POST /meta/:type/:name/rollback` passed no
organization, so every `sys_metadata_audit` row a REST-authored metadata write produced was
stamped `organization_id: null`. Composed with the scoped audit read shipped alongside it —
which returns own-org rows **plus** environment-wide ones, a limb that is required rather
than optional — that left every REST-authored audit row readable by every tenant, carrying
its `actor`, `note`, `lock_state` and `request_id`. The read side could not close this: the
rows were genuinely unscoped, so no filter could separate them.

The organization is taken from the execution context these doors already resolve, and is
threaded through `organizationIdForMetaWrite` — the same registry-derived predicate the
runtime `/metadata` dispatcher uses. Types the registry declares `allowOrgOverride: true`
(`view`, `dashboard`, `report`, `translation`, `email_template`) now scope both the overlay
row and its audit row to the caller's organization; every other type continues to write
environment-wide, because its write genuinely is environment-wide and the protocol refuses
an org-scoped write for it. `null` is now reserved for writes that really are
environment-wide.

Two behaviour changes ride along, both required for the fix to be usable rather than
separate improvements: `publish` and `rollback` resolve their row through the organization,
so scoping the save without scoping them would have broken the draft → publish loop; and
`GET /meta/:type/:name/published` is now organization-scoped (organization-first, then
environment-wide), without which it would answer 404 for an item the same caller had just
published through the same transport.

`organizationIdForMetaWrite` / `declaresOrgOverride` moved from `@objectstack/runtime` into
`@objectstack/metadata-core` so both doors share one implementation — `@objectstack/rest`
cannot import from `runtime`, which depends on it. Runtime behaviour is unchanged.
