---
"@objectstack/runtime": patch
---

fix(runtime): a `PUT /meta/:type/:name` with a falsy body is refused instead of being answered as a READ (#8842)

The http-dispatcher's metadata save branch opened `if (method === 'PUT' && body)`.
The `&& body` conjunct was not a guard — it was a hole. Every path inside that
block returns (including the terminal `501`), so a falsy body did not merely skip
the write: execution continued past the whole save block into the read `try`
below, which resolved the type and answered the ordinary metadata **read**.

A caller who asked to write received what looks like a successful read. No
status, header or field distinguished it from a real write acknowledgement —
the shape "Absence must be loud" exists to prevent. The `manage_metadata`
capability gate, which is the first thing the save branch does, was skipped
entirely for such a request as well. (Not an escalation: the request was answered
by the read path, which runs the same ADR-0106 mask a plain `GET` runs, and
nothing was written. Skipping a write gate on a request that performs no write
grants nothing — the defect is the lie, not a privilege.)

**Reachable from an ordinary client, measured rather than read.** The host that
mounts this dispatcher path is the Hono adapter's catch-all, which builds the
body as `await c.req.json().catch(() => ({}))`. That `.catch` covers a parse
*failure* — an empty body or garbage lands on `{}` — but not a *successful*
parse of a falsy JSON value. Driven against a real Hono app, a `PUT` with
`content-type: application/json` and a payload of `null`, `false`, `0` or `""`
each arrive at the dispatcher falsy.

**The fix matches the sibling transport rather than inventing a second answer.**
`packages/rest`'s `PUT /meta/:type/:name` already folds `req.body ?? {}` and
proceeds into the save unconditionally, so its bodyless writes are refused
downstream by the per-type schema with `422 INVALID_METADATA`. The dispatcher now
does the same: the branch keys off the method alone, and a nullish body folds to
`{}`. Two doors onto one `saveMetaItem` disagreeing about what a bodyless
metadata write means was the actual defect.

What callers see instead of a spurious read:

- holding `manage_metadata` → `422 INVALID_METADATA` from the per-type schema,
  with the structured `issues` the Studio form reads;
- not holding it → `403 PERMISSION_DENIED` from the capability gate, which now
  runs on this request at all.

A `PUT` carrying a real body is untouched — it saves exactly as before, and the
body still reaches the writer verbatim.
