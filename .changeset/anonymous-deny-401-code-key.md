---
"@objectstack/core": minor
---

feat(security): the REST 401 anonymous-deny body carries `code: "UNAUTHENTICATED"` alongside the existing `error` / `message` keys (#9487)

Every other REST error family answers `{ error, code }`, with the machine code
in `code` — the 401 family was the one outlier, answering
`{ error: "UNAUTHENTICATED", message }` with no `code` key at all. A client
keying on `body.code` (the shape the other families teach, and the first read
of `@objectstack/client`'s `err.code`) read `undefined` for every
authentication failure.

`ANONYMOUS_DENY_BODY` now carries `code: "UNAUTHENTICATED"` as well.
**Additive only** (maintainer-ruled): no key is removed or moved — `error`
keeps holding the same code value it always has, so every existing reader
keeps working. The wire effect surfaces through `@objectstack/rest`'s
`enforceAuth`, which writes this constant verbatim on every `/data`, `/meta`
and `/reports` 401. This does not settle ADR-0112 D5 (flat vs nested envelope
convergence); both declared envelope families are unchanged in kind.
