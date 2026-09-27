---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint)!: a field-level predicate that reads through a reference field is refused at `objectstack validate` (#20078)

<!-- adr-0087: registered field-predicate-reference-traversal-refused -->

**BREAKING** in the accept-set sense — a stack that validates today can fail tomorrow. Landing in
the launch window as `minor` (`major` is refused by `check-changeset-no-major`); breaking-ness is
carried by this banner, the `!` above and the ADR-0087 registration.

Clause-②: no

A field `requiredWhen` / `readonlyWhen`, or a select option's `visibleWhen`, that reads THROUGH a
`lookup` / `master_detail` / `user` / `tree` field — `record.account.tier` — passed `objectstack
validate`, `build` and `lint`. It cannot work: the field level is never hydrated, so the reference
holds the related record's bare id and every read through it faults. At run time a traversing
`requiredWhen` refuses every write that reaches it, a traversing `readonlyWhen` refuses every
update that writes its field (ADR-0137 D2), and a traversing option predicate is never enforced
(option visibility is fail-open). The authoring pass now refuses all three as
`expression-invalid`, naming the slot, the reference path and the related column, before deploy.

What to write instead — the refusal says the same:

- **A `record.<reference>.<column>` read** — express the check as a `validations[]` rule of
  `type: 'script'`. Its `condition` is the one predicate the server reads one hop through a
  reference, and it states the FAILURE: for `requiredWhen: P` on `po_number`,
  `P && (record.po_number == null || record.po_number == '')`; for `readonlyWhen: P` on
  `discount`, `P && record.discount != previous.discount` with `events: ['update']`; for an
  option gated by `P`, that option picked while `P` does not hold (the option is then offered to
  everyone and refused on save). Or read a column the object itself declares.
- **A `previous.<reference>.<column>` or `parent.<reference>.<column>` read** — no seam hydrates
  either root, a validation rule included, so read a column the bound record declares.

Unchanged: the same traversal inside a `validations[]` `script` rule is accepted, as is reading
the reference itself (`record.account == 'acc_1'`, `record.account != null`), an object-valued
field that is not a reference (`record.ship_to.city`), and an option gated on `current_user`
(including `current_user.can(…)`). The runtime is untouched, and an object already stored in
`sys_metadata` is not re-validated by this. `@objectstack/spec` states the rule on the three
slots' `.describe()` text and registers the ADR-0087 semantic entry
`field-predicate-reference-traversal-refused`.
