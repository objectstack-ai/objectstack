---
"@objectstack/plugin-sharing": patch
---

Repair the ADR-0090 `sys_role` → `sys_position` rename in the ja-JP object
translation bundle, and extend the mechanical guard to cover it.

`sys_record_share.fields.recipient_id.help` still read "...ユーザー/グループ/ロールの
ID" — naming the pre-rename `role` concept — while the same bundle already
rendered the renamed concept correctly, twice, as `ポジション`
(`recipient_type.options.position` on both sharing objects), and the English
source for this exact leaf says `position`. Japanese-facing admins saw the
stale word in the Setup field-help tooltip for Record Share's `Recipient` field.

`recipient-vocabulary-consistency.test.ts` (added when the es-ES half of this
same rename damage was repaired) now asserts a ja-JP stale-term rule alongside
the existing es-ES one, generalised into one per-locale table so a future
locale's rule is one entry, not a parallel `describe` block. The ja-JP pattern
excludes `ロールアップ` (rollup) and `ロールバック` (rollback) by lookahead rather
than `\b`, which does not bound katakana in JS regex (`\w` is ASCII-only) and
would otherwise match nothing at all.
