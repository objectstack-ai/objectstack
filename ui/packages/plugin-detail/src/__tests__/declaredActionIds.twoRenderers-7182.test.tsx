/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The two renderers that draw an authored action array — `page:header`
 * (`@object-ui/components`) and `record:quick_actions` (this package) — render
 * the SAME buttons for the SAME authored array, and refuse the SAME mixed
 * array (objectui#7182, maintainer ruling 2026-09-02, option C).
 *
 * This is the ruling's fourth pin, and the one neither package can carry on
 * its own: it needs both renderers registered in one process. It lives here
 * because this package already depends on `@object-ui/components`.
 *
 * Method (PR objectui#7180's): every authoring is rendered twice, as ids and
 * as inline objects, and the object-shape render is the LIVE CONTROL — each
 * control is asserted non-empty before anything is compared to it, so a green
 * can never come from two empty surfaces agreeing.
 *
 * The population is the intersection the two filter chains treat identically
 * — `locations` (`list_only` renders on neither) and `requiredPermissions`
 * (`gated` is denied on both) — with no `order` and no `record_more`: the
 * header sorts by `order` and routes `record_more` into its overflow menu,
 * neither of which the bar does, and those are pre-existing differences of
 * the two surfaces' chains, not of the array's meaning. The cross-surface
 * control (object render vs object render) is what proves the population is
 * inside that intersection.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, MetadataCtx, RecordContextProvider } from '@object-ui/react';
import type { MetadataContextValue } from '@object-ui/react';
// `page:header` is registered by the dom setup's `@object-ui/components`
// import; `record:quick_actions` by this package's own entry.
import '../index';

/**
 * Desktop, pinned rather than inherited (objectui#8399). Both surfaces draw
 * through `action-bar`, which reads `useIsMobile` (breakpoint 768) and below it
 * collapses all but `mobileMaxVisible ?? 1` buttons into a `More actions`
 * overflow.
 *
 * The cross-surface comparison this file is built on holds only while both
 * toolbars are flat: measured on the mobile branch, the header control reads
 * ['Convert Lead', 'More actions'] and the equality precondition in the first
 * case fails.
 *
 * happy-dom's ambient `innerWidth` is 1024, so the desktop branch was inherited
 * here rather than chosen.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const ACTIONS: Record<string, any> = {
  convert: { name: 'convert', label: 'Convert Lead', type: 'flow', locations: ['record_header'] },
  qualify: { name: 'qualify', label: 'Qualify', type: 'api', locations: ['record_header'] },
  list_only: { name: 'list_only', label: 'List Only', type: 'api', locations: ['list_item'] },
  gated: {
    name: 'gated',
    label: 'Gated Action',
    type: 'api',
    locations: ['record_header'],
    requiredPermissions: ['nobody_holds_this'],
  },
};
const AUTHORED = ['convert', 'qualify', 'list_only', 'gated'];
const OBJECT_META = { name: 'lead', label: 'Lead', actions: AUTHORED.map((n) => ACTIONS[n]) };
const RECORD = { id: 'rec-1', name: 'Ada', status: 'open' };
const USER = { id: 'u1', systemPermissions: ['setup.access'] };

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === 'lead' ? OBJECT_META : null,
);

/** Module-level on purpose — `getItem` is an effect dependency of `useMetadataItem`. */
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_META] as any,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

function Registered({ type, schema }: { type: string; schema: any }) {
  const Component = ComponentRegistry.get(type);
  if (!Component) throw new Error(`${type} not registered`);
  // eslint-disable-next-line react-hooks/static-components -- registry component is stable
  return <Component schema={schema} />;
}

function mount(type: 'page:header' | 'record:quick_actions', actions: unknown[]) {
  const schema =
    type === 'page:header'
      ? { type, title: 'Lead', actions }
      : { type, location: 'record_header', actions };
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <ActionProvider context={{ user: USER } as any}>
        <RecordContextProvider
          objectName="lead"
          recordId={RECORD.id}
          data={RECORD}
          objectSchema={{ name: 'lead', label: 'Lead' }}
        >
          <Registered type={type} schema={schema} />
        </RecordContextProvider>
      </ActionProvider>
    </MetadataCtx.Provider>,
  );
}

/**
 * Ordered accessible names of the buttons in the surface's action row
 * (`role="toolbar"` on both renderers). The header's record chrome draws
 * buttons of its own outside the toolbar; those are not what this is about.
 */
const buttonNames = (c: HTMLElement): string[] => {
  const toolbar = c.querySelector('[role="toolbar"]');
  if (!toolbar) return [];
  return Array.from(toolbar.querySelectorAll('button')).map(
    (b) => (b.getAttribute('aria-label') || b.textContent || '').trim(),
  );
};

const OBJECTS = AUTHORED.map((n) => ACTIONS[n]);
const IDS = [...AUTHORED];

describe('page:header and record:quick_actions — one authored array, one meaning (objectui#7182)', () => {
  let error: ReturnType<typeof vi.spyOn>;
  const errorMessages = (): string[] =>
    (error.mock.calls as unknown[][]).map((c) => String(c[0]));

  beforeEach(() => {
    getItem.mockClear();
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
  });

  it('draws the same buttons on both surfaces for the same id-authored array (object renders as live controls)', async () => {
    // Controls first, one per surface.
    const headerControl = mount('page:header', OBJECTS);
    const headerControlNames = buttonNames(headerControl.container);
    expect(headerControlNames).toContain('Convert Lead');
    expect(headerControlNames.length).toBeGreaterThan(1);
    headerControl.unmount();

    const barControl = mount('record:quick_actions', OBJECTS);
    const barControlNames = buttonNames(barControl.container);
    expect(barControlNames).toContain('Convert Lead');
    expect(barControlNames.length).toBeGreaterThan(1);
    barControl.unmount();

    // The two chains agree on this population — the precondition that makes
    // the id-side comparison below a statement about the ARRAY.
    expect(headerControlNames).toEqual(barControlNames);
    expect(getItem).not.toHaveBeenCalled();

    const headerIds = mount('page:header', IDS);
    await screen.findByRole('button', { name: /Convert Lead/i });
    const headerIdNames = buttonNames(headerIds.container);
    headerIds.unmount();

    const barIds = mount('record:quick_actions', IDS);
    await screen.findByRole('button', { name: /Convert Lead/i });
    const barIdNames = buttonNames(barIds.container);
    barIds.unmount();

    expect(headerIdNames).toEqual(headerControlNames);
    expect(barIdNames).toEqual(barControlNames);
    expect(headerIdNames).toEqual(barIdNames);
  });

  it('refuses the same mixed array on both surfaces — neither draws a button, both name index 1', async () => {
    const mixed = ['convert', ACTIONS.qualify];

    const header = mount('page:header', mixed);
    await screen.findByRole('heading', { level: 1 });
    expect(buttonNames(header.container)).toEqual([]);
    header.unmount();

    const bar = mount('record:quick_actions', mixed);
    // Both mounts are runtime views, so the bar draws nothing: its dashed
    // "refused at index N" box is preview-only developer copy (objectui#13000),
    // and the index is named in the console below, as the header names it.
    expect(screen.queryByText(/refused at index/i)).toBeNull();
    expect(bar.container.textContent).toBe('');
    expect(buttonNames(bar.container)).toEqual([]);
    bar.unmount();

    // Neither surface consulted the metadata layer for a refused array.
    expect(getItem).not.toHaveBeenCalled();

    const headerHits = errorMessages().filter((m) => m.startsWith('[page:header] actions refused at index 1'));
    const barHits = errorMessages().filter((m) => m.startsWith('[record:quick_actions] actions refused at index 1'));
    expect(headerHits.length).toBe(1);
    expect(barHits.length).toBe(1);
    // The same rule, in the same words, from the one function both call.
    const rule = 'element 1 is an inline action object but element 0 is an action id; an actions array is either all action ids or all inline action objects — mixed id/object action arrays are refused; use all ids or all objects';
    expect(headerHits[0]).toContain(rule);
    expect(barHits[0]).toContain(rule);
  });
});
