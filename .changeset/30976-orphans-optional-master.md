---
'@objectstack/cli': patch
---

fix(cli): `os db orphans` sweeps details whose controlled-by-parent master is optional

Clause-②: no
Metadata-protocol: none

A `controlled_by_parent` object may declare its one master as an optional `master_detail` (`required: false`). `os db orphans` read only required masters, so a detail row of such an object that still named a master that no longer exists was never reported, and `--delete` never removed it. The sweep now reads that optional master too, judged by `controlledByParentMasterOf` from `@objectstack/spec/data`: a row naming a missing master is reported (and deleted with its cascade under `--delete`, after the pre-delete export), and a row that names no master is valid and is never listed. A lone optional `master_detail` on an object that is not `controlled_by_parent`, or one beside a required master, stays an ordinary reference: named, never deleted.
