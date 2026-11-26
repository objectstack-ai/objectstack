---
'@object-ui/react': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

fix(console): a stage move refused with a 409 in a record drawer re-reads the record, so the next Move sends the stored version

Clause-②: yes (widening) — `RecordContextValue` (and so `RecordContextProviderProps`) gains one optional member, `reread`; nothing is removed or renamed, and `refresh` keeps its type
Metadata-protocol: none

The record header's stage menu also draws in a record drawer (the list's drawer, and the drawer a record page opens over itself). Its save path answered a `409 CONCURRENT_UPDATE` by calling the record context's `refresh`, which the record view leaves out in a drawer so the header draws no Refresh entry there. In a drawer the record was therefore never read again: the dialog kept the old row, and a second Move sent the same stale version and was refused again.

`RecordContextValue` now keeps the two apart. `refresh` stays the host's opt-in to the header's Refresh entry and is still left out in a drawer. The new `reread` reads the record again with no affordance of its own; the record view provides it on the page and in a drawer alike, and the stage menu and `record:path`'s stage press call it after a move and after a 409. On the record page nothing changes: `reread` publishes the same `'*'` notice the Refresh entry does.

A host that mounts `RecordContextProvider` with only `refresh` keeps its behaviour: the stage surfaces call `reread` when the host provides it and `refresh` otherwise. Nothing to migrate; a host that wants the re-read without the Refresh entry passes `reread` alone.
