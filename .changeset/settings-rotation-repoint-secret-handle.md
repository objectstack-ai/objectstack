---
"@objectstack/service-settings": patch
---

fix(service-settings): rotating an encrypted setting now actually rotates it — the secret handle is repointed, and the retired ciphertext is destroyed (#8030)

A **second** `PUT` of a new value for an encrypted setting key answered **200**
with a correctly redacted body, advanced `updated_at`, wrote an audit row and
inserted a genuinely new `sys_secret` row holding the new plaintext — and left
`sys_setting.value_enc` pointing at the **first** handle. The effective secret
never changed.

Nothing an administrator can see said so. Rotating a leaked SMTP password or
provider API key looked exactly like a rotation that worked, while the leaked
credential stayed the one in force. The **first** write of any secret was
correct, so the defect was invisible until the second.

**Cause.** `sys_setting.value_enc` (and `updated_by`) are declared
`readonly: true`, and the engine strips author-declared read-only columns from a
**non-system** caller's UPDATE payload. `SettingsService` persisted its rows
through a plain, un-elevated `engine.update`, so the handle could never be
repointed. The INSERT path is deliberately exempt from that strip — which is
precisely why the first write landed and every later one did not.

**Fix.** `SettingsService` performs its own row update as a **system** write.
It is a privileged writer — the manifest capability gate, the env/upper-scope
lock pre-flight and value validation have all already run by then, and these are
columns it owns rather than ones a caller forged. The `IDataEngine` adapter
forwards that execution context on both of its branches.

⚠️ `value_enc` **stays `readonly: true`**. The elevation is scoped to this one
write, so an external caller reaching `sys_setting` through the data layer still
cannot repoint a secret handle — that flag is a security control, and removing
it would have been the wrong direction on this defect. There is a test that
fails if someone removes it.

**Orphans are reaped, not accepted.** A rotation used to leave the previous
`sys_secret` row behind — one more decryptable copy of the credential the admin
just retired, accumulating per rotation (7 → 8 → 9 across three writes). The
row a rotated-away handle named is now deleted once the repoint has committed.
The delete is best-effort and reported if it fails: the new secret is already in
force at that point, and a failed cleanup must not turn a successful rotation
into an error.

Unaffected: the first-write path is byte-for-byte the same; the `••••••••`
mask-echo no-op still leaves the stored ciphertext untouched; env-locked secrets
still refuse writes with `409 SETTINGS_LOCKED`; and a secret store without the
new optional `delete` keeps working, simply accepting the orphans.
