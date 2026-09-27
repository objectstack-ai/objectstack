---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/lint": minor
---

feat(automation)!: an edge-branched `decision` is exclusive — the first out-edge whose condition holds, in declaration order, wins; `mode: 'inclusive'` takes every one (#15429)

<!-- adr-0087: registered flow-decision-mode-inclusive-explicit -->

Clause-②: yes

**BREAKING** — the run-time semantics of a shipped node type change. A `decision` node that
declares no `config.conditions` and branches on its out-edges used to take EVERY out-edge whose
condition held, one after another, while its schema, the docs and the engine's own comment all
called it an exclusive gateway; hotcrm#1555 rendered a refusal screen AND ran the conversion in
one execution. Maintainer ruling on #15429 (2026-09-23, 「跟主流对齐」): the gateway follows
BPMN's exclusive gateway, Salesforce Flow's Decision and n8n's Switch default, and taking every
true branch is a declaration the author writes down.

| | before | after |
|:--|:--|:--|
| two conditioned out-edges, both hold | both successors run, sequentially, nothing reported | the FIRST declared one runs; the second records a `skipped` step |
| `config: { mode: 'inclusive' }` | accepted, never read | every out-edge whose condition holds runs, sequentially |
| none holds | the `isDefault` edge runs | unchanged |
| `mode` beside a non-empty `conditions` list, or outside `'exclusive' \| 'inclusive'` | refused by a direct parse only | refused at `registerFlow` and by `os validate`, with the schema's own sentence |

## Migration: FROM → TO

`os migrate meta --from 17` lists the mechanical edits for existing sources and applies them
to the migrated stack: the ADR-0087 D2 conversion `flow-decision-mode-inclusive-explicit`
writes `mode: 'inclusive'` onto every decision that has no `conditions` list and two or more
conditioned out-edges, inside ADR-0031 regions included, so a migrated flow runs exactly as it
did.

```ts
// FROM — every true out-edge ran
{ id: 'verdict', type: 'decision', label: 'Verdict?' }
// TO — what the conversion writes; delete the key where the conditions partition
{ id: 'verdict', type: 'decision', label: 'Verdict?', config: { mode: 'inclusive' } }
```

Then review each written key (the paired D3 entry `flow-decision-edge-branching-first-match`
carries the acceptance criteria): delete it where the conditions partition (`== 'a'` beside
`!= 'a'`, `>` beside `<=`, a guard beside `isDefault: true`), keep it where the flow relies on
more than one branch running for one record, and where the overlap was accidental narrow the
conditions into a partition and delete the key. `os validate` reports
`flow-decision-inclusive-overlap` on every decision that keeps the key with two or more
conditioned out-edges, so the review list is the lint output.

⚠️ **The conversion replays only where the operator asserts the source's age.** It is a default
flip — the old shape still parses and now means exclusive — so the authoring funnel never
rewrites a source written against this contract, the automation engine's flow rehydration seam
refuses it by id (a code-shipped flow, a REST body and a Studio save all arrive there undated),
and `os migrate meta --stored` canonicalizes through that same seam. A flow stored in
`sys_metadata` from the Studio before this release, with two or more conditioned out-edges and
no `mode`, now runs first-match and is rewritten by nothing: list those rows and declare `mode`
on each in the designer.

## Reach, measured at landing

- Release state: the npm registry's `latest` `@objectstack/spec` is `17.4.0` (`npm view`,
  2026-09-27), whose `json-schema/automation/DecisionConfig.json` declares `conditions` only —
  `mode` has not shipped; `.changeset/19867-decision-config-mode.md` and
  `.changeset/20168-decision-mode-beside-conditions-refused.md` are still unconsumed in this
  tree. So `mode` reaches its first release together with the traversal that reads it and the
  conversion that writes it; no published accept set narrows, and the registration and
  `os validate` refusals narrow nothing that shipped.
- Corpus census (this repository at the branch base and `objectstack-ai/hotcrm` at `2f7b2326`,
  read-only): 30 decision nodes across 48 flows; 17 have two or more conditioned out-edges and
  no `mode` (the conversion's positives — every one a hand-written partition, including
  hotcrm's `lead_conversion.decision_duplicate`, the #1555 node), 13 have one conditioned
  out-edge (left alone), and no node of any other type carries a conditioned out-edge, so the
  exclusive traversal is scoped to `decision` with nothing else to migrate.
- What the published surface gains: the D2 conversion and its D3 entry in the protocol-18
  chain (`spec-changes.json`, the upgrade guide), `DecisionConfigSchema.mode`'s describe and
  docblock now state the run-time semantics, and `@objectstack/lint` gains
  `flow-decision-mode-invalid` (gating) and `flow-decision-inclusive-overlap` (advisory).

The traversal change is scoped to `decision` nodes: conditioned out-edges of any other node
type keep the every-true-edge traversal they had (none was measured to exist).
