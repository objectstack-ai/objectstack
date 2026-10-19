---
'@objectstack/lint': minor
---

fix(lint)!: a validation rule that reads, through a reference, a field the reference's target does not declare is refused where it is written

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape or authorable spelling is added, removed or renamed. The validation-rule pass now refuses one condition shape it accepted before: a one-hop read of a field the reference's target does not declare, which the runtime never judged (the rule had no verdict and refused every write it judged). Nothing stored changes, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** (an authoring narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The validation-rule pass judges the field a rule's `condition` reads one hop through a reference against the target object's fields: the fields it declares, the system columns the platform adds to it, and `id`. It is the same check the field-formula pass makes for a formula. `os validate`, `os build` and the object save door (`PUT /api/v1/meta/object/:name`) run the same pass, under the existing `EXPRESSION_INVALID` rule. It covers a `script` or `cross_field` rule's `condition`, at the top level and inside a `conditional` rule's `then` / `otherwise`.

- FROM: `record.account.region == 'north'`, where `account` is a lookup to an object that declares no `region`, saved with a 200, and every write the rule judged was refused. TO: refused (`422 INVALID_METADATA` at the save door). The message names the field and the target: "unknown field `region` on `<target>`".
- `record.account.status == 'closed'`, where the target declares `status`, passes as before.
- A target the stack does not carry is not judged. At the save door the stack carries the live registry's objects in the written package's closure, so a target from a package it depends on is judged.
- A reference read more than one hop deep (`record.account.owner.email`) keeps its own refusal and is not judged a second time.

What to do. Read a field the target declares, or declare the field on the target object. Do not declare it on the object that carries the rule. At `os build` and `os validate` this pass does not see a target field that an `objectExtensions` entry contributes, while the save door judges the merged object.
