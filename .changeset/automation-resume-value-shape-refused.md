---
'@objectstack/runtime': minor
---

**BREAKING** — `POST /api/v1/automation/:name/runs/:runId/resume` refuses an accepted
key carrying a value of the wrong TYPE, and refuses a request body that is not a JSON
object. This is the value axis of the closed envelope the same route already applies to
its KEYS.

Until now the route type-guarded each accepted key and silently skipped whatever failed
the guard, so `{"inputs":"a string"}` passed the closed key set (the key IS accepted),
lost its value, and answered HTTP 200 `success:true` with the submission treated as
empty: the run completed and the caller was told its screen input landed when nothing
did. Identical for `{"output":42}`, `{"branchLabel":7}`, a JSON string/number/boolean
body, and an empty-array body.

What changes on the wire:

- **`inputs` / `variables` / `output` must each be a JSON object ⇒ anything else is
  `400` with `error.code: 'VALIDATION_FAILED'`.** `error.details.fields[]` carries one
  `invalid_type` entry per offending key, and both the entry and the message name the
  key and the expected type (plus the type actually received). `null` and an array are
  refused too — the engine's `ResumeSignal` contract types these as
  `Record<string, unknown>`, which excludes both, and an array used to be forwarded to a
  service whose own contract rejects it.
- **`branchLabel` must be a JSON string ⇒ anything else is the same located `400`.**
- **A body that is not a JSON object ⇒ the same `400`, located at `(body)`**, naming the
  accepted keys. That covers a JSON string, number or boolean body, and an array —
  including the empty array, which previously slipped past the key check because it has
  no keys to be unknown.
- Every refusal happens **before** the flow engine is consulted, so the suspension is
  untouched and the same request with a corrected body is expected to succeed. Like the
  unknown-key refusal it sits on the retryable side beside `INVALID_SIGNAL` and
  `INVALID_SCREEN_INPUT`, and is deliberately not `FLOW_FAILED` (which the console
  treats as terminal, because it means the engine consumed the suspension and ran).
- **Unchanged:** every submission that was already well-typed behaves exactly as before,
  with byte-identical arguments at the service — all four accepted keys, the `variables`
  alias, `inputs` winning when both are sent, empty objects, an empty-string
  `branchLabel`, and the bodyless resume (`{}` / absent / `null` body), which stays a
  legal empty submission. The inner bag is still forwarded verbatim for the engine to
  judge — reserved-name and declared-field verdicts did not move into the transport. The
  signal is still assembled field-by-field, never a body spread, so the
  service-authority marker stays unforgeable.

A key spelled with an `undefined` value counts as absent rather than mis-shaped:
`JSON.stringify` drops such a key, so no HTTP caller can produce one, and the in-process
spelling `{ inputs: maybeUndefined }` means "no inputs".

Any client already sending well-typed values is unaffected. A client sending a
mis-shaped value now gets the located 400 above instead of a 200 reporting success on a
submission that was thrown away.

<!-- adr-0087: not-required (no-migration-prescription) retires no metadata surface: no Zod schema, no authorable key, and no stored sys_metadata row changes shape, so `objectstack migrate meta` has nothing to rewrite and no ledger entry can be written for it. What changes is which HTTP request bodies one route accepts, and the only channel that reaches those callers is this changeset itself — the same disposition its sibling closed-key-set change carried. -->
