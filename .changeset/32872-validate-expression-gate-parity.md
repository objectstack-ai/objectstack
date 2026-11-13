---
'@objectstack/mcp': patch
'@objectstack/lint': patch
'@objectstack/runtime': patch
'@object-ui/console': patch
---

fix(mcp): `validate_expression` gives the publish gate's own verdict at a `validation` or `formula` site, every pass the gate runs there included

Clause-②: no (narrowing) — the MCP `validate_expression` tool now answers `ok: false` (or a warning) for a validation rule or formula field the publish gate already refuses (or warns on). The gate's acceptance set does not change, and no exported type or signature changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is in an advisory tool's verdict, never in what an author may write: every expression it now refuses, the publish gate already refused, so no stored metadata and no consumer code has anything to rewrite -->

**BREAKING** verdict narrowing of the MCP `validate_expression` tool (`@objectstack/mcp`), at `site: 'validation'` and `site: 'formula'`.

The tool promises the verdict the publish gate gives the rule, but it ran the shared expression validator and nothing else, so it answered `ok: true` for rules the gate then refused at publish, and the refusal first met a person there. It now also runs the gate's own passes at those two sites, through `judgeAuthoredSiteExpression` (`@objectstack/lint`), which runs the gate's walk itself over the object definitions the caller is served:

- at both sites: a read through a reference to a field the target object does not declare (`record.balance.nope`), and a read through a reference into a stored-metadata table;
- at a `validation` site: a nullable field used without a null guard (`record.days > 3` with `days` neither required nor defaulted), and a read of `parent`, which a `validations[]` rule never binds;
- a warning at both sites: a read of an injected system column an external object has no storage behind (`record.owner_id` on an ADR-0015 `external` object).

Each finding is the gate's sentence, at the gate's severity. A rule the gate accepts answers exactly as before. A `flow_condition` and a `template` are judged by the shared validator alone, as at the gate. A sentence that names the rule names it `this rule`, since the tool is handed the condition and not the rule it will sit on.

- `@objectstack/mcp`: `McpDataBridge` gains the optional `servedObjectDefinitionOf(name)`, the object definition as the caller is served it (the read `describeObject` projects), handed to the gate and rendered to nobody. A bridge without it answers the shared validator's verdict alone, as before. The served `SKILL.md` line and the tool description name what the tool now refuses. `@objectstack/lint` moves from a development dependency to a dependency.
- `@objectstack/lint`: exports `judgeAuthoredSiteExpression` and `authoredExpressionHopTargets`. The gate itself is unchanged.
- `@objectstack/runtime`: the HTTP MCP bridge serves `servedObjectDefinitionOf`, the same caller's object `describeObject` reads (ADR-0106 D1).
- `@object-ui/console`: the downloadable `SKILL.md` mirror carries the same line.
