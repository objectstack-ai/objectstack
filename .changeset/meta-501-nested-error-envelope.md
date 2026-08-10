---
"@objectstack/rest": patch
---

REST: the `/meta` write routes' 501 refusals now speak the ADR-0112 error envelope

`DELETE /meta/:type/:name`, `PUT /meta/:type/:name` and `PUT /meta/:type/:section/:name`
answer 501 when the protocol implementation lacks the corresponding method. Each
answered that refusal in a different shape: the `DELETE` sent a bare-string
`error` with no code at all, and the two `PUT` twins sent the code as a *sibling*
of `error` rather than inside it — while `POST /meta/_migrate-stored`, a few
hundred lines away in the same file, already sent the ADR-0112 nested shape for
the same condition.

All four now answer `{ error: { code: 'NOT_IMPLEMENTED', message } }`, so
`err.error.code` — the position ADR-0112 declares — resolves on every one of
them. `NOT_IMPLEMENTED` is unchanged and needs no new catalog entry: it is
already the standard catalog's member for 501.

**Wire-visible** for a caller running a kernel that does not implement metadata
writes. A client that read `err.code` (the sibling position) on the two `PUT`
routes must read `err.error.code` instead; a client that read `err.error` as a
string on the `DELETE` route must read `err.error.message`. No in-repo or
objectui consumer read either retired position.
