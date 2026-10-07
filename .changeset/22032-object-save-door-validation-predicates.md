---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: the object save door refuses a validation rule whose predicate `os build` refuses (#22032)

Clause-②: no (narrowing)

`formulas.mdx` says the same `validateExpression` validator backs `os build` and metadata registration. For a validation rule's predicates it did not, at the object save door. A rule whose `condition` called an unregistered function, such as `sqrt(record.amount) > 1`, or read a bare field, such as `amount > 1`, was refused by `os build` at error, but `PUT /api/v1/meta/object/:name` answered 200 and stored it. The rule then faulted on every write it judged.

The runtime publish gate now runs the build's validation-rule check on an object write. The build's expression rule (`validateStackExpressions`) was already on the object door for formula fields alone. On an object write it now also runs its validation-rule pass: each `validations[]` rule's `condition` and a `conditional` rule's `when`, plus the null-guard check over every predicate the rule carries, its nested `then` and `otherwise` rules included. The door's verdict is the build's finding: the same rule id (`expression-invalid`), location (`object 'NAME' · validation 'RULE'`, or `… validation rule 'RULE' then → 'CHILD'` for a nested predicate), message and hint.

**BREAKING — what moves for consumers.**

- An object write in publish mode answered 200 for a validation rule whose predicate the shared validator refuses. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that rule. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).
- The verdict is the one `os build`, `os validate` and `os lint` already gave: an unknown function, a field the object does not declare, a bare field reference (`amount` instead of `record.amount`), a syntax error, an ordering or arithmetic operator applied to a nullable field with no `!= null` guard (`has()` is no guard here), and the other errors in the build's validation-rule check. Its warnings now ride the save response as advisories.

**Remedy.** Fix the predicate: the message names the unknown function or field, or the unguarded operand, and the position, as `os build` already requires. Qualify field reads as `record.FIELD`, use one of the functions `introspectScope` lists, and guard a nullable operand with `record.FIELD != null && …`. Saving it as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved. At that save the gate judges it, because the differential compares the write against the stored universe without its own stored row.
- The other expressions an object carries are still not judged at this door: the field-rule slots (`requiredWhen`, `readonlyWhen`, `conditionalRequired`, `visibleWhen`), option `visibleWhen`, and the object's own action predicates. `os build` judges them, and the door does not, as before.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: every validation rule this repository ships has 0 refusals and 0 advisories, at the build and at the door. That is 21 rules carrying 13 predicates on 10 objects: examples 11 predicates on 7 objects, and the platform objects 2 on 3 (one rule on `sys_user` carries no predicate).
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes: the expression rule already declared `object`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the object save door of a validation-rule predicate the published validator already refuses at `os build`: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose rule predicate the validator refuses keeps loading until it is next saved, and the repair is the author's edit of the predicate, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
