---
'@objectstack/mcp': patch
'@objectstack/lint': patch
'@object-ui/console': patch
---

fix(mcp): `validate_expression` gives the runtime publish gate's verdict at a `flow_condition`, and judges a formula-site expression as the field it is authored on

Clause-②: yes (narrowing) — the MCP `validate_expression` tool now answers `ok: false` (or a warning) at a `flow_condition`, and for a named stored or formula field at a `formula` site, where the publish gate already refuses (or warns); and it accepts two new optional inputs, `startCondition` and `field`. The gate's acceptance set does not change.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is in an advisory tool's verdict, never in what an author may write: every expression it now refuses, the publish gate already refused, so no stored metadata and no consumer code has anything to rewrite; the two inputs are optional and an existing call answers as before wherever the gate accepts -->

**BREAKING** verdict narrowing of the MCP `validate_expression` tool (`@objectstack/mcp`), at `site: 'flow_condition'` and, given the new `field`, at `site: 'formula'`.

At a flow condition the tool ran the shared expression validator and nothing else, so it answered `ok: true` for conditions the publish gate then refused when the flow was saved. It now also runs the gate's own passes there, through `judgeAuthoredSiteExpression` (`@objectstack/lint`), as the runtime publish gate judges a flow write, the door a flow saved through MCP or Studio meets:

- an error on a record-triggered flow: a nullable field read as `record.FIELD` or `previous.FIELD` without a null guard (`record.days > 3` with `days` neither required nor defaulted), the run failing at the condition;
- a warning on any flow bound to an object: a read of an injected system column an external object has no storage behind (`record.owner_id` on an ADR-0015 `external` object).

At a flow condition the verdict is that door's, not `os validate`'s: `os validate` also judges a bare name's null guard (`days > 3`) and a root the run does not bind, over the whole flow's variables, node ids and entrances, which the tool is not handed. The door itself also warns when a field is read bare under a name a flow variable shares; the tool is never handed the flow's variables, so it cannot give that warning. Write `record.FIELD` to be judged here.

Two new optional inputs:

- `startCondition` (`site: 'flow_condition'` only): the flow's start condition, for an edge or `decision` branch condition after it. What it proves non-null holds downstream, as at the gate, so `record.days > 3` after a start condition `record.days != null` is accepted. Omitted, the condition is judged as the start condition itself.
- `field` (`site: 'formula'` only, a snake_case field name): the field the expression is authored on. A field the caller is served keeps its definition with the expression in place: a stored field (any type but `formula`) gets the gate's stored-expression warnings (a read of another record, the clock, the acting user or a permission), and a formula field is refused when it would close a formula cycle. Any other name, a field masked from the caller included, is judged as a new formula field, so the answer never says whether a hidden field exists. A stored field that is not declared yet gets its stored-expression warnings once it is declared.

Each finding is the gate's sentence, at the gate's severity. An expression the gate accepts answers exactly as before. A sentence that names the condition names it `flow 'this flow' · edge 'this condition' (start→end) condition`, since the tool is handed the condition and not the flow it will sit in.

- `@objectstack/mcp`: the two inputs, the flow-condition judgment (it reads the subject's served definition alone there; nothing hydrates a hop at a flow condition), the tool description and the served `SKILL.md` line.
- `@objectstack/lint`: `judgeAuthoredSiteExpression` takes `site: 'flow_condition'` with `triggerKind`, `sweepObject` and `startCondition`, and `field` at `site: 'formula'`; exports `AUTHORED_FLOW_NAME`, `AUTHORED_CONDITION_ID` and the `AuthoredFlowTrigger` type. The gate's verdicts are unchanged.
- `@object-ui/console`: the downloadable `SKILL.md` mirror carries the same line.
