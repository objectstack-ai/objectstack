---
"@objectstack/service-storage": minor
---

feat(storage): released field files enter collection on deployments that verified their file migration — ADR-0104 D3 wave 2 PR-5b (#3459)

The gated, final step of the file-as-reference sequence. On a deployment whose
`adr-0104-file-references` flag is verified (`os migrate files-to-references
--apply`, #3617), releasing a field file's ownership — clearing the field, or
deleting the owning record — now also tombstones the file
(`status='deleted'` + `deleted_at`), which starts the `sys_file` lifecycle's
declared 30-day grace window and, at its end, hands the row to the reap sweep.
Re-referencing the id inside the window revives it, exactly like re-attaching
an attachment.

**The two halves ship together, deliberately.** The same change extends the
reap guard's sweep-time re-verify beyond `sys_attachment` join rows to the
ownership columns: a tombstoned file whose `ref_*` columns name a current
owner (re-claimed in the window, or a release/claim race) is un-tombstoned and
vetoed. Tombstoning released files without that re-verify would have turned
every release into a *guaranteed* byte delete — the guard's old check consults
a table that is always empty for field files. This pairing was the standing
hard constraint on #3459, locked by regression tests on both halves.

**Nothing changes for a deployment that has not migrated.** Release keeps
clearing the ownership columns only, and released files are retained forever.
Every way of not knowing — no flag row, an unreadable table, an engine that
cannot be asked — reads as "not verified": the gate fails closed, toward
retention. And the guard re-reads the flag *fresh* at sweep time (not the
release path's memoized read), so a later failing migration run — a database
that has drifted — closes the gate for already-written tombstones too, without
a restart. Attachments-scope collection is unchanged and needs no flag.

The irreversible moment is therefore per deployment: day 30 after *that*
deployment verified its migration and released a file — never the upgrade
itself.
