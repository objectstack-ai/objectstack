---
"@objectstack/platform-objects": minor
---

fix(platform-objects): source `sys_oauth_resource.identifier`'s bound from its producer — 1024 → 255, and the referring column with it (#12313)

**BREAKING** accept-set narrowing on two published objects, shipped as `minor`
under the repo's launch-window convention for breaking changes.

<!-- adr-0087: not-required (no-migration-prescription) Narrows two field bounds on objects whose `protection.lock` is `full`; no metadata key is removed or renamed, so no authored metadata can name the discarded band and there is nothing for an upgrader to rewrite. The physical column change is applied by schema sync itself, and the discarded (255, 1024] band is unreachable — measured, the sole writer stores this identifier in varchar(255). -->

`sys_oauth_resource.identifier` declared `maxLength: 1024`. That number cited no
producer — it arrived with the object wholesale (#3080) as generous slack for
"a URI". Every other bound in the #11374 family names where it came from; this
one had no comment at all.

Measured, the producing contract cannot fill it. better-auth 1.7.1 is the sole
writer (`managedBy: 'better-auth'`, `protection.lock: 'full'`) and emits this
column as **`varchar(255)`** on MySQL: `oauthResource.identifier` is declared
`{ type: 'string', required: true, unique: true }`, and `getType` in
`better-auth/dist/db/get-migration.mjs` takes the `field.unique → 'varchar(255)'`
arm of its mysql string branch. Verified by running that generator against live
MySQL 8.0.46 and reading `information_schema.COLUMNS` as its own query:
`varchar(255)`, 1020 octets under utf8mb4.

**The dead end this closes.** #11701 had already narrowed the REFERRING column
`sys_oauth_client_resource.resource_id` to 768 so its declared index could exist
on MySQL at all. The two halves of one foreign key then disagreed about what a
legitimate resource identifier is. On PostgreSQL or SQLite — neither of which
has MySQL's key-width ceiling — an operator could register a resource whose
`identifier` was 900 characters, because the referent's contract admitted it,
and then no client could ever be granted that resource, because the referrer
refused it. Registration succeeded, authorization failed forever, silently.
Both columns now declare **255**, so referent and referrer admit exactly the
same domain.

**What the narrowing rejects.** Values in **(255, 768]** move from "the referrer
accepts" to "both refuse"; values in (768, 1024] were already refused by the
referrer and are now refused by the referent too. Nothing upstream can produce
either band — the sole writer stores the identifier in `varchar(255)`.

**Hash-shadow outcome, measured rather than predicted.** 255 × 4 = 1020 bytes
sits under `SqlDriver.MAX_KEYABLE_VARCHAR_CHARS` (768 characters / 3072 bytes),
so `sys_oauth_resource` **LEAVES** the #11627/#12198 hash-shadow route it was on
at 1024. Both readings are from `information_schema` on live MySQL 8.0.46:

| | before (1024) | after (255) |
|---|---|---|
| `identifier` physical | `text` (65535 octets) | `varchar(255)` (1020 octets) |
| shadow column | `uniq_sys_oauth_resource_identifier__hash varbinary(32)` present | **absent** |
| UNIQUE index keys on | the shadow column | `identifier` directly, `SUB_PART NULL` |

The declared uniqueness is unchanged and still enforced over the full value —
the index is a direct full-value UNIQUE, not a prefix index. Deployments that
already synced this table on MySQL will see the shadow column dropped and the
UNIQUE index rebuilt directly on the narrowed column at the next schema sync.

**A correction to the #11701 citation.** That comment stated upstream emits the
referring column as `varchar(36)` via `getType`'s `field.references` arm. It
does not: `resourceId` participates in table-level indexes, so `getType`
receives a `tableIndexStringLength` argument, which takes precedence over every
`field.*` arm, and `getDatabaseIndexStringLength` seeds its reduce at MySQL's
191-character default — measured, upstream emits **`varchar(191)`**. That 191 is
an artifact of upstream's index budget on upstream's own physical schema;
ObjectStack emits its own schema, so the referring column takes the REFERENT's
255, the same derivation `client_id` already uses.
