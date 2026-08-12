---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): let an org-scoped caller see env-wide `sys_metadata` rows in `duplicatePackage` / `reassignOrphanedMetadata` (#7819, tier 2)

Both methods scanned `sys_metadata` with a strict `organization_id` equality:

```ts
if (request.organizationId) where.organization_id = request.organizationId;
```

`organization_id = 'org'` matches no row whose column is NULL, so an org-scoped
caller could not see any row recorded env-wide. Both scans now accept org-scoped
**or** env-wide rows — the same `$or` `deletePackage` (#7705), `listCommits`
(#7779) and the tier-1 sites (#7857) already carry.

## These two were filed UNVERIFIED, so step one was a measurement

#7819 carried four sites. Tier 1 shipped on measured evidence; these two were a
grep match with a plausible mechanism, on a **different table** (`sys_metadata`,
not `sys_metadata_commit`) with callers nobody had driven. "Latent, not live"
would have been a complete outcome and no fix. Reachability was checked on a
real engine before a line was edited, and both halves came back live:

1. **A caller passes an org.** One production caller each, both in
   `packages/runtime/src/domains/packages.ts`: `POST /packages/:id/duplicate`
   and `POST /packages/:id/adopt-orphans`, each forwarding
   `resolveActiveOrganizationId` — the same door tier 1 measured.
2. **Env-wide rows exist in that table.** Not incidentally: a `saveMetaItem`
   from a session with no active org writes `organization_id = NULL`, and
   `resolveActiveOrganizationId` answers `undefined` both for such a session and
   for any throw on the auth seam. For the orphan site, a `saveMetaItem` naming
   **no package at all still succeeds today** and lands `package_id = null,
   organization_id = null` — the current write path mints exactly the orphan the
   scan could not see, so that population is live rather than the legacy residue
   the docstring can be read as describing.

Both projected symptoms then reproduced, and both were worse than projected.

## `duplicatePackage` — a partial copy reporting success, and a copy wired back to its source

Measured before the fix: a source package holding one env-wide row and one
org-scoped row, duplicated by an org caller, answered
`{success: true, copiedCount: 1, failedCount: 0}`.

The sharper consequence is the **rename map**, which is built only from the rows
the scan returns. With the env-wide `object` rows missing it came out empty, so a
copied view was renamed `iojn2_list` while its `data.object` still read
`iojn_widget` — a duplicate silently wired back to the base it was cloned from,
reporting success. An all-env-wide source degraded just as quietly the other way:
`{success: false, copiedCount: 0, failedCount: 0}`, nothing copied and nothing
named as failed.

### Widening the scan alone was **not** a fix

With the scan widened and the write left as it was, the object copy landed in
`failed[]` with `NOT_OVERRIDABLE`: `object` is declared `allowOrgOverride=false`,
so stamping the request's org onto the copy is refused — boot hydration loads
env-wide rows only, and an org-scoped `object` row would vanish on the next
restart (ADR-0005, #6190).

Since an `object` therefore **cannot exist org-scoped**, every object row in a
source package is env-wide, and an org-scoped `duplicatePackage` could never copy
a single one. Objects being what a base is mostly made of, ADR-0070 D4's
"duplicate base" gesture was structurally unable to duplicate a base whenever an
org was active — a larger defect than the card projected.

So each copy now lands in **the scope of the row it came from**, not the
request's: the same rule #7559 gave `revertCommit`, for the same stated reason —
this loop now processes a batch that "legitimately mixes an env-wide artifact
with an org overlay". Scoped to the org-scoped door alone; with no
`organizationId` every copy is still written env-wide exactly as before.

### One hazard this fix introduces rather than inherits

Widening the scan makes a collision newly possible: an item can now appear twice,
as an env-wide row **plus** this org's overlay of it. Both copies would land on
the same target key (`type, name, organization_id, COALESCE(package_id, '')`), so
the surviving body would be decided by driver row order. The caller's own org now
shadows env-wide — ADR-0005 overlay precedence, the same order
`resolveMetaItemOrgScope` applies — and that is pinned as its own case.

## `reassignOrphanedMetadata` — the sharper member

Measured before the fix: two orphans, one env-wide and one org-scoped, adopted by
an org caller answered `{success: true, reassignedCount: 1}`, leaving the
env-wide orphan at `package_id = null` with nothing reporting it skipped.
**Finding orphans is this method's entire purpose**, so a class of orphan it
structurally cannot see is a wrong answer, not a partial one.

ADR-0070 D5 settles the scope question the widening raises (an org-scoped caller
now rebinds rows every org can see): the unit is explicitly the **environment** —
"bulk-assign legacy orphans to a default base named for the environment",
completing when "an environment has no orphans" — in a deployment model whose own
words are "there is no per-org overlay dimension here… the relevant axis is code
package vs writable base, not 'org'". Under the model this method was designed
for, every orphan is env-wide, so the strict equality made it **inert** for an
org-scoped caller in precisely that deployment.

## The no-org branch is deliberately NOT narrowed

On both sites, exactly as #7705, #7779 and tier 1 left theirs. The exposure is
worst at `reassignOrphanedMetadata`, whose no-org `where` is `{}` and already
scans every organization's rows; narrowing either door to `organization_id IS
NULL` would re-create this bug pointed the other way. Both doors are pinned as
they stand so they cannot drift silently. Whether the orphan door *should* be
that wide is #7780's open product question — a maintainer call, not decided here.

## Pin

`packages/runtime/src/package-duplicate-adopt-org-scope.integration.test.ts` — a
real `ObjectQL` over a real `SqlDriver` on better-sqlite3, seeded through the real
publish path, because the question is whether `organization_id = 'org'` matches a
NULL column: a property of the driver's SQL, not of a stub's `filter()`. Every
existing suite over these two methods either stubs `engine.find`
(`packages/objectql/src/protocol-package-lifecycle.test.ts`) or never passes an
org (the ADR-0070 dogfood), which is exactly why none could see this family. It
lives in `packages/runtime` because `metadata-protocol` cannot import `objectql`
(dependency cycle).

Twelve cases: the premise measured out of SQLite; the live-orphan producer; the
positive for each site; the reference-rewrite consequence; the org-shadows-env
precedence; both negative directions per site (another organization's rows,
another package's rows, owned rows); and the no-org door on each site.

**Reverse verification**, direction predicted before running: restoring the strict
equality turns red exactly the two positives, the reference-rewrite case, and the
two orphan cases that assert the env-wide orphan is adopted — five — leaving the
negative directions and both no-org doors green, since strict equality is
*narrower* than the `$or`. Measured: **5 failed | 7 passed**, exactly those five.

⚠️ These suites resolve `@objectstack/metadata-protocol` through its **`dist`**
and source-map traces back to `src`, so a source-only revert measures nothing
while looking like it measured something. The package was rebuilt between every
measurement above.
