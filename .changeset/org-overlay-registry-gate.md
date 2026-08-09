---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): an org-scoped overlay row no longer reaches the process-wide SchemaRegistry (#6602)

ADR-0005 (revised 2026-05) says only **env-wide** rows (`organization_id IS NULL`)
enter the process-wide `SchemaRegistry`; per-org overlays are served on demand and
never grafted into the registry every org in the process shares. The registry has
exactly one plain key per `(type, name)` and no org dimension to hold two orgs'
bodies apart, so a per-org body sitting under that key IS the other orgs' body.

Boot obeyed the rule — `loadMetaFromDb` filters `organization_id: null` and says so
in its own comment. Both **runtime** seams did not:

- **The write-through.** `applyRegistryWriteThrough` gated on `environmentId` alone.
  Its TSDoc already claimed the rule ("a project-scoped row must not be registered
  into a registry that unscoped callers share. The write must not be more permissive
  about that than the read is") while the code said nothing about `organization_id`.
  On an unscoped kernel a per-org `view` write hydrated straight into the registry
  under the plain key.
- **The read hydration.** `getMetaItems` merges this caller's org rows into the
  env-wide set and then hydrated the whole merged set under the same
  `environmentId === undefined` gate — so one org-scoped listing call grafted that
  org's bodies too, and would have undone a write-side-only fix at the next listing.

Both were observable rather than theoretical: once org A's body sat under the plain
key, org B's listing started from org A's body, and where the names did not collide
org A's item was simply **in** org B's list. Per #5086 a host config boots
`new ObjectQLPlugin()` with no `environmentId`, so the flagship showcase runs on
exactly this kernel shape.

**The fix restores the stated invariant at both seams at once, in one place.**
`hydrateOverlayIntoRegistry` is the single choke point all three hydration callers
(boot, read-side, write-through) already route through since #4521, so the row-scope
verdict now lives there — and its `organizationId` argument is **required**, not
optional: an omitted org would default to "env-wide" and reinstate the hole, while a
required one makes every caller state the row's scope to compile. The kernel-scope
gate (`environmentId === undefined`) stays with the callers, because that is a fact
about the kernel, not about the row.

Not changed, deliberately:

- **What org readers see.** The merged listing, `getMetaItem`'s org-preferred read,
  and the org-scoped write itself are all untouched — this closes a registry leak,
  never a write or a read. Per-org overlays keep working exactly as ADR-0005
  designed them: served on demand.
- **#4521 read-your-writes.** An env-wide save is still dispatchable the moment it
  lands, with no listing call in between.
- **The `object` branch.** An `object` is `allowOrgOverride: false` and its physical
  table is env-wide, so the registry entry backing it is env-wide too;
  `assertObjectRegistered` fails closed on a missing entry, so gating that branch
  would make a runtime-created object unreachable for data CRUD rather than merely
  un-listed. That branch has never carried the `environmentId` gate either, for the
  same reason.
- **The delete chain.** `restoreArtifactRegistryView` stays `(type, name)`-addressed:
  with both entry seams refusing org rows there is nothing org-scoped in the registry
  for it to mis-address, so no re-keying is needed (pinned in both directions).
