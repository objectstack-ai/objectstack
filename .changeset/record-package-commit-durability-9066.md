---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a failed `sys_metadata_commit` write is reported instead of swallowed — the turn that cannot be reverted is now visible to an operator (#9066)

`recordPackageCommit` — the ADR-0067 commit writer `publishPackageDrafts` calls
with the revert plan it just captured — sat behind a bare `catch` that answered
`null` for every reason, with nothing logged. The comment's premise was true
(the publish already succeeded and cannot be unwound) but its conclusion —
"grouping is a best-effort overlay" — understated the row: `sys_metadata_commit`
is the ONLY record of a turn's revert plan (`existedBefore` / `prevVersion` per
artifact), the thing `revertCommit` and `rollbackToPackageCommit` act on. When
the insert failed, the artifacts went live, the response read `success: true`
with `commitId` merely absent, the turn could never be reverted, and no line
anywhere said so — so a commit store that was failing kept failing, losing every
later publish's plan the same silent way.

The failure is now discriminated by error TYPE, through the shared
`isMissingTableError` predicate the read seams in this file already ask:

- an **unprovisioned** `sys_metadata_commit` (a first boot, or an environment
  kernel composed without the commit log) is a configuration fact, identical on
  every publish and fixed in one place — reported at `info`, once per protocol
  instance, naming the consequence and how to provision the store;
- **every other** failure (connection drop, timeout, permission denial, schema
  drift on that table) is a durability degradation and is reported at `error`,
  once per turn, naming the package, the operation, the item count, the driver's
  own reason, that the publish itself succeeded and still reports success, and
  the fix.

Publish semantics are unchanged: the `catch` still returns `null`, the publish
still succeeds, and no response field was added — whether the caller should be
told the turn is unrevertible is a separate, undecided question.

The gate that stops this from regressing is extended in the same change: the
insert now goes through a named `persistPackageCommitRow`, declared in
`DURABILITY_CRITICAL_CALLEES` in
`scripts/check-durability-degradation-log-level.mjs`, so a future edit that
quiets this `catch` fails CI instead of shipping.
