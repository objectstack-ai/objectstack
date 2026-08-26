---
"@objectstack/platform-objects": minor
"@objectstack/service-automation": minor
"@objectstack/objectql": minor
"@objectstack/core": minor
---

feat(platform-objects): packaged disable works without the automation service, and the activation ledger has one implementation (#12359, #12350)

Two halves of ADR-0126's "ledger convergence", bundled by maintainer ruling
(2026-08-26, verbatim and untranslated: 「同意」).

## The registration follows the declaration (#12359)

`sys_metadata_activation` is declared in `@objectstack/platform-objects`, but
the only thing that REGISTERED it was the automation service's manifest —
because flows were the ledger's first and, until packaged actions landed, only
consumer. Packaged actions are a second consumer with a different owner: their
consult and write path live on the ObjectQL engine, present in every
composition that can execute an action.

So a deployment with actions and no automation service had no ledger table, and
the activation door answered **503 SERVICE_UNAVAILABLE** on every flip —
correctly (ADR-0126 §6 wall 3: a flip that cannot be made durable must not be
reported as one) and permanently. Measured on a real boot; it is now this
change's positive test, measured on the same boot:

```
POST /api/v1/actions/_activation/showcase_task/showcase_mark_done {"enabled":false}
  before -> 503 SERVICE_UNAVAILABLE   after -> 200, and dispatch refuses 409 ACTION_DISABLED
```

`PlatformObjectsPlugin` registers it now, so every composition carrying
platform-objects has the ledger and each future ADR-0126 §8 consumer (`tool`,
`skill`, `position`) inherits it. **MOVE, not add** — the automation service no
longer names the object. That was not a style choice: a second code package
claiming one object throws `Object "…" is already owned by package "…"`
(ADR-0029 D3/D7), measured, so adding a registrant would have been a boot
failure rather than a duplicate.

**Upgrade is a no-op for existing data, and that is measured rather than
asserted.** A manifest is also a ROUTING decision — `resolveDatasourceBinding`
step 4 routes an object by its owning package's `defaultDatasource` — so the
registrar carries the table's datasource with it:

```
owner com.objectstack.service-automation (defaultDatasource:'cloud') -> 'cloud'
owner com.objectstack.platform-objects   (none)                     -> undefined (global default driver)
```

The ledger table already exists in live databases, so on any deployment
carrying a `cloud` datasource that difference would leave the rows in one
database and read another — every disabled artifact silently re-arming. The
ledger therefore rides its own manifest from the same plugin, carrying the
automation manifest's `scope` / `namespace` / `defaultDatasource` triple
verbatim. The three siblings (`sys_migration`, `sys_migration_journal`,
`sys_secret`) deliberately do not get it and keep riding the project database.

## One implementation of the §4 row contract (#12350)

ADR-0126 §4 declares one activation ledger; it had two independent
implementations of that one row contract — `ObjectStoreFlowActivationStore`
(service-automation) and `ObjectStoreActionActivationStore` (objectql). They
agreed because the second was written from the first, and nothing structurally
held them together; §8 pre-charts `tool`, `skill` and `position`, and a third
and fourth copy is where the org-row skip and the `0`-is-false read get lost
quietly, in the direction (an artifact re-arming) nothing else measures.

Neither consumer could import the other, so the contract now lives once in
`@objectstack/core` — the package both already depend on — as
`ObjectStoreMetadataActivationStore(engine, metadataType)`, exported alongside
`InMemoryMetadataActivationStore`, `MetadataActivationRow`,
`MetadataActivationStore`, `MetadataActivationStoreEngine` and
`METADATA_ACTIVATION_TABLE`. Each consumer keeps its own name, its own
one-argument constructor and its own docs, and fixes the discriminator.

**No behaviour change and no API break.** `ObjectStoreFlowActivationStore` /
`InMemoryFlowActivationStore` / `FlowActivationStoreEngine` and
`ObjectStoreActionActivationStore` / `InMemoryActionActivationStore` /
`ActionActivationRow` / `ActionActivationStore` / `ActionActivationStoreEngine`
/ `ACTION_ACTIVATION_TABLE` are exported from the same modules with the same
shapes. Row semantics are byte-equivalent: install-level rows only
(`organization_id` never written), org-carrying rows skipped on read and
ignored when deciding insert-vs-update, a driver `0` read as false,
read-then-write rather than a blind upsert, and no `delete` in the engine slice
because re-enabling rewrites the row.

Both existing pin suites stay green **unchanged**, which is what makes them the
proof the consolidation lost nothing — verified by ablation: removing the
org-row skip from the one shared implementation turns both of them red on their
own org-skip assertion, so both really reach it.
