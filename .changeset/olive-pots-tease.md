---
'@objectstack/service-settings': minor
---

Add a **report-only** classifier for `sys_secret` orphans (#8103), plus the reachability
measurements a sweep would depend on.

`classifySysSecretRows()` is a pure, read-only function over caller-supplied snapshots: it
never writes, never deletes and never decrypts, and its `SecretRowSnapshot` type
deliberately has no `ciphertext` member. It reports which `sys_secret` rows the settings
subsystem still references (`in_force`), which are unreferenced and attributable to a
declared encrypted specifier (`orphaned`), and which it cannot attribute at all
(`unattributable`).

That third verdict exists because re-measuring #8063's reachability argument **falsified**
one of its three facts: `sys_setting.value_enc` is *not* the only column that holds a
`sys_secret` handle. The store has three producers — `SettingsService`, the engine's
`secret`-field channel (which stores `secret:<id>` on any business row, including
tenant-authored objects), and the datasource credential binder (`sys_secret:<id>` at
`external.credentialsRef`). Two are invisible from this package and the engine's set of
holders is not statically enumerable, so "unreferenced by `sys_setting`" is not
"unreferenced". Rows that cannot be attributed are reported, never classified as orphans,
and the report carries explicit caveats naming its own blind spots.

The classifier also pins the two directional guards the card names: a row re-wrapped in
place by `rotateKey()` keeps its handle and is reported `in_force` (rotation metadata never
decides a verdict), and a legacy inline `value_enc` contributes no handle to the referenced
set while flagging any `sys_secret` row sharing its `(namespace, key)`.

No deletion ships with this change — the vehicle for removing orphans remains an open
maintainer decision.
