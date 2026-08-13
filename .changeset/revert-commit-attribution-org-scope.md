---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): attribute a revert commit to the scope of the commit it reverts (#7860)

`revertCommit` recorded its compensating commit under the **requesting
session's** organization:

```ts
const orgId = request.organizationId ?? null;
// …
await this.recordPackageCommit({ orgId, packageId: row.package_id, … });
```

`packageId` on that same call is already read off the reverted `row`; the org
was the one field still taken from whoever asked. It now reads
`row.organization_id ?? null` — the rule #7559 gave this function's **items**
(`resolveMetaItemOrgScope`) and #7819 tier 2 gave `duplicatePackage`'s copies,
applied to the commit **record** that documents them.

## Filed as a question, settled by measurement

The card was explicit that this was **not** filed as a defect: the behaviour is
self-consistent for the caller who performed the revert, and it asked for a
measurement before any choice between "attribute to the request" and "attribute
to the reverted row". Measured on a real ObjectQL + `SqlDriver`
(`better-sqlite3`), after an org-scoped revert of an env-wide commit:

| reader | before | after |
|:--|:--|:--|
| the actor (`org_active`) | `[revert, apply]` | `[revert, apply]` |
| **a different organization** | **`[apply]`** | `[revert, apply]` |
| no-org (direct-mount REST) | `[revert, apply]` | `[revert, apply]` |

The middle row is a concrete reporting defect, which is what settled the
question rather than a preference. What makes it more than cosmetic is the
artifact state measured alongside it: `sys_metadata` held **no** row for the
reverted view afterwards. Items revert in the **row's** scope (#7559), so the
artifact really was withdrawn env-wide — the effect was global while the record
was private, and a reader in another organization saw an `apply` commit that
was never compensated for an artifact already gone. Since #7814
`rollbackToPackageCommit` **plans** from `listCommits`, so this list is not
merely an observability surface.

The mirror direction is the same mismatch pointed the other way, and the same
line fixes it: a no-org caller reverting an **org-scoped** commit stamped the
revert env-wide, so every other organization read a dangling `Revert: …` whose
`parentCommitId` names a commit that door cannot see. Measured before:
`[revert]` for an unrelated org; after: `[]`.

The invariant both collapse to: **a revert commit is visible to exactly the
readers who can see the commit it reverts.**

## Reachability

Only since #7819 tier 1. Before it the target lookup answered
`COMMIT_NOT_FOUND` (404) for an env-wide row, so an org-scoped caller could not
reach the attribution line with a mismatched scope at all — a dormant quirk
whose reachability was created by a fix in the same function.

## Verification

`packages/runtime/src/package-revert-commit-attribution-org-scope.integration.test.ts`
— real engine, real driver, seeded through the real publish path (a stubbed
`engine.find` cannot see NULL semantics). Ablation, with a rebuild between
measurements because these suites resolve `metadata-protocol` through its
`dist`: restoring the request-derived `orgId` turned exactly 3 of the 4 cases
red — `expected [ 'apply' ] to deeply equal [ 'revert', 'apply' ]` — and left
green precisely the case predicted to be unaffected, the actor's and the no-org
door's timelines. The sibling #7819 and #7814 suites stay green (18/18).
