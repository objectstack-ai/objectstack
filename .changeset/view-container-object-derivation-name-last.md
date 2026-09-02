---
"@objectstack/metadata": minor
"@objectstack/objectql": patch
---

fix(objectql,metadata): the ObjectQL boot loop derives a view container's object through the shared `deriveViewContainerObject`, so the row's own `name` is the LAST term at every SOURCE registrar (#14399)

Three sites derive "which object does an aggregated `defineView` container bind
to". After #13407 / #13913 / #13912 all three read the container's own top-level
`object` before the `list.data.object` chain, but they still disagreed about the
row's own `name`:

- `packages/objectql/src/engine.ts` `resolveMetadataItemName('views', item)` —
  the boot-loop SOURCE registrar — read `name` FIRST, before `object`;
- `deriveViewContainerObject` (`@objectstack/metadata`, used by the artifact/HMR
  SOURCE registrar and by `getViewsByObject()`) and `expandRuntimeViewContainer`
  (`@objectstack/metadata-protocol`, the runtime door) both read `name` LAST.

A container written as `{ name: 'lead_views', object: 'crm_lead', list: { … } }`
therefore registered under `lead_views` through the boot loop and under
`crm_lead` everywhere else, with the whole expansion (`<object>.<key>`) carried
along — and since `getViewsByObject()` / `GET /meta/view?object=` filter the
expanded items by their `object`, which registrar loaded the document decided
whether the views were addressable under the object at all. No error, no
diagnostic.

The boot loop's container branch now calls `deriveViewContainerObject` — by
import, not by re-spelling: a fourth hand-copy of the chain was the defect, not
the repair. The direction is the 2026-08-07 meta-rule rather than taste (one
operation, two inconsistent implementations, the side bound by a DECLARATION
wins): `ViewSchema.object`'s own `.describe()` names its readers, while the boot
loop's order argued from item identity, which declares nothing about the
binding. The two sites that already held the winning order are untouched.

**`@objectstack/metadata` — new public export (`minor`).**
`deriveViewContainerObject` was module-local; it is now on the package's root
entry, because `packages/objectql` is a SOURCE registrar for the same containers
and has to mint the same key. `packages/objectql` already declares
`@objectstack/metadata` as a dependency and nothing in `packages/metadata`
depends on `objectql`, so the import adds no cycle.

**Scope of the behaviour change.** Only the `views` CONTAINER branch moves, gated
on `isAggregatedViewContainer`: the assembled `viewItems:` channel (standalone
ViewItems and flattened overlays, every member of `AssembledViewArtifactSchema`
requiring `viewKind`) still keys by its own `name` first, which is its identity
and not a binding. `item.id` is untouched and cannot fire for a container —
`ViewSchema` is a `strictObject` declaring `name` and `object` and no `id`.

**No migration surface.** No container in this repo carries a `name` that differs
from its `object`, and none existed when the divergence was filed — every
in-tree container derived identically at all three sites before this change and
does after it. What moves is the latent shape only.

⚠️ One card premise was measured false and is recorded in the new pin rather
than quietly dropped: the artifact/HMR registrar does not silently mint a second
key for a divergent container. It derives `crm_lead` correctly and then refuses
the whole artifact load — `assertMetadataRegisterContract` (#7378 row 1),
`VALIDATION_ERROR` / 400 — because the document's own `data.name` still reads
`lead_views`. The boot loop reconciles that field and the artifact door does
not; that residual asymmetry is a separate defect at a separate site and is
filed as its own card.
