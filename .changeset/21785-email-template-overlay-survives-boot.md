---
"@objectstack/plugin-email": patch
---

An email template edited through `PUT /api/v1/meta/email_template/:name` (the Studio editor's door) now keeps the admin's wording in `sys_email_template` across a restart. Before, the boot sweep wrote the package wording back over the sending row while `GET /meta` kept serving the admin's, so mail went out with the package wording after every boot.

Clause-②: no

- The cause: on a deployment with a Default Organization the admin's save is an org-scoped overlay, and boot hydration keeps org-scoped overlays out of the registry the sweep read. An env-wide overlay was already kept.
- `bootstrapDeclaredEmailTemplates` now projects the effective template, the layered list `protocol.getMetaItems` serves, read in `tenancy.defaultOrgId()`'s organization. That is the Default Organization under the `single` posture, and env-wide (no organization) whenever a walled posture is requested. A host without a `protocol` service reads the registry as before.
- A failed effective read projects nothing for that boot, so the rows keep their last projection. It does not fall back to the package wording.
- Seed-not-clobber is unchanged. A row an admin created (`managed_by: 'admin'`) or edited through the data API (`customized: true`) is still never overwritten.
- `bootstrapDeclaredEmailTemplates` takes an optional fifth argument, `{ protocol, tenancy }` (`EffectiveEmailTemplateSources`, now exported). Existing callers are unaffected.
