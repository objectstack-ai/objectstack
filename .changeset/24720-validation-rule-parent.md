---
"@objectstack/lint": minor
---

fix(lint)!: `os validate`, `os build` and the object save door refuse a `validations[]` rule whose predicate reads `parent` (#24720)

Clause-②: no (narrowing: `os build` and the object save door refuse a `validations[]` rule whose `condition` or `when` — nested `then` / `otherwise` rules included — reads `parent`, which the runtime's rule evaluator does not bind)

A `validations[]` rule's predicates — a `script` or `cross_field` rule's `condition`, a `conditional` rule's `when`, and the same slots on the rules nested in its `then` / `otherwise` — are evaluated by the server against `record` and `previous` only. The master-detail header is bound as `parent` for a field's own `readonlyWhen` and `requiredWhen` alone, on an object with exactly one `master_detail`. A rule that read `parent`, such as `parent.status == 'paid'`, still passed `os validate`, because `parent` is a root the platform declares. At runtime the predicate faulted (`Unknown variable: parent`) and every write the rule judged was refused as unevaluable, the seed's own rows at boot included.

The build's expression rule (`validateStackExpressions`) now refuses such a predicate at `error`, located where the rule's other findings are (`object 'NAME' · validation 'RULE'`, `… when`, or the nested rule's label). The message names the slot, the rule and the root. The object save door runs the same pass, so its verdict is the build's finding: the same rule id (`expression-invalid`), location and message.

**BREAKING — what moves for consumers.**

- `os build`, `os validate` and `os lint` refuse a `validations[]` rule whose predicate reads `parent`. The verdict judges the rule as written, the way the rest of the expression rule does: a rule marked `active: false`, a rule whose `events` a stack never fires, and a `conditional` branch whose `when` is never true are refused too, although the server never reached their `parent` read. Those stacks built and wrote before this change.
- An object write in publish mode that carries such a rule answered 200. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that rule. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).

**Remedy.** To lock or require a field on the header's state, write the predicate on that field's own `readonlyWhen` or `requiredWhen`, where `parent` is bound. For any other check, read a column the detail object declares, and denormalise the header value you need onto the detail. Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- The runtime is unchanged: a `validations[]` rule still binds `record` and `previous` and no `parent`. If the runtime comes to bind `parent` there, this refusal is lifted in that same change.
- `parent` on a field's own `readonlyWhen` / `requiredWhen` is still accepted, as before, and so is a `record` column spelled like the root (`record.parent_code`).
- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- No example or package object in this repository authors `parent` in a `validations[]` rule: the stock showcase passes `os validate` before and after this change.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes: the expression rule already declared `object`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `os build` and at the object save door of a validations[] rule predicate that reads `parent`, a root the server's rule evaluator does not bind: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose rule is refused keeps loading until it is next saved, and the repair is the author's rewrite of the predicate onto a field's readonlyWhen / requiredWhen or onto a denormalised column, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
