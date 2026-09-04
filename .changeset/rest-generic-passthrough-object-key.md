---
"@objectstack/rest": patch
---

fix(rest): the generic declared-status passthrough names its object on both error doors (#14725)

**Response-body change on the published bulk / metadata / UI doors: one optional
key is added, `object`.** Nothing is removed, no status moves, and no `code`
value changes spelling.

#14541 made the two REST error doors agree for every refusal a *bespoke* arm
classifies. They still disagreed for every refusal that reached the *generic*
declared-status passthrough, because the two copies of that one passthrough
differed by exactly one key: `classifyDataError`'s copy ends
`...(object ? { object } : {})` and `resolveErrorResponse`'s 4xx arm had no such
limb. Measured on `main` @ `a12b15e394` — one error object, both doors:

| door | before |
|---|---|
| `mapDataError(err, 'duly_note')` (single-record `/data`) | `409 {"error":"…","code":"DUPLICATE_RECORD","object":"duly_note"}` |
| `sendThrownError(res, err, 'duly_note')` (bulk / metadata / UI) | `409 {"error":"…","code":"DUPLICATE_RECORD"}` |

One refusal, two bodies, decided by which route caught it — the #14541 shape one
arm over. The bulk door now answers the first row too.

It closes the same card's second residue with it. `recordNotFoundError`
(`@objectstack/core`) declares `code`, `status = 404` **and** `object`, so that
declared status carries a record-level not-found past the `RECORD_NOT_FOUND` arm
into this same generic passthrough on every route reporting through
`handleRouteError` / `sendThrownError`, while the single-record `/data` door
reached the generic arm in `classifyDataError` and shipped the name. Both doors
now agree for that producer in every combination of declared status and
door-supplied object.

**Who sees the new key.** The name comes from the door's `object` *argument*,
never from `error.object`, so only a route that supplies one is widened. Of 35
route call sites of this door, **9** pass an argument that can be a non-empty
object name — `POST /data/:object/batch`, `/createMany`, `/updateMany`,
`/deleteMany`, `POST /data/:object/:id/clone`, `POST /data/:object/import`,
`POST /data/:object/import/jobs`, `GET /data/:object/export`, and
`GET /ui/view/:object/:type`. The other 26 (21 passing nothing, 5 passing the
literal `''`) answer byte-identical bodies. `classifiedRefusalAnswer` — the
entry point the analytics dataset face and the record-share family re-dress —
calls this door with no `object` argument at all, so those envelopes' key sets
do not move.

**What deliberately does not change.** The declared-**5xx** arm gains nothing:
its sibling `declaredServerFaultAnswer` names no object either, so the two doors
already agreed in that band and adding the limb there would *create* a
divergence, on top of putting a caller-supplied name into a body whose whole
rule is that a declared server fault says nothing beyond status and code. The
`RECORD_NOT_FOUND` arm's message-**text** limb
(`/^Record \S+ not found in \S+/i`) is not lifted above the passthrough either —
that boundary is #14541's, and it is now pinned behaviourally and positionally
rather than described.

Consumer note: a client that key-counts or exact-matches an error body from a
bulk, import, export, clone or UI-view route will see `object` alongside `error`
and `code` where the equivalent single-record `/data` response has carried it all
along. A client that reads named fields is unaffected.
