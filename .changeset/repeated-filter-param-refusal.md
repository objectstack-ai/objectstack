---
"@objectstack/rest": patch
---

fix(rest): a repeated `?filter=` on `GET /data/:object` is refused as a repetition, not misdiagnosed as a malformed filter (#7390)

**This is a behaviour change on a live surface.** A request that previously
answered `200` now answers `400`, and a request that already answered `400` now
carries a different message. Both changes make the response describe what the
caller actually did.

Repeating a query parameter used to be invisible: the production Hono adapter
collapsed repeats to the first value before any handler ran. Since #6878 route 2
(PR #7396) it surfaces them as arrays, so a repeated `?filter=` now reaches the
shared list-query normalizer — and that normalizer structurally cannot tell what
it is looking at. A filter AST **is** an array (`["status","=","open"]`), so the
arity gate #7386 added to every other query slot had to leave this one alone: on
the filter slot, an array is the ordinary shape of a legitimate body-form filter
sent to `POST /data/:object/query`.

Two shapes came out of that, both live:

| request | before | now |
| :--- | :--- | :--- |
| `?filter={"a":1}&filter={"b":2}` | `400 INVALID_FILTER`, diagnosed as a **malformed** filter | `400 INVALID_FILTER`, diagnosed as a **repetition** |
| `?filter=status&filter=%3D&filter=open` | **`200`**, applying `{status:"open"}` | `400 INVALID_FILTER` |

The first was the common one, and its message was actively misleading: both
filters the caller sent were well-formed, the response told them to check their
AST syntax, and the operator vocabulary it listed could not help. The second is
contrived to write by hand but is the sharper defect — three occurrences of one
parameter happened to spell a valid AST, so the request succeeded while applying
a filter nobody expressed.

The refusal now names the condition: `Repeated "filter" query parameter — send
exactly one.` A repeated filter is **not** merged and **not** resolved by
precedence — either would silently serve one of two intents the caller actually
expressed, which is the authoring trap this refusal exists to close.

The judgement is made at the REST querystring parse rather than in the shared
normalizer, because the querystring layer is the only one that knows it is
looking at a querystring: there, an array on the filter slot is a repeated
parameter and can be nothing else. All four wire spellings of the one slot
(`filter`, `where`, `filters`, `$filter`) are covered.

**Unaffected:**

- A **single** `?filter=` in either accepted form — the JSON object
  (`?filter={"status":"open"}`) and the bare AST
  (`?filter=["status","=","open"]`).
- `POST /data/:object/query` — the body face legitimately sends an array, and is
  untouched.
- Genuinely multi-valued query parameters (`$select`, `$expand`,
  `$searchFields`), which keep their array arm.
- A one-element array from a repeat-preserving adapter, which is one occurrence
  and is unwrapped rather than refused — this also stops it being read as a
  malformed AST.

No spec change: `INVALID_FILTER` is already a standard-catalog code, and the
accepted wire forms of `filter` are unchanged.
