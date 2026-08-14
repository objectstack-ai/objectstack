---
"@objectstack/service-settings": patch
---

fix(settings): the rotated-secret reaper verifies the repoint instead of inferring it (#8262)

`SettingsService.reapRotatedSecret` deleted the `sys_secret` row that
`upsertRow` reported as `previousEnc`, and inferred that the repoint it was
cleaning up after had taken effect from `previousEnc !== nextEnc`. That
inference holds for the shipped adapter, which forwards
`context: { isSystem: true }`. It does not hold for an adapter that drops
`context` — the reader `SettingsEngine`'s own doc comment contemplates, and a
documented extension point rather than a mistake nobody makes.

With `context` dropped, `sys_setting.value_enc` is `readonly: true` so the
UPDATE has it stripped, the row keeps naming the OLD handle, and the reaper
then deleted **the ciphertext still in force**: `materialiseRow` dereferenced a
dangling handle, got nothing, and the setting silently read as empty. That is
unrecoverable — the audit trail records digests, never handles or ciphertext,
so nothing can even name what was destroyed. Measured on the real engine over
the real `SysSetting` / `SysSecret` schemas, three writes gave `sys_secret`
`1 → 1 → 2` with `value_enc` pinned to a row that no longer existed.

The reaper now re-reads the row after the write and deletes `previousEnc` only
once storage confirms the row no longer names it. The criterion is
`current !== previousEnc` rather than the narrower `current === nextEnc`:
under a concurrent rotation the row may already have moved on to a third
handle, where `previousEnc` is genuinely unreferenced and the narrower test
would leak the orphan the reaping exists to prevent. Both refuse the case that
matters.

Every refusal branch (unreadable row, failed read, row still naming the
handle) leaves an orphan and logs — the recoverable direction, and the one an
orphan sweep can clean up; there is no recoverable direction on the other
side. The added read sits behind every cheap guard, so it is paid only where a
destructive delete would otherwise follow, and it is inside the same
best-effort guarantee as the delete: a rotation is never failed by it.

Latent rather than live: no shipped path reaches this, because the shipped
adapter forwards `context`. The population at risk is third-party and custom
`SettingsEngine` adapter authors — who also had no discovery path, since the
warning on `SettingsEngine.update` still described only the pre-#8063
consequence ("the rotated-away credential stays in force"). That warning now
states the real consequence, and a non-forwarding adapter announces itself in
the log instead of failing silently.
