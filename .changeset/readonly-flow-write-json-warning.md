---
"@objectstack/cli": patch
---

fix(cli): include readonly flow-write warnings in `os validate --json` output

The `readonlyWhen` flow-write advisory (`validateReadonlyFlowWrites`, #3465) was
printed in human mode but omitted from the `--json` summary's `warnings` array,
where every other advisory category is aggregated. `os validate --json`
consumers (CI, editors) therefore never saw those warnings. Added
`...readonlyWriteWarnings` to the summary array so JSON and human output agree.
