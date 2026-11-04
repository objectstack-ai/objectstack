// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `record-chatter-position-vocabulary` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `recordChatterPositionVocabulary` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict } from '../shared.js';

/**
 * `record:chatter` / `record:discussion` `position` converges on the
 * renderer's vocabulary (protocol 18, #8762 — maintainer ruling 2026-08-15:
 * one vocabulary, no mapping layer).
 *
 * The spec row declared `sidebar | inline | drawer` (with a `sidebar`
 * default); the renderer chain read none of those values. Measured at the
 * `.objectui-sha` pin `665661ab0932`: `RecordChatterPanel` branches on
 * exactly `right`/`left` (docked side panel) vs `bottom` (in-flow), the
 * designer registration publishes `enum: ['bottom', 'right', 'left']`, and
 * the renderer merge falls back to `bottom` — three renderer-side sites in
 * agreement, so the spec row was the isolated wrong party and converges on
 * them. The rewrite preserves AUTHOR INTENT against the renderer's actual
 * branch semantics (`right`/`left` ⇒ docked, `bottom` ⇒ in-flow):
 *
 *   - `sidebar` → `right`: the author asked for a docked side panel; `right`
 *     is the conventional chatter side (and the panel's own docked default).
 *     Observed behaviour CHANGES — the value used to fall through to the
 *     in-flow render — but that fall-through was the defect, not the intent.
 *   - `inline` → `bottom`: intent and observed behaviour agree — `bottom` is
 *     the renderer's in-flow branch, which is where `inline` already landed.
 *   - `drawer` → `right`: no renderer branch ever implemented an overlay
 *     drawer (removal, not a pure rename — there is no counterpart). The
 *     docked side panel is the nearest surviving shape of a side drawer.
 *
 * `retiredFromLoadPath`: the enum refuses the old spellings outright, each
 * with a per-value prescription (`CHATTER_POSITION_RETIRED`,
 * ui/component.zod.ts), so a live author is taught at parse rather than
 * silently rewritten. The entry exists so stored rows replay clean
 * (`applyConversionsToStoredItem`) and so `os migrate meta` lists the mechanical edits for author sources.
 *
 * The same #8762 ruling dropped all three schema defaults (`position`,
 * `collapsible`, `defaultCollapsed`) per the `maxVisible` principle; that
 * half needs no conversion — an authored value keeps its meaning, and "the
 * author said nothing" now stays nothing (the renderer's own fallbacks
 * apply). The semantic entry `record-chatter-position-vocabulary-converged`
 * carries the review prescription for both halves.
 */
const recordChatterPositionVocabulary: MetadataConversion = {
  id: 'record-chatter-position-vocabulary',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.0.0',
  surface: 'page.component.record:chatter.position / page.component.record:discussion.position',
  summary:
    "record:chatter / record:discussion 'position' respelled to the renderer's vocabulary — "
    + "'sidebar' → 'right', 'inline' → 'bottom', 'drawer' → 'right' (one vocabulary, the "
    + "renderer's, rather than a mapping layer between two: the renderer compares only "
    + 'bottom/right/left, and the old set fell through every branch)',
  apply(stack, emit) {
    const POSITION_REWRITE: Readonly<Record<string, string>> = {
      sidebar: 'right',
      inline: 'bottom',
      drawer: 'right',
    };
    const CHATTER_TYPES = new Set(['record:chatter', 'record:discussion']);
    return mapPageComponents(stack, (component, path) => {
      if (typeof component.type !== 'string' || !CHATTER_TYPES.has(component.type)) return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const position = properties.position;
      if (typeof position !== 'string') return component;
      const to = POSITION_REWRITE[position];
      if (!to) return component;
      emit({ from: position, to, path: `${path}.properties.position` });
      return { ...component, properties: { ...properties, position: to } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'deal_detail_chatter',
          regions: [
            {
              name: 'main',
              components: [
                // The old schema default, written out — the author asked for a
                // docked side panel and silently got the in-flow render.
                { type: 'record:chatter', properties: { position: 'sidebar', width: '350px' } },
                // `inline` meant the in-flow render, and got it.
                { type: 'record:discussion', properties: { position: 'inline' } },
                // A `position` on a component that is NOT the chatter pair is a
                // different surface and must survive byte-identically.
                { type: 'element:custom', properties: { position: 'sidebar' } },
                // Already-canonical values are untouched.
                { type: 'record:chatter', properties: { position: 'left' } },
              ],
            },
          ],
        },
        {
          name: 'deal_detail_chatter_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            discussion: [
              { type: 'record:discussion', properties: { position: 'drawer', collapsible: true } },
            ],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'deal_detail_chatter',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'record:chatter', properties: { position: 'right', width: '350px' } },
                { type: 'record:discussion', properties: { position: 'bottom' } },
                { type: 'element:custom', properties: { position: 'sidebar' } },
                { type: 'record:chatter', properties: { position: 'left' } },
              ],
            },
          ],
        },
        {
          name: 'deal_detail_chatter_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            discussion: [
              { type: 'record:discussion', properties: { position: 'right', collapsible: true } },
            ],
          },
        },
      ],
    },
    // One per rewritten `position` — the non-chatter component and the
    // already-canonical `left` are untouched.
    expectedNotices: 3,
  },
};

export { recordChatterPositionVocabulary };
