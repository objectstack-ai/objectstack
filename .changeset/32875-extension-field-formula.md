---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint): a computed field an `objectExtensions` entry adds is judged by the field-formula pass, against the extended object as served, as a declared field is

Clause-②: no (narrowing) — `os build`, `os validate` and `os lint` refuse a stack whose extension adds a computed field with an `expression` the pass refuses on a declared field. No exported type or signature changes. Measured first-party: 0 (`examples/**` and `packages/apps/**` carry one extension entry, three plain fields on `showcase_account`; `packages/plugins/plugin-auth` one, a `secret` field; HotCRM none), so no first-party stack moves.
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-data` teaches `defineObjectExtension({ extend, fields })` and the computed-field rules on a field without saying an extension field is exempt; the build now gives an extension field the verdict those rules already describe.

<!-- adr-0087: registered object-extension-computed-field-expression-judged -->

**BREAKING** accept-set narrowing of `os build` / `os validate` / `os lint` (`validateStackExpressions`).

The engine plans and stores a field an `objectExtensions` entry adds exactly as a declared one, but the field-formula pass walked only the fields the stack's objects declare. An extension field's `expression` was never judged: not its grammar, its functions or its field reads, and not the stored-expression warnings (`stored-expression-cross-record-input`, `stored-expression-volatile-input`).

- Each field of each extension entry the shared fold keeps (one entry per package per target) is judged by the same pass as a declared field, located at the entry: `object 'hr_leave_request' · objectExtensions[0] · field 'hours' expression`.
- A target the stack declares is judged as the registry serves it: a field read resolves against the object's own fields and every field an extension adds, and the stored-expression member reads the served fields and the injected columns. Measured: `hours: { type: 'number', expression: 'record.days * record.employee.daily_hours' }` added to `hr_leave_request` through an extension gives one `stored-expression-cross-record-input` warning (0 before), exactly as the same field declared on the object does.
- A target the stack does not declare (another package's object, a platform `sys_*` object) has no served body to read: the expression is judged on what does not depend on the object's fields (grammar, registered functions, a bare or unbound reference), and no field read is refused as unknown.
- Unchanged: a declared field's findings and their order; the object save door, whose snapshot carries no extension (the walk is fenced on an object write); the runtime `object_extension` write door, which this rule does not run on.

Migration: fix each refused `expression` the way you would on a declared field of the same object: read `record.FIELD` for a field the object serves, call only registered functions, and make a stored field that reads another record, the clock or the acting user a `formula` field (or keep the stored copy current with a flow).
