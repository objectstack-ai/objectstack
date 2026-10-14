---
'@objectstack/client': minor
---

feat(client): `meta.deleteItem` can name the package whose row it removes (`packageId`, sent as `?package=`), so a caller can follow the `409 RESOURCE_CONFLICT` remedy the reset door prescribes for an item two packages hold (#23293)

Clause-②: yes (widening)

**What is new.** `DeleteMetaItemOptions` gains `packageId?: string`. Both `deleteItem` declarations take it, the unscoped `ObjectStackClient.meta` and the environment-scoped `client.environment(id).meta`, and send it as `?package=<id>` through the one query builder they share. The name, the query key and the omission rule are the ones `saveItem`'s `packageId` already uses: only a non-empty id reaches the wire, and `undefined` and `''` send nothing.

**Why.** A metadata item can hold one row per package (ADR-0048). The REST reset door `DELETE /api/v1/meta/:type/:name` reads `?package=` and refuses a delete that names no package of an item two or more packages hold, with `409 RESOURCE_CONFLICT`. The refusal names the packages and the remedy, which is to name one with `?package=`. This client had no option for it, so an SDK caller (an agent, the CLI, an app) could not do what the refusal said.

FROM → TO:

```ts
// FROM: refused 409 RESOURCE_CONFLICT when two packages hold the item, with no way to name one
await client.meta.deleteItem('view', 'shared_grid');

// TO: removes com.acme.crm's row of the item and no other package's row
await client.meta.deleteItem('view', 'shared_grid', { packageId: 'com.acme.crm' });
```

**Unchanged.** A delete without `packageId` sends the same request as before: no query string unless `state: 'draft'` is set, and no header unless `ifMatch` is set. `packageId` combines with `ifMatch` and `state` (`?state=draft&package=<id>`). `?dropStorage` is still not an option.
