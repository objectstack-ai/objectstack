// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0085 (the record page is composed from the object's roles and
// relationship flags); the record-page v3 definition-surface ruling of
// 2026-10-28 (card #27053): keep six slotted slots and `kind: 'full'`, retire
// the `tabs` slot. `page.slots.tabs` replaced the whole synthesized tab strip —
// the related lists, approvals, attachments and history the platform composes
// from the object were dropped unless re-added by hand — and opted the page out
// of the record page's column tiers. `PageSchema` is reachable from the `page`
// metadata-type root, so the slot is not deleted from the shape: it stays as a
// `retiredKey()` tombstone that carries the prescription. The two alias entries
// that steered an authored `related:` / `relatedLists:` INTO this slot became
// refusals with the same remedy in the same change. D2: `page-slots-tabs-removed`;
// D3 semantic: `page-slots-tabs-retired`.
export const entry = 'ui/Page:slots.tabs';
