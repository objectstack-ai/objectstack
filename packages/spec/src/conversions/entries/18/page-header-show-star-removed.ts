// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-header-show-star-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageHeaderShowStarRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `page:header.showStar` leaves the contract (protocol 18, #23650 — ADR-0049
 * enforce-or-remove; ruling record 6203775759, letter A: 「A 退役 showStar
 * (Recommended)」).
 *
 * The key switched a star the reference console no longer draws. Since
 * objectui#12427 the `page:header` record chip draws the follow star only
 * where the host wires a favorites toggle into the record context
 * (`onToggleFavorite`), and no reference host does: the record's favorites
 * entry is the header's ⋯ overflow menu. `true` drew nothing and `false` hid
 * nothing. The tombstone on `PageHeaderProps` refuses it for a live author:
 * `os validate`, `os build` and `os lint` refuse it as an `error` with the
 * prescription (the component-props gate, `@objectstack/lint`; the load path
 * keeps the open `properties` bag as written).
 *
 * **A delete of both values.** Neither changes what the reference console
 * draws, so there is no value to preserve and no rewrite target. The host
 * hook is not the key: a third-party host of the published component library
 * that wires `onToggleFavorite` keeps its star, and after the strip a header
 * that said `false` shows it there as an absent key would. The D3 entry
 * `page-header-show-star-retired` records that.
 *
 * Who writes the key: nobody measured. No example app, skill or doc in this
 * repo, and no objectui app or example, authors it; the entry is for stored
 * `sys_metadata` pages and built artifacts written by hand.
 *
 * ⚠️ Scoped by component `type`, never by key name, exactly as
 * {@link pageHeaderBreadcrumbRemoved}: `showStar` is an ordinary name for an
 * open-namespace component's own prop.
 */
const pageHeaderShowStarRemoved: MetadataConversion = {
  id: 'page-header-show-star-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'page.component.page:header.showStar',
  summary:
    "page:header prop 'showStar' removed, whether 'true' or 'false' (the reference console draws no star "
    + 'beside the record title: the record\'s favorites entry is the header\'s ⋯ menu, and metadata does '
    + 'not control it)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'page:header') return component;
      const properties = component.properties;
      if (!isDict(properties) || !('showStar' in properties)) return component;
      const stripped = stripKeys(properties, ['showStar'], emit, `${path}.properties`);
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'account_record',
          regions: [
            {
              name: 'header',
              components: [
                // The default value, written out.
                { type: 'page:header', properties: { title: 'Account', showStar: true } },
                // The switch turned off, beside the live copy-id switch.
                { type: 'page:header', properties: { title: 'Contract', showStar: false, showCopyId: false } },
                // A header WITHOUT the key rides through untouched — the strip
                // dispatches on key presence, and copy-on-write keeps the reference.
                { type: 'page:header', properties: { title: 'Overview', recordChrome: false } },
                // ⚠️ The same key name on an open-namespace component that is
                // NOT a page header — its own prop, not this entry's key.
                { type: 'acme:rating_badge', properties: { showStar: true } },
                // The nested position (#6775): a header inside a card's
                // `children` is still a page header.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Summary',
                    children: [{ type: 'page:header', properties: { title: 'Inner', showStar: true } }],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape (#6776): a header authored into a slotted page.
        {
          name: 'account_record_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:header', properties: { title: 'Account', showStar: false } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'account_record',
          regions: [
            {
              name: 'header',
              components: [
                { type: 'page:header', properties: { title: 'Account' } },
                { type: 'page:header', properties: { title: 'Contract', showCopyId: false } },
                { type: 'page:header', properties: { title: 'Overview', recordChrome: false } },
                { type: 'acme:rating_badge', properties: { showStar: true } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Summary',
                    children: [{ type: 'page:header', properties: { title: 'Inner' } }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'account_record_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:header', properties: { title: 'Account' } },
          },
        },
      ],
    },
    // Four notices, one per stripped key: the two region-level headers, the
    // nested one and the slotted one. The header without the key and the
    // open-namespace component emit none.
    expectedNotices: 4,
  },
};

export { pageHeaderShowStarRemoved };
