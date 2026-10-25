/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7029 — the SECOND route to `ObjectCalendar` invents nothing either.
 *
 * Ruled on objectstack#13748 (director batch #19, option A): ⛔ either way no
 * invented field names. The card measured the console route
 * (`app-shell/ObjectView` → `plugin-list/ListView` → `ObjectCalendar`); this
 * file covers the other one. `generateViewSchema` runs precisely when no host
 * supplied `renderListView` — the authored `object-view` element, which is what
 * `examples/schema-catalog`'s object-view fixtures drive — so it bypasses
 * `ListView` entirely and carried its OWN copy of the fabrication:
 * `startDateField: 'start_date'`, `endDateField: 'end_date'`,
 * `titleField: 'name'` for a view that declared none.
 *
 * Fixing only the console route would have left this one rendering the same
 * plausible, fully wrong screen the card exists to remove, and would have made
 * the fix's own claim ("no invented field names") false in the repo it was
 * merged into.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore the three `||` floors in this branch and the "invents NO binding"
 * case goes RED (it reads the fabricated names) while the declared-config
 * CONTROL stays GREEN in either world.
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
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'crm_leave_request', fields: {} }),
  };
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'crm_leave_request' } as ObjectViewSchema}
      views={[{ id: 'c', label: 'Calendar', type: 'calendar' as any, ...view }]}
      dataSource={ds}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

describe('ObjectView.generateViewSchema — calendar restates only a DECLARED binding (objectui#7029)', () => {
  it('invents NO binding for a calendar view that declares no config', async () => {
    const schema = await renderCalendarView({});
    expect(schema.type).toBe('object-calendar');
    // All three used to be fabricated here. Absent bindings are the only route
    // to `ObjectCalendar`'s refusal screen.
    expect(schema.startDateField).toBeUndefined();
    expect(schema.endDateField).toBeUndefined();
    expect(schema.titleField).toBeUndefined();
  });

  it('CONTROL: forwards a declared calendar block unchanged', async () => {
    // A correctly configured calendar renders exactly as it did before this
    // card — without this case a fix that emitted nothing at all would look
    // identical to the fix that was ruled.
    const schema = await renderCalendarView({
      calendar: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'subject' },
    });
    expect(schema.type).toBe('object-calendar');
    expect(schema.startDateField).toBe('start_date');
    expect(schema.endDateField).toBe('end_date');
    expect(schema.titleField).toBe('subject');
  });

  it('CONTROL: a partially declared block keeps its declared half and only that', async () => {
    const schema = await renderCalendarView({ calendar: { startDateField: 'start_date' } });
    expect(schema.startDateField).toBe('start_date');
    expect(schema.endDateField).toBeUndefined();
    expect(schema.titleField).toBeUndefined();
  });
});
