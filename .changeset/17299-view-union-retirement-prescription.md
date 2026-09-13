---
'@objectstack/spec': patch
---

A retirement prescription is the top-level message a `PUT /api/v1/meta/view` 422 carries, instead of sitting buried in `invalid_union` sub-errors

`ViewMetadataSchema` is the union behind the runtime write door — the one an
MCP/AI author reaches, with no CLI anywhere on the path. A shape-level refusal
raised inside one of its four branches did not become the union's message: the
top level read zod's bare `Invalid input`, and the upgrade prescription sat at
`error.issues[0].errors[k][j].message`. Every retirement this platform wrote for
list and form views was therefore invisible at the one door its intended reader
uses — shipped behaviour since 17.0.0 for `virtualScroll`, `striped` and
`bordered`, not a recent regression.

The lift is family-wide rather than per case. `retiredKey()` raises one declared
issue shape — `code: 'invalid_type'`, `expected: 'never'`, with the prescription
as its `message` — so the union's existing `.check()` now lifts that message
verbatim from the branch the body claims. The next retirement on this shape is
surfaced without anyone remembering to wire it, which is what a per-case fix
could not promise.

What does not move: the accept/reject verdict of every body (the lift runs after
the union has reached its verdict and writes one string), the issue codes, the
nested `errors` array and its order, and the message of every refusal that is
not a retirement — a plain shape error still reads `Invalid input`, and a
curated unknown-key refusal still reads exactly as it did. That boundary is
measured, not asserted: `strictObject()` closes a shape with a `z.never()`
catchall, so the union's members reach 67 `never` leaves of which only 8 are
tombstones — zod folds a rejecting `never` catchall into `unrecognized_keys`, so
the other 59 never raise the lifted shape at all.
