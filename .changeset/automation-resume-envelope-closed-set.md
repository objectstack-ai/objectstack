---
'@objectstack/runtime': minor
---

**BREAKING** — `POST /api/v1/automation/:name/runs/:runId/resume` refuses a request
body carrying an unknown top-level key. The resume body's outer envelope is now a
closed set: exactly `inputs`, `variables`, `output`, `branchLabel`.

Until now the route read the keys it knows and silently ignored the rest, so a body
like `{"nodeId":"ask","values":{...}}` — no key of which the route reads — answered
HTTP 200 `success:true` with the screen submission treated as empty: the run
completed and the submitted value never reached the flow. A caller that guessed
`values` for the key the route spells `inputs` got silence instead of a correction.

What changes on the wire:

- **A body with any unknown top-level key ⇒ `400` with `error.code:
  'VALIDATION_FAILED'`.** The message names the offending key(s) and the accepted
  set; `error.details.fields[]` carries one `unknown_field` entry per offending key.
  The request never reaches the flow engine, the suspension is untouched, and the
  same request with a corrected body is expected to succeed — this refusal sits on
  the retryable side beside `INVALID_SIGNAL` and `INVALID_SCREEN_INPUT`, and is
  deliberately not `FLOW_FAILED` (which the console treats as terminal, because it
  means the engine consumed the suspension and the run actually ran).
- **Unchanged:** a body made only of accepted keys behaves exactly as before,
  including an empty body (a legal empty submission for a screen whose declared
  fields are all optional). The signal is still assembled field-by-field — never a
  body spread — so the service-authority marker stays unforgeable.

Any client already sending only the documented keys is unaffected. A client sending
extra keys alongside a correct `inputs` now gets the located 400 above instead of
having the extras silently dropped.

<!-- adr-0087: not-required (no-migration-prescription) retires no metadata surface: no Zod schema, no authorable key, no stored sys_metadata row changes shape, so `objectstack migrate meta` has nothing to rewrite and no ledger entry can be written for it. What changes is which HTTP request bodies one route accepts, and the only channel that reaches those callers is this changeset itself. -->
