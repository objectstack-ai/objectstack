---
"@objectstack/service-automation": minor
---

fix(automation): a flow condition authored as a plain string is evaluated as CEL, not string-compared (#4336)

`evaluateCondition` decided which engine to use by asking whether an
`{ dialect, source }` **envelope** was present. A condition authored as a plain
string therefore never reached the CEL engine: it fell through to the legacy
`{var}` template path, which substitutes brace holes and then compares whatever
text is left — **as text**.

Nothing errored, and the run was recorded as `success`. The failure direction
depended on the predicate, which is what made it dangerous:

| Authored | Actually evaluated | Result |
|:---|:---|:---|
| `existingTask == null` | `'existingTask' === 'null'` | always **false** — gate never opens |
| `record.rating >= 4` | `'record.rating' >= '4'` → `'r' > '4'` | always **true** — branch pinned open |

The dialect is now decided by the **source**, not by the envelope: a condition
is CEL unless it actually contains a `{var}` hole. The same predicate then
evaluates the same way wherever it is authored — an edge `condition` (which
`FlowEdgeSchema` parses into an envelope), a start-node gate, or a `decision`
node's `config.conditions[].expression`, which no schema normalizes because
`FlowNodeSchema.config` is an open `z.record` no transform can reach. That last
one is why author-side discipline could not fix this.

**What changes for authors**

- **Decision-node expressions are CEL.** `conditions: [{ expression: 'amount >
  10000' }]` now compares the amount. Field access on an object variable works:
  `get_record` stores the whole row under its `outputVariable`, so
  `lead_record.status == 'converted'` resolves — the `{lead_record.status}`
  spelling never could, because substitution looks for a variable *named*
  `lead_record.status`.
- **The `{var}` dialect still works** where it always did — `{amount} > 100`,
  `{status} == active` — and now also with a **quoted** literal:
  `{status} == 'active'` used to compare `active` against `'active'`, quotes
  included, and was false for every value.
- **It no longer answers `false` when it cannot resolve something.** A `{…}`
  hole that names no variable, and a substituted value that is neither a
  boolean, a number, nor part of a comparison, are refused with the source and
  the offending reference attached (ADR-0032 §1c: a predicate that cannot be
  evaluated is a fault, never a quiet branch decision). Both used to be a silent
  `false`.
- **A condition that is not valid CEL now raises**, where a bare string
  previously string-compared to some answer. This is the intended tightening —
  it surfaces as a loud flow failure naming the source, which `registerFlow` and
  `objectstack build` already do for edge and start-node conditions.

Braces inside an explicit `dialect: 'cel'` envelope remain the #1491 brace-trap
and still throw: stating the dialect is the author saying "this is CEL", where
`{…}` is a map literal. The sniff applies only where no dialect was stated.
