// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'metadata-customization-protocol-retired',
  surface:
    'the paper metadata-customization protocol: `kernel/metadata-customization.zod.ts` '
    + 'whole (`MetadataOverlay`, `FieldChange`, `CustomizationOrigin`, `MergeConflict`, '
    + '`MergeStrategyConfig`, `MergeResult`, `CustomizationPolicy`) / the section-5 '
    + 'Overlay/Customization API contracts (`api/MetadataOverlayResponse`, '
    + '`api/MetadataOverlaySaveRequest`, `api/MetadataEffectiveResponse`) / the optional '
    + '`getOverlay`/`saveOverlay`/`removeOverlay`/`getEffective` members of '
    + '`contracts/metadata-service.ts` / the authorable keys '
    + '`MetadataPluginConfig.customizationPolicies`, `MetadataPluginConfig.mergeStrategy` and '
    + '`MetadataManagerConfig.persistence.overlayWritable` (tombstoned; see '
    + '`RETIRED_KEYS_BY_MAJOR[18]`)',
  replacement:
    'nothing to re-declare — delete any authored keys. The customization mechanisms that '
    + 'actually ship: ADR-0005\'s org-scoped overlay (opt-in via `allowOrgOverride` on '
    + '`DEFAULT_METADATA_TYPE_REGISTRY`, stored as `sys_metadata` org rows, written through the '
    + 'REST meta write doors and read back through `getMetaItemLayered`\'s '
    + '`code`/`overlay`/`effective` layers), and ADR-0126\'s packaged-metadata customization '
    + 'model (clone with a new machine name + ledger disable — never a field-level patch '
    + 'overlay)',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-08-29 on #12057 (「同意」 — retirement '
    + 'adopted, re-scope rejected), executed widened by #13135 per the fork report on #12057: '
    + 'the module declared a three-layer platform/user patch-overlay protocol with field-level '
    + 'change tracking and a 3-way-merge story, published reference docs described it as the '
    + 'customization architecture — and nothing reachable implemented it. The one '
    + 'implementation (`packages/metadata`\'s manager limb) was served by no route and called '
    + 'only by its own unit tests; no merge engine ever existed; no code read a '
    + '`CustomizationPolicy`. ADR-0126 §6 wall 4 supersedes the protocol as a matter of record '
    + '("nothing may build against it") — the per-field overlay layer it described is '
    + 'precisely what the #11513 ruling recorded as deliberately not chartered. Why D3 '
    + 'semantic and not a D2 conversion: the defs leave with no carrier key in any stack '
    + 'collection, and the three tombstoned keys live on plugin/manager configs, which are not '
    + 'stack collection members (`PLURAL_TO_SINGULAR` has no `plugins` entry) — a '
    + 'MetadataConversion would be a transform with no seam that ever runs (the '
    + '`kernel/Manifest:loading` precedent).',
  acceptanceCriteria:
    'No import of `metadata-customization.zod` (or of the retired names from '
    + '`@objectstack/spec/kernel` / `@objectstack/spec/api`) compiles anywhere; no '
    + '`MetadataPluginConfig` carries `customizationPolicies` or `mergeStrategy`; no '
    + '`MetadataManagerConfig` carries `persistence.overlayWritable` (TypeScript authors get '
    + 'the refusal at compile time — the keys are typed `never` — and a value reaching the '
    + 'parse is refused with the prescription at the key\'s path). ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED and must be verified as such: no route ever served the paper '
    + '`…/overlay` / `…/effective` endpoints, so removing the limb removes no served '
    + 'behaviour — the ADR-0005 org-overlay read/write path (`getMetaItemLayered`, the REST '
    + 'meta write doors) stays exactly as it was, before and after.',
};
