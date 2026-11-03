// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `record-highlights-field-icon-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `recordHighlightsFieldIconRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * `record:highlights` highlight-field `icon` — a declared, advertised key with
 * zero read points (#10054, ADR-0049 enforce-or-remove; maintainer ruling
 * 2026-08-21, executing the 2026-08-20 census verdict).
 *
 * The dead-end is complete in every direction the census measured: objectui's
 * renderer normalizes the authored object and carries `icon: f?.icon` into
 * `HeaderHighlight`, whose chip has NO icon slot (its only `icon` occurrence
 * is a button `size="icon"`); the key is structurally unable to travel
 * `useRegisterHighlightFields`, which registers `names: string[]`; and the
 * Studio block designer publishes the field list as a `string[]` input, so the
 * key was never designer-publishable either. Meanwhile six author-facing
 * surfaces advertised it — the union's own describe, the `fields` describe,
 * the lint entry-shape prose, the reference docs, and objectui's input
 * description. The exact #8691 reference-rail-`icon` shape, on the highlight
 * chip.
 *
 * **A pure lossless delete.** The key never had an effect to lose: the chip
 * renders label and value only, so there is no rewrite target — deleting the
 * key preserves observed behaviour exactly.
 *
 * ⚠️ Scoped by component `type` AND by entry shape: `icon` is live on half a
 * dozen other components (`element:button`, header actions, …), and the
 * bare-string entries of the same `fields` array are not carriers — only the
 * OBJECT entries of a `record:highlights` `fields[]` are touched. The
 * neighbouring `readonly` key is LIVE (#5176 — HeaderHighlight's inline-edit
 * gate reads it) and survives untouched.
 */
const recordHighlightsFieldIconRemoved: MetadataConversion = {
  id: 'record-highlights-field-icon-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.1.0',
  surface: 'page.component.record:highlights.fields[].icon',
  summary:
    "record:highlights highlight-field key 'icon' removed (ADR-0049 — no render path: "
    + 'the highlight chip has no icon slot, the register hook carries field names only, and the '
    + 'Studio designer publishes the field list as plain strings, so an authored icon was '
    + 'accepted and drawn by nothing)',
  apply(stack, emit) {
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'record:highlights') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const fields = properties.fields;
      if (!Array.isArray(fields)) return component;
      let touched = false;
      const nextFields = fields.map((entry, i) => {
        // Bare-string entries are not carriers — untouched, same reference.
        if (!isDict(entry)) return entry;
        const stripped = stripKeys(entry, ['icon'], emit, `${path}.properties.fields[${i}]`);
        if (stripped !== entry) touched = true;
        return stripped;
      });
      if (!touched) return component;
      return { ...component, properties: { ...properties, fields: nextFields } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'project_detail',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'record:highlights',
                  properties: {
                    fields: [
                      // Bare-string entry — the shape every in-tree producer
                      // authors; not a carrier, rides through untouched.
                      'status',
                      // The retired shape: an object entry carrying `icon`.
                      { name: 'budget', label: 'Budget', icon: 'dollar-sign' },
                      // The LIVE neighbour keys survive — `readonly` is the
                      // #5176 enforced key, `type` the renderer override.
                      { name: 'health', type: 'number', readonly: true },
                    ],
                  },
                },
                // `icon` on a component that is not record:highlights — live
                // there, and not this entry's key.
                { type: 'element:button', properties: { label: 'Open', icon: 'external-link' } },
              ],
            },
          ],
        },
        // The named-slot shape (#6776 reach): a highlights strip authored into
        // a slotted record page's `highlights` slot.
        {
          name: 'task_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            highlights: {
              type: 'record:highlights',
              properties: { fields: [{ name: 'priority', icon: 'flag' }] },
            },
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'project_detail',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'record:highlights',
                  properties: {
                    fields: [
                      'status',
                      { name: 'budget', label: 'Budget' },
                      { name: 'health', type: 'number', readonly: true },
                    ],
                  },
                },
                { type: 'element:button', properties: { label: 'Open', icon: 'external-link' } },
              ],
            },
          ],
        },
        {
          name: 'task_detail',
          kind: 'slotted',
          regions: [],
          slots: {
            highlights: {
              type: 'record:highlights',
              properties: { fields: [{ name: 'priority' }] },
            },
          },
        },
      ],
    },
    // Two notices: the region-level object entry and the slotted one.
    expectedNotices: 2,
  },
};

export { recordHighlightsFieldIconRemoved };
