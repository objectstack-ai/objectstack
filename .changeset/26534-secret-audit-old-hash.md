---
'@objectstack/service-settings': patch
---

fix(service-settings): a secret overwrite's audit row records the previous value's keyed digest as `old_hash` (#26534)

Clause-②: no
Metadata-protocol: none
Ruling-ref: #26534 triage `6436617436`; the server seat 2 ruling, arm (a)

A secret-valued setting's overwrite used to record `old_hash` null on `sys_setting_audit` / `sys_platform_setting_audit`, though the column declares null only when the key was previously unset. It now records the same keyed digest (`hmac-sha256:…`) that `new_hash` records, taken over the previous value, so an overwrite's `old_hash` equals the previous row's `new_hash` and a rewrite of the same secret reads `old_hash == new_hash`. It stays null when the key was unset or reset, when no keyed digest is available, or when the previous value can no longer be read, and it is never an unkeyed hash of the secret. Only a secret overwrite pays for it: one `sys_secret` read and one decrypt of the previous value, before the rotated-away secret is reaped.
