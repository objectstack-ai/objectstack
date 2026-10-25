/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { FlexSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import { cn } from '../../lib/utils';

ComponentRegistry.register('flex', 
  ({ schema, className, ...props }: { schema: FlexSchema; className?: string; [key: string]: any }) => {
    const direction = schema.direction || 'row';
    const justify = schema.justify || 'start';
    const align = schema.align || 'start';
    // `??`, not `||`: `gap` is a declared `number`, and `0` is a legal value that
    // `||` folds into the default — which left the `gap === 0 && 'gap-0'` branch
    // below permanently unreachable. Sibling `stack.tsx` / `grid.tsx` already read
    // theirs with `??`; this converges the family (objectui#4003).
    const gap = schema.gap ?? 2;
    const wrap = schema.wrap || false;
    
    const flexClass = cn(
      'flex',
      // Direction
      direction === 'row' && 'flex-row',
      direction === 'col' && 'flex-col',
      direction === 'row-reverse' && 'flex-row-reverse',
      direction === 'col-reverse' && 'flex-col-reverse',
      // Justify content
      justify === 'start' && 'justify-start',
      justify === 'end' && 'justify-end',
      justify === 'center' && 'justify-center',
      justify === 'between' && 'justify-between',
      justify === 'around' && 'justify-around',
      justify === 'evenly' && 'justify-evenly',
      // Align items
      align === 'start' && 'items-start',
      align === 'end' && 'items-end',
      align === 'center' && 'items-center',
      align === 'baseline' && 'items-baseline',
      align === 'stretch' && 'items-stretch',
      // Gap - Mobile-first responsive
      gap === 0 && 'gap-0',
      gap === 1 && 'gap-1',
      gap === 2 && 'gap-1.5 sm:gap-2',
      gap === 3 && 'gap-2 sm:gap-3',
      gap === 4 && 'gap-2 sm:gap-3 md:gap-4',
      gap === 5 && 'gap-3 sm:gap-4 md:gap-5',
      gap === 6 && 'gap-3 sm:gap-4 md:gap-6',
      gap === 7 && 'gap-4 sm:gap-5 md:gap-7',
      gap === 8 && 'gap-4 sm:gap-6 md:gap-8',
      // Wrap
      wrap && 'flex-wrap',
      className
    );

    // DOM pass-through is a WHITELIST, never a list of keys to strip — the
    // objectui#3291 discipline, executed by {@link toDomProps} and already landed
    // on the sibling `grid.tsx` (objectui#4787 / PR #5573), whose docblock carries
    // the full argument. This replaces the bare `{...flexProps}` spread, which
    // forwarded everything `SchemaRenderer` hands a renderer — the authored node's
    // own keys, the flattened `props` container, the injected adapter and any
    // extra key the author wrote — onto the div as invalid HTML attributes.
    //
    // MEASURED, not assumed (objectui#5574): every `flex` node in
    // `examples/schema-catalog` rendered through the real `SchemaRenderer`, then
    // read off the DOM — 494 illegitimate attributes across 248 nodes, led by
    // `align` (198), `gap` (193), `justify` (98) and `direction` (5). Each of
    // those four is a key CONSUMED off `schema` above and turned into a class;
    // forwarding it as well is pure leakage. All four are all-lowercase, so React
    // reports none of them — which is why the pin is the DOM-reading sweep in
    // `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx` rather
    // than a warning-as-error rule. `grid`'s 26 nodes read ZERO under the same
    // probe, which is the control saying the reading is real.
    //
    // `style` is forwarded BY NAME rather than reopened in the shared whitelist
    // (the objectui#4435 route): it is this container's designer sizing channel,
    // and the shared set is deliberately element-agnostic. `data-obj-id` /
    // `data-obj-type` need no special handling — they arrive through the open
    // `data-*` family {@link toDomProps} already forwards.
    const { style, ...hostProps } = props;

    return (
      <div 
        {...toDomProps(hostProps)}
        className={flexClass} 
        style={style}
      >
        {/* ⛔ No `&&` guard: the slot IS the left operand, so a legal
            authored `children: 0` would render the character (objectui#9162).
            `renderChildren` is the guard — its `isEmptyNodeSlot` first leg
            answers every falsy input with `null`, and it is reachable only
            because nothing short-circuits ahead of it. Pinned in
            `renderers/__tests__/node-slot-numeric-falsy.test.tsx`; the
            spelling is held by `object-ui/no-bare-node-slot-guard`. */}
        {renderChildren(schema.children)}
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'Flex Layout',
    inputs: [
      { 
        name: 'direction', 
        type: 'enum', 
        enum: ['row', 'col', 'row-reverse', 'col-reverse']      },
      { 
        name: 'justify', 
        type: 'enum', 
        enum: ['start', 'end', 'center', 'between', 'around', 'evenly']      },
      { 
        name: 'align', 
        type: 'enum', 
        enum: ['start', 'end', 'center', 'baseline', 'stretch']      },
      {
        name: 'gap',
        // A closed list, in `container.padding`'s object form, not
        // `type: 'number'` (objectui#11474): the `gap === N` branches above map
        // exactly these steps, and any other number drew no gap class at all.
        // `FlexSchema` and the authored `properties` bag refuse the rest on both
        // faces; this list carries the same set into the SDUI manifest, so
        // `validateTree` answers `gap: 9` with `invalid-enum`.
        // `layout-spacing-sets-11474.test.tsx` holds this list, the declaration
        // and the rendered branches to one set.
        type: 'enum',
        enum: [
          { label: '0 (none)', value: 0 },
          { label: '1', value: 1 },
          { label: '2', value: 2 },
          { label: '3', value: 3 },
          { label: '4', value: 4 },
          { label: '5', value: 5 },
          { label: '6', value: 6 },
          { label: '7', value: 7 },
          { label: '8', value: 8 },
        ],
        description: 'Gap step between items; 0 is none. Default 2.'
      },
      {
        name: 'wrap',
        type: 'boolean',


        description: 'Allow flex items to wrap'
      },
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot' }
    ],
    defaultProps: {
      direction: 'row',
      justify: 'start',
      // `'start'`, not `'center'`. This entry is the DESIGNER face — what a new
      // `flex` node is seeded with — and it used to seed a value the renderer
      // eight lines from the top of this file never applies (`schema.align ||
      // 'start'`). A designer-made node therefore laid out differently from a
      // hand-authored one that simply omitted the key: one component, two
      // answers (the finding `8b7ea3945` reconciled, folded into objectui#7735's ruling).
      //
      // The renderer fallback is the single authoritative default under that
      // ruling — the zod mirror stopped authoring `align` in the same change,
      // and `FlexLayoutProps.align` publishes no single `@default` tag because
      // `flex` and `stack` diverge (objectui#7361). So `'start'` here is not a
      // fourth opinion; it is this face agreeing with the one authority.
      //
      // Derived pin: `__tests__/registration-defaults-match-renderer-8229.test.ts`
      // re-derives every `defaultProps`/fallback pair in this file and
      // `stack.tsx` off disk and fails if any of them diverges again.
      align: 'start',
      gap: 2,
      wrap: false,
      children: [
        { type: 'button', label: 'Button 1' },
        { type: 'button', label: 'Button 2' },
        { type: 'button', label: 'Button 3' }
      ]
    },
    // `flex` renders `schema.children` (see `renderChildren` above) but did not
    // DECLARE that it does, while `grid`, `card`, `container` and `stack` — the
    // same directory, the same `ui` namespace — all do. The flag is not read by
    // the render path, so nothing was broken at runtime; its consumers are
    // elsewhere, and the gap made them contradict the renderer (`7c9b044f4`).
    //
    // MEASURED, not inferred. Building the manifest the way the app builds it
    // (`getKnownTypes()` + `getMeta()` -> `manifestFromConfigs`) and putting a
    // `flex` node WITH children through `validateTree` returned
    // `["not-a-container"]`, while `grid` / `card` / `container` under the same
    // probe returned `[]` — the control that makes the reading real. Downstream,
    // objectstack's three shipped `examples/app-showcase` html pages drew 32
    // `not-a-container` warnings, every one of them on `flex` and `flex` the
    // only source of them.
    //
    // `isContainer` alone, deliberately. The four `ui`-namespace siblings pair
    // it with `resizable` / `resizeConstraints`, but the `page:*` containers in
    // `containers.tsx` declare `isContainer: true` on its own — so the flag is
    // independent of designer resize affordances, and minting one here would be
    // a behaviour change this card did not measure.
    //
    // Since objectui#9910 the flag means LAYOUT containment only (the
    // react-page JSX scope skips it; the public layout ledger lists it). The
    // measurement above is now held by the `children` slot in `inputs`, which
    // is the one thing `validateTree`'s `not-a-container` reads.
    isContainer: true
  }
);
