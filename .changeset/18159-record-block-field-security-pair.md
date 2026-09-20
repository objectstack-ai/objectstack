---
"@objectstack/spec": minor
---

`record:details`, `record:highlights` and `record:related_list` accept `enforceFieldSecurity` and `redactFields` — the two field-security keys objectui's detail renderers have been honouring on documents this contract refused by name (#18159).

Clause-②: yes (widening)

All three blocks are `strictObject`s that declared neither key, while `@object-ui/plugin-detail` reads both off each of the three. An author who wrote either was refused at publish, and the same document was honoured on the raw-node path — a contract that could not be satisfied by writing it down. Both keys are declared here, optional, with no schema default, so an absent key stays absent rather than becoming "the author asked for off".

- **`enforceFieldSecurity`** (boolean) folds the block's field list — the detail body's fields and sections, the highlight chips, the related list's `columns` — through the caller's field-read permissions before rendering, so a field the permission set denies leaves no empty row behind.
- **`redactFields`** (string array) drops the names it lists outright. On `record:related_list` it also reaches the columns the list derives for itself when none are authored.
- **The claim is held to what the render path does.** Both are presentation filters, applied in the browser after the record is fetched: the values are in the page either way, so neither is a data-access control and neither is the object's `publicSharing.redactFields`, which removes them server-side. Each `describe()` says that in the text an author reads, rather than leaving the key names to imply it (Prime Directive #10). The gates that do keep a value from a caller are the field's own `requiredPermissions` / `maskingRule` (ADR-0066 D3) and the permission set.
- **⚠️ On `record:details`, `redactFields` neighbours the already-declared `hideFields`** and on a well-formed field list the two remove the same rows: `hideFields` is the dedupe channel the renderer also writes to (live `record:highlights` registrations, the page-title field), `redactFields` is the author's deliberate omission and the arm that participates in the renderer's fail-closed fold. Converging them is a contract question this change did not open.
- **⚠️ The third key the same three renderers read — `requiredPermissions` — is deliberately NOT declared**, and stays refused by name on all three. Its read is `perms.can(objectName, name)`, whose second parameter is this package's own closed `PermissionActionSchema` enum, not the ADR-0066 capability set that name means on `action`, `app`, `field` and `bulkAction`. Measured on both shipped permission providers: under the backend-backed one an unmapped name falls through to the object's `allowRead` bit, so a capability the caller does not hold passes for every reader; under the role-based one the same name is denied for everyone whenever the object carries a permission config. Declaring it would mint the ADR-0049 fail-open access gate retired from `app.areas[].requiredPermissions` in 17.0.0. The exit is a ruling, not an omission.

⚠️ **Not measured here**: the runtime behaviour of either declared key in a browser, and whether any authored document anywhere writes them. "The schema refused it" is not "nobody writes it"; only the first is measured.
