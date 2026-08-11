---
"@objectstack/rest": patch
---

fix(rest): `GET /api/v1/meta/app?id=` narrows the app list instead of being dropped (#7566)

`GET /api/v1/meta/app?id=…` accepted the parameter and then ignored it. The
same apps came back for **every** value, including one that names no app at all
— `?id=crm` and `?id=no_such_app` produced byte-identical responses. Nothing on
`GET /meta/:type` had ever read `id`: the list route narrows by permission
(`filterAppForUser`) and by `?package=` / `?object=` / `?include=`, and `id` was
never among them.

Worse than an error, because the answer looks like the one that was asked for: a
caller cannot tell a working filter from a dropped one. A client that asks for
one app and renders `items[0]` gets a plausible, wrong answer, and a bogus id can
never come back empty.

The filter is now honoured, matching on `name` — the App document's identity
(`AppSchema.name`, "App unique machine name"), the key `GET /meta/app/:name`
addresses and the key the metadata store merges overlays on. `AppSchema` declares
no `id` of its own, so there is no second identity for the two to disagree about.
Both spellings of the type segment are covered (`/meta/app` and `/meta/apps`),
since every other per-type filter on this handler keys off `metaTypeSingular`.

**A filter that matches nothing answers `200` with an empty list, not a `404`.**
Measured off this route's siblings rather than chosen: `?package=<no such
package>` and `/meta/view?object=<no such object>` both serve an empty list here,
and the only 404 on the meta surface is the single-item address `GET
/meta/:type/:name`. An empty list is already observably different from the
defect, which answered with all of them.

**A repeated `?id=a&id=b` is refused with `400`**, through the same
`refuseRepeatedQueryParams` gate this route already opens with for `?package=` /
`?preview=` / `?object=` / `?include=` (#6877) — one route, one dialect for "this
request is malformed". Picking one of two conflicting intents is a wrong answer
delivered as a success, and the alternative the other filters on this line were
bitten by (`String(['crm','account'])` → the single app name `'crm,account'`)
would just have emptied the list silently.

**The filter narrows within what the caller may observe, never around it.** It
runs after the ADR-0045 §3 publish gate, so `?id=<an unpublished app>` answers the
same empty list to a non-builder as `?id=<nonexistent>` — the two are
indistinguishable by design. It is also not part of the permission branch's
`ctx?.userId` guard, so an anonymous read of a public deployment gets the filter
too.

**Nothing that worked before changes.** An absent `?id=` still returns the whole
list, and so does the empty spelling `?id=` — the same falsy gate `?package=` on
this route has always used, and what an unset `<select>` submits. Other metadata
types are untouched: `?id=` on `/meta/view` and friends keeps being ignored
exactly as before, since #7566 is filed on the app list and teaching every type an
`id` filter in the same change would be surface expansion with nothing measured
behind it.
