/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// table.tsx implementation
import { ComponentRegistry } from '@object-ui/core';
// The NARROW static column subset, not the rich shared `TableColumn` —
// objectui#5474 split the types so declared = enforced holds per renderer.
// Every key this file reads off a column must be declared there, and every
// key declared live there must be read here; the pairing is pinned by
// `__tests__/table-declared-equals-enforced.test.tsx`.
import type { StaticTableColumn, TableSchema } from '@object-ui/types';
import { renderChildren, renderNodeSlot } from '../../lib/utils';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableFooter, 
  TableHead, 
  TableRow, 
  TableCell, 
  TableCaption 
} from '../../ui';

// A simple data-driven table
ComponentRegistry.register('table', 
  ({ schema, className, ...props }: { schema: TableSchema; className?: string; [key: string]: any }) => (
    <Table className={className} {...props}>
      {schema.caption && <TableCaption>{schema.caption}</TableCaption>}
      <TableHeader>
        <TableRow>
          {schema.columns?.map((col: StaticTableColumn, index: number) => (
            <TableHead key={index} className={col.className} style={{ width: col.width }}>
                {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {schema.data?.map((row: any, rowIndex: number) => (
          <TableRow key={rowIndex}>
            {schema.columns?.map((col: StaticTableColumn, colIndex: number) => (
                <TableCell key={colIndex} className={col.cellClassName}>
                    {row[col.accessorKey]}
                </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {/* ⛔ No `&&` guard on a node slot (objectui#9162): `&&` evaluates to
          the slot, so a legal authored `footer: 0` painted "0" into the footer
          cell. `renderNodeSlot` runs the wrapper only when the slot has
          content, so the whole footer row disappears with it — which is what
          the `&&` was there for. The `typeof === 'string'` branch is gone
          because `renderChildren` already returns a string slot as its own
          text; the branch was a second spelling of the same answer. */}
      {renderNodeSlot(schema.footer, (footer) => (
          <TableFooter>
              <TableRow>
                   <TableCell colSpan={schema.columns?.length}>
                     {renderChildren(footer)}
                   </TableCell>
              </TableRow>
          </TableFooter>
      ))}
    </Table>
  ),
  {
    namespace: 'ui',
    label: 'Table',
    inputs: [
      { name: 'caption', type: 'string' },
      { name: 'footer', type: 'string' },
      { 
          name: 'columns', 
          type: 'array', 
          description: 'Array of { header, accessorKey, className, cellClassName, width }'
      },
       { 
          name: 'data', 
          type: 'array', 
          description: 'Array of objects'
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      caption: 'Table Caption',
      columns: [
        { header: 'Column 1', accessorKey: 'col1' },
        { header: 'Column 2', accessorKey: 'col2' },
        { header: 'Column 3', accessorKey: 'col3' }
      ],
      data: [
        { col1: 'Row 1, Col 1', col2: 'Row 1, Col 2', col3: 'Row 1, Col 3' },
        { col1: 'Row 2, Col 1', col2: 'Row 2, Col 2', col3: 'Row 2, Col 3' },
        { col1: 'Row 3, Col 1', col2: 'Row 3, Col 2', col3: 'Row 3, Col 3' }
      ]
    }
  }
);
