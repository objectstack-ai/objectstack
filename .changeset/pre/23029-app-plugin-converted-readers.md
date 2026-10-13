---
'@objectstack/runtime': patch
---

A job's `timeout`, a turso datasource's `config.timeout` and a memory datasource's `config.persistence.autoSaveInterval`, authored by 17.x tooling, are honoured again when the bundle reaches `AppPlugin` raw

Clause-②: no

Protocol 18 renames these three duration keys so their unit is in their name: `jobs[].timeout` to `timeoutMs`, turso `config.timeout` to `config.timeoutMs`, memory `config.persistence.autoSaveInterval` to `autoSaveIntervalMs`. An artifact built earlier still carries the old spelling, and the boot's ADR-0087 forward conversion renames it. `AppPlugin` registered that converted copy with the `manifest` service and the security registrar, but its job scheduling and its datasource registration and auto-connect read the RAW bundle. So the scheduler and the drivers found no `*Ms` key and fell back to their defaults, with no notice.

`loadArtifactBundle` converts at load, so an artifact booted with `os start --artifact` or `os dev -a` already arrived converted. A bundle in a host config's `plugins[]` array does not go through it: `os serve` and `os migrate` wrap it into `new AppPlugin(bundle)` as authored. Measured through that route on a bundle that declares no `engines.protocol`: the job was scheduled with no timeout at all, and both datasources were registered and handed to `connectDeclared` with the retired keys.

Job scheduling, the code-defined datasource registration, its reserved-name check and `connectDeclared` now read the boot's one forward conversion, the copy every other registrar takes. A bundle authored in the current spellings is read exactly as before: a conversion that changes nothing returns its input, and the registered datasources carry the same `_packageId` / `_packageVersion` / `_provenance` stamps. A handler job's `ctx.bundle` is that converted copy as well.
