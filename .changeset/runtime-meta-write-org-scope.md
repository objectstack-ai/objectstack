---
"@objectstack/runtime": minor
---

fix(runtime): a metadata write carries the session's organization only for types that declare `allowOrgOverride` (#7018)

The dispatcher threaded the caller's active organization into
`protocol.saveMetaItem` **unconditionally**, and `SysMetadataRepository.put`
stamps `organization_id` for every type. So any session with an active
organization minted an org-scoped `sys_metadata` row even for types the registry
declares NOT per-org overridable — and cold boot (`loadMetaFromDb`) hydrates
`organization_id IS NULL` only.

Those rows were **phantom writes**: correct for the life of the process, silently
absent after the next restart. The measured specimens are the ones #6190 filed —
a `flow` authored in Studio binds its triggers, fires all day, and stops firing
after a restart with nothing said; an `object` written the same way 404s every
record. For `allowOrgOverride: true` types (`view`, `dashboard`, `report`,
`translation`, `email_template`) the same skip is the ADR-0005 design, because
those overlays are loaded on demand by `getMetaItem`/`getMetaItems`.

Both runtime write sites now consult the type's registry declaration:

- `PUT /api/v1/meta/:type/:name` — the active organization rides the write only
  when the target type declares `allowOrgOverride: true`. Otherwise it is
  dropped and the write lands env-wide, producing exactly the row (and exactly
  the receipt) a session with no active organization already produces today.
- `POST /api/v1/packages/:id/publish-drafts` — the ADR-0045 §3 visibility flip
  writes `app` (`allowOrgOverride: false`), so it now lands env-wide, on the row
  cold boot hydrates and the App Switcher reads. The org-scoped flip was itself a
  phantom: the app looked published until the next restart and then went back to
  `_unpublished: true`, because the env-wide row it left untouched is the only
  one boot loads.

The predicate is derived from `DEFAULT_METADATA_TYPE_REGISTRY`, so a registry
entry flipping `allowOrgOverride` moves the runtime with it — there is no second
list to keep in sync. It deliberately does **not** consult the
`OS_METADATA_WRITABLE` escape hatch: that hatch unlocks the *write*, and an
env-unlocked type's org rows are hydrated no more than any other's, which is the
same call `reportUnhydratableOrgScopedRows` already made on the read side.

No authoring change and no new refusal: writes that succeeded still succeed, with
the same response body. What changes is which partition the row lands in for
types that never had a per-org read channel.

Part of the #6190 maintainer ruling (Option A, runtime half).
