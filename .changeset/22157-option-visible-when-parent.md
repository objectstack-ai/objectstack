---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: `os build` and the object save door refuse a select option's `visibleWhen` that reads `parent`, or any other root the server's option check does not bind (#22157)

Clause-②: no (narrowing: `os build` and the object save door refuse a select option's `visibleWhen` that reads `parent`, which the runtime's option check cannot bind)

A select option's `visibleWhen` is a gate the server enforces on write: the rule validator evaluates the predicate for the value a caller picks, and refuses the value when the predicate is false. That option check binds `record`, `previous` and the acting user (`current_user`, and its ADR-0068 aliases `user`, `ctx` and `os`), and nothing else. An option predicate that read `parent`, such as `parent.status == 'closed'`, still passed `os build` and the object save door. `parent` is a root the platform declares, and a field's own `readonlyWhen` and `requiredWhen` bind it on an object with exactly one `master_detail`. The option check does not bind it. So the predicate faulted on every write that picked the option, the server logged "the option's gate was NOT enforced on this write", and the value was admitted.

The build's expression rule (`validateStackExpressions`) now gives a select option's `visibleWhen` a root verdict over the roots the option check binds. A predicate that reads any other root the platform declares, `parent` above all, is refused at `error` and located at the option (`object 'NAME' · field 'FIELD' option 'VALUE' visibleWhen`). The message names the option, the field and the root. The object save door runs the same pass, so its verdict is the build's finding: the same rule id (`expression-invalid`), location, message and hint.

**BREAKING — what moves for consumers.**

- `os build`, `os validate` and `os lint` refuse an option `visibleWhen` that reads a root other than `record`, `previous`, `current_user`, `user`, `ctx` or `os`. Besides `parent`, that covers the roots the platform declares for other evaluation sites, such as `input`, `vars`, `trigger`, `data` and `features`. Each of them faulted at the option check in the same way.
- An object write in publish mode that carries such an option answered 200. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that option. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).

**Remedy.** Rewrite the predicate against what the option check binds: `record.FIELD`, `previous.FIELD`, or the acting user as `current_user`. To gate a choice on a master-detail header's state, read a column the detail object declares, and denormalise the header value onto the detail; `parent` is bound only for a field's own `readonlyWhen` and `requiredWhen`. Saving the object as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- The server's option check is unchanged. It binds what it bound before, and an option predicate that faults is still logged and admitted. If the runtime comes to bind `parent` for an option, this refusal is lifted in that same change.
- The acting user is still accepted in an option's `visibleWhen` under all four ADR-0068 spellings, and so is a grant check such as `current_user.can('OBJECT', 'edit')`. On a field's own `requiredWhen`, `readonlyWhen` or `visibleWhen`, the acting user is still refused and `parent` is still accepted, as before.
- A root the platform does not declare at all, such as `app`, was already refused in an option's `visibleWhen` by the bare-reference check, and it still is, with the same message.
- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps loading until it is next saved, and that save is judged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: every object this repository ships carries 5 option predicates, all on `showcase_cascade`: four `record.country` cascades and one `current_user.positions` role gate. That is over the 119 objects from its `*.object.ts` files and the two `app-multi-package` sub-stacks, and over the example stacks as `defineStack` composes them (33 objects). They have 0 refusals and 0 advisories, at the build and at the door, before this change and after it.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature, and no registry entry changes: the expression rule already declared `object`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at `os build` and at the object save door of a select option's visibleWhen predicate that reads a root the server's option check does not bind: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose option predicate is refused keeps loading until it is next saved, and the repair is the author's rewrite of the predicate against a bound root, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a build and door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
