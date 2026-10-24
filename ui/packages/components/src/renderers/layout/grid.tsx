/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { GridSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import { cn } from '../../lib/utils';

// Helper maps to ensure Tailwind classes are scanned and included
const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4',
  5: 'grid-cols-5', 6: 'grid-cols-6', 7: 'grid-cols-7', 8: 'grid-cols-8',
  9: 'grid-cols-9', 10: 'grid-cols-10', 11: 'grid-cols-11', 12: 'grid-cols-12'
};

const GRID_COLS_SM: Record<number, string> = {
  1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6', 7: 'sm:grid-cols-7', 8: 'sm:grid-cols-8',
  9: 'sm:grid-cols-9', 10: 'sm:grid-cols-10', 11: 'sm:grid-cols-11', 12: 'sm:grid-cols-12'
};

const GRID_COLS_MD: Record<number, string> = {
  1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4',
  5: 'md:grid-cols-5', 6: 'md:grid-cols-6', 7: 'md:grid-cols-7', 8: 'md:grid-cols-8',
  9: 'md:grid-cols-9', 10: 'md:grid-cols-10', 11: 'md:grid-cols-11', 12: 'md:grid-cols-12'
};

const GRID_COLS_LG: Record<number, string> = {
  1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7', 8: 'lg:grid-cols-8',
  9: 'lg:grid-cols-9', 10: 'lg:grid-cols-10', 11: 'lg:grid-cols-11', 12: 'lg:grid-cols-12'
};

const GRID_COLS_XL: Record<number, string> = {
  1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6', 7: 'xl:grid-cols-7', 8: 'xl:grid-cols-8',
  9: 'xl:grid-cols-9', 10: 'xl:grid-cols-10', 11: 'xl:grid-cols-11', 12: 'xl:grid-cols-12'
};

// `2xl` is the sixth and last member of the breakpoint vocabulary — `BreakpointName`
// in `@object-ui/types`, `BREAKPOINTS` / `BREAKPOINT_ORDER` in `@object-ui/mobile`,
// and `BreakpointColumnMap` in `@object-ui/layout`, whose `ResponsiveGrid` already
// emits `2xl:grid-cols-*`. This map stopped at `xl`, and so did the read arm below,
// so an authored `columns: { '2xl': 6 }` validated, emitted nothing, and rendered at
// the `xs` count on every screen (`3cab5703b`).
//
// The map is not decoration: it is what makes these class names EXIST. Tailwind v4
// finds utilities by scanning source text (`@source '../src/**/*.{ts,tsx}'` in
// `packages/components/src/index.css`), so a `2xl:grid-cols-${n}` built at runtime
// from a template would never be compiled and the node would render unstyled — green
// in a unit test, wrong in the browser. Spelling all twelve out is the same reason
// the five maps above are spelled out. The variant itself is Tailwind's default
// `2xl` (96rem / 1536px, matching `BREAKPOINTS['2xl']`); no `@theme` block in this
// repo overrides `--breakpoint-*`.
const GRID_COLS_2XL: Record<number, string> = {
  1: '2xl:grid-cols-1', 2: '2xl:grid-cols-2', 3: '2xl:grid-cols-3', 4: '2xl:grid-cols-4',
  5: '2xl:grid-cols-5', 6: '2xl:grid-cols-6', 7: '2xl:grid-cols-7', 8: '2xl:grid-cols-8',
  9: '2xl:grid-cols-9', 10: '2xl:grid-cols-10', 11: '2xl:grid-cols-11', 12: '2xl:grid-cols-12'
};

// The counts the six maps above spell, as the registration's closed list
// (objectui#11491), in `container.padding`'s `{ label, value }` form: the
// `columns` input's own list, and the members of its breakpoint object.
const COLUMN_COUNT_OPTIONS = [
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5', value: 5 },
  { label: '6', value: 6 },
  { label: '7', value: 7 },
  { label: '8', value: 8 },
  { label: '9', value: 9 },
  { label: '10', value: 10 },
  { label: '11', value: 11 },
  { label: '12', value: 12 },
];

const GAPS: Record<number, string> = {
  0: 'gap-0', 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 
  5: 'gap-5', 6: 'gap-6', 8: 'gap-8', 10: 'gap-10', 12: 'gap-12'
};

ComponentRegistry.register('grid', 
  ({ schema, className, ...props }: { schema: GridSchema; className?: string; [key: string]: any }) => {
    // Determine columns configuration
    // Supports detailed object configuration from schema
    let baseCols = 2;
    let smCols, mdCols, lgCols, xlCols, xxlCols;

    if (typeof schema.columns === 'number') {
      baseCols = schema.columns;
    } else if (typeof schema.columns === 'object' && schema.columns !== null) {
      // Handle responsive object: { xs: 1, sm: 2, md: 3, lg: 4, xl: 5, '2xl': 6 }
      // Note: 'xs' corresponds to base (mobile-first)
      baseCols = schema.columns.xs ?? 1;
      smCols = schema.columns.sm;
      mdCols = schema.columns.md;
      lgCols = schema.columns.lg;
      xlCols = schema.columns.xl;
      // `xxlCols` because `2xlCols` is not a legal identifier; the authored key
      // is and stays `'2xl'`.
      xxlCols = schema.columns['2xl'];
    }

    // No flat per-breakpoint key is read (objectui#11505). `smColumns`,
    // `mdColumns`, `lgColumns` and `xlColumns` were a second spelling of the
    // breakpoint object above, read over it, and declared by no face of
    // `GridSchema`; both faces now refuse them by name, and a value that
    // reaches here unvalidated draws nothing and is never forwarded.
    //
    // Mobile-first ramp: a bare numeric `columns` collapses on small screens so
    // an N-across row doesn't render as unreadable slivers on a phone. Authors
    // who pass the breakpoint object keep full control. The bare-number branch
    // sets no breakpoint count, so the ramp's only condition is that branch.
    if (typeof schema.columns === 'number' && baseCols > 1) {
      mdCols = baseCols;
      smCols = Math.min(2, baseCols);
      baseCols = 1;
    }

    const gap = schema.gap ?? 4;
    
    // Generate Tailwind grid classes
    const gridClass = cn(
      'grid',
      // Base columns. No fallback class (objectui#11491): this read once ended
      // `|| 'grid-cols-2'`, which drew two columns for a base count the map
      // lacks (`0`, `-1`, `{ xs: 13 }`). `GridSchema.columns` now refuses every
      // count outside 1–12, and each path a validated document takes lands
      // `baseCols` in this map: an absent `columns` keeps the `2` above, an
      // object without `xs` takes `?? 1`, and a bare count above 1 is ramped
      // to `1`. An unmapped count that reaches here unvalidated draws no base
      // column class, the same as an unmapped count at any other breakpoint;
      // nothing is substituted.
      GRID_COLS[baseCols],
      // Responsive columns
      smCols && GRID_COLS_SM[smCols],
      mdCols && GRID_COLS_MD[mdCols],
      lgCols && GRID_COLS_LG[lgCols],
      xlCols && GRID_COLS_XL[xlCols],
      xxlCols && GRID_COLS_2XL[xxlCols],
      // Gap
      GAPS[gap] || `gap-[${gap * 0.25}rem]`, // Fallback for arbitrary values if not in map
      className
    );

    // DOM pass-through is a WHITELIST, never a list of keys to strip — objectui#3291's
    // discipline, promoted out of `packages/fields` to `@object-ui/core` by
    // objectui#4425 phase 2 and executed here by {@link toDomProps}.
    //
    // `SchemaRenderer` hands this renderer the authored node's own keys, the contents
    // of its `props` container, and any extra key the author wrote. The bare
    // `{...gridProps}` spread this replaces put all of it on the div as invalid HTML
    // attributes — measured on a canary node: `columns="4"`, `gap="4"`, `mdcolumns="2"`,
    // `smcolumns="2"`, `name="grid_node"`, `props="[object Object]"`,
    // `colorvariant="x"` and an unknown authored `zzcanary="leak"`, eight in all
    // (objectui#4787). Only `data-obj-*`/`style` were ever removed.
    //
    // Enumerating today's GridSchema keys instead would re-rot the moment the schema
    // grows one, and could never name the OPEN TAIL — `zzcanary` and the flattened
    // `props` container are author-supplied, so no finite list reaches them. The
    // whitelist keeps what is DECLARED DOM-safe (`id`, `className`, `role`, `tabIndex`,
    // … plus the open `data-*` / `aria-*` families, which is how `data-obj-id` and
    // `data-obj-type` still arrive) and drops everything else by construction.
    //
    // `style` is forwarded BY NAME rather than reopened in the shared whitelist (the
    // objectui#4435 route): it is this container's designer sizing channel, but the
    // shared set is deliberately element-agnostic and nothing element-specific belongs
    // in it. Grid's own keys (`columns`, `gap`) are CONSUMED off `schema` above and must
    // never be forwarded.
    const { style, ...hostProps } = props;

    return (
      <div
        {...toDomProps(hostProps)}
        className={gridClass}
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
    label: 'Grid Layout',
    // The column input is a closed list of the counts the `GRID_COLS*` maps
    // above spell, not `type: 'number'` (objectui#11491): any other count drew
    // no column class where it was authored. `GridSchema.columns` refuses the
    // rest on both faces. `columns` also takes the breakpoint object
    // `GridSchema` declares, so it publishes an `object` arm whose members are
    // the same list (`of`): `columns: 13` is an error-level `type-mismatch`
    // naming the list, and `columns: { md: 13 }` a `member-type-mismatch`.
    // `layout-spacing-sets-11474.test.tsx` holds this list, the declaration
    // and the rendered classes the compiled stylesheet defines to one set.
    // ⛔ No flat `smColumns` … `xlColumns` input (objectui#11505): the
    // breakpoint object is the one spelling of a per-breakpoint count, and
    // `validateTree` answers a flat key with `unknown-prop`.
    inputs: [
      {
        name: 'columns',
        type: ['enum', 'object'],
        enum: COLUMN_COUNT_OPTIONS,
        of: 'enum',
        description:
          'Column count, 1 to 12, or an object of such counts keyed by breakpoint (xs, sm, md, lg, xl, 2xl). Default 2.'
      },
      {
        name: 'gap',
        // A closed list, in `container.padding`'s object form, not
        // `type: 'number'` (objectui#11474): these are the `GAPS` entries above.
        // For any other number the renderer builds a class at runtime, and
        // Tailwind never compiles a class it did not find in scanned source, so
        // that grid drew no gap at all. `GridSchema` refuses the rest on both
        // faces; this list carries the same set into the SDUI manifest, so
        // `validateTree` answers `gap: 9` with `invalid-enum`.
        // `layout-spacing-sets-11474.test.tsx` holds this list, the declaration
        // and the rendered classes the compiled stylesheet defines to one set.
        type: 'enum',
        enum: [
          { label: '0 (none)', value: 0 },
          { label: '1', value: 1 },
          { label: '2', value: 2 },
          { label: '3', value: 3 },
          { label: '4', value: 4 },
          { label: '5', value: 5 },
          { label: '6', value: 6 },
          { label: '8', value: 8 },
          { label: '10', value: 10 },
          { label: '12', value: 12 },
        ],
        description: 'Gap step between items; 0 is none. Default 4.'
      },
      { name: 'className', type: 'string' },
      { name: 'children', type: 'slot' }
    ],
    defaultProps: {
      // One column on a phone, two from `md`, four from `lg`: the breakpoint
      // object, the one spelling (objectui#11505). The seed was `columns: 1`
      // with the retired flat `mdColumns: 2` / `lgColumns: 4`, and draws the
      // same classes in this form.
      columns: { xs: 1, md: 2, lg: 4 },
      gap: 4,
      children: [
        { type: 'card', title: 'Card 1', description: 'First card' },
        { type: 'card', title: 'Card 2', description: 'Second card' },
        { type: 'card', title: 'Card 3', description: 'Third card' },
        { type: 'card', title: 'Card 4', description: 'Fourth card' }
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
