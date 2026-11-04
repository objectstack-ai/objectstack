// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `page-header-breadcrumb-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `pageHeaderBreadcrumbRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `page:header.breadcrumb` leaves the contract (protocol 18, #20758 —
 * ADR-0049 enforce-or-remove, the spec half of objectui#11166; the triage
 * ruling on the card: 「没有 ⇒ 退役」).
 *
 * The key switched a trail that never existed. objectui's
 * `PageHeaderRenderer` (`containers.tsx`) reads it and, unless it is `false`,
 * draws an EMPTY `div[data-page-breadcrumb-slot]` in both header layouts;
 * nothing fills the slot. The console draws the navigation trail once, in the
 * shell (`@object-ui/app-shell` `AppHeader`, inside `/apps/:appName/*`), so the
 * retirement takes the key away rather than building a second trail. The
 * tombstone on `PageHeaderProps` refuses it for a live author: `os validate`,
 * `os build` and `os lint` refuse it as an `error` with the prescription (the
 * component-props gate, `@objectstack/lint`; the load path keeps the open
 * `properties` bag as written).
 *
 * **A delete of both values.** `true` and `false` go alike: neither ever drew
 * a trail, so there is no value to preserve and no rewrite target. The one
 * thing either value changed is the empty slot itself — present for `true`
 * (and for absence), gone for `false` — which is spacing, not content, and
 * leaves with the slot on the objectui half. A stored page that said `false`
 * reads as absent after this strip, so it draws the empty slot again until
 * that half lands; the D3 entry `page-header-breadcrumb-retired` records it.
 *
 * Who writes the key, so who this entry is for: objectui's Studio page-block
 * inspector publishes a `page:header` "Show breadcrumb" boolean
 * (`previews/block-config.ts`), so stored `sys_metadata` pages can carry
 * either value. No example app, skill or doc in this repo authors it.
 *
 * ⚠️ Scoped by component `type`, never by key name, as the retired
 * `page-structure-inert-keys-removed` scoped `icon`: `breadcrumb` is an
 * ordinary word for an open-namespace component's own prop, and the kebab
 * `page-header` spelling is objectui's legacy registration, not a key this
 * spec declares. `nav:breadcrumb` — a component TYPE, not this key — is
 * untouched: the Studio palette still offers it (`previews/block-types.ts`),
 * so it has a producer and stays.
 */
const pageHeaderBreadcrumbRemoved: MetadataConversion = {
  id: 'page-header-breadcrumb-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'page.component.page:header.breadcrumb',
  summary:
    "page:header prop 'breadcrumb' removed, whether 'true' or 'false' (no renderer ever drew a trail for "
    + 'it: objectui drew an empty slot and nothing filled it, and the app shell\'s header draws the '
    + 'navigation trail)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'page:header') return component;
      const properties = component.properties;
      if (!isDict(properties) || !('breadcrumb' in properties)) return component;
      const stripped = stripKeys(properties, ['breadcrumb'], emit, `${path}.properties`);
      return { ...component, properties: stripped };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'lead_record',
          regions: [
            {
              name: 'header',
              components: [
                // The default value, written out: the Studio inspector's
                // "Show breadcrumb" switch left on.
                { type: 'page:header', properties: { title: 'Lead', breadcrumb: true } },
                // The switch turned off, on a non-record header.
                { type: 'page:header', properties: { title: 'Pipeline', recordChrome: false, breadcrumb: false } },
                // A header WITHOUT the key rides through untouched — the strip
                // dispatches on key presence, and copy-on-write keeps the reference.
                { type: 'page:header', properties: { title: 'Settings', recordChrome: false } },
                // ⚠️ The same key name on an open-namespace component that is
                // NOT a page header — its own prop, not this entry's key.
                { type: 'acme:trail_banner', properties: { breadcrumb: true } },
                // The nested position (#6775): a header inside a card's
                // `children` is still a page header.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Summary',
                    children: [{ type: 'page:header', properties: { title: 'Inner', breadcrumb: true } }],
                  },
                },
              ],
            },
          ],
        },
        // The named-slot shape (#6776): a header authored into a slotted page.
        {
          name: 'lead_record_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:header', properties: { title: 'Lead', breadcrumb: false } },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'lead_record',
          regions: [
            {
              name: 'header',
              components: [
                { type: 'page:header', properties: { title: 'Lead' } },
                { type: 'page:header', properties: { title: 'Pipeline', recordChrome: false } },
                { type: 'page:header', properties: { title: 'Settings', recordChrome: false } },
                { type: 'acme:trail_banner', properties: { breadcrumb: true } },
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
          name: 'lead_record_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            details: { type: 'page:header', properties: { title: 'Lead' } },
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

export { pageHeaderBreadcrumbRemoved };
