// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `element-text-variant-heading-levels` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `elementTextVariantHeadingLevels` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapPageComponents } from '../../walk.js';
import { isDict } from '../shared.js';

/**
 * `element:text` `variant`'s two pre-convergence spellings become the heading
 * levels they always rendered — `heading` → `h2`, `subheading` → `h3`
 * (protocol 18, #21015: release 2 of objectui#7450's ruling B, maintainer
 * 「其他同意」 2026-09-07, split across two releases 2026-09-09).
 *
 * Release 1 (#17108, 17.5.0) widened the enum to the nine values `ui:text`
 * publishes — `h1`-`h6`, `body`, `caption`, `overline` — and refused nothing;
 * 17.6.0 was the one full release in which both vocabularies parsed. This
 * release refuses the two old spellings by name (`enumWithRetiredValues`,
 * ui/component.zod.ts), and this entry carries the ruled migration hint as the
 * mechanical edit.
 *
 * **The rewrite keeps the heading element, not the look.** Measured at the
 * `.objectui-sha` pin `89cad75d55` (`renderers/basic/elements.tsx`), the
 * `element:text` renderer drew `heading` as an h2 element and `subheading` as an
 * h3 element, so the document outline a screen reader walks is unchanged. The
 * size is not: `heading` drew `h3`'s style and `subheading` a medium-weight
 * `text-lg`, while `h2` and `h3` draw their own, larger ones. The level IS the
 * ruled meaning ("or pick the level you mean"), so the edit follows the
 * element; the D3 entry `element-text-variant-heading-subheading-retired`
 * carries the judgement the chain cannot make — whether this page wanted that
 * level, or another.
 *
 * **One reach: every page component of type `element:text`**, through
 * {@link mapPageComponents} — regions, named slots and container nesting, the
 * positions the component-props gate judges. `variant` on any other component
 * type is that component's own vocabulary and is never read here.
 *
 * `retiredFromLoadPath`: an author is not silently rewritten — `os validate`,
 * `os build` and `os lint` report an old spelling as a
 * `component-props-invalid` error carrying the prescription (the
 * component-props gate, `@objectstack/lint`: a retired enum value is a value
 * verdict, an error like every other; the load path keeps the open `properties`
 * bag as written); stored rows replay it at rehydration
 * (`applyConversionsToStoredItem`) and `os migrate meta` lists the edit for
 * existing sources. Idempotent by construction: the rewrite's output is
 * outside its own input set.
 */
const elementTextVariantHeadingLevels: MetadataConversion = {
  id: 'element-text-variant-heading-levels',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.6.0',
  surface: 'page.component.element:text.variant',
  summary:
    "element:text 'variant' spellings 'heading' → 'h2' and 'subheading' → 'h3' (the vocabulary converged "
    + "on the nine values ui:text publishes; each old spelling already rendered that heading element, "
    + 'so the outline is unchanged and the heading takes that level\'s style)',
  apply(stack, emit) {
    const VARIANT_REWRITE: Readonly<Record<string, string>> = { heading: 'h2', subheading: 'h3' };
    return mapPageComponents(stack, (component, path) => {
      if (component.type !== 'element:text') return component;
      const properties = component.properties;
      if (!isDict(properties)) return component;
      const variant = properties.variant;
      if (typeof variant !== 'string' || !Object.prototype.hasOwnProperty.call(VARIANT_REWRITE, variant)) {
        return component;
      }
      const to = VARIANT_REWRITE[variant]!;
      emit({ from: variant, to, path: `${path}.properties.variant` });
      return { ...component, properties: { ...properties, variant: to } };
    });
  },
  fixture: {
    before: {
      pages: [
        {
          name: 'text_variant_levels',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:text', properties: { content: 'Overview', variant: 'heading', align: 'center' } },
                { type: 'element:text', properties: { content: 'Details', variant: 'subheading' } },
                // A published level and an absent `variant` ride through.
                { type: 'element:text', properties: { content: 'Body copy', variant: 'h3' } },
                { type: 'element:text', properties: { content: 'Default body' } },
                // `variant` on another component type is that type's own
                // vocabulary, untouched here.
                { type: 'element:button', properties: { label: 'Go', variant: 'heading' } },
                // Nested one container down.
                {
                  type: 'page:card',
                  properties: {
                    title: 'Card',
                    children: [{ type: 'element:text', properties: { content: 'In a card', variant: 'subheading' } }],
                  },
                },
              ],
            },
          ],
        },
        // A slotted page's named slot — the same component, the other authoring shape.
        {
          name: 'text_variant_levels_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [{ type: 'element:text', properties: { content: 'Title', variant: 'heading' } }],
          },
        },
      ],
    },
    after: {
      pages: [
        {
          name: 'text_variant_levels',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'element:text', properties: { content: 'Overview', variant: 'h2', align: 'center' } },
                { type: 'element:text', properties: { content: 'Details', variant: 'h3' } },
                { type: 'element:text', properties: { content: 'Body copy', variant: 'h3' } },
                { type: 'element:text', properties: { content: 'Default body' } },
                { type: 'element:button', properties: { label: 'Go', variant: 'heading' } },
                {
                  type: 'page:card',
                  properties: {
                    title: 'Card',
                    children: [{ type: 'element:text', properties: { content: 'In a card', variant: 'h3' } }],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'text_variant_levels_slotted',
          kind: 'slotted',
          regions: [],
          slots: {
            details: [{ type: 'element:text', properties: { content: 'Title', variant: 'h2' } }],
          },
        },
      ],
    },
    // One per rewritten `variant`: the region pair, the nested card child and
    // the slotted one — the published level, the absent key and the
    // other component type are untouched.
    expectedNotices: 4,
  },
};

export { elementTextVariantHeadingLevels };
