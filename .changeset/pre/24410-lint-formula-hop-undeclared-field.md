---
'@objectstack/lint': minor
---

fix(lint)!: a formula that reads, through a reference, a field the reference's target does not declare is refused where it is written

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape or authorable spelling is added, removed or renamed. The field-formula pass now refuses one expression shape it accepted before: a one-hop read of a field the reference's target does not declare, which the runtime never computed a value for (the formula read null on every row). Nothing stored changes, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** (an authoring narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The field-formula pass judges the field a formula reads one hop through a reference against the target object's fields: the fields it declares, the system columns the platform adds to it, and `id`. `os validate`, `os build` and the object save door (`PUT /api/v1/meta/object/:name`) run the same pass, under the existing `EXPRESSION_INVALID` rule.

- FROM: `record.book.name`, where `book` is a lookup to an object that declares no `name`, saved with a 200 and read `null` on every row. TO: refused (`422 INVALID_METADATA` at the save door). The message names the field and the target: "unknown field `name` on `<target>`".
- `record.book.title`, where the target declares `title`, passes as before.
- A target the stack does not carry is not judged. At the save door the stack carries the live registry's objects in the written package's closure, so a target from a package it depends on is judged.

What to do. Read a field the target declares, or declare the field on the target object. Do not declare it on the object that carries the formula. At `os build` and `os validate` this pass does not see a target field that an `objectExtensions` entry contributes, while the save door judges the merged object.
