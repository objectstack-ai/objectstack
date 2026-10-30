/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27386 row 2 — the task list's name column is headed by what its
 * rows are.
 *
 * A gantt bound to an object heads the column with that object's label (a
 * campaign gantt reads "Campaign", not "Task Name"). Three cases keep the
 * generic heading: an inline data set (no object), a bound object that
 * declares no label, and a mixed-object tree (`objectField`), whose rows are
 * not all the bound object.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from './ObjectGantt';

const ITEMS = [
  { id: '1', name: 'Spring launch', start: '2024-01-01', end: '2024-01-05' },
  { id: '2', name: 'Summer promo', start: '2024-02-01', end: '2024-02-10' },
];

function ganttSchema(extra: Record<string, any> = {}, gantt: Record<string, any> = {}) {
  return {
    type: 'object-gantt',
    objectName: 'campaign',
    gantt: { startDateField: 'start', endDateField: 'end', titleField: 'name', ...gantt },
    data: { provider: 'object', object: 'campaign' },
    ...extra,
  } as any;
}

function makeDataSource(objectLabel?: string): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: ITEMS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      label: objectLabel,
      fields: { name: { type: 'text' }, start: { type: 'date' }, end: { type: 'date' } },
    }),
  } as any;
}

/**
 * Renders the gantt and answers the name column's heading once rows are drawn
 * and, for a bound object, once its schema read has settled — so a generic
 * heading is read after the label could have arrived, not before.
 */
async function columnHeading(schema: any, dataSource?: DataSource): Promise<string> {
  const { findAllByText, getByTestId } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <ObjectGantt schema={schema} dataSource={dataSource} />
    </I18nProvider>,
  );
  await findAllByText('Spring launch');
  const read = (dataSource as any)?.getObjectSchema;
  if (read?.mock.calls.length) {
    await read.mock.results[0].value;
    await new Promise((r) => setTimeout(r, 0));
  }
  return getByTestId('gantt-task-column-heading').textContent ?? '';
}

describe('ObjectGantt — name column heading (objectstack#27386 row 2)', () => {
  afterEach(cleanup);

  it('is the bound object label', async () => {
    expect(await columnHeading(ganttSchema(), makeDataSource('Campaign'))).toBe('Campaign');
  });

  it('stays generic when the bound object declares no label', async () => {
    expect(await columnHeading(ganttSchema(), makeDataSource(undefined))).toBe('Task Name');
  });

  it('stays generic on a mixed-object tree', async () => {
    const schema = ganttSchema({}, { objectField: 'object_name' });
    expect(await columnHeading(schema, makeDataSource('Campaign'))).toBe('Task Name');
  });

  it('stays generic on an inline data set', async () => {
    const schema = ganttSchema({ data: { provider: 'value', items: ITEMS } });
    expect(await columnHeading(schema, makeDataSource('Campaign'))).toBe('Task Name');
  });
});
