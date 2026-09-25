---
'@objectstack/runtime': patch
---

fix(runtime): a self-hosted restart reads the kernel's own `sys_metadata` back into the registry, so objects authored at runtime keep serving

An object created and published at runtime on a self-hosted install (Studio,
`PUT /api/v1/meta/object/…`, `POST /api/v1/packages/<id>/publish-drafts`)
answered `404 OBJECT_NOT_FOUND` on the data API after the next restart, while
its `sys_metadata` row was still there and
`GET /api/v1/meta/object/<name>/published` still served it. Every `os dev` / `os serve` / `os start` boot was affected.

**Cause.** `createStandaloneStack` stamps `environmentId: 'env_local'` on every
boot (or whatever `OS_ENVIRONMENT_ID` names), and `ObjectQLPlugin.start()` read
any environment id as "a per-project kernel whose metadata comes from an
artifact or a control-plane proxy", so it skipped reading `sys_metadata` at
boot. It logged `Project kernel — skipping sys_metadata hydration (metadata
sourced from artifact)`, which was false on this composition. This is the same
deduction that `runPlatformMigrations` was declared out of.

**Fix: a declaration, not a wider deduction.** `createStandaloneStack` gains an
optional `hydrateMetadataFromDb` config field beside `runPlatformMigrations`,
defaults it to `true`, and passes it to `ObjectQLPlugin`. The plugin option's
own caution holds on this stack: the registry is per-instance (a fresh
`ObjectQL` per plugin), and `sys_metadata` declares no datasource, so it lives
on the stack's one `default` datasource, never a control-plane proxy. Set
`hydrateMetadataFromDb: false` only for a boot whose `sys_metadata` is not on
that driver.

What an upgraded install sees at boot:

- every env-wide `sys_metadata` row (`organization_id` NULL), any metadata type,
  is registered again. Org-scoped rows are still served on demand and are not
  read at boot (ADR-0005);
- a stored row that cannot register now says so at boot, on lines that were
  never reached here before: `[Protocol] [metadata_field_type_refused] …` at
  `error`, `[Protocol] Failed to hydrate <type>/<name>: …` and
  `[Protocol] [metadata_spec_invalid] …` at `warn`. The same boot also reports
  org-scoped rows of types that are not per-org overridable, on one aggregated
  line. Each line names its remedy;
- the one-shot `os migrate *` / `os meta *` commands take the default too, so a
  plan or a scan covers runtime-authored objects the way the serving boot
  registers them. The read itself writes nothing, and a deferred-DDL boot
  (`os migrate plan`, `os migrate duplicates`) still defers the tables of what
  it read.
