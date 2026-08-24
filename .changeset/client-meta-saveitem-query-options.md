---
'@objectstack/client': minor
---

`meta.saveItem` accepts the query-string options bag its route already reads —
`force`, `packageId`, `mode` — on both clients

The Phase 3a-destructive gate refuses a metadata save with
`409 DESTRUCTIVE_CHANGE` and ends the message `— re-submit with ?force=true to
proceed.` Both REST `PUT` doors read `?force` off the query string and thread
it, so that sentence is true of an HTTP caller. It was **false of a
first-party SDK caller**: `meta.saveItem(type, name, item)` built a bare path
and a body and sent no query string at all, on either declaration. A caller
who did literally what the refusal prescribed got the identical refusal back,
and the only way to act on it was to abandon `@objectstack/client` for raw
`fetch`.

Three parameters are newly reachable, and they are exactly the three
`PUT /api/v1/meta/:type/:name` reads:

- **`force?: boolean`** — `?force=true`, the destructive-change opt-in the 409
  message names. Only the opt-IN is spelled on the wire: `false` and
  `undefined` both omit the parameter rather than sending `?force=false`.
  That is a hazard avoided, not tidiness — the door refuses a *repeated*
  `force` because a repeated value arrives as an array and a non-empty array
  is truthy, so an opt-OUT that reached the wire twice would switch the guard
  ON.
- **`packageId?: string`** — `?package=<id>`, binding the saved row to a
  software package (`sys_metadata.package_id`). Named `packageId` to match the
  sibling `getItem` / `getItems` options on the same object.
- **`mode?: 'draft' | 'publish'`** — `?mode=draft`, staging the write as a
  pending draft. `'publish'` is the default said out loud and deliberately
  sends nothing, since the door acts on `mode=draft` alone.

**Backward compatible.** The bag is optional and an options-less call builds a
byte-identical URL to before — `''`, not a trailing `?`. Existing
three-argument callers are unaffected, and pins measure that rather than
assuming it.

Both declarations move together — the unscoped `ObjectStackClient.meta` and
the environment-scoped `ScopedProjectClient.meta` — sharing ONE exported
`SaveMetaItemOptions` type and ONE query builder rather than a literal copied
into each. They are the same method on two clients reaching one pair of routes
(the scoped mount is the same route registration replayed under
`/environments/:environmentId`, so it reads the same three parameters), and
every divergence measured between these twins so far has been closed as a
defect. A bag spelled twice is the next one waiting to be introduced.

The branch was selected by measurement, not preference: the SDK is the real
metadata-write path for both surfaces the ruling named. The CLI's `os meta
register` goes through `client.meta.saveItem` and the CLI has no raw-HTTP
metadata-save path at all; Studio reaches it from 21 production call sites
across `@object-ui/app-shell`, `plugin-designer`, `data-objectstack` and the
console app — including the object and field designers, where dropping a field
and saving is precisely what raises the destructive 409.
