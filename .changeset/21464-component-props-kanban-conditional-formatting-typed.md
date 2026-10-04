---
'@objectstack/spec': minor
---

feat(spec)!: an `object-kanban` page block's `conditionalFormatting` takes the list view's own `[{ condition, style }]` rules instead of any value (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-kanban-conditional-formatting-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`object-kanban` `conditionalFormatting` is the list view's own member, by reference, as on `object-grid`.** It was `z.unknown()`, held while objectui's kanban also authored a native `{ field, operator, value, backgroundColor }` rule the list view refuses. objectui has since made the list view's `{ condition, style }` rule the member's only authoring dialect, and the board evaluates it with the evaluator the grid's rows use. So `42`, a bare string, a single rule outside a list or a rule with no `style` — values that passed and painted no card — are refused, and so are a blank `condition`, a non-string `style` value, the native rule, an `expression` rule and a colour written beside `condition` or `style`.
- **`ObjectKanbanProps`** carries the list view's rule type on `conditionalFormatting` instead of `unknown`. The member's string `condition` parses to the `{ dialect: 'cel', source }` envelope, exactly as it does on a list view and on `object-grid`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `conditionalFormatting: [{ field: 'priority', operator: 'equals', value: 'high', backgroundColor: '#fee2e2' }]` | `conditionalFormatting: [{ condition: "record.priority == 'high'", style: { backgroundColor: '#fee2e2' } }]` (`not_equals` is `!=`, `contains` is `.contains(…)`, `in` is `record.FIELD in [ … ]`) |
| `conditionalFormatting: [{ condition: "record.priority == 'high'", backgroundColor: '#fee2e2' }]` | `[{ condition: "record.priority == 'high'", style: { backgroundColor: '#fee2e2' } }]` — every colour goes in `style` |
| `conditionalFormatting: [{ expression: "record.priority == 'high'", style: { color: 'red' } }]` | `[{ condition: "record.priority == 'high'", style: { color: 'red' } }]` |
| `conditionalFormatting: { condition, style }` (one rule, no list) | `conditionalFormatting: [{ condition, style }]` |
| `conditionalFormatting: [{ condition: '', style }]` | delete the rule — a blank condition matches no card |

The one-line fix: write each rule as `{ condition, style }`, a CEL `condition` over the card's `record.*` and a CSS `style` map, the rule a list view declares. No conversion is registered: nothing on the load path refuses the shape, and the census below found no working rule to respell — the D3 entry `ui-object-kanban-conditional-formatting-typed` carries that judgment.

## Who is affected, measured

A writer is a value written on the block: a page-component node (an object literal naming `object-kanban`, flat or in its `properties` bag, or a literal asserted as one), a direct parse through the row, the block's React component inside `schema={{…}}`, or the argument of a local test helper that mounts one. Values resolve through same-file constants and spreads, and parameters at every same-file call site. Each static value was parsed through the list view's member; a second pass parsed every rule-shaped object within 400 characters after a `conditionalFormatting` token, in any syntax, and each remaining hit was read by hand.

- **objectstack** at `16d241a6af`, every tracked file: one writer, this package's own test that the key survived the `quickAdd` retirement, `[{ field: 'priority', value: 'high' }]` — no `operator`, so the board's evaluator built no predicate from it and painted nothing. Respelled to a `{ condition, style }` rule in the same change.
- **objectui** at the `.objectui-sha` pin `ab1879721595` and at `main` `2e818d0b51` (the readers are byte-identical between the two), every value a test fixture: nine `{ condition, style }` writers on the block (three through the board test's mount helper, one asserted node, one declared-keys row parsed through this very row, one live-member row, the dialect test's control, and the wire-slot test's string and envelope conditions), all parse. The ten refused values are refusal probes. Nine are refused by objectui's own faces too: the native rule, the flat colour rule, a colour beside `style` (three keys), an undeclared `label` and three malformed conditions. The tenth is objectui's probe that its mirror still admits a blank `condition`, which the board answers with no paint. Eight more rules mount the runtime `KanbanBoard` directly rather than the block, and the view-face relays carry a list view's rules; all of them parse.
- **hotcrm** at `4054ec2680` and **cloud** at `2205b53010`: no `conditionalFormatting` at all (controls: `kanban` in 48 and 35 files).
- **Deployed metadata** was not measured.
