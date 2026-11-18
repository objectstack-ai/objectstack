---
'@objectstack/objectql': minor
'@objectstack/lint': minor
'@objectstack/spec': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

fix(objectql)!: a field that is `required` and hidden by its own `visibleWhen` is required only when shown, so one admin setting no longer locks every record outside the condition

Clause-②: yes (narrowing + widening of the required write contract) — widened: an insert or update whose record a `required` field's own `visibleWhen` cleanly hides no longer needs that field, and an explicit null onto a row already shown and empty is accepted. Narrowed: a write that moves a record INTO the condition while that field is empty is refused; 18.5.0 accepted it.
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moved is when the engine enforces required on a field that also declares visibleWhen. The one-line fix for a refused write is in the body: fill the field in the same write that moves the record into the condition. -->

**BREAKING** for flows, bulk updates, imports and API PATCHes that move existing records into a `required` field's `visibleWhen` condition without filling the field. Such a write is now refused with `required` naming the field (on a bulk update, one such row refuses the batch). Fill the field in the same write. A field with `required` and no `visibleWhen` is unchanged.

**What changed (ADR-0113 D1 and D5, amended).** A field that declares `required: true` and its own `visibleWhen` used to be enforced on every save. In Studio an administrator can add one in a few clicks, and from then on every record that fails the condition refused every write, even an edit of an unrelated field, naming a field nobody could see. The engine now judges such a field from its visibility on the write:

- the predicate evaluates cleanly to anything but TRUE on the record (the stored row with the write over it), so FALSE, or `null` such as an unset boolean: the field is not required for that write, so a record outside the condition can be created and edited, and the form's clear-on-hide `null` is accepted;
- the predicate is true: the field is required by the same non-regression rule `requiredWhen` uses, against the prior record, which the engine now reads on update for objects with such a field;
- the predicate cannot be evaluated: it counts as shown, the field stays required exactly as before, and the server logs a warning naming the field and the fault.

The predicate is evaluated with the acting user bound as `current_user`, so a role-gated field is judged per writer; a system write with no user counts as shown. A `formula` field it reads is computed over the record first, as a read of that record computes it. A formula that faults for a reason a read shares (an empty operand) is judged on the `null` a read serves; a formula whose read value the write path cannot know (it reads through a reference, calls `label()`, calls `can` on a write that picks no permission-gated option and so resolves no permission map, reads `current_user` on a system write with no user, or reads such a formula at any depth) counts as shown; the system-write case is logged as `no-acting-user`, as the direct `current_user` spelling is. Only the field's own `visibleWhen` is read: a field group's `visibleWhen` and form-view predicates are not.

The refusal for such a field now comes from the rule pass rather than the record walk. A single-fault write gets the same `required` code and sentence; a write with several faults may name fewer of them in one `400`, or answer a dangling reference first, and a `beforeUpdate` hook now runs before the refusal and may fill the field.

**A formula-driven `visibleWhen` on the form.** The form computes the object's formula fields over the record being edited before it judges the field rules (the form-side recompute in `@object-ui/core`, `@object-ui/components` and `@object-ui/console`), so it shows such a field where the server requires it. A formula the form cannot compute (it reads through a reference, calls `label()` or `can()`, reads `os`, or reads the user when nobody is signed in) leaves the field shown and required, and the server decides on save.

**`@objectstack/lint`.** Three new warnings at `objectstack validate` and the object save door, on a `required` field with a `visibleWhen`: the predicate reads through a reference field (the server cannot evaluate it, so the field stays required everywhere); the predicate reads a `formula` field (with the counts-as-shown consequence when a formula it reads, at any depth, reads through a reference, calls `label()`, or calls `can`, which a write computes only when it picks a permission-gated option); and `storage.notNull: true` beside the pair (the column still refuses the null on a record outside the condition).

**`@object-ui/app-shell`.** Studio's field inspector shows the reference-read and formula-read warnings under the Visible-when editor of a required field.

**`@objectstack/spec`.** The `required` and `visibleWhen` descriptions on `FieldSchema` say how the two combine.
