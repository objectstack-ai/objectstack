/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36270 — an AUTHORED `object-grid` node (a page's SDUI node, or
 * `<ObjectGrid>` on a `kind: 'react'` page, both drawn by the registered
 * renderer) that edits (`editable: true`) edits as the list page's grid does:
 * a click selects a cell, Enter opens its editor, and the committed cell saves
 * on its own. No pending-changes bar and no "Save All" is drawn. A read-only
 * node keeps click-to-open, and a host that says `cellSelection` itself wins.
 *
 * Rendered through `SchemaRenderer` and the registry, the path an authored
 * node takes, never by importing `ObjectGrid` directly.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionProvider, SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold every key the
// node draws before the first render.
import '@object-ui/components';
import { registerAllFields } from '@object-ui/fields';
import '../index';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';
import { installExplainDouble } from './explainDouble';

registerAllFields();

const OBJECT = 'authored_grid_task';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Alpha' },
    r2: { id: 'r2', name: 'Beta' },
  };
  const update = vi.fn(async (_object: string, id: string, changes: Record<string, any>) => {
    store[id] = { ...store[id], ...changes };
    return { ...store[id] };
  });
  const ds = {
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update,
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    })),
  };
  return { ds, update };
}

function mount(node: Record<string, unknown>, ds: unknown, extra: Record<string, unknown> = {}) {
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds as any}>
        <SchemaRenderer
          schema={{ type: 'object-grid', objectName: OBJECT, columns: [{ field: 'name', label: 'Name' }], ...node } as any}
          {...extra}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

const catcher = () => document.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]');

describe('objectstack#36270 — an authored editable object-grid saves each cell on its own', () => {
  it('the committed cell sends one update for its record, and no Save All is drawn', async () => {
    const { ds, update } = makeDataSource();
    mount({ editable: true }, ds);
    await screen.findByText('Beta');
    fireEvent.click(screen.getByText('Alpha').closest('td') as HTMLElement);
    const typeCatcher = await waitFor(() => {
      const el = catcher();
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.keyDown(typeCatcher, { key: 'Enter' });
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('td[data-editing-cell] input');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(input, { target: { value: 'Alpha one' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toBe(OBJECT);
    expect(update.mock.calls[0][1]).toBe('r1');
    expect(update.mock.calls[0][2]).toEqual({ name: 'Alpha one' });
    await screen.findByText('Alpha one');
    expect(screen.queryByText(/Save All/)).toBeNull();
    expect(screen.queryByText(/Cancel All/)).toBeNull();
  });

  it('CONTROL: a read-only authored grid selects no cell on a click', async () => {
    const { ds } = makeDataSource();
    mount({}, ds);
    await screen.findByText('Beta');
    fireEvent.click(screen.getByText('Alpha').closest('td') as HTMLElement);
    await new Promise((r) => setTimeout(r, 50));
    expect(catcher()).toBeNull();
  });

  it("CONTROL: a host's own `cellSelection` wins over the node's `editable`", async () => {
    const { ds } = makeDataSource();
    mount({ editable: true }, ds, { cellSelection: false });
    await screen.findByText('Beta');
    fireEvent.click(screen.getByText('Alpha').closest('td') as HTMLElement);
    await new Promise((r) => setTimeout(r, 50));
    expect(catcher()).toBeNull();
  });
});
