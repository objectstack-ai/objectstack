/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid during collection, not inside a case's clock: Studio's dashboard panels
// reach both through dynamic imports (check:test-source-alias).
import '@objectstack/lint';
import '@objectstack/formula';
import {
  filtersSectionLabel,
  openDashboardForEdit,
  withAddedWidget,
  withResizedWidget,
} from './DashboardInPageEditor';
import type { DashboardSaveTargetDoors } from './runtime-metadata-persistence';

/**
 * objectstack#36372 — opening a dashboard for in-page editing, and the two
 * buffer edits the page makes itself (add a card, resize a card). The rest of
 * the buffer's edits are Studio's panels' own `onPatch`.
 */

const doors = (writable: boolean): DashboardSaveTargetDoors => ({
  listPackages: async () => new Map([['crm', { writable, manifest: { id: 'crm', version: '3.0.0' } } as any]]),
  ensureCustomization: async (base) => ({ packageId: `${base}.custom`, writable: true }),
});

const stored = { name: 'exec', label: 'Exec', widgets: [{ id: 'a', type: 'bar' }] };

describe('openDashboardForEdit', () => {
  it('opens the layered effective document of the owning package', async () => {
    const client = {
      getDraft: vi.fn(async () => null),
      layered: vi.fn(async () => ({ code: { name: 'exec' }, effective: stored })),
    };
    await expect(openDashboardForEdit('exec', 'crm', client, doors(true))).resolves.toEqual({
      kind: 'ready',
      target: { kind: 'package', packageId: 'crm' },
      doc: stored,
    });
    expect(client.getDraft).toHaveBeenCalledWith('dashboard', 'exec', { packageId: 'crm' });
  });

  it('into a customization pair that does not hold it yet, opens its base\'s document', async () => {
    const client = {
      getDraft: vi.fn(async () => null),
      layered: vi.fn(async (_t: string, _n: string, o?: { packageId?: string }) =>
        o?.packageId === 'crm' ? { code: stored, effective: stored } : { code: null, effective: null },
      ),
    };
    const opened = await openDashboardForEdit('exec', 'crm', client, doors(false));
    expect(opened).toMatchObject({ kind: 'ready', target: { kind: 'customization', packageId: 'crm.custom', base: 'crm' }, doc: stored });
    expect(client.getDraft).toHaveBeenCalledWith('dashboard', 'exec', { packageId: 'crm.custom' });
  });

  it('is refused over a pending draft, without reading the document', async () => {
    const client = {
      getDraft: vi.fn(async () => ({ item: { name: 'exec' } })),
      layered: vi.fn(),
    };
    await expect(openDashboardForEdit('exec', 'crm', client, doors(true))).resolves.toEqual({ kind: 'refused', reason: 'pending-draft' });
    expect(client.layered).not.toHaveBeenCalled();
  });

  it('is refused when there is no package to save into, and when the read fails', async () => {
    const client = { getDraft: vi.fn(async () => null), layered: vi.fn(async () => ({ code: null, effective: null })) };
    await expect(openDashboardForEdit('exec', 'gone', client, doors(true))).resolves.toMatchObject({ kind: 'refused', reason: 'no-package' });
    await expect(openDashboardForEdit('exec', 'crm', client, doors(true))).resolves.toMatchObject({ kind: 'refused', reason: 'load-failed' });
    const failing = { getDraft: vi.fn(async () => { throw new Error('500'); }), layered: vi.fn() };
    await expect(openDashboardForEdit('exec', 'crm', failing, doors(true))).resolves.toEqual({
      kind: 'refused',
      reason: 'load-failed',
      detail: '500',
    });
  });
});

describe('the page\'s own buffer edits', () => {
  it('adds a card at the end with a fresh id', () => {
    const added = withAddedWidget({ ...stored, widgets: [{ id: 'widget_1', type: 'bar' }] }, 'pie');
    expect(added.id).toBe('widget_2');
    const widgets = added.doc.widgets as Array<{ id: string; type: string }>;
    expect(widgets.map((w) => w.id)).toEqual(['widget_1', 'widget_2']);
    expect(widgets[1].type).toBe('pie');
  });

  it('resizes a card, keeping the coordinates the span does not name', () => {
    const doc = { widgets: [{ id: 'a', type: 'bar', layout: { x: 6, y: 2, w: 3, h: 4 } }, { id: 'b', type: 'bar' }] };
    expect((withResizedWidget(doc, 'a', { w: 4, h: 2 }).widgets as any[])[0].layout).toEqual({ x: 6, y: 2, w: 4, h: 2 });
    // A card with no layout gets the grid's auto placement for its index.
    expect((withResizedWidget(doc, 'b', { w: 2, h: 1 }).widgets as any[])[1].layout).toEqual({ x: 3, y: 0, w: 2, h: 1 });
    // An unknown id changes nothing.
    expect(withResizedWidget(doc, 'zz', { w: 2, h: 1 })).toBe(doc);
  });

  it('finds the panel section that edits the page filters', () => {
    expect(filtersSectionLabel('en-US')).toBe('Filters');
  });
});
