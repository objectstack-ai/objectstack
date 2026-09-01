---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): serve a runtime-authored aggregated view container to org-scoped and environment-scoped `getMetaItems` reads (#13407)

A `defineView`-shaped container authored **live in the app** (`PUT /api/v1/meta/view/`)
was stored `active` and never reached `getViewsByObject` / `GET /meta/view?object=` —
the third occurrence of one defect, after #7163 and #7736.

**#7163/#7736 scope-boundary, named:** #7736's `hydrateExpandedViewItems` registry
hydration is reached only for an unscoped (`environmentId === undefined`) kernel writing
an env-wide (`organizationId` unset) row — its own pin never exercised anything else.
Both `applyRegistryWriteThrough` (`environmentId !== undefined` → no write-through) and
`hydrateOverlayIntoRegistry` (any `organizationId` set → refused, ADR-0005 per-org
isolation) gate the SAME registry-mutating mechanism off for the exact case this card
reports: "a signed-in user with an **active org**" on "a live **multi-node EE
deployment**". Both gates are correct and untouched by this fix — the SchemaRegistry
they guard is shared by every org/environment a kernel serves.

**What changed:** `getMetaItems` now also expands a container it reads **inline, into
that request's own response only** — never into the shared registry — so the response is
correct regardless of org/environment scope, without touching either isolation gate.
Object-name derivation (`hydrateExpandedViewItems`'s fallback chain) now also reads the
container's own top-level `object` field first (`ViewSchema.object`, previously never
consulted), before falling back to `list.data.object → form.data.object → name`.

The container-enumeration drop in `getMetaItems` is untouched: the raw container is still
never listed, only its expanded ViewItems are now also present — restoring, for the
org/environment-scoped case, the same invariant #7736 already established for the
unscoped/env-wide one.

**Out of scope, filed separately:** `getViewsByObject()` (`metadata-manager.ts`) reads a
different backing store and is not exercised by the card's own repro or pin; the artifact
loader (`packages/metadata/src/plugin.ts`) carries the identical object-derivation gap.

<!-- adr-0087: not-required (no-migration-prescription) no metadata key, spec symbol, or stored value is renamed/retired/converted — this widens what a READ (`getMetaItems`) returns for data already stored exactly as authored, not any declared metadata surface `objectstack migrate meta` would touch. -->
