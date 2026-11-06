---
'@objectstack/runtime': patch
---

fix(runtime)!: `PATCH /api/v1/packages/:id/disable` refuses while an enabled package's validation rule reads a field the package adds through `objectExtensions`

Clause-②: no (narrowing) — the package disable door refuses (`409` `PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`) a disable it accepted before: one that would withhold a field a validation rule of any enabled package reads. Nothing is widened: no export, request shape, response member or authorable key is added, and the code is the one #30724 registered.
Metadata-protocol: none
Skills-docs: updated here — `content/docs/api/metadata-api.mdx` (the disable door's entry), `content/docs/deployment/marketplace-handbook.mdx` (the Enable-and-disable step and the Disabling-a-module list) and `content/docs/api/error-catalog.mdx` (the code's 409 entry) name the refusal; `skills/**` teaches no package disable door (grep for `packages/:id/disable`, `disableable`, `WRITABLE_PACKAGE_REQUIRED`: none), so no skill or eval moves.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes: a disable request that would have left an object refusing every write is refused before anything changes, with an error code already registered. Nothing at rest records that answer, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the package disable door (`@objectstack/runtime`, `domains/packages.ts`), for one case only.

- **Before.** A disabled package's `objectExtensions` fields are withheld from the object they extend. When a validation rule of another package that stayed enabled read one of those fields, the disable answered `200`, and every write to that object was then refused (`400 VALIDATION_FAILED`, naming the rule) for as long as the package stayed off.
- **Now.** The door refuses such a disable with `409` and `error.code` `PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`, after the read-only check and before anything changes: the package row, the served objects and the environment's stored disable state stay as they were. The message names every reading rule as `package · object · rule (reads FIELD)`, one or several. The refusal carries no other `error.details`.
- **Who is scanned.** Any enabled package, declared dependent or not (no `manifest.dependencies` entry is read), an app's `<base>.custom` pair (where tenant-written rules live) included, at every severity. A rule reads a field when its predicate names it on the rule's own object or one hop through a reference field of that object (`record.account.FIELD`), or when it is a `state_machine` / `format` / `json_schema` rule on that field.
- **Unchanged.** A formula over the field is no reason to refuse (it answers `null`), nor is a rule switched off (`active: false`) or a rule of a package that is itself disabled. Every other disable answers as before.
- **Who moves.** An administrator or client disabling such a package: a refusal naming the rules, instead of a disable that left the object refusing every write.

**The remedy.** Switch off or change each named rule first, or disable the package that owns it, then disable the package; or keep the package enabled.
