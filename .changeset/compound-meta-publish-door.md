---
'@objectstack/rest': minor
---

feat(rest): mount the compound-name per-item promotion door `POST /api/v1/meta/:type/:section/:name/publish`

**A new public route.** `POST /api/v1/meta/:type/:section/:name/publish` — four
segments after `/meta`, the compound-name arity of the per-item promotion door
that has been mounted as `POST /api/v1/meta/:type/:name/publish` all along. Both
arities now come out of one two-entry registration loop, exactly as the ADR-0033
read twin `GET /api/v1/meta/:type/:section/:name/published` has since #7526.

**What it now makes possible: promoting a compound-named draft over REST, per
item.** A metadata item addressed by a compound name — `views/all_leads`,
`crm/task`, the spelling the SDK documents for `getPublished('lead',
'views/all_leads')` — could already be **staged**
(`PUT /api/v1/meta/:type/:section/:name?mode=draft`, shipped in the
`?mode=draft` entry beside this one) and **read back**
(`GET /api/v1/meta/:type/:section/:name/published`). It could not be promoted:
no registered route matched the four-segment promotion path, so the request
reached the transport's `notFound` and answered `404`, byte-identical to a path
that does not exist. The draft was writable, readable, and not publishable, by
the same caller, over the same transport.

| Request | Before | After |
| --- | --- | --- |
| `POST /meta/object/crm/task/publish` | `404` — no registered route matched | `200`, the staged body is now the live overlay |
| `POST /meta/object/crm_task/publish` | `200` | `200` — unchanged |

The workarounds that entry named remain available and are unchanged:
`POST /packages/:id/publish-drafts` promotes a whole package's drafts at once,
and the runtime dispatcher's own `meta.publish` verb is reachable without any
REST route. What they were not is a **per-item** door.

**Nothing below the route changed, and no accept set widened anywhere else.**
`publishMetaItem` keys the draft on type/name/organization/package and reads the
name's spelling nowhere, so a compound name was always a valid draft key — this
release mounts the route that had been missing, it does not add a capability.
The two arities share one handler, so the compound door inherits, unchanged:
the `manage_metadata` authoring gate (ADR-0066 D1), the `?package=` binding and
its repeated-parameter refusal, the `X-Actor`-ignoring write-actor resolution,
the organization scoping, the `404 [no_draft]` answer when nothing is staged,
and the `501` envelope when a kernel does not implement promotion. The
single-segment door's behaviour is untouched in every one of those respects.

**For SDK callers there is no API change — only a route that now answers.**
`client.meta.publishItem(type, name)` already built this URL: it interpolates
the name unencoded and its own documentation says "Compound names pass through
unencoded, like `getItem`". Calling it with a compound name returned `404`
before this release and promotes the draft after it.
