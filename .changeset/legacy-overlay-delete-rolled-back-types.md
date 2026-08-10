---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a legacy env overlay on a rolled-back overlayable type can be REMOVED again (#6960)

#6483 / PR #6608 flipped `permission` / `position` / `page` / `app` / `dataset` /
`book` to `allowOrgOverride: false`. That closed the **write** door and
deliberately left the **read** path alone — `supportsOverlay` stayed `true`, so
an overlay row authored *before* the rollback still merges overlay-wins and
still shapes the effective body.

Removing such a row was refused, at two places and on two different topologies:

- `deleteMetaItem`'s `environmentId !== undefined` branch answered
  `403 not_overridable` **before** it ever probed for the row — so even an
  artifact-backed item with nothing customized was refused;
- `SysMetadataRepository`'s delete gate refused the same removal
  `intent: 'override-artifact'`, and that check is **topology-independent**, so
  a control-plane kernel (no `environmentId`, which skips the first gate
  entirely) was refused there instead.

Net effect for an environment that upgraded across the rollback while holding
such a row: the ordinary "Reset to package default" flow answered 403 with the
item still customized, and `OS_METADATA_WRITABLE` was the only documented way
out.

**What changes.** Per the maintainer's ruling of 2026-08-10, the **delete** side
moves: removing an overlay of a type whose loader merges overlays at read time
is allowed through the ordinary delete path, on both kernel topologies, without
the operator hatch. Deleting an overlay restores the code-declared state — the
narrowing direction, which cannot widen anything — so refusing it served no
security purpose while trapping the repair behind an escape hatch.

**What does NOT change, deliberately.**

- **Create and update stay refused exactly as before.** The asymmetry is the
  ruling, not an oversight: `saveMetaItem`'s gate and `SysMetadataRepository.put`
  are untouched, and both gates' doc comments now record why, so the asymmetry
  is not later "fixed" into symmetry.
- **The `object` tier does not move.** The relaxation is keyed on the registry's
  `supportsOverlay` flag, not on `allowOrgOverride`, so it stops at the tier
  boundary: `object` declares `supportsOverlay: false` (its overlay registers as
  its own contributor layer, ADR-0029 D9) and keeps refusing both verbs, which
  is D9.6's declared cost.

Zero affected rows in the in-repo corpus today (measured at PR #6608), so this
is a correctness-of-contract change with no live victim.
