// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-slots-tabs-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageSlotsTabsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPages } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `page.slots.tabs` removed (protocol 18, ADR-0085; #27053, the record-page v3
 * definition-surface ruling of 2026-10-28: keep the object's roles, its
 * relationship flags, six slotted slots and `kind: 'full'`; retire the `tabs`
 * slot).
 *
 * The slot replaced the WHOLE synthesized tab strip — the related lists and the
 * approvals, attachments and history tabs the platform composes from the
 * object were gone unless the author re-added each one — and it opted the page
 * out of the record page's column tiers, so the page stayed tabbed at every
 * width. The parse refuses it (a `retiredKey()` tombstone on the slot map,
 * `ui/page.zod.ts`); this is the data-at-rest half.
 *
 * **A strip, not a rewrite.** The mechanical half deletes the slot, so a stored
 * page that carried it renders the synthesized strip (and the columns) again,
 * its other slots unchanged; a page whose ONLY slot was `tabs` is left an empty
 * slotted page, which is exactly the synthesized default. Whether a page whose
 * strip was curated — a Security tab, a custom first tab, a list the object's
 * relationship flags do not produce — should instead become a `kind: 'full'`
 * page that draws that strip as authored is a judgement no walker can make: the
 * D3 semantic entry `page-slots-tabs-retired` names it.
 *
 * **Retired from the load path, from day one**: the authoring door keeps the
 * tombstone's prescription; stored rows, artifacts and `os migrate meta` replay
 * this. Idempotent by construction (`stripKeys` skips an absent key).
 *
 * ⚠️ Coverage boundary: this walks `stack.pages[]` ({@link mapPages}). `slots`
 * is a top-level `PageSchema` key with no nested spelling, and the slot map is
 * the only place a `tabs` slot was authorable.
 */
const pageSlotsTabsRemoved: MetadataConversion = {
  id: 'page-slots-tabs-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface: 'page.slots.tabs',
  summary:
    "page slot 'tabs' removed (it replaced the whole synthesized tab strip and kept the page tabbed "
    + "at every width; the record page composes its strip and columns from the object's roles and "
    + "relationship flags, ADR-0085, and a page that needs its own strip is kind: 'full')",
  apply(stack, emit) {
    return mapPages(stack, (page, path) => {
      const slots = page.slots;
      if (!isDict(slots)) return page;
      const next = stripKeys(slots, ['tabs'], emit, `${path}.slots`);
      return next === slots ? page : { ...page, slots: next };
    });
  },
  fixture: {
    before: {
      pages: [
        // A slotted page whose only slot was the strip: left an empty slotted
        // page, the synthesized default.
        {
          name: 'project_detail',
          type: 'record',
          object: 'project',
          kind: 'slotted',
          slots: { tabs: { type: 'page:tabs', properties: { items: [{ label: 'Related', children: [] }] } } },
        },
        // The strip beside other slots: only the strip goes.
        {
          name: 'user_detail',
          type: 'record',
          object: 'person',
          kind: 'slotted',
          slots: { highlights: { type: 'record:highlights' }, tabs: [{ type: 'page:tabs' }], discussion: [] },
        },
        // A page with no strip keeps its identity (copy-on-write).
        { name: 'account_detail', type: 'record', object: 'account', kind: 'slotted', slots: { discussion: [] } },
      ],
    },
    after: {
      pages: [
        { name: 'project_detail', type: 'record', object: 'project', kind: 'slotted', slots: {} },
        {
          name: 'user_detail',
          type: 'record',
          object: 'person',
          kind: 'slotted',
          slots: { highlights: { type: 'record:highlights' }, discussion: [] },
        },
        { name: 'account_detail', type: 'record', object: 'account', kind: 'slotted', slots: { discussion: [] } },
      ],
    },
    // One per stripped slot: the two pages that carried `tabs`.
    expectedNotices: 2,
  },
};

export { pageSlotsTabsRemoved };
