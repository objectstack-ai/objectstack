---
'@objectstack/service-automation': patch
'@objectstack/mcp': patch
---

fix(service-automation,mcp): a time-relative flow's conditions are typed against the object its sweep scans, at registration and in the `validate_expression` advice

Clause-②: no
Metadata-protocol: none

- **`@objectstack/service-automation`**: the registration pass's advisory schema check (the logged `unknown field` / typo / type-mismatch warnings) typed a time-relative flow's conditions against the start node's `config.objectName`, while the run binds a row of `config.timeRelative.object`. A flow stored with a start naming another object kept a warning on a field that is right for the scanned object and none on a field that fails at run time; a start naming no `objectName` got no schema check at all. The pass now reads the object off the flow's trigger binding, the same answer the run uses: `timeRelative.object` when it is a string, `config.objectName` only otherwise. Every other flow is typed as before. The warnings stay logged, never thrown.
- **`@objectstack/mcp`**: `validate_expression`'s description, its `sweepObject` input text and the SKILL.md line no longer advise passing a `sweepObject` other than `objectName` as a supported shape. They say to pass the scanned object as `objectName`, and that a start whose `objectName` names another object is refused at publish (`flow-time-relative-object-mismatch`). The tool's inputs and verdicts are unchanged.
