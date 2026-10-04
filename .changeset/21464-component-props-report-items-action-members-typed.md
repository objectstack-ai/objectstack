---
'@objectstack/spec': minor
---

feat(spec)!: an `object-metric` drill-down's `report` takes a report definition, an `object-timeline`'s `items` take the entry kind its `variant` selects, and each `action:group` / `action:menu` member takes a closed inline action, instead of any value (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-metric-drill-down-report-typed ui-object-timeline-items-typed ui-action-group-menu-members-typed -->

**BREAKING** — three accept-set narrowings on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the rows: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`object-metric` `drillDown.report` is a report definition — `ReportSchema`, by reference.** It was `z.unknown()`. The tile hands it to the shared drill drawer, which draws a dataset-bound report (with the metric's filter joined into the report's own `runtimeFilter`) and lists the records for any other value. A joined report already refuses a block that binds no `dataset`, so every report the member admits is one the drawer draws; a report with no `dataset`, a bare report name, a `{ name }` reference or the retired `objectName` / `columns` form is refused. The drawer still draws a few incomplete reports the member refuses (no `name` / `label`, a non-joined report with no `values`, a joined one with a container `dataset` or with only some blocks bound) — no measured writer authors one.
- **`object-timeline` `items` takes the entry kind the block's `variant` selects.** It was `z.array(z.unknown())`. On `vertical` (the default) or `horizontal` an entry is a feed entry `{ time?, title, description?, variant?, icon?, content?, className? }`; on `gantt` it is a gantt row `{ label, items? }` whose bars are `{ title?, startDate?, endDate?, variant? }`, each date a string or epoch milliseconds — objectui's two ruled element kinds, closed. A row refinement pairs each entry with its kind: a feed entry with no `title`, a gantt row with no `label`, and a key of the other kind are refused at the entry, by path. `variant` is one of `default`, `success`, `warning`, `danger`, `info`. A feed entry's `content` (child components) is not judged yet. The keys the record-bound rail composes onto its entries (`color`, `startDate`, `endDate`, `group`, `meta`) are refused on an authored entry with what to write instead.
- **Each `action:group` / `action:menu` member is a closed inline action.** It was an open record. A member takes `action:button`'s keys with its executor spelled `type` (a member is an action entry): `name`, `label`, `icon`, `type`, `variant`, `visible`, `disabled`, `tags`, `params`, `description`, `target`, `openIn`, `method`, `bodyExtra`, `bodyShape`, `operation`, `patch`, `confirmText`, `successMessage`, `errorMessage`, `refreshAfter`, `locations`, `toast`, `resultDialog`, `onSuccess`, `objectName` — and `size` on an `action:group` member, whose inline button reads it (an `action:menu` item reads none). `tags` takes `separator-before`, the one tag the containers draw. Refused, each with what to write instead: `actionType` (write `type`), `endpoint` / `url` / `path` / `href` (write `target`), `enabled` (write `disabled`, inverted), `autoTrigger`, `outcomeMessages` (write `successMessage`), a member `className`, a member `properties` bag, `undoable` and `recordIdField`. `outcomeMessages` stays undeclared on all four action blocks (`action:button`, `action:icon`, `action:group`, `action:menu`).
- **`ObjectMetricProps`, `ObjectTimelineProps`, `ActionGroupProps`, `ActionMenuProps`** and their parsed types carry these shapes instead of `unknown`; the member and entry shapes are module-private. `ObjectMetricPropsParsed` now also differs from the authored type on `drillDown.report`, whose `ReportSchema` defaults (`type`, `drilldown`) materialize on parse. No export is added or removed.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `drillDown: { report: 'pipeline' }` or `{ report: { name: 'pipeline' } }` | `drillDown: { report: { name: 'pipeline', label: 'Pipeline', dataset: 'deals_ds', values: ['amount_sum'] } }` |
| `drillDown: { report: { name, label, objectName: 'deal', columns: [ … ] } }` | the dataset-bound report: `{ name, label, dataset, rows, values }` |
| `drillDown: { report: { …, type: 'joined', blocks: [{ name: 'notes' }] } }` | bind every block: `blocks: [{ name: 'notes', dataset: 'notes_ds', values: [ … ] }]` |
| `items: [{ date: '2026-01-15', title: 'Kickoff' }]` | `items: [{ time: '2026-01-15', title: 'Kickoff' }]` |
| `items: [{ title: 'Kickoff', color: 'green' }]` | `items: [{ title: 'Kickoff', variant: 'success' }]` |
| `items: [{ label: 'Backend', items: [ … ] }]` with no `variant` | `variant: 'gantt', items: [{ label: 'Backend', items: [ … ] }]` |
| `variant: 'gantt', items: [{ title: 'Kickoff' }]` | `variant: 'gantt', items: [{ label: 'Kickoff', items: [{ startDate, endDate }] }]`, or drop `variant: 'gantt'` |
| `actions: [{ name: 'go', actionType: 'url', target: '/x' }]` | `actions: [{ name: 'go', type: 'url', target: '/x' }]` |
| `actions: [{ name: 'save', type: 'api', endpoint: '/api/save' }]` | `actions: [{ name: 'save', type: 'api', target: '/api/save' }]` |
| `actions: [{ name: 'del', outcomeMessages: { archived: 'Archived' } }]` | `actions: [{ name: 'del', successMessage: 'Archived' }]` |
| `actions: [{ name: 'del', className: 'text-red-600' }]` | `actions: [{ name: 'del', variant: 'destructive' }]` |
| `actions: [{ name: 'run', enabled: "record.status == 'open'" }]` | `actions: [{ name: 'run', disabled: "record.status != 'open'" }]` |
| `actions: [{ name: 'edit', properties: { params: { … } } }]` on `action:group` / `action:menu` | `bodyExtra` for a `type: 'api'` request body, or the action as its own `action:button` node with a `params` object |
| `action:menu` `actions: [{ name: 'a', size: 'sm' }]` | `actions: [{ name: 'a' }]` — the menu's own `size` sizes the trigger |

The one-line fix: write a drill report as the report definition, each timeline entry as the kind the block's `variant` draws, and each container member with `action:button`'s keys and `type` as its executor. No conversion is registered: nothing on the load path refuses these shapes, and the census below found no working value to respell — the D3 entries `ui-object-metric-drill-down-report-typed`, `ui-object-timeline-items-typed` and `ui-action-group-menu-members-typed` carry that judgment.

## Who is affected, measured

A writer is a value written on the block: a page-component node (an object literal naming the block, flat or in its `properties` bag, or with its `type` arriving through a spread constant), a literal annotated as one, a direct parse through the row, the block's React component (`schema={…}`, or its props), and the argument a local helper passes in that position at every same-file call site. Values resolve through same-file constants and spreads, a `.map` over a constant list, templates and same-file helper calls (`member('alpha', { size })`). Every static value was parsed through this branch's rows; each value with a non-static part, and each refusal, was read by hand.

- **objectstack** at `1289925c0a`, this branch's merge base: one drill report (the metric pin's own), one timeline `items` (a spec test, a feed entry) and three `action:group` / `action:menu` members (a spec test) — all parse. No example, doc or skill writes any of the three.
- **objectui** at the `.objectui-sha` pin `2e818d0b51ec` and at `main` `2abec3a96` (every cited reader byte-identical between the two, and the same census at both): **drill report** — the drawn report drill (`objectMetricDrillDownMembers-8071.test.tsx:281`) parses; refused are only the probes of what the drawer does NOT draw (that file's two `it.each` values, and the `@object-ui/types` drill-mirror tests' `{ name }` / incomplete-report refusal probes). **Timeline `items`** — 18 values: 15 parse (feed entries and gantt rows); the 3 refused are the render-time gantt date diagnostic's own probes (an array, `false` and `null` bar date). **Members** — `action:group` 40 values and `action:menu` 19, all in tests but for one run-time hand-off: every static member parses except the probes of the very reads the ruling refuses — the member pin's `className` (`action-group-menu-inputs-11168.test.tsx:249`), the `outcomeMessages` forward tests, the `properties.params` static-value tests, and the host's `autoTrigger` flag in the overflow / forward tests. The hand-off is `action:bar`'s overflow menu (`action-bar.tsx:287`), which hands the bar's own members — a host's registered actions — to `action:menu` at run time, never through the component-props gate.
- **hotcrm** at `4054ec2680` and **cloud** at `2205b53010`: no writer of any of the three (hotcrm's four `object-metric` tiles declare no drill-down).
- **Deployed metadata** was not measured.
