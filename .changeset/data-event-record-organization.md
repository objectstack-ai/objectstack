---
"@objectstack/objectql": patch
---

fix(objectql): a published `DataEvent` now names the organization the RECORD belongs to

`DataEventSchema.organizationId` has been declared and published since the spec
half landed, and its TSDoc states the obligation on the producer's side: *"a
producer that omits the key on an organization-stamped row publishes a
cross-tenant event, which is fixed at the publish site — never by a
consumer-side lookup."* The engine populated it on no event at all. Every
`data.record.created` / `updated` / `deleted` went out with the key absent,
which a consumer is required to read as *"this record is behind no organization
wall"* — so an organization-stamped row was published as an unwalled one, and a
tenant-scoped fan-out had nothing to discriminate on.

`publishDataEvent` now resolves the organization from the row itself and spreads
the key in when there is one. The row is already in hand at all three call
sites — the written record on `created`, the post-state on `updated`, and the
pre-image on `deleted` (the by-id branch reads it unconditionally for its
existence gate) — so this buys **no** per-event read: the key exists precisely
to keep a per-event lookup off the fan-out path.

Three properties are deliberate:

- **The RECORD's organization, never the caller's.** The row's own tenant column
  is the only source consulted. `ExecutionContext.tenantId` is the caller's
  *active* organization; the two coincide on an ordinary tenant write and
  diverge on a system or unscoped one, where substituting it would mislabel an
  administrator's write into another organization as belonging to the
  administrator's.
- **Absence has exactly one spelling: the key is omitted.** An object that is
  not tenant-scoped, a row whose column is empty, and a value no id can be read
  off all publish the key absent rather than `null`, `''` or an explicit
  `undefined`. The schema refuses the empty string outright, so producing one
  would have thrown at the publish site and dropped the event entirely.
- **The column is resolved the way the write path resolves it** — the
  `tenancy.enabled: false` opt-out, then a declared `tenancy.tenantField`, then
  the injected `organization_id` — so the event cannot name an organization for
  a column the engine does not actually scope by. Note the two spellings differ:
  the column is `organization_id`, the published key is `organizationId`.

No schema, no accepted shape and no public export moves: the key was already
declared, already validated and already part of what consumers parse. Only the
implementation changed, from omitting a declared key to populating it.
