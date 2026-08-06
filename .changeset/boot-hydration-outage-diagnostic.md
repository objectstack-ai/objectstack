---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
---

fix(metadata-protocol,objectql): a boot that could not read `sys_metadata` says so at `error`, instead of reporting "no persisted metadata" at debug (#5897)

`loadMetaFromDb` — the boot step that hydrates `sys_metadata` overlay rows into
the SchemaRegistry — returned `{ loaded, errors, invalid }`, and no field in
that shape could express **"this hydration never read the store"**. An
unreachable database and a genuinely empty one both answered `loaded: 0`.

Its only production consumer, `ObjectQLPlugin.restoreMetadataFromDb`, therefore
had nothing to branch on: its single branch chose between two log lines, and
the "nothing came back" side was
`logger.debug('No persisted metadata found in database')`. So a kernel that
could not read a word of its persisted metadata stated at **debug** level that
there was none, and went on to report ready.

What that costs is not hypothetical — it is written into the plugin's own
Phase 2 comment. With the registry empty, `registry.getObject` answers "not
declared" where the truth is "we could not look": unknown-column query guards,
hooks and relationships silently degrade, and overlay objects get neither a
synced table nor a metadata bridge. This is ADR-0110 D3 (an outage is not a
miss) on the boot side, after the same rule landed for `DatabaseLoader`
(#5108), `listForIndex` (#5089) and the overlay reads (#5532 / #5707).

**What changed**

- `loadMetaFromDb` returns `storeUnavailable: boolean`, set on exactly the
  branch that already prints `[Protocol] DB hydration skipped` — a read that
  failed for a reason `isMissingTableError` does *not* call benign. A store
  that has merely not been provisioned yet (first boot, before migrations)
  keeps `storeUnavailable: false`, because `loaded: 0` genuinely is the truth
  there (#5841).
- `restoreMetadataFromDb` reads it and logs at **`error`**, naming the
  consequence (nothing was restored, the kernel keeps reporting healthy, and
  which capabilities silently degrade) and the fix (check the datasource behind
  `sys_metadata` — connection, credentials, table existence — then restart).
  Per AGENTS.md "Degradation log levels": persisted state and runtime state
  disagreeing while the system still looks healthy is the `error` class. An
  empty-but-readable store keeps its quiet debug line, so first boots do not
  start emitting durability errors.

**Not changed**: control flow. Boot still degrades and continues — refusing to
boot on an unreadable overlay store would turn a transient outage into an
outright one. What changes is that the degradation is now distinguishable from
health, and reported as such.

**Impact on duck-typed `ProtocolWithDbRestore` implementers**: none required.
`ObjectQLPlugin` matches the `protocol` service structurally, and the new field
is declared **optional** on its side of the contract, exactly as `invalid`
already is. A shim that predates the field keeps type-checking and is read as
"not an outage" — the only verdict it was able to express before — so its
behaviour is byte-for-byte what it was. The trade-off is deliberate and worth
naming: an optional field cannot *force* a third-party shim to start reporting
outages, so such a shim stays as silent as it is today. Requiring the field
would have made that impossible to ignore at the cost of breaking every
external implementer for a bit only one in-repo producer sets; the in-repo
producer (`ObjectStackProtocolImplementation`) declares and returns it
**required**, so the path that actually runs in every ObjectStack kernel is
fully covered.
