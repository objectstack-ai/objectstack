---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: a `conditional` validation rule's nested `then` / `otherwise` predicate meets the same expression verdict as the rule's own (#22042)

Clause-②: no (narrowing)

A `conditional` validation rule applies its `then` rule when its `when` holds and its `otherwise` rule when it does not, and the rule validator evaluates either branch as a rule of its own. `os build` judged a rule's own `condition` and `when` with the shared `validateExpression` validator, but reached the predicates inside `then` / `otherwise` with the null-guard check alone. So a nested `condition` that called an unregistered function, such as `sqrt(record.amount) > 1`, or read a bare field, such as `amont > 1`, passed `os build`. The object save door gives the build's verdict, so `PUT /api/v1/meta/object/:name` stored it, and the rule then refused every write it judged, because a validation rule that cannot be evaluated fails closed. The same predicate one level up was refused at both doors.

The build's expression rule (`validateStackExpressions`) now runs the same check on every predicate nested in a `conditional` rule, at every depth: each nested `condition`, and the `when` of a `conditional` nested inside a branch. A nested `condition` also gets the relationship-traversal checks, because ObjectQL hydrates a one-hop read there, as it does at the top level. A nested `when` does not, because the evaluator never hydrates a `when`, as at the top level. A nested finding is located at the nested rule, the location the null-guard check already gave it: `object 'OBJECT' · validation rule 'OUTER' then → 'INNER'`, with `when-predicate` appended for a nested `when`. A rule's own `condition` and `when` keep their findings and their location (`object 'OBJECT' · validation 'NAME'`) and are judged once.

**BREAKING — what moves for consumers.**

- `os build`, `os validate` and `os lint` now refuse, at `error`, a stack whose `conditional` validation rule carries a nested predicate the shared validator refuses. The validator's warnings on a nested predicate are now reported too, and at the save door they ride the response as advisories.
- An object write in publish mode that carries such a rule answered 200. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at the nested rule. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode) and the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`).
- The verdict is the one a rule's own `condition` already got: an unknown function, a field the object does not declare, a bare field reference (`amount` instead of `record.amount`), a syntax error, and, for a nested `condition`, a reference field read both through the relationship and as a value, or a read deeper than one hop.

**Remedy.** Fix the nested predicate the way the same predicate is fixed at the top level: the message names the unknown function or field and the position. Qualify field reads as `record.FIELD`, and use one of the functions `introspectScope` lists. Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- A rule's own `condition` and `when` are judged exactly as before, at the same location; the null-guard check over every predicate is unchanged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: this repository ships one `conditional` validation rule with nested predicates (`showcase_account.churn_reason_consistency`, two nested `condition`s), among 21 validation rules on the 118 objects it ships. Both have 0 refusals and 0 advisories, at the build and at the door.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes.

<!-- adr-0087: not-required (no-migration-prescription) a refusal, at os build and at the object save door, of a nested conditional validation predicate the published validator already refuses one level up: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose nested predicate the validator refuses keeps loading until it is next saved, and the repair is the author's edit of the predicate, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a validator verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
