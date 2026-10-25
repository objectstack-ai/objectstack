/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { TextSchema } from '@object-ui/types';
import { cn } from '../../lib/utils';

type TextVariant = NonNullable<TextSchema['variant']>;
type TextAlign = NonNullable<TextSchema['align']>;

/**
 * `TextSchema.variant` -> one visibly distinct typographic class per published
 * value (`57f9b077b`, maintainer ruling B1 of 2026-09-02).
 *
 * ## What was measured before this map existed
 *
 * `variant` had NO read site. Rendered through the real `SchemaRenderer`,
 * `variant: 'small'`, `variant: 'body'`, `variant: 'h1'` and the key absent
 * produced byte-identical output — 2 elements, `Small text` — so every one of
 * the nine values the enum blesses did nothing, and the five catalog entries
 * written in the shadcn scale were refused by `safeValidateSchema` for a key
 * that could not have changed a pixel either way. `align` sat in the same
 * state. This is the declared-but-unenforced class ADR-0049 governs, and the
 * ruling took ENFORCE (B1): the published enum in
 * `packages/types/src/zod/layout.zod.ts` is the vocabulary and does not move;
 * the renderer catches up to it.
 *
 * ## The map is modelled on `ElementTextRenderer`, deliberately
 *
 * `renderers/basic/elements.tsx` already carries `VARIANT_CLASS` / `ALIGN_CLASS`
 * for `element:text`, and the ruling names it as the shape to follow rather
 * than a second convention to invent. Three entries here are its entries
 * verbatim — `h3` is its `heading` (`text-2xl font-semibold tracking-tight`),
 * `body` and `caption` are its `body` and `caption` — and the six-step heading
 * ladder is that same idiom extended one Tailwind size per step. Only
 * `overline` has no counterpart there: it is the published value with no
 * `element:text` sibling, so it takes the conventional small-caps label
 * treatment.
 *
 * ⚠️ Since objectui#7450 the two primitives take ONE vocabulary: the nine
 * published values below. The paragraph above records how this map was first
 * built, not which way the dependency runs now — `element:text` takes this
 * map's nine, `overline` included, with this map's class for each, and this
 * map is the vocabulary that does not move. `element:text` also accepted
 * `heading` / `subheading` while the installed `@objectstack/spec` did; the
 * spec retired them in 17.7.0, through the value-level mechanism of
 * objectstack-ai/objectstack#17109, and `element:text` dropped them with it
 * (objectui#11717) — never this file. The defaulting
 * asymmetry stays: an absent `variant` is not `body` here (objectui#6942, see
 * ABSENCE IS NOT `body` below), while `element:text` renders it as `body`.
 *
 * ## Distinctness is the contract, not a nicety
 *
 * Two values sharing a class would put this key straight back into the state
 * this card exists to leave: authored, accepted, and invisible. The pin is
 * `__tests__/text-variant-align-6942.test.tsx` — one rendered element per
 * value, with the nine class strings asserted pairwise distinct.
 */
const VARIANT_CLASS: Record<TextVariant, string> = {
  h1: 'text-4xl font-semibold tracking-tight',
  h2: 'text-3xl font-semibold tracking-tight',
  h3: 'text-2xl font-semibold tracking-tight',
  h4: 'text-xl font-semibold tracking-tight',
  h5: 'text-lg font-semibold tracking-tight',
  h6: 'text-base font-semibold tracking-tight',
  body: 'text-sm text-foreground',
  caption: 'text-xs text-muted-foreground',
  overline: 'text-xs font-medium uppercase tracking-widest text-muted-foreground',
};

/**
 * The element each variant renders. `h1`…`h6` render the heading element they
 * name — a value that says `h1` and paints a `<span>` would deliver the size
 * and withhold the semantics, which assistive technology reads and a class
 * cannot supply. The three non-heading values keep the `<span>` this renderer
 * has always wrapped with, so nothing about inline usage changes for them.
 */
const VARIANT_TAG: Record<TextVariant, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span'> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  body: 'span',
  caption: 'span',
  overline: 'span',
};

/**
 * `TextSchema.align` -> a Tailwind alignment class. Four values, not
 * `ElementTextRenderer`'s three: `TextSchema` publishes `justify` as well, and
 * an enforced key has to cover the vocabulary it publishes.
 *
 * Each class is paired with `block` because the element three of the nine
 * variants render is a `<span>`, and `text-center` on an inline box centres
 * nothing — it would re-enter this card's own failure mode one layer down
 * (declared, accepted, invisible). On the heading elements `block` is a no-op.
 */
const ALIGN_CLASS: Record<TextAlign, string> = {
  left: 'block text-left',
  center: 'block text-center',
  right: 'block text-right',
  justify: 'block text-justify',
};

ComponentRegistry.register('text', 
  ({ schema, ...props }: { schema: TextSchema; [key: string]: any }) => {
    // Text is a special case as it might be rendered as a fragment or span depending on usage.
    // However, to support drag and drop in designer, it MUST be wrapped in an element if props are passed.
    
    // DOM pass-through is a WHITELIST — objectui#3291's discipline, executed by
    // {@link toDomProps}. Mechanism and full argument: `grid.tsx`'s docblock
    // (objectui#4787 / PR #5573) and `packages/core/src/utils/dom-props.ts`.
    // `variant` and `align` are read off the NODE below and never forwarded —
    // they are semantic props, which the whitelist consumes rather than leaks.
    //
    // MEASURED (objectui#5574): every `text` node in `examples/schema-catalog`
    // rendered through the real `SchemaRenderer` and read off the DOM — 523
    // illegitimate attributes, the largest single reading in the family, and all
    // but one of them `content` (522; the odd one out is `value`). Those are the
    // two keys this renderer RENDERS AS ITS CHILDREN, so every leaked attribute
    // duplicated the visible text into the markup.
    //
    // The reading also has to be read against its own denominator: 699 `text`
    // nodes rendered, and 176 of them produced NO ELEMENT at all — the fragment
    // return below, taken when a node carries neither designer id nor className.
    // A renderer that renders nothing spreads nothing and reads clean, so those
    // 176 were never evidence of safety; they are the phantom-clean class the
    // sweep's readiness selectors exist to keep honest.
    //
    // `style` is forwarded by name (the objectui#4435 route); `data-obj-*` arrive
    // through the open `data-*` family {@link toDomProps} already forwards, which
    // is why the wrap condition reads `data-obj-id` off `hostProps` rather than
    // destructuring it out.
    const { style, ...hostProps } = props;
    const dataObjId = hostProps['data-obj-id'];

    // ABSENCE IS NOT `body` (`57f9b077b`). Nothing writes a variant into a
    // node that omits the key: the Zod mirror used to declare `.default('body')`
    // and materialise it on a PARSED document, and objectui#7735 removed that —
    // a validator validates, it does not author, and this renderer's own
    // behaviour is the authoritative default. So the parsed and the authored
    // node now agree here, and both are variant-less. Reading absence as `body`
    // would put `text-sm text-foreground` on all ~690 corpus
    // text nodes that never asked for a variant — a corpus-wide restyle, and
    // the opposite of the narrow repair the ruling scoped. An unauthored node
    // therefore keeps exactly the shape it had before this change: the
    // fragment, or the bare `<span>` when a designer id or className wraps it.
    // An off-enum value contributes no class for the same reason — it is
    // refused at authoring time by `safeValidateSchema`, which is where B1 puts
    // the rejection, and quietly styling it would be option C.
    const variantClass = schema.variant ? VARIANT_CLASS[schema.variant] : undefined;
    const alignClass = schema.align ? ALIGN_CLASS[schema.align] : undefined;
    const className =
      cn(variantClass, alignClass, schema.className || hostProps.className) || undefined;

    // If we have designer props, typography or className, we must wrap it to make it selectable and styleable
    if (dataObjId || className) {
        const Tag = (schema.variant && VARIANT_TAG[schema.variant]) || 'span';
        return (
            <Tag 
                {...toDomProps(hostProps)}
                style={style}
                className={className}
            >
                {schema.content}
            </Tag>
        );
    }

    return <>{schema.content}</>;
  },
  {
    namespace: 'ui',
    label: 'Text',
    inputs: [
      { name: 'content', type: 'string', required: true },
      // Declared because they are READ, in the same change as the read sites
      // above (`57f9b077b`). While these were missing, `page.tsx`'s JSX-page
      // prop whitelist — built from `getKnownTypes()` plus these `inputs` —
      // reported `unknown-prop` for two keys `TextSchema` publishes.
      //
      // There is NO published default for `variant` to restate. `layout.zod.ts`
      // carried `.default('body')` until objectui#7735 removed it (the zod
      // mirror stopped authoring values), and `TextSchema.variant`'s docblock
      // publishes no `@default` tag for the same reason: this renderer applies
      // none, and under that ruling the renderer is the authority the tag
      // describes. Restating one here would be impossible anyway —
      // `ComponentInput.defaultValue` is an ADR-0049 tombstone since
      // objectui#7493; the manifest never forwarded it and no designer read it.
      // See the ABSENCE IS NOT `body` note above: a node that never carried the
      // key is left exactly as it was authored.
      { name: 'variant', type: 'enum', enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'caption', 'overline'] },
      { name: 'align', type: 'enum', enum: ['left', 'center', 'right', 'justify'] }
    ],
    defaultProps: {
      content: 'Text content'
    }
  }
);
