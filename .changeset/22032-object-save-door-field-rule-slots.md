---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: the object save door refuses a field-rule slot whose predicate `os build` refuses (#22032)

Clause-②: no (narrowing)

`formulas.mdx` says the same `validateExpression` validator backs `os build` and metadata registration. For a field's rule slots it did not, at the object save door. A field whose `requiredWhen` read a bare field, such as `amount > 1`, or whose `visibleWhen` called an unregistered function, such as `sqrt(record.amount) > 1`, was refused by `os build` at error, but `PUT /api/v1/meta/object/:name` answered 200 and stored it.

The runtime publish gate now runs the build's field-rule-slot check on an object write. The build's expression rule (`validateStackExpressions`) was already on the object door for formula fields and validation-rule predicates. On an object write it now also judges each field's `requiredWhen`, `readonlyWhen` and `visibleWhen` the way the build does, with the build's three gates on them: the `parent` gate, the null-guard check over `requiredWhen`, and the refusal of a `requiredWhen` or `readonlyWhen` that reads through a reference field. The door's verdict is the build's finding: the same rule id (`expression-invalid`), location (`object 'NAME' · field 'FIELD' SLOT`), message and hint.

**BREAKING — what moves for consumers.**

- An object write in publish mode answered 200 for a field whose `requiredWhen`, `readonlyWhen` or `visibleWhen` the shared validator refuses. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that slot. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).
- The verdict is the one `os build`, `os validate` and `os lint` already gave: an unknown function, a field the object does not declare, a bare field reference (`amount` instead of `record.amount`), a syntax error, a root a field-level rule never binds (such as `current_user`), a `parent` read on an object that does not declare exactly one `master_detail` relationship, an ordering or arithmetic operator in `requiredWhen` applied to a nullable field with no `!= null` guard, and a `requiredWhen` or `readonlyWhen` that reads through a reference field (`record.account.tier`, or `parent.REF.FIELD`). Its warnings now ride the save response as advisories.
- A detail object's `requiredWhen` or `readonlyWhen` that reads through one of its master's reference fields (`parent.REF.FIELD`) is judged whenever the master is in the write's context, and that includes a save of the master itself. So a master save can answer 422 with an issue located at a stored detail's field. Fix the detail's predicate, then save the master again.

**Remedy.** Fix the predicate: the message names the unknown function or field, the unbound root, the unguarded operand or the reference read, and the position, as `os build` already requires. Qualify field reads as `record.FIELD`, use one of the functions `introspectScope` lists, guard a nullable operand in `requiredWhen` with `record.FIELD != null && …`, and move a check that must read through `record.REF` into a `validations[]` `script` rule, whose `condition` is read one hop through a reference; a read through `parent.REF` has no such surface, so read a column the master declares instead (denormalise the value onto it). Saving it as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved. At that save the gate judges it, because the differential compares the write against the stored universe without its own stored row.
- `conditionalRequired` is still refused at the save door's schema step, before this gate, as a key retired in protocol 17; `os build` judges it as a field-rule slot as before.
- Option `visibleWhen` and the object's own action predicates are still not judged at this door. `os build` judges them, and the door does not, as before.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: every field-rule slot this repository ships has 0 refusals and 0 advisories, at the build and at the door. That is 9 slots on 8 fields of 3 objects (examples: 8 on `showcase_invoice` and `showcase_invoice_line`, three of them `parent`-scoped; the platform: 1 on `sys_permission_set`), over the 118 objects this repository ships.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes: the expression rule already declared `object`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the object save door of a field-rule predicate the published validator already refuses at `os build`: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose field-rule predicate the validator refuses keeps loading until it is next saved, and the repair is the author's edit of the predicate, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
