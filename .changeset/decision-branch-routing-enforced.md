---
"@objectstack/service-automation": minor
"@objectstack/spec": minor
"@objectstack/cli": minor
"@objectstack/example-crm": patch
---

fix(automation): a decision's three declared ways to route a branch are now one working model (#4414)

A `decision` node advertised three mechanisms for splitting a path and only one
of them did anything. The other two were the ADR-0049 `declared ≠ enforced`
shape, and the pair of them shipped a guard that does not guard in
`examples/app-crm`.

| mechanism | before | now |
|:---|:---|:---|
| `edge.condition` | ✅ the only one that worked | unchanged |
| `edge.isDefault` | **zero readers** anywhere but the schema declaration | BPMN default flow, enforced in `traverseNext` |
| `decision.config.conditions[].label` → `branchLabel` | matched **0** out-edge labels across every example app, then fell back to the full edge set in silence | routes; an unclaimable label is logged, not swallowed |

## What was broken, end to end

`crm_convert_lead_wizard` means "already converted → abort screen; otherwise →
the wizard". It ran **both**: an already-converted lead got
"This lead has already been converted" and then walked straight into the
conversion wizard behind it. Four independent silences stacked up:

1. the decision's first condition was authored `{lead_record.status} ==
   'converted'` — braces in a slot declared bare CEL, so it was string-compared
   and never true;
2. the second (`'true'`) therefore won, yielding `branchLabel: 'No — proceed'`;
3. no out-edge carried that label (they were `'Yes'` / `'No'`), so traversal
   discarded the branch and considered every out-edge;
4. `e3b` was unconditional, so it ran regardless — and the natural fix, marking
   it `isDefault: true`, was a dead key.

## The model

`branchLabel` narrows the edge set → `condition` gates each edge → `isDefault`
catches whatever is left. Concretely:

- **`isDefault` is enforced.** A default edge is traversed only when no
  conditional sibling of the same source node matched, and it is no longer part
  of the unconditional parallel fan-out — that distinction is the whole point of
  the marker. Passed over because a real branch won, its target records the same
  `skipped` step a closed gate does (#4354).
- **An unclaimable branch label warns.** Traversal still falls back to the full
  edge set (a run mid-flight must not die on a metadata error) but says so,
  naming the computed branch and the out-edge labels that exist.
- **A decision that declares no `conditions` reports no branch.** It used to
  report `'default'` unconditionally — a label no out-edge in the repo ever
  carried — which is why every decision node fell back to the full edge set.
  The `'default'` sentinel survives for the case it actually describes (declared
  conditions, none matched) and is now claimed by the `isDefault` edge as well
  as by an edge literally labelled `'default'`.
- **`conditions[].expression` is evaluated as the bare CEL it is declared to
  be.** The raw string went to the legacy `{var}` template path, where
  `lead.status == 'converted'` cannot resolve and the branch is decided by
  string comparison. Unlike `edge.condition` this slot carries no
  `ExpressionInput` envelope — the decision descriptor is deliberately
  schemaless — so the executor supplies the dialect. A brace-in-CEL predicate
  now fails loudly (ADR-0032 §1c) instead of deciding `false`.

## Caught at authoring time too

Four new `os build` / `os validate` warnings, because a wrong route is silent at
run time by nature (Prime Directive #12):

`flow-branch-label-unmatched` (the shipped shape),
`flow-decision-unconditional-branch` (a guarded decision with an unconditional
sibling — the actual hole), `flow-default-edge-with-condition` and
`flow-multiple-default-edges`.

Both of the first two fire on the pre-fix `convert-lead.flow.ts` and are silent
after it.

## The example app

`crm_convert_lead_wizard`'s guard is now a plain exclusive gateway: the
redundant `config.conditions` is gone and `e3b` carries `isDefault: true`. One
mechanism per decision, and exactly one branch runs.

Verified: 11 new engine/executor tests (including the reported repro in both
directions), 12 new linter tests; `@objectstack/service-automation` 577 tests
and `@objectstack/cli` 652 tests green, all three example apps build with no new
findings.
