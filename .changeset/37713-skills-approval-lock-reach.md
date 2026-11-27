---
'@objectstack/skills': patch
---

docs(skills): the automation skill says a record under approval can still be deleted

Clause-②: no
Metadata-protocol: none

Published prose only; no behaviour changes.

`objectstack-automation` `references/state-machines-and-approvals.md`:

- Best practice 2 now says that deleting a record whose approval is pending is not refused: the delete lands, cancels the request and cascades the record's `master_detail` child rows. It is refused whole with `409 RECORD_LOCKED` only where that cascade has no single transaction to run in, or a child row has a second cascading parent.
- The `lockRecord` config row states its bound again: it locks the record from edits.
- Best practice 2 no longer names a parent field group as a way a `lookup` child is shown in the record's details: a group places a `lookup` child only when it already declares `relatedList: 'primary'`.

The file did not grow past its ceiling: each addition is paid for by deletion in the same file.
