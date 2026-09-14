---
"@objectstack/lint": patch
---

A flow's `edges` list no longer takes the whole authoring gate down when one of its members is not a record — the sibling list #16751's repair did not reach (#16910).

`lintFlowPatterns` read `.label` off each member of `flow.edges` behind nothing but an `Array.isArray` check, which proves the LIST and never its MEMBERS. A YAML `edges:` list item left empty deserialises to `null`, so hand-written metadata turned `objectstack validate` into an uncaught `TypeError` out of a function contractually typed `(stack) => FlowLintFinding[]`:

```
edges:[null, valid]        threw=YES  TypeError: Cannot read properties of null (reading 'label')
edges:[undefined, valid]   threw=YES  TypeError: Cannot read properties of undefined (reading 'label')
```

A linter that throws instead of reporting fails hardest on exactly the documents it is most needed for, and the author gets a stack trace where a diagnostic belongs.

- **The junk member is DROPPED, silently**, through `recordsOf` — the same coercion, from the same one home (`object-graph.ts`), that #16751 chose for the seven flow-NODE-list readers, so two sibling lists on one flow member cannot disagree about what a malformed member means.
- ⭐ **The valid edge beside it is still JUDGED.** "No longer throws" is half a contract: a guard that abandoned the list would satisfy it and would have traded the crash for silence. Measured against a control holding the same flow without the junk member, the surviving finding is identical in rule and location, and no finding is invented about an entry no author wrote.
- **Two rules, not one.** `os validate` runs the rule TABLE, so one throwing reader takes every other rule's verdict down with it: once `lintFlowPatterns` stopped throwing, the identical defect surfaced one file over in `validateStackExpressions`, which read the same list through the same double cast. Both are repaired here; repairing only the filed one would have left the gate down on the same document.
- ⭐ **Which reader actually carried the crash, measured by ablation** — both edge walks read `graph.edges`, not the flow's own list, because `collectFlowGraphs` re-exposes whatever array it is handed. Reverting `graph.edges` alone in either file reds the new cases (10 failures in `lintFlowPatterns`, 6 in `validateStackExpressions`); reverting either `flow.edges` coercion alone leaves them green. The two `flow.edges` coercions are therefore **defence in depth, not the load-bearing fix**, and are kept deliberately: they hand the COERCED array to `collectFlowGraphs` rather than the raw one, which is the discipline the node lists already follow, and they keep two sibling lists on one flow member reading the same way. ⛔ Read them as belt and braces, not as one repair written twice.
- **The producer's edge side is still member-blind.** `collectFlowGraphs` filters the nodes it hands out and forwards edges untouched, so `FlowGraph.edges` is declared `FlowEdgeParsed[]` and can contain a non-record. It does not dereference them today, which is why the consumer coercion is sufficient; that asymmetry is filed separately rather than widened here.
- **No new finding id and no new diagnostic.** On every well-formed document the output is byte-identical; the only behaviour that changes is on input that previously crashed.
