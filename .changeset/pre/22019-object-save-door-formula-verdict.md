---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

fix(lint)!: the object save door refuses a formula field whose expression `os build` refuses (#22019)

Clause-②: no (narrowing)

`formulas.mdx` says the same `validateExpression` validator backs `os build` and metadata registration. At the object save door it did not. A formula field calling an unregistered function, such as `sqrt(record.amount)`, was refused by `os build` as an unknown function, but `PUT /api/v1/meta/object/:name` answered 200, stored it, and the field read `null` on every row.

The runtime publish gate now runs the build's own formula check on an object write. The registry entry for the build's expression rule (`validateStackExpressions`) declared the flow, action and hook writes and never the object write, so the gate never dispatched it there. It now declares `object` as well, for one of its passes: a formula field's `expression`. The door's verdict is the build's finding: the same rule id (`expression-invalid`), location (`object 'NAME' · field 'FIELD' expression`), message and hint.

**BREAKING — what moves for consumers.**

- An object write in publish mode answered 200 for a formula field whose expression the shared validator refuses. It now answers `422 INVALID_METADATA`, with an `expression-invalid` issue located at that field's `expression`. This covers `PUT /api/v1/meta/object/:name` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/object/:name/publish`, `publishMetaItem`), and a package draft publish (`publishPackageDrafts`).
- The verdict is the one `os build`, `os validate` and `os lint` already gave: an unknown function, a field the object does not declare, a bare field reference (`amount` instead of `record.amount`), and the other errors in the build's formula check. Its warnings now ride the save response as advisories, as they already did for a flow write.

**Remedy.** Fix the expression: the message names the unknown function or field and the position, as `os build` already requires. Use one of the functions `introspectScope` lists, qualify field reads as `record.FIELD`, or compute the value in a stored field and reference it. Saving it as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**Unchanged.**

- Stored rows are not migrated, and they are not refused on read. An object stored before this change keeps reading, with the formula still `null`, until it is next saved. At that save the gate judges it, because the differential compares the write against the stored universe without its own stored row.
- This entry's crossing covers formula fields alone. The other expressions an object carries (validation-rule predicates, the field-rule slots `requiredWhen`, `readonlyWhen` and `visibleWhen`, option `visibleWhen`, and the object's own action predicates) are judged at this door through their own #22032 entries, each its own crossing, measured over the stored corpus first.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: every formula field this repository ships has 0 refusals and 0 advisories at the door. That is 29 fields on 28 objects: examples 7 on 6, and the platform `display_title` formulas 22 on 22.
- No public export or signature moves. `validateStackExpressions(stack)` keeps its signature. The registry entry reaches the passes through an internal function that is not on the package's entry. The built entry declarations differ only in one doc comment, on `AuthoringRuleContext.runtimeWriteType`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the object save door of a formula expression the published validator already refuses at `os build`: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored object whose formula the validator refuses keeps reading until it is next saved, and the repair is the author's edit of the expression, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
