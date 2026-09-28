---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): `DELETE /packages/:id` refuses an uninstall that names no organization before it touches the running registry (#20492)

Clause-②: no

A caller holding `manage_metadata` with no active organization — a member removed from an organization whose session still names it, or a caller who never selected one — sent `DELETE /api/v1/packages/:id` and was answered `400 TENANT_SCOPE_REQUIRED`. The dispatcher had already run the registry uninstall by then, so the package and every object it registers had left the running process for everyone it serves, while its stored rows still said it was installed. The state lasted until a restart re-seeded the registry.

The door now asks the persisted delete's organization-scope question first, from the same organization value it hands `deletePackage`, and only when a persisted delete will run. The same refusal (`400 TENANT_SCOPE_REQUIRED`) now arrives before anything changes: the package stays served, listed and registered, and its stored rows are untouched. The refusal's message names what an HTTP caller can do, which is to select an organization they are a member of and retry.

- **Unchanged:** a caller acting in an organization uninstalls exactly as before. A read-only package is still refused `422 WRITABLE_PACKAGE_REQUIRED` first. A host with no persisted delete (no `deletePackage` on its `protocol` service) still uninstalls from the registry alone, because there is no refusal to mirror there. The protocol keeps its own refusal as a second line.

- **`@objectstack/spec`:** `PROVENANCE_WAIVERS` (the error-code ledger) gains one entry: `@objectstack/runtime` stamps `TENANT_SCOPE_REQUIRED`, which stays registered under `@objectstack/metadata-protocol`. The door mirrors `deletePackage`'s refusal and does not emit a second vocabulary. The registered code union and `ErrorCode` are unchanged.
