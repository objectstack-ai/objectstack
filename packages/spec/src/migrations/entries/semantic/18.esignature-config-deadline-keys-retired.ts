// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'esignature-config-deadline-keys-retired',
  surface:
    'e-signature deadline keys: `ESignatureConfig.expirationDays` / `reminderDays` '
    + '(`document.eSignature.expirationDays` / `document.eSignature.reminderDays`)',
  replacement:
    'nothing to re-declare — delete the keys. No e-signature engine exists on the platform: '
    + 'no signature request is sent, expired or reminded by any layer, so there is no live '
    + 'mechanism to declare an expiry window or a reminder interval to. `ESignatureConfig` '
    + 'itself stays (`provider` / `enabled` / `signers`), unchanged',
  reason:
    'ADR-0049 enforce-or-remove; the 2026-09-02 ruling on #14477 held this pair on one '
    + 'condition — "no roadmap ⇒ they retire with the other three families" — and the '
    + 'maintainer answered it on 2026-09-05 (decision batch #40, no roadmapped e-signature '
    + 'consumer), so the ruling\'s own branch resolves to retirement. Two day-shaped keys sat '
    + 'on the published authorable surface (`authorable-surface/data.json`) and in the '
    + 'generated reference docs — an author could write `expirationDays: 30` and reasonably '
    + 'expect a signature request to lapse after thirty days — and were read by NOTHING: the '
    + 'reader census over every package outside `packages/spec` (tests and changelogs '
    + 'excluded), over `examples/**` and `skills/**`, and over objectui at the pinned sha '
    + 'returned zero hits for `expirationDays`, `reminderDays`, `eSignature` and the '
    + '`ESignatureConfig` names, with a lit control inside `packages/spec`. Both carried '
    + 'defaults (30 days, 7 days) that were materialized into every parsed configuration '
    + 'without ever being consulted. `cloud` and real customer configurations are UNMEASURED. '
    + 'Why D3 semantic and not a D2 conversion: `DocumentSchema` is not a stack collection '
    + 'member and `document` is no metadata type, so the chain has no seam that would ever '
    + 'see one (the `kernel/MetadataPluginConfig:additionalTypes` precedent); the '
    + 'prescription reaches authors through the `retiredKey()` tombstones (`tsc` + the parse) '
    + 'and this entry.',
  acceptanceCriteria:
    'No `ESignatureConfig` literal — standalone or nested as `Document.eSignature` — carries '
    + '`expirationDays` or `reminderDays`. TypeScript authors get the refusal at compile time '
    + '(each key is typed `never`); a value reaching the parse is refused with the '
    + 'prescription (`invalid_type` at the path of the key, on the base schema and through '
    + 'the `DocumentSchema.eSignature` carrier). Parsed configurations no longer carry the '
    + 'two former defaults. ⚠️ Runtime behaviour is deliberately UNCHANGED and must be '
    + 'verified as such: nothing ever read the keys, so removing them removes no behaviour.',
};
