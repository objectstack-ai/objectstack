---
'@objectstack/metadata-protocol': patch
---

feat(metadata-protocol): a save that re-points a stored record-mode amount's `currencyField` answers 409 `destructive_change` with the finding `currency_field_repointed`

Clause-②: no (a narrowing: a save that answered 200 now answers 409 without `force`; owes one CONTRACT_REVIEW_TIER review before the queue, run by this seat on an isolated sub-agent)
Metadata-protocol: none

A record-mode amount is a bare number whose currency is whatever its `currencyField` names. Saving an object whose stored record-mode amount now points at another field (another sibling code field, or a `master_detail` child's `PARENT_FIELD.CODE_FIELD` path, in any of the four directions) converts no stored amount: every row is read in the currency the new field holds. The save (REST `PUT /meta`, Studio, a package publish) now answers the existing 409 `DESTRUCTIVE_CHANGE` with the finding `currency_field_repointed` on the amount field, the sibling of `currency_mode_to_record`. Re-submit with `force` to save.

- The message names the remedies that exist. A new sibling target names the code backfill (`os migrate record-currency-codes`, and its REST door `POST /api/v1/meta/_migrate-record-currency-codes`) for rows whose new code is blank. A path target names none, because the child stores no code and follows its parent.
- When the amount declared `homeAmount`, the message says its stored home amounts and rates were converted from the old code and are not re-rated by the save. It names `os migrate recompute-home-amounts --object OBJECT --field FIELD`, a shell command with no REST door, or says nothing re-rates them when the save also drops `homeAmount`.
- It reads no row, and fires only where a previous version exists: a code-declared package registered at boot is not refused. An identical pointer raises nothing. Pointers compare as written, so one that differs only in white space names another field. A field that was a formula raises nothing.
- The `currency_mode_to_record` message is unchanged, byte for byte. Its backfill clause is now one shared helper with the new finding's.
