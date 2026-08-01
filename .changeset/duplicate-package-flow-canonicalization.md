---
"@objectstack/metadata-protocol": patch
"@objectstack/cli": patch
---

fix(metadata-protocol): `duplicatePackage` stops minting pre-protocol flow rows (#4498)

`duplicatePackage` canonicalizes each source row before re-saving it, under a
stated guarantee: "duplication never mints new rows in a pre-protocol dialect."
It delivered that through `convertStoredItem`, which opens with
`if (singular === 'flow') return { item: data, notices: [] }` — so for flows the
guarantee was **not** delivered.

It did not fail loudly either. `FlowNodeSchema.config` is an open `z.record`, so
a pre-17 body (a `delete_record` carrying `config.filters`) sails through
`saveMetaItem`'s schema gate and lands verbatim in a brand-new row.

**Why this mattered more than an un-migrated row.** ADR-0087 justifies the whole
stored-metadata design on new writes always being canonical, *therefore* the
stored pass being "a strictly shrinking concern". `duplicatePackage` was a live
producer contradicting that for flows: an operator could run
`os migrate meta --stored --apply`, get a clean report, duplicate a package, and
be back to having pre-protocol rows — with the report still saying protocol N
until the next run.

**The capability was already reachable.** The reason for the flow skip is real —
flow-node conversions carry ADR-0078's open-namespace conflict guard, which needs
the automation engine's live executor registry to tell a rename from a clobber.
But the protocol is constructed with an accessor for the kernel's service table
(the same one `analytics` and `package` are read from), and the automation
service registers under `automation`. A new private `resolveFlowCanonicalizer`
reads `canonicalizeStoredFlow` (#4454) off it, so every caller running next to a
live engine gets flow coverage without threading anything.

- **`duplicatePackage`** canonicalizes flow rows through it. A refused rename
  fails that item into the existing `failed[]` naming the token — copying the
  un-renamed body would mint exactly the row this fixes. A flow that cannot
  canonicalize fails the same way. With no engine reachable (a control-plane or
  metadata-only host) the source body is copied as-is: no worse than the source
  row already is, and failing an unrelated duplication over it would be its own
  regression.
- **`migrateStoredMetadata`'s `canonicalizeFlow` becomes an override.** It now
  defaults to the resolver. The CLI stopped passing one — it boots its inert
  engine into the same kernel, so both routes reached the same instance, and two
  routes to one capability is how they drift. The parameter stays for callers
  with no registry and for testing the flow branch without an engine.
- **Resolution is lazy, per call.** Plugin init order does not guarantee
  `automation` is in the table when the protocol is assembled (the CLI adds it
  after ObjectQL by design), so caching `undefined` from a too-early read would
  disable flow canonicalization for the life of the process.

Two smaller honesty fixes ride along: a source item that fails *conversion* (a
tombstoned key throws) is now reported as such instead of as `unparseable
metadata`, and `migrateStoredMetadata`'s "no engine" skip reason says no
automation service is reachable rather than blaming the caller for not supplying
one.

Reads are unchanged. `getMetaItems` / `getMetaItem` / `getMetaItemLayered` /
`loadMetaFromDb` still skip flows — they are reads, covered by `registerFlow`
canonicalizing at execution, and are not producing bad data. Duplication was the
one that writes.
