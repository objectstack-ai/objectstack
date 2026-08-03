---
"@objectstack/metadata-protocol": major
---

fix(metadata-protocol)!: batch per-row results now deliver the declared `BatchOperationResultSchema` shape (#4793)

**Breaking wire change** on the per-row `results` entries of the three
bulk-write endpoints — `POST /data/:object/batch`, `/updateMany`,
`/deleteMany`. The rows had drifted from the schema that declares them:
`BatchOperationResultSchema`, the client SDK's exported `BatchOperationResult`
type and the reference docs all said `errors: ApiError[]` / `data` / `index`,
while the wire carried `error: string` / `record` and never sent `index`. A
TypeScript consumer written against the published type compiled, validated,
and read `undefined` at runtime. The wire now delivers exactly what is
declared (a conformance pin parses every emitted row against the schema, so
the two cannot silently fork again).

**FROM → TO, per row:**

| Before (legacy wire) | After (declared schema) | Your fix |
| --- | --- | --- |
| `row.error` (string) | `row.errors` (`ApiError[]`) | read `row.errors?.[0]?.message`; branch on `row.errors?.[0]?.code` |
| `row.record` | `row.data` | rename the read |
| — (never sent) | `row.index` (number) | new — the row's position in the request array; use it to correlate failure rows that carry no `id` |
| `row.droppedFields` | `row.droppedFields` | unchanged |

**Rollback marking is structured now.** The `ROLLED_BACK:` /
`NOT_ATTEMPTED:` message-string prefixes that #4620 introduced (see the
`many-data-atomic-real-or-refused` changeset — its description of those
markers is superseded by this entry) are promoted to first-class
`ApiError.code` values, registered in the spec's ERROR_CODE_LEDGER:

- `errors[0].code === 'ROLLED_BACK'` — the row was written, then undone by the
  atomic batch rollback; `message` carries the causal row's index and error.
- `errors[0].code === 'NOT_ATTEMPTED'` — the row never ran; an earlier row's
  failure aborted the batch.
- the causal row keeps its own error code (e.g. `RECORD_NOT_FOUND`,
  `VALIDATION_FAILED`; an unclassified engine throw maps to `INTERNAL_ERROR`,
  with `httpStatus` mirrored when the error carried one).

Branch on the code — do **not** regex message prefixes; the prefixes are gone.

**Who is affected:** only readers of the *legacy* keys — which were never in
the schema or the SDK types, so they were reachable only via `as any` or bare
JS. Code written against `BatchOperationResult` (the published contract) needed
this change to start working and needs no migration. There is no
dual-emission or compatibility fallback: this is a hard cut inside the v17
major window, and the old keys simply no longer exist on the wire.
