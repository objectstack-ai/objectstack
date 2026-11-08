---
'@objectstack/spec': minor
'@objectstack/service-settings': patch
'@objectstack/objectql': patch
---

feat(spec): a `map` settings specifier for keyed rows; the data lifecycle retention overrides, row quotas and per-class quota defaults use it, and both settings doors judge them

Clause-②: yes (widening) — `SpecifierType` gains a member; the save and env doors also start refusing malformed values for the three keys (a narrowing on values that never took effect, named in the PR's BREAKING note)
Metadata-protocol: added — a package author can now declare a `map` specifier in a settings manifest (a new accepted value of `SpecifierType`)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is removed, renamed or re-shaped: `SpecifierType` gains `map` and `Specifier` gains the optional `keyColumn` and `columns`. The three lifecycle keys keep their stored shape, their env variable names and their cascade. What narrows is the set of values the settings doors accept for those three keys: a stored value is runtime state in `sys_setting` / `sys_platform_setting` and an `OS_LIFECYCLE_*` override is a deployment's environment, so there is nothing for a migration to rewrite, and every refused value is one the sweep never applied. -->

**New: the `map` specifier** (`@objectstack/spec`, ADR-0007 as amended 2026-11-08). A setting whose value is keyed rows declares `type: 'map'` with a `keyColumn` (its header) and `columns` (`{ name, label, kind }`, `kind` is `duration` or `positive_integer`). One value column stores `Record<key, value>`; several store `Record<key, { [column]: value }>`. The keys a map admits are served at run time by an option source the settings service registers for the key, never listed in the manifest. `json` stays for raw config.

**`lifecycle.retention_overrides`, `lifecycle.quotas` and `lifecycle.quota_defaults` are `map` specifiers** (`@objectstack/objectql`). Stored values, `OS_LIFECYCLE_*` names and the env, global, organization cascade are unchanged, and the sweep reads the same shapes. Their keys are served from the running system: the objects that declare a lifecycle class other than `record` for the first two, the lifecycle classes other than `record` for `quota_defaults`.

**BREAKING** accept-set narrowing at the settings doors (`@objectstack/service-settings`), for those three keys only.

- **Before.** `PUT /api/settings/lifecycle` and `OS_LIFECYCLE_*` accepted any object under them: a misspelt object (`sys_audit_logs`), a quota written as text (`"1e6"`) or zero, a window written as `30 days`, a column misspelt (`max_age`). Each was stored, answered "saved", and the sweep silently applied nothing for it.
- **Now.** The save door refuses such a value with `400 SETTINGS_VALIDATION` and one field error for the key, which names the entry and the expected form: `invalid_option` for a key the running system does not have, `invalid_shape` for a cell that is not a duration such as `7y` or a whole number above 0, `unknown_field` for a property no column declares, `invalid_type` for a value that is not an object (JSON text included). The env door rejects such an override with one `error` line, and the key resolves from the next layer of the cascade. A value already stored is not judged until a save touches its key.
- **Who moves.** Nobody whose values took effect. A script or a deployment that wrote one of the refused values was configuring nothing; the refusal now says so. Durations take `h`, `d`, `w` or `y` (`90d`, `7y`), quotas a whole number above 0, and keys are the object names (or classes) the refusal lists.

**The remedy.** Send keys the deployment has and cells in their column's form: `{ "quotas": { "sys_audit_log": 1000000 } }`, `{ "retention_overrides": { "sys_job_run": { "maxAge": "90d" } } }`; for an override, `OS_LIFECYCLE_QUOTAS='{"sys_audit_log":1000000}'`.

**The console.** Until its `map` control lands (a separate change), Setup → Data Lifecycle draws these three keys as an unsupported specifier type; env overrides and the API are unaffected.
