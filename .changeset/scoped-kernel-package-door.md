---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the metadata write refusal stops depending on deployment topology (#8184)

`PUT /api/v1/meta/object/showcase_task?package=READONLY_PKG` answered **two
different machine-readable codes for one condition**, selected by the kernel's
`environmentId` — a row-scoping key, not a topology declaration:

| kernel | answer |
| --- | --- |
| host-config / CLI lightweight assembler (`environmentId` undefined — the flagship showcase, self-hosted servers) | `403 ITEM_LOCKED`, `lockSource: 'package'` |
| project / cloud per-environment kernel (`environmentId` set) | `403 NOT_OVERRIDABLE` — the package was never read |

`saveMetaItem` carries its own artifact-backed refusal behind
`if (this.environmentId !== undefined)`, and it threw before
`SysMetadataRepository.assertAllowed` — the topology-independent package door
(#7682, then #8146's hatch ruling) — ever ran. So a client that learned to
handle `ITEM_LOCKED` on a self-hosted deployment never saw it on a cloud one,
and an operator reading `NOT_OVERRIDABLE` was told the type had no overlay
channel when the real obstacle was the read-only base they had named.

Not a regression: that branch answered `NOT_OVERRIDABLE` before #8185 and
#8320 too. Those cards made the divergence visible by fixing the other half.

**The scoped branch now consults the same `isWritablePackage` predicate and
throws the repository's own emitter** — called, not copied — so the code, the
status, `lockSource`, `packageId` and the sentence are byte-identical on both
topologies, and neither door can drift when the other moves.

**Same limb ordering as the repository, because the ordering is the rule:**

- **Below every registry limb.** The branch is guarded by `!overlayAllowed`, so
  an `allowOrgOverride` type never reaches the door. An ADR-0005 org overlay of
  a code-shipped item *always* names the read-only package it customizes; a
  door one limb higher would close the overlay model outright.
- **Above the hatch limb.** `isOverlayAllowed` folds `OS_METADATA_WRITABLE` in,
  so an open hatch takes the write past this branch to the repository door,
  which applies the same rule with its own hatch-aware remedy — the refusal
  never prescribes the step the caller already took. Both directions pinned.

**Narrow, exactly as the repository is.** Only a write that *names* a read-only
base is re-coded; a package-less write keeps `NOT_OVERRIDABLE` verbatim, and a
package-less hatch write still lands `{ package_id: null, organization_id: null }`
env-wide and `{ package_id: null, organization_id: <org> }` under an org kernel.
Refusing a hatch write that names no read-only base (the broad reading) would
retire the hatch's only documented use and remains a maintainer decision plus a
docs/ADR change.

The `runtime-only` create side needed no change: the ADR-0070 D1 gate further
down `saveMetaItem` is already topology-independent and already answers
`422 WRITABLE_PACKAGE_REQUIRED` on every kernel.
