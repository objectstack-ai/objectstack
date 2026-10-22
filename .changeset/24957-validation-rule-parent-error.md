---
"@objectstack/lint": minor
---

fix(lint)!: `os build` and the object save door refuse a `validations[]` rule whose predicate reads `parent` (#24957)

Clause-②: no (narrowing: `os build` and the object save door refuse a `validations[]` rule whose predicate reads `parent`, which the server's rule evaluator never binds)
Metadata-protocol: narrowed

A `validations[]` rule's predicates are a `script` or `cross_field` rule's `condition`, a `conditional` rule's `when`, and the same slots on the rules nested in its `then` / `otherwise`. The server evaluates them against `record` and `previous` only. The master-detail header is bound as `parent` for a field's own `readonlyWhen` and `requiredWhen` alone, on an object with exactly one `master_detail`. A rule that reads `parent`, such as `parent.status == 'paid'`, faults (`Unknown variable: parent`) on every write it judges, and the server refuses that write as unevaluable, the seed's own rows at boot included.

The build's expression rule (`validateStackExpressions`) reported such a predicate at `warning` (#24720). This entry supersedes that entry's sentence "Nothing new is refused in 18.x" and its plan to refuse in 19.0: the refusal ships now, in this release, and this entry is the current statement. The rule now refuses such a predicate at `error`, at the same location (`object 'NAME' · validation 'RULE'`, `… when`, or the nested rule's label), with the same rule id (`expression-invalid`). The message no longer says it is a warning. The object save door runs the same pass, so its verdict is the build's finding.

**BREAKING — what moves for consumers.**

- `os build`, `os validate` and `os lint` fail on a `validations[]` rule whose predicate reads `parent`. The rule is judged as written, so this also covers a rule marked `active: false`, a rule whose `events` a stack never fires, and a `conditional` branch whose `when` is never true.
- An object write in publish mode that carries such a rule answered 200, with the finding among its advisories. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at the rule. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).

**Remedy.** To lock or require a field on the header's state, write the predicate on that field's own `readonlyWhen` or `requiredWhen`, where `parent` is bound. To refuse a whole write on the header's state (for example a new line under a paid invoice), use a lifecycle hook (`beforeInsert` / `beforeUpdate` / `beforeDelete`) that reads the header. For any other check, read a column the detail object declares, and denormalise the header value you need onto the detail. Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- The runtime is unchanged: a `validations[]` rule still binds `record` and `previous` and no `parent`, and such a rule already refused every write it judged. If the runtime comes to bind `parent` there, this refusal is withdrawn in that same change.
- `parent` on a field's own `readonlyWhen` / `requiredWhen` is still accepted with no finding, and so is a `record` column spelled like the root (`record.parent_code`).
- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- No example, template or package object in this repository authors `parent` in a `validations[]` rule.
- No public export or signature moves.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `os build` and at the object save door of a validations[] rule predicate that reads `parent`, which the server's rule evaluator never binds: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object carrying such a rule keeps loading until it is next saved, and the repair is the author's rewrite of the predicate (a field rule, a lifecycle hook, or a denormalised column), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
