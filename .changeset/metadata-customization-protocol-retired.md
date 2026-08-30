---
"@objectstack/spec": minor
"@objectstack/metadata": minor
---

feat(spec): retire the paper metadata-customization protocol with its full coupling set (#13135, re-charter of #12057; ADR-0049, ADR-0126)

<!-- adr-0087: registered metadata-customization-protocol-retired -->

**BREAKING** export removal + authorable-key retirement, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`; the
prescriptions are registered under protocol major 18 —
`RETIRED_DEFS_BY_MAJOR[18]`, `RETIRED_KEYS_BY_MAJOR[18]` and the D3 semantic
entry `metadata-customization-protocol-retired` — where `os migrate meta`
users will look).

`kernel/metadata-customization.zod.ts` declared a three-layer platform/user
patch-overlay protocol (field-level change tracking, customization policies, a
3-way-merge story) that nothing reachable implemented: no route ever served
the paper `…/overlay` / `…/effective` endpoints, the only implementation
(`packages/metadata`'s manager limb) was called solely by its own unit tests,
no merge engine ever existed, and no code read a `CustomizationPolicy`.
ADR-0126 §6 wall 4 supersedes the protocol as a matter of record ("nothing may
build against it"); the maintainer adopted retirement on #12057 (2026-08-29,
「同意」), and #13135 charters the full coupling set the fork report measured.

FROM → TO:

- `MetadataOverlaySchema` / `FieldChangeSchema` / `CustomizationOriginSchema` /
  `MergeConflictSchema` / `MergeStrategyConfigSchema` / `MergeResultSchema` /
  `CustomizationPolicySchema` and their `…`/`…Parsed` types
  (`@objectstack/spec/kernel`) → *(removed — no replacement protocol)*. The
  customization that actually ships: ADR-0005's org-scoped overlay
  (`allowOrgOverride` on `DEFAULT_METADATA_TYPE_REGISTRY`, `sys_metadata` org
  rows, layered read `code`/`overlay`/`effective`) and ADR-0126's
  packaged-metadata model (clone + ledger disable).
- `MetadataOverlayResponseSchema` / `MetadataOverlaySaveRequestSchema` /
  `MetadataEffectiveResponseSchema` (`@objectstack/spec/api` §5) →
  *(removed)* — contracts for endpoints no adapter ever served; the layered
  read's contracts (`getMetaItemLayered`) are the live API.
- `IMetadataService.getOverlay` / `.saveOverlay` / `.removeOverlay` /
  `.getEffective` optional members (`@objectstack/spec/contracts`) →
  *(removed)*, together with `packages/metadata`'s in-memory limb and its
  `'overlay'` feature log entry.
- `MetadataPluginConfig.customizationPolicies` / `.mergeStrategy` and
  `MetadataManagerConfig.persistence.overlayWritable` → *(removed — retiredKey
  tombstones)*: authoring one is now a `tsc` error and a parse error carrying
  the prescription. Delete the keys; nothing replaces them (`persistence.writable`
  remains the base write gate).

One-line fix: delete the keys and any code building against the removed
exports — they configured and described nothing that ever ran; org-level
customization keeps riding the ADR-0005 overlay unchanged.

The retirement kit: whole-module deletion + kernel barrel line; 10
`RETIRED_DEFS_BY_MAJOR[18]` entries (7 kernel defs + 3 api §5 contracts); 3
`RETIRED_KEYS_BY_MAJOR[18]` tombstone entries (no D2 conversion —
plugin/manager configs are not stack collection members, the
`kernel/MetadataPluginConfig:additionalTypes` precedent); D3 semantic entry
`metadata-customization-protocol-retired`; retirement pin test
(`kernel/metadata-customization-retirement.test.ts`); type-alias pin rows
Iso408-411 vacated; api-surface / export-origins / json-schema manifest /
authorable-surface / reference docs regenerated (the
`kernel/metadata-customization` reference page disappears with the module).
