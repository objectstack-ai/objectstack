/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { useSchemaContext } from '@object-ui/react';
import { ObjectTimesheet } from './ObjectTimesheet';
import type { ObjectTimesheetProps } from './ObjectTimesheet';

export { ObjectTimesheet };
export type { ObjectTimesheetProps };
export type { ObjectTimesheetSchema } from '@object-ui/types';
export {
  buildTimesheetRows,
  planCellWrite,
  resolveTimesheetConfig,
  startOfWeek,
  weekDays,
  type TimesheetBinding,
  type TimesheetGrid,
  type TimesheetRow,
  type TimesheetCell,
  type CellWrite,
} from './timesheetModel';

// Renderer wrapper: pulls the dataSource from schema context, mirroring the
// other view plugins (object-tree / object-gantt / …).
export const ObjectTimesheetRenderer: React.FC<any> = ({ schema, ...props }) => {
  const { dataSource } = useSchemaContext() || {};
  return <ObjectTimesheet schema={schema} dataSource={dataSource} {...props} />;
};

// The keys `ObjectTimesheet` reads off its node. The node is composed by
// `@object-ui/plugin-list`'s `ListView` for a `type: 'timesheet'` view; it is
// not a curated page block (`PUBLIC_BLOCKS`), so these inputs describe the
// renderer to the designer and the registry, not a page-authoring contract.
const timesheetInputs = [
  {
    name: 'objectName',
    type: 'string' as const,
    required: true,
    description: 'The object whose records the grid pivots, one record per filled cell.',
  },
  {
    name: 'timesheet',
    type: 'object' as const,
    required: true,
    description:
      'The binding: `rowFields` (one to three fields whose values key a row), `dateField` (the field placing a record on a day column) and `valueField` (the number a cell shows and edits). Without all three the grid shows the "Timesheet configuration required" screen.',
  },
  {
    name: 'filter',
    type: 'array' as const,
    description:
      'Base query filter, joined with the displayed week on `dateField`. Rows a filter removes are not drawn, so a record typed into a row the filter excludes disappears on the next read.',
  },
];

ComponentRegistry.register('object-timesheet', ObjectTimesheetRenderer, {
  namespace: 'plugin-timesheet',
  label: 'Object Timesheet',
  category: 'view',
  inputs: timesheetInputs,
});
