---
'@objectstack/lint': patch
---

feat(lint): warn on a `private` synced object that no sharing rule grants read on

Clause-②: no
Metadata-protocol: none

ADR-0153 D4. A pull writes the rows of a `managedBy: 'synced'` object with no person owner, so on `sharingModel: 'private'` a member sees only the rows a share grants them. With no sharing rule that grants read, a member whose permission set grants `allowRead` lists no row at all, and the author finds out from an empty list.

- **New advisory rule `security-synced-private-unreadable`** (`os validate`, `os compile`, `os dev`). It fires on an object with `managedBy: 'synced'` and `sharingModel: 'private'` when no sharing rule in the stack grants read on it. Its fix line names the same two ways out `security-owd-unset` gives a synced object: `sharingModel: 'public_read'` (recommended), or `'private'` with a sharing rule that grants read.
- **What counts as granting read:** a sharing rule whose `object` names the object, that is not `active: false`, and whose `accessLevel` is `read` or `edit` (absent reads as `read`). Any recipient and any `condition` count.
- **Not judged:** a synced object with no `sharingModel` (already the `security-owd-unset` error, with the same fix line), and any model other than `'private'`.
- `os explain security-synced-private-unreadable` explains the mechanism. The rule id and `validateSyncedPrivateReadability` are exported from `@objectstack/lint`.

It is a warning, not an error: the stack stays valid, and nothing that was accepted before is refused.
