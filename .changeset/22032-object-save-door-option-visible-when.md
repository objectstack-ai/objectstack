---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: the object save door refuses a field option's `visibleWhen` that `os build` refuses (#22032)

Clause-②: no (narrowing)

`formulas.mdx` says the same `validateExpression` validator backs `os build` and metadata registration. For a field option's `visibleWhen` it did not, at the object save door. An option whose `visibleWhen` read a bare field, such as `amount > 1`, or called an unregistered function, such as `sqrt(record.amount) > 1`, was refused by `os build` at error, but `PUT /api/v1/meta/object/:name` answered 200 and stored it. The server's option check cannot evaluate such a predicate and lets the value through, so the gate it declares is never enforced.

The runtime publish gate now runs the build's option check on an object write. The build's expression rule (`validateStackExpressions`) was already on the object door for formula fields, validation-rule predicates and the field-rule slots. On an object write it now also judges each `fields[].options[].visibleWhen` the way the build does: as a predicate over `record` and `previous`, and with the build's refusal of a read through a reference field. The door's verdict is the build's finding: the same rule id (`expression-invalid`), location (`object 'NAME' · field 'FIELD' option 'VALUE' visibleWhen`), message and hint.

**BREAKING — what moves for consumers.**

- An object write in publish mode answered 200 for an option whose `visibleWhen` the shared validator refuses. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that option. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).
- The verdict is the one `os build`, `os validate` and `os lint` already gave: an unknown function, a field the object does not declare, a bare field reference (`amount` instead of `record.amount`), a syntax error, and a read through a reference field (`record.account.tier`, `previous.account.tier`). Its warnings now ride the save response as advisories.

**Remedy.** Fix the predicate: the message names the unknown function or field, the bare reference or the reference read, and the position, as `os build` already requires. Qualify field reads as `record.FIELD`, use one of the functions `introspectScope` lists, and compare a reference field as a value (`record.account != null`) rather than read through it. Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- `current_user` is still accepted in an option's `visibleWhen`, as the build accepts it: the option evaluator binds the acting user (ADR-0068 D1). A role gate such as `'org_admin' in current_user.positions`, or a grant check such as `current_user.can('OBJECT', 'edit')`, still saves. On a field's own `requiredWhen`, `readonlyWhen` or `visibleWhen` it is still refused, as before.
- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- The object's own action predicates (`actions[].visible`, `actions[].disabled`) are judged at this door through their own #22032 entry, its own crossing, not through this one.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: this repository ships 5 option predicates, all on `showcase_cascade` (four `record.country` cascades and one `current_user.positions` role gate), among the 118 objects it ships. They have 0 refusals and 0 advisories, at the build and at the door.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes: the expression rule already declared `object`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the object save door of a field option's visibleWhen predicate the published validator already refuses at `os build`: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose option predicate the validator refuses keeps loading until it is next saved, and the repair is the author's edit of the predicate, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
