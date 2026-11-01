/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28102 — `ObjectView`'s `generateViewSchema` hands a view's
 * `calendar.initialDate` on inside the node's `calendar` block, the one place
 * `ObjectCalendar` reads the date it opens on from. The branch forwards the
 * block's keys by name, so a key it does not name never reaches the renderer.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

async function renderCalendarView(view: Record<string, unknown>) {
  rendered.length = 0;
  const ds: any = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'renewal', fields: {} }),
  };
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'renewal' } as ObjectViewSchema}
      views={[{ id: 'c', label: 'Calendar', type: 'calendar' as any, ...view }]}
      dataSource={ds}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

describe('ObjectView.generateViewSchema — calendar.initialDate reaches the node (objectstack#28102)', () => {
  it.each(['next_record', 'first_record', '{next_month_start}'])('forwards `initialDate: %s` inside the calendar block', async (initialDate) => {
    const schema = await renderCalendarView({ calendar: { startDateField: 'renewal_date', initialDate } });
    expect(schema.type).toBe('object-calendar');
    expect(schema.calendar).toEqual({ startDateField: 'renewal_date', initialDate });
    expect(schema).not.toHaveProperty('initialDate');
  });

  it('CONTROL: a block without the key carries none', async () => {
    const schema = await renderCalendarView({ calendar: { startDateField: 'renewal_date' } });
    expect(schema.calendar).toEqual({ startDateField: 'renewal_date' });
  });
});
