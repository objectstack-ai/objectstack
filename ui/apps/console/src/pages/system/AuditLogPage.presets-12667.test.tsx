/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The audit log browser offers `sys_audit_log`'s served list views as presets,
 * and links to the object list (objectui#12667).
 *
 * The console's metadata cache (`useMetadata().objects`) is stubbed with a
 * `sys_audit_log` document whose `listViews` the page has never heard of:
 * `night_shift` is a key no code names, so a preset for it can only come from
 * the served document, never from a literal copy of plugin-audit's views.
 *
 * Pinned:
 *  - the presets row is a group named by its visible "Presets" caption
 *    (`aria-labelledby`), never by a literal `aria-label`, which the
 *    aria-label census refuses (objectui#12145);
 *  - every served list view appears as a preset, in served order, by its
 *    served label;
 *  - choosing a preset sends that view's filter, lowered as the object list
 *    lowers it, and choosing it again removes it;
 *  - a preset's filter joins the bar's filters, never replaces them;
 *  - a view whose filter the browser cannot express is offered disabled with a
 *    link to the view in the list, and never sends a filter;
 *  - "Open as list" reaches the `sys_audit_log` list, on the active preset's
 *    view when one is chosen.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';

const { ADAPTER, OBJECTS } = vi.hoisted(() => {
  const AUDIT = {
    name: 'sys_audit_log',
    listViews: {
      night_shift: {
        type: 'grid',
        name: 'night_shift',
        label: 'Night shift',
        data: { provider: 'object', object: 'sys_audit_log' },
        columns: ['created_at'],
        filter: [{ field: 'action', operator: 'in', value: ['login', 'logout'] }],
      },
      everything: {
        type: 'grid',
        name: 'everything',
        label: 'Everything',
        data: { provider: 'object', object: 'sys_audit_log' },
        columns: ['created_at'],
      },
      // A text comparand the filter lowering refuses (objectui#9048).
      broken: {
        type: 'grid',
        name: 'broken',
        label: 'Broken view',
        data: { provider: 'object', object: 'sys_audit_log' },
        columns: ['created_at'],
        filter: [{ field: 'object_name', operator: 'icontains', value: '' }],
      },
      elsewhere: {
        type: 'grid',
        name: 'elsewhere',
        label: 'Elsewhere',
        data: { provider: 'object', object: 'sys_user' },
        columns: ['name'],
      },
    },
  };
  return {
    ADAPTER: {
      find: async () => ({ data: [], total: 0 }),
      findOne: async () => null,
      getObjectSchema: async () => undefined,
    },
    OBJECTS: Object.freeze([{ name: 'account' }, AUDIT]),
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: OBJECTS }),
}));

// Imported after the mocks so the page picks them up.
import { AuditLogPage } from './AuditLogPage';

/** Every `/data/sys_audit_log` request's `$filter`, parsed, or null when absent. */
let filters: unknown[] = [];

beforeEach(() => {
  filters = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = new URL(String(input), 'http://console.test').searchParams.get('$filter');
      filters.push(raw === null ? null : JSON.parse(raw));
      return new Response(JSON.stringify({ object: 'sys_audit_log', records: [], total: 0 }), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** The page at its component route, with a probe where the object list mounts. */
function renderPage() {
  render(
    <MemoryRouter initialEntries={['/apps/setup/component/audit/log']}>
      <Routes>
        <Route path="/apps/:appName/component/audit/log" element={<AuditLogPage />} />
        <Route path="/apps/:appName/sys_audit_log" element={<div>LIST:default</div>} />
        <Route path="/apps/:appName/sys_audit_log/view/:viewId" element={<ListProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function ListProbe() {
  const { viewId } = useParams();
  return <div>LIST:{viewId}</div>;
}

function presetsGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Presets' });
}

function lastFilter(): unknown {
  return filters[filters.length - 1];
}

describe('AuditLogPage — served list views are presets (objectui#12667)', () => {
  it('names the presets row by its visible caption, not a literal aria-label', async () => {
    renderPage();
    await settle();
    const group = screen.getByRole('group', { name: 'Presets' });
    expect(group).not.toHaveAttribute('aria-label');
    const captionId = group.getAttribute('aria-labelledby');
    expect(captionId).toBeTruthy();
    expect(document.getElementById(captionId as string)).toHaveTextContent('Presets');
  });

  it('offers every served list view by its served label, in served order', async () => {
    renderPage();
    await settle();
    const labels = within(presetsGroup()).getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['Night shift', 'Everything', 'Broken view', 'Elsewhere']);
  });

  it("sends the chosen view's own filter, and removes it when chosen again", async () => {
    renderPage();
    await settle();
    expect(lastFilter()).toBeNull();

    fireEvent.click(within(presetsGroup()).getByRole('button', { name: 'Night shift' }));
    await settle();
    expect(within(presetsGroup()).getByRole('button', { name: 'Night shift' })).toHaveAttribute('aria-pressed', 'true');
    // The view's rule, lowered exactly as the object list lowers it.
    expect(lastFilter()).toEqual([['action', 'in', ['login', 'logout']]]);

    fireEvent.click(within(presetsGroup()).getByRole('button', { name: 'Night shift' }));
    await settle();
    expect(lastFilter()).toBeNull();
  });

  it("joins the bar's filters rather than replacing them", async () => {
    renderPage();
    await settle();
    // The object is picked from the served objects (objectui#13165).
    fireEvent.click(screen.getByRole('combobox', { name: 'Object' }));
    fireEvent.click(await screen.findByRole('option', { name: 'account' }));
    await settle();
    fireEvent.click(within(presetsGroup()).getByRole('button', { name: 'Night shift' }));
    await settle();
    expect(lastFilter()).toEqual([
      'and',
      ['object_name', '=', 'account'],
      [['action', 'in', ['login', 'logout']]],
    ]);
  });

  it('a view with no filter sends none', async () => {
    renderPage();
    await settle();
    fireEvent.click(within(presetsGroup()).getByRole('button', { name: 'Everything' }));
    await settle();
    expect(lastFilter()).toBeNull();
  });

  it('a view the browser cannot express is disabled with a link to it, and never sends a filter', async () => {
    renderPage();
    await settle();
    const group = presetsGroup();
    for (const [label, key] of [['Broken view', 'broken'], ['Elsewhere', 'elsewhere']] as const) {
      const button = within(group).getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button.getAttribute('title')).toBeTruthy();
      expect(within(group).getByRole('link', { name: `Open ${label} as list` })).toHaveAttribute(
        'href',
        `/apps/setup/sys_audit_log/view/${key}`,
      );
      const before = filters.length;
      fireEvent.click(button);
      await settle();
      expect(filters.length).toBe(before);
    }
    expect(filters.every((f) => f === null)).toBe(true);
  });
});

describe('AuditLogPage — "Open as list" (objectui#12667)', () => {
  it('reaches the sys_audit_log list', async () => {
    renderPage();
    await settle();
    const link = screen.getByRole('link', { name: 'Open as list' });
    expect(link).toHaveAttribute('href', '/apps/setup/sys_audit_log');
    fireEvent.click(link);
    expect(await screen.findByText('LIST:default')).toBeInTheDocument();
  });

  it("opens the active preset's own view", async () => {
    renderPage();
    await settle();
    fireEvent.click(within(presetsGroup()).getByRole('button', { name: 'Night shift' }));
    await settle();
    const link = screen.getByRole('link', { name: 'Open as list' });
    expect(link).toHaveAttribute('href', '/apps/setup/sys_audit_log/view/night_shift');
    fireEvent.click(link);
    expect(await screen.findByText('LIST:night_shift')).toBeInTheDocument();
  });
});
