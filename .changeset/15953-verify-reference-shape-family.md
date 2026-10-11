---
'@objectstack/verify': minor
'@objectstack/cli': minor
---

feat(verify): the reference-value shape family — every client-writable reference field refuses a value that is not a record id (ADR-0104 D1), runnable as `os verify --reference-shapes` (#15953)

Clause-②: yes

A third derived proof family beside `runCrudVerification` and `runRlsProofs`. It needs no hand-written test: from the app's own objects it takes every field whose type is in `REFERENCE_VALUE_TYPES` (`lookup`, `master_detail`, `user`, `tree`), reads what the declaration promises from `valueSchemaFor(field, 'stored')` (a record-id string, or an array of them when the field is multi-valued), and asks the engine whether three wrong-shaped values are refused: a boolean, a number, and an embedded record object (the expanded read shape written back). A multi-valued field gets each one as an array element. Every probe is written on insert and on update, through two doors: the REST data routes as the signed-in caller, and the engine's own write as the system principal.

A probe counts as refused only when the engine names the probed field in its refusal. A refusal that names something else is reported `unattributed`, so an engine that refused every write would not read as proven. A field is `proven` (every probe refused), `holes` (a probe was admitted), `failed` (a door faulted), `inconclusive` (a probe could not be attributed or written; the report says why) or `excluded` (declared `readonly` or `system`, which the caller does not write). `holes + failed` is the report's `hardFailures`.

**`@objectstack/verify` — new exports.**

- `runReferenceShapeProofs(stack, token, config, { doors? })` → `ReferenceShapeReport`. Run it on a fresh stack of its own: a door that admits a probe lands a row.
- `deriveReferenceShapeCases(config)`, `referenceShapeProbeValue(kind, multiple, id)`, `formatReferenceShapeReport(report)`, `REFERENCE_SHAPE_PROBE_ID`.
- Types: `ReferenceShapeCase`, `ReferenceShapeDoor`, `ReferenceShapeOperation`, `ReferenceShapeProbeKind`, `ReferenceShapeProbeResult`, `ReferenceShapeFieldStatus`, `ReferenceShapeFieldResult`, `ReferenceShapeReport`, `ReferenceShapeProofOptions`.

```ts
import { bootStack, runReferenceShapeProofs, formatReferenceShapeReport } from '@objectstack/verify';

const stack = await bootStack(myApp);
const report = await runReferenceShapeProofs(stack, await stack.signIn(), myApp);
console.log(formatReferenceShapeReport(report));
expect(report.summary.hardFailures).toBe(0);
await stack.stop();
```

**`@objectstack/cli` — `os verify --reference-shapes`.** Opt-in, like `--rls`, on a fresh boot of its own. A field with holes, or a door that faulted, counts in `hardFailures` and fails the run. The `--json` document carries the report as `referenceShapes` when the flag is given; without the flag the run and its document are unchanged.
