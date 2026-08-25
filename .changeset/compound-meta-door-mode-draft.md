---
'@objectstack/rest': patch
---

fix(rest): `?mode=draft` now stages on the compound-name metadata write door

`PUT /api/v1/meta/:type/:section/:name` — the compound-name door, the one you
reach with a name like `views/all_leads` — built its `saveMetaItem` request
field by field and `mode` was not one of the fields. Its single-segment twin
`PUT /api/v1/meta/:type/:name` has read that parameter all along. The parameter
was never refused here, only dropped, so the request was answered `200` and
published **live**. Both doors now read it.

**Two behaviour changes, and both can be observed by an unchanged caller.**

**1. `?mode=draft` on this door changes OUTCOME, not acceptance.** The request
was accepted before and is accepted now; what moved is what it does.

| Request | Before | After |
| --- | --- | --- |
| `PUT /meta/object/crm/task?mode=draft` | `200`, `"state":"active"` — the live row overwritten, nothing staged | `200`, `"state":"draft"` — a staged row written, the live row untouched |

If you send `?mode=draft` to a compound name today and rely on the write going
live — for instance because you never call `POST /meta/:type/:name/publish` —
those writes stop taking effect immediately and start waiting for a promotion.
Drop the parameter to keep publishing straight away. `mode=publish`, an
unrecognised `mode=`, an empty `mode=` and no `mode` at all are all unchanged:
they publish, exactly as before. The spelling test is the twin's, `draft`
case-insensitive.

⚠️ **The draft you can now stage has no per-item REST promotion door in this
arity.** `POST /meta/:type/:name/publish` is mounted for single-segment names
only, while its read twin `GET /meta/:type/:section/:name/published` is mounted
for both — so a compound-named draft is writable and readable over REST and not
promotable there. Until that route exists, promote through
`POST /packages/:id/publish-drafts` (whole-package) or the runtime dispatcher's
own `meta.publish` verb. Tracked in #11932; this release does not change it.

**2. A repeated `?mode` is now REFUSED where it was accepted.** This narrows
what the door takes. `?mode=draft&mode=draft` arrives as an array; the
`typeof === 'string'` test is false for it, so before this change it fell back
to publishing live under a `200`. It is now answered `400`
`{ "error": { "code": "VALIDATION_ERROR" } }` and nothing is written — the
#6877 guard this door already applied to `force` and `package`, extended to the
parameter it just gained, and the same answer the single-segment twin has given
for a repeated `mode` since #6877. A single occurrence encoded as an array
(`?mode=draft` once) is still accepted; the guard unwraps rather than
blanket-refusing.

Nothing else on the door moved: `?force`, `?package`, the `meta-envelope`
write face, the `manage_metadata` gate and the `501` envelope are untouched,
and the single-segment twin is untouched.
