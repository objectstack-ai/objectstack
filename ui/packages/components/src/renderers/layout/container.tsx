/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { ContainerSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import { cn } from '../../lib/utils';
import { forwardRef } from 'react';

// Index signature on the parameter annotation, not on the `forwardRef` type
// argument — mechanism note on `action:bar` (objectui#4422), pinned by
// `__tests__/forwardref-props-annotation.guard.test.ts`.
const ContainerRenderer = forwardRef<HTMLDivElement, { schema: ContainerSchema; className?: string }>(
  ({ schema, className, ...props }: { schema: ContainerSchema; className?: string; [key: string]: any }, ref) => {
    // `??`, not `||`: `maxWidth` declares `false` for the "no maximum width"
    // case, and `||` folded that legal value into the default — so a container
    // asking for NO constraint rendered `max-w-xl` (36rem), the exact opposite
    // of what it declared, and the `false` arm of the union had no reachable
    // path from the day it was declared (objectui#4889). Same read as `padding`
    // below, and the one `stack.tsx` / `grid.tsx` have always used.
    const maxWidth = schema.maxWidth ?? 'xl';
    // `??`, not `||`: `padding` is a declared step, and `0` is a legal value
    // that `||` folds into the default — which left the `padding === 0 && 'p-0'`
    // branch below permanently unreachable, so a container asking for no padding
    // silently rendered `p-2 sm:p-3 md:p-4` (objectui#4003).
    // ⛔ No rounding or clamping here: the branches below ARE the accept set, and
    // `ContainerSchema` refuses every other number at the door (objectui#11424).
    const padding = schema.padding ?? 4;
    const centered = schema.centered !== false; // Default to true
    
    const containerClass = cn(
      // Base container
      'w-full',
      // Max width
      // `false` emits an EXPLICIT cancel, not merely the absence of a class.
      // "Absent" and "cancel" coincide only when nothing else supplies a
      // max-width. Under an INHERITED one they diverge — the typography
      // plugin's `prose` sets `max-width: 65ch` on the same element — so
      // dropping the class would leave that constraint standing and the
      // declared "no maximum width" would still not be what renders
      // (objectui#4889).
      maxWidth === false && 'max-w-none',
      maxWidth === 'sm' && 'max-w-sm',
      maxWidth === 'md' && 'max-w-md',
      maxWidth === 'lg' && 'max-w-lg',
      maxWidth === 'xl' && 'max-w-xl',
      maxWidth === '2xl' && 'max-w-2xl',
      maxWidth === '3xl' && 'max-w-3xl',
      maxWidth === '4xl' && 'max-w-4xl',
      maxWidth === '5xl' && 'max-w-5xl',
      maxWidth === '6xl' && 'max-w-6xl',
      maxWidth === '7xl' && 'max-w-7xl',
      maxWidth === 'full' && 'max-w-full',
      maxWidth === 'screen' && 'max-w-screen-2xl',
      // Centering
      centered && 'mx-auto',
      // Padding - Mobile-first responsive
      padding === 0 && 'p-0',
      padding === 1 && 'p-0.5 sm:p-1',
      padding === 2 && 'p-1 sm:p-2',
      padding === 3 && 'p-2 sm:p-3',
      padding === 4 && 'p-2 sm:p-3 md:p-4',
      padding === 5 && 'p-3 sm:p-4 md:p-5',
      padding === 6 && 'p-3 sm:p-4 md:p-6',
      padding === 7 && 'p-4 sm:p-5 md:p-7',
      padding === 8 && 'p-4 sm:p-6 md:p-8',
      padding === 10 && 'p-5 sm:p-7 md:p-10',
      padding === 12 && 'p-6 sm:p-8 md:p-12',
      padding === 16 && 'p-8 sm:p-10 md:p-16',
      className
    );

    // DOM pass-through is a WHITELIST — objectui#3291's discipline, executed by
    // {@link toDomProps}. Mechanism and full argument: `grid.tsx`'s docblock
    // (objectui#4787 / PR #5573) and `packages/core/src/utils/dom-props.ts`.
    //
    // MEASURED (objectui#5574): every `container` node in
    // `examples/schema-catalog` rendered through the real `SchemaRenderer` and
    // read off the DOM — 20 illegitimate attributes across 15 nodes, `padding` 14
    // and `maxwidth` 6. Both are keys CONSUMED off `schema` above. `maxwidth` is
    // the one camelCase leak in this family and it is instructive: it reaches the
    // DOM ALREADY LOWERCASED, because React's own remedy for the unknown-attribute
    // warning is to spell it lowercase — which silences the warning and keeps the
    // leak. That is why the pin reads the DOM instead of the console.
    //
    // `style` is forwarded by name (the objectui#4435 route) as this container's
    // designer sizing channel; `data-obj-*` arrive through the open `data-*`
    // family {@link toDomProps} already forwards.
    const { style, ...hostProps } = props;

    return (
      <div 
        ref={ref}
        {...toDomProps(hostProps)}
        className={containerClass} 
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
  }
);

ComponentRegistry.register('container', 
  ContainerRenderer,
  {
    namespace: 'ui',
    label: 'Container',
    inputs: [
      { 
        name: 'maxWidth', 
        type: 'enum', 
        // `false` is a member of the union `ContainerSchema.maxWidth` declares,
        // and this list lagged it: an author reading the type wrote a value the
        // published authoring surface called illegal, while the renderer folded
        // it into `max-w-xl` anyway (objectui#4889). `inputs` is not
        // documentation — `sdui-parser` serializes it into `sdui.manifest.json`
        // and `sdui-intrinsics.d.ts`, and `validate.ts` gates authored props
        // against it — so a value missing here is a value the platform reports
        // as `invalid-enum`.
        //
        // The object form is what carries a non-string member: `enum` is typed
        // `string[] | { label, value }[]`, not a mixed array, and `enumValues()`
        // in `sdui-parser/src/validate.ts` flattens BOTH forms, so this stays a
        // single `enum` arm whose closed list now contains `false`.
        enum: [
          { label: 'None (cancel max-width)', value: false },
          { label: 'sm', value: 'sm' },
          { label: 'md', value: 'md' },
          { label: 'lg', value: 'lg' },
          { label: 'xl', value: 'xl' },
          { label: '2xl', value: '2xl' },
          { label: '3xl', value: '3xl' },
          { label: '4xl', value: '4xl' },
          { label: '5xl', value: '5xl' },
          { label: '6xl', value: '6xl' },
          { label: '7xl', value: '7xl' },
          { label: 'full', value: 'full' },
          { label: 'screen', value: 'screen' },
        ]      },
      {
        name: 'padding',
        // A closed list, in `maxWidth`'s object form above, not `type: 'number'`
        // (objectui#11424): the branches in this file map exactly these steps,
        // and any other number drew no padding class at all. `ContainerSchema`
        // refuses the rest on both faces; this list carries the same set into
        // the manifest, so `validateTree` answers `padding: 9` with
        // `invalid-enum` and the generated intrinsics type the prop as the
        // twelve literals. `layout-spacing-sets-11474.test.tsx` holds this
        // list, the declaration and the rendered branches to one set.
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
          { label: '10', value: 10 },
          { label: '12', value: 12 },
          { label: '16', value: 16 },
        ],
        description: 'Padding step on the container spacing scale; 0 is none. Default 4.'
      },
      {
        name: 'centered',
        type: 'boolean'      },
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot' }
    ],
    defaultProps: {
      maxWidth: 'xl',
      padding: 4,
      centered: true,
      children: [
        { type: 'text', content: 'Container content goes here' }
      ]
    },
    isContainer: true,
    resizable: true,
    resizeConstraints: {
      width: true,
      height: true,
      minWidth: 200,
      minHeight: 100
    }
  }
);
