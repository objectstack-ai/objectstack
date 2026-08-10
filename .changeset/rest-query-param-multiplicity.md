---
'@objectstack/rest': patch
---

Refuse a repeated single-valued query parameter instead of silently answering the wrong thing (#6877)

`IHttpRequest.query` is declared `Record< string, string | string[] >`, and the array
arm is produced by a real first-party adapter (`NodeHttpServer` hands `?x=1&x=2`
through as `['1','2']`, measured over a socket). `rest-server.ts` read ~50 of its
query parameters as if the union had one arm, so a repeated parameter was coerced
into a *different* value and served with a `200` rather than refused. None of it was
a type error — every site laundered the array through `any`, `String()` or
`Number()`.

Two of the outcomes were inversions rather than degradations:

- `PUT /meta/:type/:name?force=false&force=false` — the read fell through to
  `!!forceRaw`, and a non-empty array is truthy, so repeating an explicit **opt-out**
  switched the destructive-change guard **on**.
- `GET /data/:object/export?limit=1&limit=2` — `Number([...])` is `NaN`, `NaN || 0`
  is `0`, `Math.max(1, 0)` is `1`: a **one-row export**, `200 OK`.

Each affected handler now declares which of its parameters are single-valued, and a
repeated one is refused with `400` and the ADR-0112 nested envelope
`{ error: { code: 'VALIDATION_ERROR', message } }` — the same rule and message
#6307 landed on `/api/v1/packages/:id`, now shared rather than duplicated. The rule
counts occurrences, not values: a one-element array is one occurrence and is
accepted (and unwrapped), an empty array is none, two identical values are still two.

**Wire-visible**: requests that used to receive a wrong `200` now receive a `400`.
No well-formed single-value request changes in any way.

Parameters that are genuinely multi-valued are deliberately untouched and pinned by
tests — `select` / `expand` on `GET /data/:object/:id` (whose consumer takes
`string | string[]` by design), `objects` on `/search`, `fields` / `searchFields` on
the export route, and `approverId` on `/approvals/requests`.
