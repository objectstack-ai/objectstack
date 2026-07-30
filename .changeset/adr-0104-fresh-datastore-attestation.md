---
"@objectstack/spec": minor
"@objectstack/platform-objects": minor
"@objectstack/objectql": minor
"@objectstack/driver-memory": minor
"@objectstack/driver-sql": minor
"@objectstack/service-storage": minor
---

feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

Deployment-level migration flags could only be recorded by running
`os migrate`. That left a hole at the other end of a deployment's life: a
database created on a version that already ships the migrations started **lax**
and stayed lax until someone thought to run a command that, for them, converts
nothing and finds nothing. Every new deployment re-entered the warn regime, so
the warn regime would never die out — and, since #3459, every new deployment
also kept every released file forever.

A store the platform **creates from empty** now records
`adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
to run; enforcement and collection are live from the first boot.

**This is not version-gating in disguise.** The fact recorded — no legacy value
is stored here — is *observed*: the store had no history at all. The platform
attests only what it watched itself create, and the test is deliberately
strict: every table made by this boot and **none found already present**. One
pre-existing table anywhere, one datasource that was already there, one driver
that cannot account for its schema sync — any of those and the deployment
attests nothing and produces its evidence by scan, exactly as before. "Found
empty" and "created empty" are not the same claim, and only the second is an
observation.

**New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
observational: tables created vs found since connect — implemented by the SQL
and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
`attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
`VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
`@objectstack/spec/system`. Attestation never overwrites an existing flag row
and never throws into a boot: a failure leaves the deployment lax, which a
migration run can still fix.

**Upgrading changes nothing for an existing database.** It is non-empty when
the platform reaches it, so it is never attested — run
`os migrate files-to-references --apply` as before. Importing legacy values
into an attested deployment is rejected loudly at the write path;
`OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.
