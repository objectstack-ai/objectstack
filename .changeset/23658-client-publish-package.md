---
'@objectstack/client': minor
---

feat(client): `meta.publishItem` can name the package whose pending draft it promotes (`packageId`, sent as `?package=`), so a caller can follow the `?package=` remedy the per-item publish door prescribes when it refuses a publish that names no package (#23658)

Clause-②: yes (widening)

**What is new.** `meta.publishItem`'s options gain `packageId?: string`, sent as `?package=<id>` on `POST /api/v1/meta/:type/:name/publish`. The name, the query key and the omission rule are the ones `saveItem`'s and `deleteItem`'s `packageId` already use: only a non-empty id reaches the wire, and `undefined` and `''` send nothing.

**Why.** A metadata item can hold one row per package (ADR-0048). A per-item publish that names no package promotes the draft a draft save naming no package writes, and the door refuses it in two states, each with `?package=` as the remedy and nothing published: `409 RESOURCE_CONFLICT` when two or more packages hold the item, and `404 NO_DRAFT` when the item's one package holds no draft and another package's draft is stored. This client had no option for it, so an SDK caller (an agent, the CLI, an app) could not do what the refusal said.

FROM → TO:

```ts
// FROM: refused 409 RESOURCE_CONFLICT when two packages hold the item, with no way to name one
await client.meta.publishItem('view', 'shared_grid');

// TO: promotes com.acme.crm's pending draft into com.acme.crm's active row, and no other package's draft
await client.meta.publishItem('view', 'shared_grid', { packageId: 'com.acme.crm' });
```

**Unchanged.** A publish without `packageId` sends the same request as before: no query string, and the body `{ message }` when a message is given, `{}` otherwise. `packageId` combines with `message`, which still rides the body. The environment-scoped `client.environment(id).meta` declares no `publishItem`, and this release adds none.
