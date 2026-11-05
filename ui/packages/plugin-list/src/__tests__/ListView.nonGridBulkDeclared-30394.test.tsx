/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30394 — the NON-grid selection bar (kanban / calendar / gallery
 * / …), which ListView draws itself, follows the grid's rule (objectstack#30169,
 * ruling C): a bare `bulkActions` name draws a button only when the object
 * declares an action of that name, labelled from that declaration; the
 * built-in `delete` keeps its own path; any other name draws nothing and, in
 * development, is named once in a console warning, the grid's own warning.
 *
 * The grid's half is pinned in plugin-grid's `objectBulkActionDispatch.test.tsx`;
 * this file pins the same rule on the bar ListView renders for every other view.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const ROWS = [{ id: 'l1', name: 'Lead One' }, { id: 'l2', name: 'Lead Two' }];

function makeDataSource(objectName: string, opts: { actions?: unknown[]; noSchema?: boolean } = {}) {
  const ds: Record<string, unknown> = {
    find: vi.fn().mockResolvedValue(ROWS.map(r => ({ ...r }))),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  if (!opts.noSchema) {
    ds.getObjectSchema = vi.fn().mockResolvedValue({
      name: objectName,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
      ...(opts.actions ? { actions: opts.actions } : {}),
    });
  }
  return ds;
}

/**
 * Stand in for the gallery renderer and select every row as soon as it mounts:
 * the bar only renders with a non-empty selection (the device
 * `ListView.bulkDeleteVisibleWhen.test.tsx` uses).
 */
function registerSelectingGallery() {
  ComponentRegistry.register('object-gallery', (props: any) => {
    const onRowSelect = props.onRowSelect;
    React.useEffect(() => {
      onRowSelect?.(ROWS);
    }, [onRowSelect]);
    return <div data-testid="gallery-stub" />;
  });
}

function renderGallery(objectName: string, bulkActions: string[], ds: Record<string, unknown>) {
  const onBulkAction = vi.fn();
  const schema: ListViewSchema = {
    type: 'list-view',
    objectName,
    viewType: 'gallery',
    fields: ['name'],
    bulkActions,
  };
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ListView schema={schema} dataSource={ds as any} onBulkAction={onBulkAction} />
    </SchemaRendererProvider>,
  );
  return { onBulkAction };
}

/** The ListView warnings logged so far (the grid's own say `ObjectGrid`). */
function listViewWarnings(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((m: string) => m.startsWith('[ObjectUI] ListView bulkActions:'));
}

describe('ListView non-grid bulk bar draws only actions the object declares (objectstack#30394)', () => {
  let prevGallery: ReturnType<typeof ComponentRegistry.get>;
  let warn: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeEach(() => {
    prevGallery = ComponentRegistry.get('object-gallery');
    registerSelectingGallery();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    warn.mockRestore();
    if (prevGallery) ComponentRegistry.register('object-gallery', prevGallery);
    else ComponentRegistry.unregister('object-gallery');
  });

  it('draws the declared name with its declared label, keeps delete, and drops the undeclared name', async () => {
    const ds = makeDataSource('lead_a', { actions: [{ name: 'qualify_lead', label: 'Qualify' }] });
    const { onBulkAction } = renderGallery('lead_a', ['qualify_lead', 'create_campaign', 'delete'], ds);

    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    const qualify = await screen.findByTestId('bulk-action-qualify_lead');
    // The declaration's label, not the title-cased name (`Qualify Lead`).
    expect(qualify).toHaveTextContent('Qualify');
    expect(qualify).not.toHaveTextContent('Qualify Lead');
    expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-create_campaign')).toBeNull();

    // Authored order, delete where the author put it.
    const order = Array.from(screen.getByTestId('bulk-actions-bar').querySelectorAll('[data-testid^="bulk-action-"]'))
      .map(el => el.getAttribute('data-testid'));
    expect(order).toEqual(['bulk-action-qualify_lead', 'bulk-action-delete']);

    // The declared name still dispatches through the host by its name.
    fireEvent.click(qualify);
    expect(onBulkAction).toHaveBeenCalledWith('qualify_lead', ROWS);

    await waitFor(() => expect(listViewWarnings(warn)).toHaveLength(1));
    const [message] = listViewWarnings(warn);
    expect(message).toContain("gallery (objectName: 'lead_a')");
    expect(message).toContain("1 name matches no action the object declares");
    expect(message).toContain("'create_campaign'");
    expect(message).not.toContain('qualify_lead');
  });

  it('draws no bar at all when no name is declared and there is no delete', async () => {
    const ds = makeDataSource('lead_b', { actions: [{ name: 'qualify_lead', label: 'Qualify' }] });
    renderGallery('lead_b', ['create_campaign', 'send_blast'], ds);

    await screen.findByTestId('gallery-stub');
    await waitFor(() => expect(listViewWarnings(warn)).toHaveLength(1));
    expect(screen.queryByTestId('bulk-actions-bar')).toBeNull();
    expect(listViewWarnings(warn)[0]).toContain("2 names match no action the object declares");
  });

  it('says the actions are unknown, not undeclared, when the data source cannot read the schema', async () => {
    const ds = makeDataSource('lead_c', { noSchema: true });
    renderGallery('lead_c', ['qualify_lead', 'delete'], ds);

    await waitFor(() => expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-action-qualify_lead')).toBeNull();
    expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument();
    await waitFor(() => expect(listViewWarnings(warn)).toHaveLength(1));
    expect(listViewWarnings(warn)[0]).toContain("gallery (objectName: 'lead_c') — the object's schema could not be read");
  });

  it('says nothing while every name is declared', async () => {
    const ds = makeDataSource('lead_d', { actions: [{ name: 'qualify_lead', label: 'Qualify' }] });
    renderGallery('lead_d', ['qualify_lead'], ds);

    await screen.findByTestId('bulk-action-qualify_lead');
    expect(listViewWarnings(warn)).toEqual([]);
  });
});
