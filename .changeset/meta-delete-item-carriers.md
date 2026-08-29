---
"@objectstack/client": minor
---

feat(client): `meta.deleteItem` can pin a reset (`If-Match`) and discard only the pending draft (`?state=draft`) (#12181)

Accept-set widening on a published SDK surface: both `deleteItem` declarations
— the unscoped `ObjectStackClient.meta` and the environment-scoped
`ScopedEnvironmentClient.meta` twin — take a third, optional
`DeleteMetaItemOptions` argument. Existing calls are unchanged: with the bag
omitted, the request is byte-identical to what this method has always sent
(no header key, no query string).

FROM → TO:

```ts
// FROM — the only reset a first-party SDK caller could express
await client.meta.deleteItem('view', 'shared_grid');

// TO — pin the reset against the version you read (ADR-0008 OCC)
const saved = await client.meta.saveItem('view', 'shared_grid', spec);
await client.meta.deleteItem('view', 'shared_grid', { ifMatch: saved.version });
//   concurrent edit  →  409 metadata_conflict, instead of silently resetting it

// TO — discard ONLY the pending draft; the published overlay keeps serving
await client.meta.deleteItem('view', 'shared_grid', { state: 'draft' });
```

Why it matters: `DELETE /meta/:type/:name` has always read the `If-Match`
header and threaded it as `parentVersion` (the spec's own
`DeleteMetaItemRequest.parentVersion` describes the pin), and the sibling
first-party client `@object-ui/data-objectstack` `MetadataClient.reset`
already sent it — but this client had no argument for it, so every SDK reset
was last-write-wins on the one verb whose whole job is destroying an overlay
row. `state: 'draft'` reaches the NARROWER reset; without it the only
reachable reset was the full one, which drops the published overlay too.

⛔ `?dropStorage=true` is deliberately NOT part of this bag. It is the one
carrier the reset door reads that ADDS destructive reach — it drops the
object's physical table — no caller was measured needing it from this client,
and the door's repeated-parameter refusal exists because of that
destructiveness. A caller that needs it is a separate, separately reviewable
widening.

`state: 'active'` is the explicit spelling of the default and deliberately
sends nothing; an empty `ifMatch` (`''`) omits the header rather than pinning
against the empty string.
