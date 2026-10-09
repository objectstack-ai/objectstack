---
"@objectstack/formula": minor
---

fix(formula)!: the unknown-field check judges every spelling of a `record` / `previous` member, not only the dot, so `os build` and the object save door refuse `record['typo']`, `previous['typo']`, `record.?typo` and `record[?'typo']` (#22428)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A refusal at `os build` and at the object save door of an expression that names an undeclared field in a non-dot member spelling: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose expression is refused keeps loading until it is next saved, and the repair is the author's own (declare the field or fix the typo), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict and this diff adds none (not registered / already-registered); and no exported TypeScript declaration changes (not runtime-interface-only / type-surface-only). -->

**BREAKING**: an accept-set change, in both directions, of the `os build`, `os validate` and `os lint` verdicts and of the object save door, shipped as `minor` under the launch-window convention for accept-set narrowings. It narrows: an expression that names an undeclared field of its object in a non-dot member spelling (`record['FIELD']`, `record["FIELD"]`, `record.?FIELD`, `record[?'FIELD']`, or any of those on `previous`), or an undeclared leaf of a declared read attachment in such a spelling, is now refused where it was accepted. It widens: three shapes the dot-only regex misread as a member of the root, and refused as unknown fields, are now accepted, because none of them names a member. They are text inside a string literal (`record.name == 'record.typo'`), a root name after another root (`vars.record.x`), and a method call on the root itself (`record.size()`). No refusal code is added.

`validateExpression`'s field-existence pass judges each member an expression reads on `record` or `previous` against the object's fields, and refuses an undeclared one with the `unknown-field` code. It found those members with a regex over the dot spelling, so it judged `record.typo` and `has(record.typo)` and nothing else. `record['typo']`, `record["typo"]`, `previous['typo']`, `record.?typo` and `record[?'typo']` name the same column, and they reached the evaluator with no verdict at every slot the pass judges, among them a select option's `visibleWhen`, a field's `requiredWhen` and a validation rule's condition. There the expression faults on a key the record never carries, or reads a value that never exists.

The pass now reads members through the same AST member reader the relationship-traversal analysis is built on, so every spelling gets the dot spelling's verdict, did-you-mean included:

- `os build`, `os validate` and `os lint` refuse an expression that names an undeclared field of its object as `record['FIELD']`, `record["FIELD"]`, `record.?FIELD`, `record[?'FIELD']` or any of those on `previous`, at `error`, with the message they already give for `record.FIELD`.
- The object save door runs the same pass, so an object write in publish mode that carries such an expression is now refused with an `expression-invalid` issue located at the slot, the build's own finding.
- A declared read attachment's leaf (`ObjectSchema.attachedOnRead`) is judged in the same spellings: `record.viewer['can_actt']` and `record.viewer.?can_actt` are refused like `record.viewer.can_actt`. An earlier entry in this release says index access on a read attachment stays unjudged; that describes the check before this change.

**Remedy.** Declare the field on the object, or fix the typo to the field the message suggests. The spelling itself is not the defect: `record['status']`, `record.?status` and `record[?'status']` on a declared `status` are accepted, as before.

**Unchanged.**

- A computed key (`record[record.kind]`, `record[someVar]`) names no member before evaluation, so it is not judged.
- A method call on a member (`record.name.startsWith('A')`) still judges the member (`name`).
- Stored rows are not migrated or refused on read; an object stored before this change keeps loading until it is next saved, and that save is judged. Drafts are not gated.
- Measured before crossing: the stacks this repository ships give the same expression findings before and after the change. That covers `examples/app-todo`, `examples/app-crm`, both `examples/app-multi-package` sub-stacks, the objects, actions, flows, views and pages of `examples/app-showcase`, the 51 objects `@objectstack/platform-objects` exports, and `plugin-approvals`' `sys_approval_request`, whose eight action predicates read the leaves of its declared `viewer` read attachment and pass. No in-repo producer writes a non-dot spelling of an undeclared field.
- No public export or signature moves; only the doc comments of `ExprSchemaHint.fields` and `ExprSchemaHint.attachedOnRead` change. `analyzeRelationshipTraversals` answers exactly what it answered before: measured identical, set order included, on 4,528 analyses of the 2,264 `record` / `previous` expressions in this repository's TypeScript sources.
