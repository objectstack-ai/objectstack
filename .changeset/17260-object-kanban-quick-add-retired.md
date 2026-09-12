---
"@objectstack/spec": minor
---

feat(spec)!: retire `ObjectKanbanProps.quickAdd` — the `object-kanban` board forwarded it and nothing ever read it (ADR-0049)

<!-- adr-0087: registered object-kanban-quick-add-removed -->

**BREAKING** — `quickAdd` is retired from the `object-kanban` component props. Executes the
objectui#8285 director-seat ruling (decision batch #91, 2026-09-08, standing maintainer
delegation), ruled **option B**: the key leaves the board and stays only on the `kanban-ui`
block, where a React host can supply the runtime function the control needs.

| | before | after |
|:--|:--|:--|
| `object-kanban` | `quickAdd: true` parsed clean and did nothing | refused by the tombstone, with the prescription |
| `kanban-ui` (objectui block) | the control works when the host passes `onQuickAdd` | **unchanged** |

**What was actually wrong.** Measured at the `.objectui-sha` pin this repo builds against
(`53ded82bf`): the board FORWARDS the key — `ObjectKanban.tsx:930` spreads the authored bag
into `KanbanRenderer`, which passes `quickAdd={schema.quickAdd}` alongside
`onQuickAdd={schema.onQuickAdd}` (`plugin-kanban/src/index.tsx:196`) — but `KanbanImpl`
gates the affordance on **both** (`:355`, `:368`), and `onQuickAdd` is a host-supplied
FUNCTION that JSON cannot carry and that no producer puts on an `object-kanban` node.
`ObjectKanban.tsx` names neither half of the pair (0 occurrences each, against 6 for the
sibling `onCardClick` in the same file), so the gate was permanently false.

**And the drop was not silent, which is what made it worse than silence.** objectui's html
tier reported the published key as `unknown-prop` — the same diagnostic a typo gets — and
its registry↔spec ledger records it as `ESCALATED (object-kanban.quickAdd — measured NOT
honoured)`. An author following the published contract met a tool that contradicted it, with
nothing in either message to say which side was wrong. The tombstone collapses both halves
onto one answer.

## What to write instead

Nothing, on this board: there is no per-column quick-add affordance on `object-kanban` and
there never was one. Delete the key.

```ts
// before — parsed clean, rendered nothing
{ type: 'object-kanban', properties: { objectName: 'crm_task', groupBy: 'status', quickAdd: true } }
// after
{ type: 'object-kanban', properties: { objectName: 'crm_task', groupBy: 'status' } }
```

The control itself is not withdrawn from the platform. It stays on the `kanban-ui` block,
which a React host renders directly and can hand the `onQuickAdd` slot to — that is what the
ruling preserved deliberately.

Existing sources: `os migrate meta --from 17` lists the mechanical edits; apply them by hand.

The retirement kit:

- a `retiredKey()` tombstone on `ObjectKanbanPropsSchema` — `tsc` types the key `never`, and
  a value reaching the parse raises the prescription rather than a bare unknown-key verdict
- the D2 conversion `object-kanban-quick-add-removed` (`RETIRED_KEYS_BY_MAJOR[18]` entry
  `ui/ObjectKanbanProps:quickAdd`, wired into the protocol-18 chain step) — a **pure lossless
  delete**, since the key never had an effect to preserve, scoped by component `type` so the
  live `kanban-ui` spelling stays out of its reach
- the `authorable-surface/ui.json` row becomes `ui/ObjectKanbanProps:quickAdd [RETIRED]`, and
  the generated reference page prints the prescription in place of the old describe
- the schema docblock's read-point list is corrected in the same stroke: it named `quickAdd`
  among the keys reached "via the forwarded schema", a sentence true about the FORWARD and
  false about the READ — which is how the key kept re-authorizing itself
- pin tests (`ui/component.test.ts`): the refusal carries the prescription; a clean parse does
  not materialize the key; and the control pair separating the tombstone's answer from the
  strict unknown-key arm's, so a shape that had merely DROPPED the key could not pass
- no liveness-ledger row (component props are not an enrolled ledger type) and no form or
  i18n edit: zero `object-kanban` components are authored anywhere under `examples/` or
  `apps/` (control: `object-grid` 3, `object-metric` 8 in the same corpora, same instrument)
- `api-surface/` is unchanged, correctly: it ratchets export existence, and no export leaves —
  `ObjectKanbanProps` still exists, one key narrower
