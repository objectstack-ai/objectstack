/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import { cn } from '../../lib/utils';
import { pageBlockSpan, PAGE_BLOCK_SPAN_CLASS } from './page-block-span';

/**
 * Is this block list inside a rail region (sidebar / aside)? A rail is a
 * narrow column, so every block in it, at any depth, spans 12. The region
 * renderer provides it; the container grids below read it.
 */
const PageBlockRailContext = React.createContext(false);

/**
 * Lays a list of page blocks on the 12-column block grid (objectui#12624):
 * each block takes the span its kind gets from `./page-block-span`, folded by
 * breakpoint. One component for every block list that folds this way: a
 * region's blocks (`RegionContent` in `./page.tsx`) and the children of
 * `page:card` / `page:section` (`./containers.tsx`), so a container in a
 * region spans 12 by its own kind and its children fold like region blocks.
 * A cell is `empty:hidden`, so a block that renders nothing leaves no gap.
 */
export const PageBlockGrid: React.FC<{
  nodes: readonly unknown[];
  className?: string;
  /** Marks the list as a rail's: every block in it, nested ones too, spans 12. */
  rail?: boolean;
  /** Key prefix for blocks with no `id`. */
  keyPrefix?: string;
  /** Maps a node to the schema `SchemaRenderer` renders (identity by default). */
  toSchema?: (node: unknown) => unknown;
  attributes?: Record<string, string | undefined>;
  /** The grid element, for a caller that measures it (the region's posture, objectui#12703). */
  gridRef?: React.Ref<HTMLDivElement>;
}> = ({ nodes, className, rail, keyPrefix = 'block', toSchema, attributes, gridRef }) => {
  const inRail = React.useContext(PageBlockRailContext);
  const isRail = !!rail || inRail;
  const grid = (
    <div ref={gridRef} className={cn('grid grid-cols-12 gap-4', className)} {...attributes}>
      {nodes.map((node, idx) => {
        const n = node as { id?: unknown; type?: unknown } | null;
        const span = pageBlockSpan(n?.type, isRail);
        return (
          <div
            key={typeof n?.id === 'string' && n.id ? n.id : `${keyPrefix}-${idx}`}
            className={cn('min-w-0 empty:hidden', PAGE_BLOCK_SPAN_CLASS[span])}
            data-block-span={span}
          >
            <SchemaRenderer schema={(toSchema ? toSchema(node) : node) as React.ComponentProps<typeof SchemaRenderer>['schema']} />
          </div>
        );
      })}
    </div>
  );
  return rail && !inRail ? <PageBlockRailContext.Provider value>{grid}</PageBlockRailContext.Provider> : grid;
};

/**
 * A container's child slot as a block grid: a list goes on the grid, while a
 * bare node or text renders as it did (`renderChildren`), since there is
 * nothing to lay out beside it.
 */
export function renderBlockChildren(children: unknown, render: (c: unknown) => React.ReactNode): React.ReactNode {
  if (Array.isArray(children) && children.length > 0) return <PageBlockGrid nodes={children} />;
  return render(children);
}
