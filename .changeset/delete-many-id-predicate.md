---
"@objectstack/metadata-protocol": minor
"@objectstack/rest": minor
---

fix(metadata-protocol,rest): the id list is the only thing deleteMany can select on (#3897)

`deleteManyData` built the predicate its endpoint is named after and then spread
the caller's `options` **over** it:

```js
return this.engine.delete(request.object, {
    where: { id: { $in: request.ids } },
    ...request.options          // ← lands after `where`, so it can replace it
});
```

`request.options` is caller-supplied — `POST /data/:object/deleteMany` splatted
the whole request body into the protocol request (`{ object, ...req.body }`) —
so one body key rewrote the operation:

```json
{"ids":["a"], "options":{"multi":true,"where":{}}}
```

reached `engine.delete` as an unscoped bulk delete. The engine's write
middleware still composes RLS/sharing predicates onto the AST, so the blast
radius is not automatically the whole table: it is **everything the caller is
allowed to delete**. For an ordinary user with delete permission that is the
difference between the 3 records they asked for and every record they can see;
measured on a stock CRM dev deployment, that payload against one id removed all
8 rows in the object and returned the raw driver count (`8`). The same spread
also accepted `context`, i.e. a forged principal wherever the route is reachable
without auth.

**The id set is now authoritative, structurally.** The engine options are built
from the validated id list and nothing else — caller `options` is a
`BatchOptions` bag (`atomic` / `returnRecords` / `continueOnError` /
`validateOnly`) that carries nothing `engine.delete` consumes, so merging it
could only ever smuggle in engine keys. Ids must be scalars, so an operator
object (`{"ids":[{"$ne":null}]}`) cannot reach `where.id` either; a malformed
list is a `400 VALIDATION_FAILED` instead of a wider delete. The REST route
parses the body against `DeleteManyDataRequestSchema` first, one hop earlier —
Zod object schemas strip unknown keys, so `options.where`, top-level `where` and
a body `context` no longer survive the ingress at all.

**The endpoint also works now.** `deleteManyData` never set `multi`, so a
correctly-formed `{"ids":[…]}` hit the engine's
`'Delete requires an ID or options.multi=true'` throw — only the requests that
triggered the override above ever completed. Deletes now go one id at a time by
primary key, the same shape `batchData`'s `delete` case uses, which closes two
gaps behind that: the bulk branch skips `cascadeDeleteRelations`, so
`deleteBehavior` (`cascade` / `set_null` / `restrict`) was not honoured for the
rows it removed; and the declared `BatchUpdateResponse` contract (per-record
`results`, `atomic`, `continueOnError`) was unimplementable from a bulk row
count. Both are delivered rather than declared.

**Behaviour change.** The endpoint returns a `BatchUpdateResponse`
(`{ success, operation, total, succeeded, failed, results }`) where it
previously returned the driver's raw delete count — on the paths where it
returned anything at all. The caller's execution context is threaded to every
delete, so RLS/FLS now run under the caller here as they do on the single-record
route.
