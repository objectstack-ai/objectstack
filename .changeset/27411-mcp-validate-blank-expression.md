---
'@objectstack/mcp': patch
---

fix(mcp): `validate_expression` refuses a blank or whitespace-only expression with the save gate's verdict

Clause-②: no
Metadata-protocol: none

The `validate_expression` MCP tool used to answer `ok: true` for an empty or whitespace-only expression, while saving that same expression is refused with `422 INVALID_METADATA` ("An expression in an evaluated slot needs a non-blank `source` …"). An agent that validated first and then saved was told the expression was fine.

The tool now parses the expression with the same spec input schema the save/build gate uses for the slot (`EvaluatedExpressionInputSchema` for the `formula`, `validation` and `flow_condition` sites, `TemplateExpressionInputSchema` for the `template` site) before it runs the formula checks. When that schema refuses, the tool answers `ok: false` with that schema's own issue: the `code` is the schema's issue code and the `message` is the published sentence (`EVALUATED_EXPRESSION_SOURCE_REQUIRED`, or `TYPED_EXPRESSION_SOURCE_REQUIRED.template` for a template). The fields and functions in scope still come back. A non-blank expression gets the same answer as before.
