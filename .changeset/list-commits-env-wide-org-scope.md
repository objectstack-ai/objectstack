---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `listCommits` no longer hides a package's env-wide commit history (#7779)

`protocol.listCommits` selected the ADR-0067 timeline with the same strict
`organization_id` equality that #7705 (PR #7771) had just replaced one function
above it:

```ts
const where = { package_id: request.packageId };
if (request.organizationId) where.organization_id = request.organizationId;
```

`organization_id = '<org>'` matches no row whose column is NULL, so a session
with an active organization was shown **none** of the commits recorded
env-wide. The commits were in `sys_metadata_commit` the whole time; the read
could not see them.

**Env-wide commit rows are actually written — this was live, not latent, and
that was measured before the fix was written.** `recordPackageCommit` stores
`organization_id: request.organizationId ?? null`, and the only door into a
publish (the dispatcher's `POST /packages/:id/publish-drafts`) forwards an
organization only when `resolveActiveOrganizationId` yields one. That resolver
answers `undefined` both for a session with no active organization and for *any*
throw on the auth seam, since its whole body is `catch`-wrapped. A publish made
before an organization is selected — or during a transient auth failure — is
therefore recorded env-wide permanently, because the timeline is append-only.
Driven on a real engine over SQLite, a no-org publish wrote
`organization_id: null` and the org-scoped read of that same package then
returned `[]`.

**The blast radius is wider than audit.** `rollbackToPackageCommit` derives the
set of commits it must undo *from this list*, so a commit the list could not see
was a commit the rollback silently skipped: measured before the fix, an
org-scoped rollback past an env-wide commit answered
`{success: true, revertedCommits: []}` while that commit's changes stayed live.
A rollback that reports success and rolls back nothing is a correctness defect,
not a reporting one.

An org-scoped read now matches its own organization **or** env-wide — the
`$or [{organization_id: oid}, {organization_id: null}]` shape this package
already uses for the #3115 "orphaned draft" fix, the shape #7705 applied to the
sibling `deletePackage` read, and the shape the SQL driver's own implicit tenant
wall uses (`field = :tenant OR field IS NULL`, #2734).

Both directions that must not widen are pinned: another organization's commits
stay invisible to an org-scoped read, and another package's commits are never
returned. Newest-first ordering is unchanged. The **no-org** branch is
deliberately left package-wide rather than narrowed to `organization_id IS
NULL` — narrowing it would hide every org-scoped commit from that door instead,
re-creating this bug pointed the other way, which is exactly why #7705 left its
own no-org branch alone.

**Known remaining gap, reported on #7779 rather than fixed here** (this card
holds `protocol.ts`, a serialized file, for `listCommits` alone): `revertCommit`
and `rollbackToPackageCommit`'s own target lookups still carry the identical
strict equality. The consequence is now *loud* instead of silent — the rollback
above reports `success: false` naming the commit it could not resolve, rather
than claiming success over a no-op. That is strictly better and non-destructive,
but it is not the whole repair, and the new suite asserts it so the remainder
cannot drift unnoticed before its own card lands.
