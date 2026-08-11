---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): let an org-scoped caller revert an env-wide commit (#7819, tier 1)

`revertCommit` and `rollbackToPackageCommit`'s target lookup each resolved
their target commit with a strict `organization_id` equality:

```ts
const where = { id: request.commitId };
if (request.organizationId) where.organization_id = request.organizationId;
```

`organization_id = 'org'` matches no row whose column is NULL, so an org-scoped
caller got `COMMIT_NOT_FOUND` (404) for any commit recorded env-wide — a row
that demonstrably exists and that the **same caller's** `listCommits` hands
back. Both lookups now accept org-scoped **or** env-wide rows, the same `$or`
`deletePackage` (#7705) and `listCommits` (#7779) already carry.

Env-wide commit rows are not hypothetical: `recordPackageCommit` stores
`request.organizationId ?? null`, and the publish door forwards an org only when
`resolveActiveOrganizationId` yields one — a resolver that answers `undefined`
for a session with no active organization *and* for any throw on the auth seam.
A publish made before an org was selected lands its commit env-wide,
permanently, since the timeline is append-only.

**User-visible change.** An org-scoped rollback past an env-wide publish now
performs the rollback instead of refusing it. #7814 had already converted this
from silent to loud (pre-#7814: `{success: true, revertedCommits: []}` with the
changes still live; after it: `success: false` naming the commit), so this
closes a blocked-but-attributable operation rather than a silent data defect.

## Why the `$or` here, and not the other two remedies

Unlike the earlier members of this family, `where` is keyed on `id` — a
primary-key lookup — so the org predicate reads like an **authorization filter
on a unique key** rather than scan scoping, and widening it would be widening an
authorization boundary. Measured against the only door, it is not one:

1. Authorization on `POST /packages/:id/commits/:commitId/revert` and
   `POST /packages/:id/rollback` is `requireManageMetadata`, checked **before**
   the protocol call. The org never gates the call.
2. The `organizationId` that arrives is the session's *active org selection*
   from `resolveActiveOrganizationId`, whose body is entirely `catch`-wrapped.
3. On any auth-seam throw it answers `undefined`, which **omits** the predicate
   — the widest reading, every organization's commits. A boundary that fails
   **open** is not a boundary.

That rules out remedy 3 (keep the check, distinguish "not yours" from "no such
commit"): there is no authorization here to make precise, and asserting one
would be inventing a boundary, not repairing one. Remedy 2 (drop the predicate
outright, defensible on an id lookup) was rejected because it would newly let an
org caller revert **another organization's** commit by id — a widening this card
never asked for. The `$or` admits the env-wide rows and refuses that one.

The decisive in-code evidence is that the **body already accepted what the
lookup refused**: #7559 made `revertCommit` resolve each item's scope from the
row rather than the request, precisely because "a batch legitimately mixes an
env-wide artifact with an org overlay". `rollbackToPackageCommit` made the
contradiction self-evident — since #7814 it plans from `listCommits` (org +
env-wide) and fed each id straight back into a lookup that refused half of them.

The **no-org branch is deliberately not narrowed** to `organization_id IS NULL`,
exactly as #7705 and #7779 left theirs: the direct-mount REST registrar passes
no `organizationId` at all, and restricting that door to env-wide rows would
make every org-scoped commit unrevertable — the same bug pointed the other way.

## Pin

`packages/runtime/src/package-revert-commit-org-scope.integration.test.ts` — a
real `ObjectQL` over a real `SqlDriver` on better-sqlite3, seeded through the
real publish path, because the question is whether `organization_id = 'org'`
matches a NULL column: a property of the driver's SQL, not of a stub's
`filter()`. (It lives in `packages/runtime` because `metadata-protocol` cannot
import `objectql` — dependency cycle.) Eight cases: the premise measured out of
SQLite, the positive for each site, **both** negative directions (another
organization's commit refused on each site; another package's commits not
reached by the planner), and the no-org door on each site. Refusals are asserted
on `code` **and** `status` per ADR-0112, never on "it threw".

`package-list-commits-org-scope.integration.test.ts` (#7814) carried the handoff
assertion that pinned this defect as known-incomplete
(`rollback.success === false`, `failed == [c2]`); it now asserts the rollback
succeeds and reverts `c2`, and survives as the family's end-to-end case.

**Reverse verification**, direction predicted before running: restoring the
strict equality turns exactly the two positive cases red plus the updated
handoff assertion, and leaves both negative directions and both no-org doors
green, since strict equality is *narrower* than the `$or`. Measured: 3 failed |
11 passed, exactly those three.

## A blind test double, taught rather than accommodated

`packages/objectql/src/protocol-commit-history.test.ts` went red on two
org-scoped revert cases. Measured, not assumed: its `matchesWhere` was pure flat
equality, so it compared `row['$or']` against the array and matched nothing.

The double was the blind party, not the fix — both failing rows carry the
**caller's own** org (`organization_id: 'org_a'`, request org `'org_a'`), so
they match the first `$or` branch outright: the same row the strict equality
already accepted. Neither case's subject (#6602's registry org-asymmetry)
involves the commit lookup at all; it is merely the door they enter through.

It now understands `$or`/`$and`, **conjoined with the sibling keys in the
entries loop** — the corrected form #7846 landed across six doubles in this
package (part of #7620), not the early-returning `if ($or) return …some(…)`
shape those six carried before it. That shape discards sibling keys, so
`{ id, $or: [...] }` would stop constraining `id` and the lookup could return
some *other* commit whose org matched. This file was not among #7846's six
because it had no operator handling to correct, so it reads as a new member of
the #7620 lane rather than a regression of it.

⚠️ Recorded deliberately: this makes the double a *reimplementation* of `$or`,
so any assertion whose **subject** is the org predicate would be measuring the
double rather than the protocol. No case in that file has that subject — which
is exactly why it could never see this family — and a comment there says so and
asks that org-scoping cases not be added. The operator's real behaviour against
a real driver stays pinned on the real engine in `packages/runtime`.

## Scope

Tier 1 of #7819 only. The two remaining strict equalities in this file —
`duplicatePackage` and `reassignOrphanedMetadata`, a different table
(`sys_metadata`) whose step one is the unanswered "are these states even
reachable" — are deliberately untouched, and #7819 stays open to carry them.
