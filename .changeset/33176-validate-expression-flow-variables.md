---
'@objectstack/mcp': patch
'@objectstack/lint': patch
---

fix(mcp): `validate_expression` takes the flow's declared `variables` at a `flow_condition`, so a bare name binds as the flow binds it and the shadowed-read warning comes back

Clause-②: yes (widening) — the MCP `validate_expression` tool accepts a new optional input, `variables`, at `site: 'flow_condition'`, a call its closed input refused before; without it every answer is unchanged.
Metadata-protocol: none

A flow run binds its declared variables before it flattens the trigger record's fields, so a bare name a variable shares with a field reads the variable, and the runtime flow publish door warns about it (a bare read of a name that is both a declared flow variable and a field). `validate_expression` was never handed the flow's variables: it typed such a bare name as the field, and it could not give that warning.

- `variables` (`site: 'flow_condition'` only): the flow's declared `variables`, in the flow's own shape (`FlowVariableSchema`: a `name` and a `type` at least), so a flow's `variables` array can be handed over as it stands; a malformed one is refused with the spec's own sentence. Given them, a bare read of a declared variable is not typed as the field (the shared validator's `flowVariables`, as the gate hands it on the same flow), and a variable named like a field of `objectName` read bare gets the gate's own shadowed-read warning. `record.FIELD` still reads the field and is judged as before. On another site the input is refused, like `startCondition`.
- Without `variables`, the answer is byte for byte what it was, and the tool description says the shadowed-read warning needs them.
- `@objectstack/lint`: `judgeAuthoredSiteExpression` takes an optional `variables` (a new optional key on the exported `AuthoredSiteExpression` type), which its one-flow probe declares. The gate's verdicts are unchanged.
