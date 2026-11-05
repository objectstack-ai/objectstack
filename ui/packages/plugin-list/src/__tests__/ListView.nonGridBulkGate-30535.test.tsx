/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30535 — the NON-grid selection bar (kanban / calendar / gallery
 * / …) applies the grid bar's own gate to a declared bulk action, through the
 * grid's own `useBulkActionItems`:
 *
 *  - an action whose `requiredPermissions` the caller does not hold is not
 *    drawn (ADR-0066 D4; unknown capabilities fail open, as on the grid);
 *  - `visible` is evaluated once per selected record, and the action is drawn
 *    when at least one selected record passes;
 *  - a name repeated in `bulkActions` draws one button.
 *
 * The grid's half is pinned in plugin-grid's `bulkActionCapabilityGate.test.tsx`
 * and `bulk-action-visible.test.tsx`; this file pins the same gate on the bar
 * ListView renders for every other view.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

type Row = { id: string; name: string; status: string };

function makeDataSource(objectName: string, rows: Row[], actions: unknown[]) {
  return {
    find: vi.fn().mockResolvedValue(rows.map(r => ({ ...r }))),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: objectName,
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'text' } },
      actions,
    }),
  };
}

/** A gallery stand-in that selects `rows` as soon as it mounts. */
function registerSelectingGallery(rows: Row[]) {
  ComponentRegistry.register('object-gallery', (props: any) => {
    const onRowSelect = props.onRowSelect;
    React.useEffect(() => {
      onRowSelect?.(rows);
    }, [onRowSelect]);
    return <div data-testid="gallery-stub" />;
  });
}

function renderGallery(
  objectName: string,
  bulkActions: string[],
  ds: ReturnType<typeof makeDataSource>,
  user?: unknown,
) {
  const schema: ListViewSchema = {
    type: 'list-view',
    objectName,
    viewType: 'gallery',
    fields: ['name'],
    bulkActions,
  };
  const tree = (
    <SchemaRendererProvider dataSource={ds as any}>
      <ListView schema={schema} dataSource={ds as any} onBulkAction={vi.fn()} />
    </SchemaRendererProvider>
  );
  return render(user === undefined ? tree : <ActionProvider context={{ user } as any}>{tree}</ActionProvider>);
}

const OPEN: Row = { id: 'l1', name: 'Lead One', status: 'open' };
const CLOSED: Row = { id: 'l2', name: 'Lead Two', status: 'closed' };

const ACTIONS = [
  { name: 'tag_lead', label: 'Tag' },
  { name: 'push_down', label: 'Push Down', requiredPermissions: ['plan.push'] },
  { name: 'reopen', label: 'Reopen', visible: "record.status == 'closed'" },
];

describe('ListView non-grid bulk bar applies the grid bar gate (objectstack#30535)', () => {
  let prevGallery: ReturnType<typeof ComponentRegistry.get>;

  beforeEach(() => {
    prevGallery = ComponentRegistry.get('object-gallery');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (prevGallery) ComponentRegistry.register('object-gallery', prevGallery);
    else ComponentRegistry.unregister('object-gallery');
  });

  it('does not draw an action whose requiredPermissions the caller lacks', async () => {
    registerSelectingGallery([OPEN]);
    const ds = makeDataSource('lead_g1', [OPEN], ACTIONS);
    renderGallery('lead_g1', ['tag_lead', 'push_down'], ds, { id: 'u1', systemPermissions: ['setup.access'] });

    await screen.findByTestId('bulk-action-tag_lead');
    expect(screen.queryByTestId('bulk-action-push_down')).toBeNull();
  });

  it('draws it when the caller holds every declared capability', async () => {
    registerSelectingGallery([OPEN]);
    const ds = makeDataSource('lead_g2', [OPEN], ACTIONS);
    renderGallery('lead_g2', ['tag_lead', 'push_down'], ds, { id: 'u1', systemPermissions: ['plan.push'] });

    expect(await screen.findByTestId('bulk-action-push_down')).toHaveTextContent('Push Down');
  });

  it('draws it when the caller capabilities are unknown (fail open, as the grid)', async () => {
    registerSelectingGallery([OPEN]);
    const ds = makeDataSource('lead_g3', [OPEN], ACTIONS);
    renderGallery('lead_g3', ['push_down'], ds);

    expect(await screen.findByTestId('bulk-action-push_down')).toBeInTheDocument();
  });

  it('evaluates visible per selected record: no passing record, no button', async () => {
    registerSelectingGallery([OPEN]);
    const ds = makeDataSource('lead_v1', [OPEN], ACTIONS);
    renderGallery('lead_v1', ['tag_lead', 'reopen'], ds);

    await screen.findByTestId('bulk-action-tag_lead');
    expect(screen.queryByTestId('bulk-action-reopen')).toBeNull();
  });

  it('evaluates visible per selected record: one passing record draws the button', async () => {
    registerSelectingGallery([OPEN, CLOSED]);
    const ds = makeDataSource('lead_v2', [OPEN, CLOSED], ACTIONS);
    renderGallery('lead_v2', ['tag_lead', 'reopen'], ds);

    expect(await screen.findByTestId('bulk-action-reopen')).toHaveTextContent('Reopen');
  });

  it('draws a repeated name once, with no duplicate React key', async () => {
    registerSelectingGallery([OPEN]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeDataSource('lead_d1', [OPEN], ACTIONS);
    renderGallery('lead_d1', ['tag_lead', 'tag_lead', 'delete', 'delete'], ds);

    await screen.findByTestId('bulk-action-tag_lead');
    await waitFor(() => expect(screen.getAllByTestId('bulk-action-tag_lead')).toHaveLength(1));
    expect(screen.getAllByTestId('bulk-action-delete')).toHaveLength(1);
    const keyErrors = error.mock.calls.filter(c => String(c[0]).includes('same key'));
    expect(keyErrors).toEqual([]);
  });
});
