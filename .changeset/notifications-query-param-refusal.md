---
'@objectstack/runtime': patch
---

`GET /api/v1/notifications` now refuses a malformed query parameter with a proper
ADR-0112 refusal (`400`, `error.code: VALIDATION_FAILED`, `details.fields[]` naming
the parameter with an ADR-0114 field code) instead of coercing it into a value
nobody asked for.

Wire-visible for raw-HTTP callers only — the typed SDK's `limit` is a `number`, so
it could never produce these:

- `?limit=abc` coerced to `NaN`, which survived `listInbox`'s clamp
  (`Math.min(Math.max(NaN ?? 50, 1), 200)` — `??` does not catch `NaN`) and reached
  the driver as `data.find({ limit: NaN })`. Driver-dependent behaviour, always a
  200. Now a 400. Non-integers (`1.5`, `Infinity`, a repeated `?limit=1&limit=2`)
  are refused on the same rule.
- `?read=1` / `?read=TRUE` / `?read=` answered `false`, silently serving the
  **unread** half of the inbox to a caller who asked for the read half. Only
  `true` and `false` are accepted now.
- A repeated `?type=a&type=b` became the single topic `'a,b'` — an empty inbox and
  a 200. A non-string `type` is refused.

Unchanged on purpose: every value that already had a defensible answer keeps it,
including the **clamp** for out-of-range numbers, which is declared contract
(`?limit=1000` still answers 200 rows, `?limit=-5` still answers 1), absent/empty
parameters, and unknown query keys such as the retired `cursor`, which stays
ignored rather than refused.
