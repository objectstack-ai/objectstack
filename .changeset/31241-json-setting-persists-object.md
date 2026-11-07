---
'@objectstack/service-settings': patch
'@objectstack/objectql': patch
'@object-ui/console': patch
---

fix(service-settings)!: a `json` setting persists a JSON object or array, and the console sends one; data lifecycle quotas and retention overrides saved as text are read and applied

Clause-②: yes (narrowing) — the settings save door and the env door start refusing a `json` value that is not a JSON object or array, which they accept today; ADR-0007:123 already declares `json` persists an object, so the narrowing enforces the declared contract and widens nothing
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. What narrows is the value a settings door accepts for a `json` key: a stored value is runtime state in `sys_setting` / `sys_platform_setting` and an `OS_*` override is a deployment's environment, so there is nothing for a migration to rewrite. Values already stored as JSON text are handled by their one reader (`LifecycleService`): quota text is read as the object it holds, with a warning, and retention-override text waits for an administrator's save. -->

**BREAKING** accept-set narrowing at the settings doors (`@objectstack/service-settings`): a `json` key takes a JSON object or array, as ADR-0007 declares.

- **Before.** `PUT /api/settings/:namespace` stored any value under a `json` key. The console's `json` field sent the textarea's text, so Setup → Data Lifecycle saved `lifecycle.quotas`, `lifecycle.quota_defaults` and `lifecycle.retention_overrides` as strings, answered "saved", and the lifecycle sweep read every quota and override as absent: no `quota-exceeded` alert, no override applied, nothing logged.
- **Now.** The save door refuses a string, number or boolean under a `json` key with `400 SETTINGS_VALIDATION` and one `invalid_type` field error for the key, and stores nothing. An object, an array and `null` (a clear) are accepted. A value already stored under a key the save does not touch does not block it. An `OS_*` override for a `json` key whose text does not parse to an object or array is not in force: one `error` line names the variable, and the key resolves from the next layer of the cascade.
- **Who moves.** The console now parses the text at Save: valid JSON is sent as the object or array, blank text as a clear, and text that does not parse blocks Save on that row with "Invalid JSON". A script that PUTs JSON text for a `json` key gets the 400.

**The remedy.** Send the parsed value, not its text: `{ "quotas": { "sys_audit_log": 1000 } }`, not `{ "quotas": "{\"sys_audit_log\": 1000}" }`. For an `OS_*` override, set JSON text of an object, such as `OS_LIFECYCLE_QUOTAS='{"sys_audit_log":1000}'`.

**Values saved as text before this release** (`@objectstack/objectql`). A deployment that saved the Data Lifecycle page through the old console holds JSON text, which applied nothing. After the upgrade the lifecycle service treats the three keys by what they drive:

- `quotas` and `quota_defaults` only raise alerts, so text that holds a JSON object is read as that object and applied, with one warning per stored value: `lifecycle.quotas is stored as JSON text, not an object … Save the Data Lifecycle settings page again to store it as an object.`
- `retention_overrides` drives the reaper and the archiver, which delete rows, so its text is **not** applied: the declared retention windows stay in force and no row is reaped or archived on the old windows. One error per stored value names the key (and the organization, for an organization's own value) and the fix: open Setup → Data Lifecycle, check the value and save the page once. The page shows the stored text and now sends it as an object, so that save is what puts the window in force.

A stored value that is not a JSON object still applies nothing, as before, and is now reported once at `error`.
