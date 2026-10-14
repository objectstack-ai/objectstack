---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a save of a packaged item whose type allows no overlay answers `403 NOT_OVERRIDABLE` before any check that judges its body, on every kernel topology

Clause-②: no

- **What was wrong.** `PUT /api/v1/meta/:type/:name` refuses an in-place write onto an item a code package ships when the type has no per-organization overlay channel (`allowOrgOverride: false`, for example `object`, `permission`, `position`). An environment-scoped kernel answered that refusal before it judged the body. A host-config kernel (the CLI's assembler, the showcase's boot shape, `OS_MODE=off`) answered it only at the repository write, after every other check. So on that kernel a publish of a packaged object whose body the authoring gate refuses answered `422 INVALID_METADATA` with findings the author could not land through this door, and a body the spec parse refuses answered `422` in draft and publish mode. After fixing the findings, the author got the `403`.
- **What changes.** The package check now runs on every topology, at the position it already had on an environment kernel: after the code-only and organization-scope refusals, before the item lock and every check that reads the body or the store. The same request now gets the same refusal on both kernels: `403 NOT_OVERRIDABLE`, or `403 ITEM_LOCKED` when the save names the read-only package, with the same sentence. On a host-config kernel that sentence replaces the repository's "is not allowOrgOverride in the registry" text for these saves.
- **What does not change.** Every request refused before is still refused, and every request admitted before is still admitted. The repository refused the same writes on every topology, and it still does, for the doors that reach it without this check. An environment-local item, an item of a type that allows overlays, and a save with `OS_METADATA_WRITABLE` open for the type are judged by the same checks as before, and drafts are still not judged by the authoring gate.
