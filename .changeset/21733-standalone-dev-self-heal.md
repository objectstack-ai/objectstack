---
"@objectstack/runtime": minor
"@objectstack/cli": patch
---

fix(runtime,cli): a plain `os dev` now self-heals safe schema drift on restart and provisions the `telemetry` sibling database, as `content/docs/deployment/cli.mdx` already says (#21733)

Clause-②: yes (widening)

- **What was broken.** A config with no instantiated `plugins[]` (every fresh scaffold) boots through the standalone stack. Its `default` datasource was built without `autoMigrate: 'safe'`: only the config-load fallback that a host config or `OS_MODE=off` takes carried it. So safe drift was never applied on restart. An example is a per-organization unique index that an older release left non-NULL-safe. Meanwhile the driver's drift line and `os migrate plan` both said the change was "auto-applied at boot under dev autoMigrate: 'safe'". The same boot never provisioned the `<db>.telemetry.<ext>` sibling either.
- **The fix.** The dev self-heal decision now lives in one place, `devAutoMigrateConfig` in `@objectstack/runtime`. That is the driver kinds whose connection contract declares `autoMigrate` (sqlite, postgres, mysql), on a dev boot. The standalone stack, the CLI's config-load fallback and the telemetry sibling all read it, so no kind gains or loses the self-heal relative to the host path. The telemetry provision is one helper (`provisionTelemetryDatasource`) that both serving paths call, under the same `resolveTelemetryDbPath` rule: dev default-on for a file-backed SQLite primary, `OS_TELEMETRY_DB=0` to opt out, `OS_TELEMETRY_DB=<path>` to opt in anywhere.
- **Only a serving boot self-heals.** The standalone stack arms the self-heal on an explicit `dev: true`. That is what `os dev` passes. It does not arm it on the `NODE_ENV=development` default that its sqlite step-down still takes. A one-shot command (`os migrate *`, `os meta resync`, …) passes no `dev`, so it never applies drift its operator did not confirm, whatever `NODE_ENV` says. Production boots are unchanged: the definition carries no `autoMigrate`, and the SQL driver refuses it under `NODE_ENV=production` anyway.
- **Why minor.** `@objectstack/runtime` gains two exports on its only entry, `devAutoMigrateConfig` and its `DevAutoMigrateConfig` type. That is the widening: the existing decision moved out of the CLI so that the CLI reads it rather than keep a second copy. No config key, schema or accept set moves. `@objectstack/cli` is a `patch`: its fix restores documented behaviour and adds no public surface.
