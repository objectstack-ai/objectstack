---
'@objectstack/lint': minor
---

fix(lint)!: a roll-up summary whose `summaryOperations.filter` names a key its child object lacks is refused at build and publish (`object-field-ref-unknown`), because every child write then fails its recompute

Clause-②: no (narrowing) — `os validate`, `os build`, `os lint` and the object save and publish doors refuse a summary field they accepted before. No export is added: the position joins the existing `object-field-ref-unknown` rule.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach `summaryOperations.filter` keys that are fields of the child object, which this rule accepts. The reasoning ships in the `os explain object-field-ref-unknown` entry.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: summaryOperations.filter keeps its shape and meaning, and lint now judges its keys against the child object the way lookupFilters[].field is judged against the referenced one. A refused key never filtered what the author meant (every child write answered a recompute failure and the summary stayed stale), so there is no rewrite that keeps the author's intent: the author names a real child field, and the verdict names the nearest one. -->

**BREAKING** accept-set narrowing in `os validate` / `os build` / `os lint` and at the object save and publish doors (`PUT /api/v1/meta/object/NAME` live save, the per-item and package publish; Studio, REST and MCP authors), through the `object-field-ref-unknown` rule.

- **Before.** A summary field with `summaryOperations: { object: 'invoice_line', function: 'sum', field: 'amount', filter: { stauts: 'paid' } }` parsed, built and published. The engine runs the filter as the `where` of an aggregate on the child, ANDed with the parent-FK match. Measured on a real `SqlDriver` (better-sqlite3): every insert of a child row then answered `SummaryRecomputeError` ("the triggering records WERE written"), and the summary kept a stale value.
- **Now.** Each key the child lacks is refused `error` at `objects[i].fields.FIELD.summaryOperations.filter.KEY`, naming the key, the child object and the nearest field ("Did you mean"). Keys inside `$and` / `$or` / `$not` groups and past operator objects are judged too, and a relationship path is resolved through the child.
- **Not judged.** A child object the stack does not define, a child with no readable field map, and a registry-injected system column (resolved per object), the same skips every position of this rule takes.

**What an author does.** Nothing for a filter whose keys are fields of the child object. For a refused key: name the child field you meant (the verdict suggests the nearest one), or drop the key.
