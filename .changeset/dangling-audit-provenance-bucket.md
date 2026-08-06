---
"@objectstack/objectql": minor
---

feat(objectql): the dangling-reference audit stops skipping `readonly`
references and files them in their own `provenance` bucket (#4743)

`auditDanglingReferences` used to drop every `readonly` reference field before
reading a single row. That skip rested on two grounds, and #4556 removed one of
them: the platform no longer writes a NON-ID into a reference column
(`sys_metadata_history.recorded_by` stored the sentinel string `'system'`; it
stores `NULL` now). What the skip still covered afterwards was exactly one
family — the audit-provenance fields `created_by` / `updated_by` /
`organization_id` that `applySystemFields` injects, all `readonly: true`.

Those hold **genuine ids, and genuine ids dangle**: delete one user and every
row they ever created points `created_by` at a row that is gone. "Who did this"
failing to resolve is precisely the question an audit trail exists to answer,
so the remaining skip was blindness rather than economy. The audit now probes
them.

**They do not join `dangling`.** A deleted actor and a broken business foreign
key are different findings with different remedies (usually nothing to do vs.
re-seed the target or clear the link), and merging them would bury the second
under the first. Two new report keys carry the new class, mirroring the
unknown/absent split the report already makes everywhere else:

| Key | Means |
|:--|:--|
| `provenance: DanglingReference[]` | a `readonly` provenance reference that resolves to nothing — same row shape as `dangling` |
| `provenanceUndetermined: number` | a provenance reference whose target could not be probed at all |

Both are **additive and optional in the type**, exactly like `aborted`: an
existing consumer keeps compiling and keeps reading `dangling` with its meaning
unchanged (a link the model *declares* is broken). Every report this module
produces sets both explicitly.

⚠️ **Expect `provenance` to be large on the first run against an aged
database.** One deleted user dangles every row they ever touched. That number
is pre-existing state being reported for the first time — not damage the audit
caught being done, and not a regression introduced by looking at it.

For the same reason `provenance` **alone does not raise the summary warning**.
On a database of any age it is non-empty on every healthy run, and a line that
always fires is the #4747 broken alarm again — it would train its reader
straight past the run where `dangling` had something in it. The counts ride
along in the payload whenever the line fires for a real finding, and the
itemised rows are always in the returned report. `provenanceUndetermined` is
separate from `undetermined` for the same reason: on a stack that never
registers `sys_user`, every provenance value probes "cannot tell", and that is
a fact about which platform tables are mounted, not about the audited data.

Scan order gained a third tier to keep the change from costing the signal it
sits next to: security surface, then objects carrying a business reference,
then the provenance-only remainder. Admitting the family means nearly every
object now has an auditable field, so without the tier a bounded run would
spend its row budget on tables carrying only provenance and never reach the
business findings the budget was built for.

Part of #4743 (fact 2). The stale `assertReferencesResolve` comment in
`engine.ts` (fact 1) is deliberately untouched here.
