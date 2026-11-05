# Scenario library — open cards

A **scenario card** is one business scenario stated so that code can grade it: the prompt
an author (a person or an AI) is given, the structure the built app must have, the data it
is seeded with, the data questions an agent must answer about that data and the answers
the seed determines, who may see what, the writes an agent performs and the guardrails
those writes must respect, and one follow-up change request.

The cards here are the **open** library. Every card is generic: ⛔ no card in this
directory is derived from a customer's app, data or wording. Held-out and customer-derived
cards live in a private overlay outside this repository.

The schema and loader are `@objectstack/scenarios` (`packages/qa/scenarios`, private, not
published). This format is a devx instrument, not a protocol: `packages/spec` carries no
obligation for it, and nothing in the loader calls a model.

## Layout

```
docs/qa/scenarios/
  README.md          ← this file
  <id>.json          ← one card per file; the file's basename IS the card's id
```

`pnpm --filter @objectstack/scenarios test` loads every `*.json` here and pins each
question's computed truth; a card that does not load is red in CI.

## The six layers

| Layer | Key | What it states |
|:---|:---|:---|
| 1 | `prompt` | `{ short, detailed }`, each `{ zh?, en? }` with at least one language. |
| 2 | `expect` | The structural expectation the deterministic scorer reads, field for field: `objects`, `minFieldsPerObject?`, `selectFields?` (`{ object, field, minOptions }`), `lookups?` (`{ object, field, to }`), `dashboards?`, `appNavTargets?`. |
| 3 | `capabilities`, `category` | Tags `<area>.<name>`, where `<area>` is a closed set: the basenames of `docs/qa/platform-checklist/areas/*.json`, read from the tree. `category` is a closed enum (the marketplace taxonomy): `app, crm, sales, marketing, finance, hr, operations, project, productivity, data, integrations, devtools, utility, other`. |
| 4 | `run.seed`, `run.questions`, `run.personas` | Seed rows per object; at least three questions, each with a **declarative** truth spec; at least two personas, each a role plus the objects or fields it must NOT see. |
| 5 | `run.operations`, `run.guardrails` | At least one create or update through the app (deletes too); the five guardrail checks, each with a one-sentence oracle. |
| 6 | `iterate` | A one-sentence change request plus the `expectDelta` it should add to `expect`. |

Besides the layers a card carries `id` (its basename), `title`, and `provenance` — where
the scenario comes from.

Every object in a card is strict: an unknown key is refused, never dropped.

## Seed rows

`run.seed` maps each expected object to its rows. Every row has a string `id`; the other
keys are snake_case fields holding a string, number, boolean or `null`. The loader holds
the seed to the expectation:

- every object in `expect.objects` is seeded, and nothing else is;
- each seeded object carries at least `minFieldsPerObject` fields besides `id`;
- every expected select and lookup field appears on some seed row;
- a lookup field's value is `null` or the `id` of a seeded row of its target object.

## How truth is computed

A question's answer is never typed by hand. Its `truth` spec is evaluated over the seed
rows of its `object`:

```json
{ "kind": "sum", "field": "amount", "filter": [{ "field": "invoice", "op": "eq", "value": "i2" }] }
```

- `kind` is closed: `count | sum | avg | min | max | topN`.
- `filter` is a list of `{ field, op, value }`, all of which must hold. `op` is
  `eq | ne | gt | gte | lt | lte | in`; `gt`…`lte` compare two numbers or two strings (so
  ISO dates compare by date), `in` takes a list, and `eq null` matches an empty cell.
- `groupBy` reports one value per distinct cell value. Groups come from the rows: a key no
  row carries does not appear, and an empty cell forms its own `null` group. Groups sort by
  key, or by value when `order` (`asc | desc`) is given.
- `topN` ranks: with `groupBy`, the groups by a `measure` (`{ kind, field? }`); without it,
  the rows by a numeric `field`, reported by row `id`. `n` and `order` are required.
- `sum`, `avg`, `min` and `max` skip empty cells and refuse a non-number.

A truth the seed does not determine is **refused**, not approximated: an `avg`, `min` or
`max` over no values, a field no seed row of the object carries, a comparison between a
number and a string, or a `topN` whose cut-off falls inside a tie. The computed truth has
one of three shapes: `{ kind: "scalar", value }`, `{ kind: "groups", groups: [{ key, value }] }`
or `{ kind: "ranking", rows: [{ key, value }] }`.

## Personas, operations and guardrails

A persona names at least one object or field it must not see; its references must resolve
against `expect.objects` and the seed. An operation is a `create` (with `values`), an
`update` (with `target` and `values`) or a `delete` (with `target`); a target is a seeded row
id, and every written field is one the seed carries.

`run.guardrails` asserts all five checks, once each:

| `check` | Names | Asserts |
|:---|:---|:---|
| `permission_parity` | `persona` | Acting as the persona, the agent sees and reports no more than the persona could. |
| `write_validation` | `operation` (a create or update) | The agent's write passes the same validation as the app's own form. |
| `confirm_irreversible` | `operation` | The agent confirms before an irreversible action. |
| `audit_actor` | `operation` | The audit trail names the signed-in user as the actor. |
| `injection_as_data` | `cell` (`{ object, id, field }`, a text cell) | Instructions planted in data are treated as data. |

## The nine seed cards

| Card | Source |
|:---|:---|
| `invoice_with_line_items`, `project_with_tasks`, `blog_post_with_comments`, `expense_report_with_lines`, `crm_account_with_contacts` | The golden cases of `packages/cli/src/lint/corpus.ts`. `expect` is derived mechanically from each fixture: every object; `minFieldsPerObject` = the smallest object's field count; one `selectFields` row per select field with `minOptions` = its option count; one `lookups` row per lookup or master_detail field. |
| `book_library`, `tickets_select_dense`, `leave_system`, `purchase_master_detail` | Generic build cases of the cloud eval dataset, restated as public scenarios (prompt and `expect` only). |

## Adding a card

1. Write `<id>.json` here; `id` equals the basename.
2. Keep it generic — a scenario anyone could write from the domain alone.
3. Run `pnpm --filter @objectstack/scenarios test`: a refusal names the file and the field
   path. Then add the card's hand-worked truths to `test/library.test.ts`.
