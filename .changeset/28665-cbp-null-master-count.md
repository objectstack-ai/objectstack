---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the 409 `DESTRUCTIVE_CHANGE` that makes a `controlled_by_parent` detail's master required now counts the stored rows with no master and says they become unreadable to everyone

Clause-②: no
Metadata-protocol: none

Saving "Controlled by parent" on a detail whose `master_detail` was not required answers 409 `DESTRUCTIVE_CHANGE` with a `field_required_no_default` finding. Its message said only that "existing rows with null values may fail validation". Under `controlled_by_parent` a row with no master has no reader at all (ADR-0055 §1, fail-closed): after publish the list answers `total: 0` and the by-id read and write answer 404, for the admin too, while the row stays stored.

- **What the finding says now.** When the saved body is `controlled_by_parent` and the finding is on its `master_detail` field, the save door counts the stored rows whose master is null. If there are any, the finding's `message` (and the 409's own text) says how many, that they become unreadable through every door once the object is controlled by its parent, the admin's included, and to set the master on them first.
- **Unchanged.** The finding's `code` and `field`, the 409 itself and `?force=true` behave as before; no code or member is added. With no masterless row, or when the count cannot be answered, the message is byte-identical to before. Access derivation is not touched.
- **Cost.** One system-authority `count` on that column per matching finding. No other save issues a query, and a forced save issues none.
- **The Studio confirm.** `PackageOwdOverviewPanel` already lists each `issues[].message` in its confirm, so the count reaches the author there with no console change.
