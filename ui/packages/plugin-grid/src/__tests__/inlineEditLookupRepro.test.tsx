/**
 * Repro: inline-edit a LOOKUP cell, pick a value, then click ANOTHER row.
 * Reported bug: the just-picked value is lost when moving to another row.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
  if (!(Element.prototype as any).releasePointerCapture) {
    (Element.prototype as any).releasePointerCapture = () => {};
  }
});

const OBJECT = 'os_prod_report';

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: '塔筒 T1' },
    r2: { id: 'r2', name: '塔筒 T2' },
  };
  const users: Record<string, any> = {
    u1: { id: 'u1', name: 'Dev Admin' },
    u2: { id: 'u2', name: '班组长-测' },
  };
  const find = vi.fn(async (object: string) => {
    if (object === 'users') {
      const data = Object.values(users).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }
    const data = Object.values(store).map((r) => ({ ...r }));
    return { data, total: data.length, hasMore: false, pageSize: 50 };
  });
  const findOne = vi.fn(async (object: string, id: string) => {
    if (object === 'users') return users[id] ? { ...users[id] } : null;
    return store[id] ? { ...store[id] } : null;
  });
  const update = vi.fn(async (_o: string, id: string, changes: Record<string, any>) => {
    store[id] = { ...store[id], ...changes };
    return { ...store[id] };
  });
  return {
    store,
    find,
    findOne,
    update,
    getObjectSchema: async (name: string) => {
      if (name === 'users') {
        return { name, fields: { id: { type: 'text' }, name: { type: 'text' } } };
      }
      return {
        name,
        fields: {
          id: { type: 'text' },
          name: { type: 'text' },
          manager: { type: 'lookup', label: '管理责任人', reference: 'users' },
        },
      };
    },
  } as any;
}

function renderGrid(dataSource: any) {
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'name', label: '作业对象', editable: false },
      { field: 'manager', label: '管理责任人', type: 'lookup' },
    ],
    pagination: { pageSize: 50 },
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid schema={schema} dataSource={dataSource} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

describe('ObjectGrid — lookup inline edit survives clicking another row', () => {
  it('keeps the picked lookup value after clicking another row', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('塔筒 T1')).toBeInTheDocument());

    const rows = () => Array.from(container.querySelectorAll('tbody tr')) as HTMLElement[];
    const managerCellOf = (row: HTMLElement) => {
      const tds = Array.from(row.querySelectorAll('td'));
      // columns: [rownum] name, manager  -> manager is the last data col
      return tds[tds.length - 1] as HTMLElement;
    };

    // Enter edit mode on row1's manager cell.
    fireEvent.click(managerCellOf(rows()[0]));

    // The lookup trigger button should appear inside the cell; open the popover.
    const trigger = await waitFor(() => {
      const btn = managerCellOf(rows()[0]).querySelector('button');
      expect(btn).toBeTruthy();
      return btn as HTMLButtonElement;
    });
    fireEvent.click(trigger);

    // Pick "Dev Admin" from the popover options (fetched from `users`).
    const option = await waitFor(() => {
      const el = screen.getByText('Dev Admin');
      expect(el).toBeInTheDocument();
      return el;
    });
    fireEvent.click(option);

    // The staged value shows in row1's manager cell.
    await waitFor(() => {
      expect(within(managerCellOf(rows()[0])).getByText('Dev Admin')).toBeInTheDocument();
    });

    // Now click ANOTHER row's manager cell.
    fireEvent.click(managerCellOf(rows()[1]));

    // BUG: row1's picked value must still be present.
    await waitFor(() => {
      expect(within(managerCellOf(rows()[0])).queryByText('Dev Admin')).toBeInTheDocument();
    });
  });
});
