---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): refuse to mint a share row on a federated object whose `owner_id` is the platform's injected anchor (#8119)

Granting a per-record share on a **federated** (ADR-0015 `external`) object whose
`owner_id` is the anchor the registry injected — rather than a column the author
declared on the remote table — used to succeed and persist a `sys_record_share`
row. That row was inert **by construction**: no read or write verdict can ever
consult it. `POST /api/v1/data/:object/:id/shares` now answers **422
`SHARING_NOT_ENABLED`**, the same refusal the guard already gives for public and
owner-less objects (ADR-0111 D7, closing the ADR-0078 silently-inert trap).

**Why the anchor is not a column.** `applySystemFields` injects `owner_id` into
every object that has not opted out, federated ones included, while
`Engine.syncObjectSchema` returns early for `external != null` and issues no DDL
— the remote schema is owned externally. So for a federated object `owner_id`
exists in the registered schema and nowhere else, and the field-existence test
behind the share-posture guard was answering YES about a column that is not
there.

**Measured, not inferred.** On a booted showcase stack with an unstamped
federated object bound to the remote `customers` table, the single-record
ownership lookup does **not** raise on SQLite. A projection naming the phantom
column is *discarded* and the whole row comes back without it:

```
find(obj, { where:{id:'c1'}, fields:['id','name'] })      -> keys [id, name]
find(obj, { where:{id:'c1'}, fields:['id','owner_id'] })  -> keys [id, created_at,
    updated_at, name, email, region, lifetime_value]   — no `owner_id` key, no error
```

So the ownership fast-path reads `owner == null` and both write gates answer
`deny` — silently, for every principal at every write DEPTH including `org`,
because the null-owner branch short-circuits before the scope is consulted. Only
the `modifyAllRecords` bypass reaches `allow`, and it does so without reading a
share row. Refusing the grant therefore costs no live access: the row it declines
to write could never have granted any.

**What is deliberately unchanged.** `checkEdit` / `checkDelete` still refuse on
these objects. That is fail-closed and safe; widening them to `abstain` would
hand the row to another authority and can turn a refusal into an allow, which is
a decision recorded on #8119 rather than part of this fix.

**Unaffected:** every local object; a federated object whose author **declared**
a real remote `owner_id` (the test is provenance, not `external`, so its shares
keep working); and the grandfathered `public_read_write` federated objects, which
are still refused as *public* by the check that runs first.
