// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26740 — the Interfaces nav-item inspector authors the keys the
 * spec's nav members declare beyond the target: an `object` entry's landing
 * (`viewName`, `recordId` / `recordMode`, `filters`), and the shared base's
 * `badge` / `badgeVariant`, `order` and `visible`.
 *
 * What is pinned, each against the INSTALLED spec (`NavigationItemSchema`) and,
 * where the key changes what the menu shows, against the running menu
 * (`NavigationRenderer`, the sidebar the console mounts):
 *
 *  1. each key can be authored, is written as the spec spells it, and the
 *     entry the editor holds parses;
 *  2. a key the member does not declare is not offered (a `page` has no
 *     landing, a `separator` only its `order`);
 *  3. a change of landing removes the keys the spec refuses beside it;
 *  4. `visible` round-trips — a bare string stays a string, an envelope keeps
 *     its envelope — and a condition whose lint finds an error is never
 *     written: the entry keeps its previous one and the field says so;
 *  5. `order` moves an entry in the running menu.
 *
 * The CEL engine is stubbed so the lint verdict is deterministic, the method
 * `PageBlockInspector.celGate.test.tsx` uses; the live lint is
 * `CelPredicateField.test.tsx`'s job.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

const PKG = 'com.acme.app';

// A server double: the package's views (one of another object, which the view
// picker must not offer), and the task object whose fields the filters editor
// offers.
const mockClient = vi.hoisted(() => {
  const client: Record<string, unknown> = {
    list: vi.fn(async (type: string) =>
      type === 'view'
        ? [
            { name: 'acme_task.open_tasks', label: 'Open tasks' },
            { name: 'acme_note.all_notes', label: 'All notes' },
          ]
        : [],
    ),
    listDrafts: vi.fn(async () => []),
    get: vi.fn(async (type: string, name: string) =>
      type === 'object' && name === 'acme_task'
        ? { name: 'acme_task', label: 'Task', fields: { status: { name: 'status', label: 'Status', type: 'text' } } }
        : null,
    ),
  };
  client.withPreviewDrafts = () => client;
  return client;
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

import { StudioNavItemInspector } from './StudioDesignSurface';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

/** A condition that ends after an operator does not parse; everything else does. */
const DANGLING = /(&&|\|\||[=<>!]=?|[-+*/])\s*$/;

beforeEach(() => {
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: (_role: string, input: unknown) => {
        const src = typeof input === 'string' ? input : String((input as { source?: string })?.source ?? '');
        return DANGLING.test(src)
          ? { ok: false, errors: [{ message: 'Parse error: expression ends after an operator' }], warnings: [] }
          : { ok: true, errors: [], warnings: [] };
      },
      introspectScope: () => ({ fields: [], roots: ['current_user'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
});

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

/** The inspector over a navigation it edits in place, as the pillar does. */
const held = { draft: {} as Record<string, unknown> };
function InspectorHost({ navigation, at = 0 }: { navigation: Array<Record<string, unknown>>; at?: number }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(() => ({ navigation }));
  held.draft = draft;
  return (
    <StudioNavItemInspector
      navId={`navigation[${at}]`}
      appDraft={draft}
      objects={[{ name: 'acme_task', label: 'Task' }]}
      packageId={PKG}
      onNavPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onClear={() => undefined}
    />
  );
}

/** The navigation as a save would send it (JSON erases `undefined`). */
const navNow = () => JSON.parse(JSON.stringify(held.draft.navigation)) as Array<Record<string, unknown>>;
const entryNow = (at = 0) => navNow()[at];

/** The spec's verdict on an entry: its issues, `[]` when it parses. */
function issuesOf(entry: Record<string, unknown>): unknown[] {
  const r = NavigationItemSchema.safeParse(entry);
  return r.success ? [] : r.error.issues;
}

/** Pick `option` in the picker (the shared `Select`) named `name`. */
async function pick(name: string, option: string | RegExp): Promise<void> {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(await within(listbox).findByRole('option', { name: option }, { timeout: 8000 }));
}

/** The running menu over `navigation`, as the console's sidebar draws it. */
function renderMenu(navigation: Array<Record<string, unknown>>) {
  return render(
    <MemoryRouter>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={navigation as unknown as NavigationItem[]} basePath="/apps/acme" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const TASKS = { id: 'nav_tasks', type: 'object', label: 'Tasks', objectName: 'acme_task' };

describe('objectstack#26740 — each declared key is authored, spelled as the spec spells it, and the entry parses', () => {
  it('object › named view: picked from the package\'s views of THIS object', async () => {
    render(<InspectorHost navigation={[TASKS]} />);
    await pick('Landing', 'Named view');
    // A landing chosen holds no key until its value is picked.
    expect(entryNow()).toEqual(TASKS);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'View' }), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    await within(listbox).findByRole('option', { name: 'Open tasks (acme_task.open_tasks)' }, { timeout: 8000 });
    expect(within(listbox).queryByRole('option', { name: /acme_note/ })).toBeNull();
    fireEvent.click(within(listbox).getByRole('option', { name: 'Open tasks (acme_task.open_tasks)' }));

    expect(entryNow()).toEqual({ ...TASKS, viewName: 'acme_task.open_tasks' });
    expect(issuesOf(entryNow())).toEqual([]);
    expect(mockClient.list).toHaveBeenCalledWith('view', { packageId: PKG });
    cleanup();
    renderMenu(navNow());
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/apps/acme/acme_task/view/acme_task.open_tasks');
  });

  it('object › record: `recordId` typed, `recordMode` picked', async () => {
    render(<InspectorHost navigation={[TASKS]} />);
    await pick('Landing', 'Record deep-link');
    fireEvent.change(screen.getByRole('textbox', { name: 'Record ID' }), { target: { value: '{current_user_id}' } });
    await pick('Open mode', 'Edit');
    expect(entryNow()).toEqual({ ...TASKS, recordId: '{current_user_id}', recordMode: 'edit' });
    expect(issuesOf(entryNow())).toEqual([]);
  });

  it('object › filtered slice: `filters` as a record of field to value', async () => {
    render(<InspectorHost navigation={[TASKS]} />);
    await pick('Landing', 'Filtered slice (/data)');
    expect(entryNow()).toEqual({ ...TASKS, filters: {} });
    fireEvent.click(screen.getByTestId('nav-filter-add'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Field' }));
    fireEvent.click(await screen.findByRole('option', { name: /Status/ }, { timeout: 8000 }));
    fireEvent.change(screen.getByTestId('nav-filter-value-status'), { target: { value: 'open' } });

    expect(entryNow()).toEqual({ ...TASKS, filters: { status: 'open' } });
    expect(issuesOf(entryNow())).toEqual([]);
    cleanup();
    renderMenu(navNow());
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('href')).toMatch(/^\/apps\/acme\/acme_task\/data\?filter/);
  });

  it('`badge` and `badgeVariant`: the text, and the variant by its spec value', async () => {
    render(<InspectorHost navigation={[TASKS]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Badge' }), { target: { value: 'New' } });
    await pick('Badge style', 'Alert');
    expect(entryNow()).toEqual({ ...TASKS, badge: 'New', badgeVariant: 'destructive' });
    expect(issuesOf(entryNow())).toEqual([]);
    cleanup();
    renderMenu(navNow());
    expect(within(screen.getByRole('link', { name: /Tasks/ })).getByText('New')).toBeInTheDocument();
  });

  it('`order`: written as a number; an emptied field removes the key', () => {
    render(<InspectorHost navigation={[TASKS]} />);
    const order = screen.getByRole('spinbutton', { name: 'Order' });
    fireEvent.change(order, { target: { value: '2' } });
    expect(entryNow()).toEqual({ ...TASKS, order: 2 });
    expect(issuesOf(entryNow())).toEqual([]);
    fireEvent.change(order, { target: { value: '' } });
    expect(entryNow()).toEqual(TASKS);
  });

  it('`visible`: a condition that lints clean is written as the bare string', async () => {
    render(<InspectorHost navigation={[TASKS]} />);
    fireEvent.change(screen.getByLabelText('Visible when'), { target: { value: "'org_admin' in current_user.positions" } });
    await waitFor(() => expect(entryNow().visible).toBe("'org_admin' in current_user.positions"), { timeout: 3000 });
    expect(issuesOf(entryNow())).toEqual([]);
  });
});

describe('objectstack#26740 — a key the member does not declare is not offered', () => {
  it('a `page` entry: no landing, and the shared base\'s badge, order and condition', () => {
    render(<InspectorHost navigation={[{ id: 'nav_home', type: 'page', pageName: 'home' }]} />);
    expect(screen.queryByTestId('nav-landing')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Record ID' })).toBeNull();
    expect(screen.queryByTestId('nav-filter-add')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Badge' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Order' })).toBeInTheDocument();
    expect(screen.getByLabelText('Visible when')).toBeInTheDocument();
  });

  it('a `separator`: its `order` only', () => {
    render(<InspectorHost navigation={[{ id: 'sep_1', type: 'separator' }]} />);
    expect(screen.getByRole('spinbutton', { name: 'Order' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Badge' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Badge style' })).toBeNull();
    expect(screen.queryByLabelText('Visible when')).toBeNull();
  });

  it('an `object` entry with no object yet: no landing to choose', () => {
    render(<InspectorHost navigation={[{ id: 'nav_item_1', type: 'object' }]} />);
    expect(screen.queryByTestId('nav-landing')).toBeNull();
  });

  it('each landing offers its own keys only', async () => {
    render(<InspectorHost navigation={[TASKS]} />);
    // The object's default: no landing field.
    expect(screen.queryByRole('combobox', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Record ID' })).toBeNull();
    expect(screen.queryByTestId('nav-filter-add')).toBeNull();
    await pick('Landing', 'Named view');
    expect(screen.getByRole('combobox', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Record ID' })).toBeNull();
    expect(screen.queryByTestId('nav-filter-add')).toBeNull();
  });
});

describe('objectstack#26740 — a change of landing removes the keys the spec refuses beside it', () => {
  it('record → filtered slice: `recordId` and `recordMode` go', async () => {
    render(<InspectorHost navigation={[{ ...TASKS, recordId: 'rec_1', recordMode: 'edit' }]} />);
    expect(screen.getByRole('textbox', { name: 'Record ID' })).toHaveValue('rec_1');
    await pick('Landing', 'Filtered slice (/data)');
    expect(entryNow()).toEqual({ ...TASKS, filters: {} });
    expect(issuesOf(entryNow())).toEqual([]);
  });

  it('filtered slice → record: `filters` goes, and `runAction`, which the spec refuses beside a `recordId`', async () => {
    render(<InspectorHost navigation={[{ ...TASKS, filters: { status: 'open' }, runAction: 'new_task' }]} />);
    await pick('Landing', 'Record deep-link');
    fireEvent.change(screen.getByRole('textbox', { name: 'Record ID' }), { target: { value: 'rec_1' } });
    expect(entryNow()).toEqual({ ...TASKS, recordId: 'rec_1' });
    expect(issuesOf(entryNow())).toEqual([]);
    // The control: the spec refuses the pair this landing removes.
    expect(issuesOf({ ...TASKS, recordId: 'rec_1', runAction: 'new_task' })).not.toEqual([]);
  });

  it('back to the object\'s default: every landing key goes', async () => {
    render(<InspectorHost navigation={[{ ...TASKS, viewName: 'acme_task.open_tasks' }]} />);
    await pick('Landing', 'Default view (workspace)');
    expect(entryNow()).toEqual(TASKS);
  });
});

describe('objectstack#26740 — `visible` round-trips', () => {
  it('shown as authored, and left as authored while untouched', async () => {
    const gated = { ...TASKS, visible: 'current_user.is_admin' };
    render(<InspectorHost navigation={[gated]} />);
    expect(screen.getByLabelText('Visible when')).toHaveValue('current_user.is_admin');
    // The mount's own lint pass writes nothing.
    await new Promise((r) => setTimeout(r, 400));
    expect(entryNow()).toEqual(gated);
  });

  it('an envelope keeps its envelope: the edit writes its `source`', async () => {
    render(<InspectorHost navigation={[{ ...TASKS, visible: { dialect: 'cel', source: 'current_user.is_admin' } }]} />);
    expect(screen.getByLabelText('Visible when')).toHaveValue('current_user.is_admin');
    fireEvent.change(screen.getByLabelText('Visible when'), { target: { value: 'current_user.is_admin || current_user.is_owner' } });
    await waitFor(
      () => expect(entryNow().visible).toEqual({ dialect: 'cel', source: 'current_user.is_admin || current_user.is_owner' }),
      { timeout: 3000 },
    );
    expect(issuesOf(entryNow())).toEqual([]);
  });

  it('a condition with a lint error is not written: the entry keeps its previous one, the field says so, and the fix is written', async () => {
    render(<InspectorHost navigation={[{ ...TASKS, visible: 'current_user.is_admin' }]} />);
    const box = screen.getByLabelText('Visible when');
    fireEvent.change(box, { target: { value: 'current_user.is_admin &&' } });
    expect(await screen.findByTestId('nav-visible-held', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(box).toHaveValue('current_user.is_admin &&');
    expect(entryNow().visible).toBe('current_user.is_admin');

    fireEvent.change(box, { target: { value: 'current_user.is_admin && current_user.is_owner' } });
    await waitFor(() => expect(entryNow().visible).toBe('current_user.is_admin && current_user.is_owner'), { timeout: 3000 });
    expect(screen.queryByTestId('nav-visible-held')).toBeNull();
  });

  it('emptying the field removes the key, never writes `\'\'`', async () => {
    render(<InspectorHost navigation={[{ ...TASKS, visible: 'current_user.is_admin' }]} />);
    fireEvent.change(screen.getByLabelText('Visible when'), { target: { value: '' } });
    await waitFor(() => expect(entryNow()).toEqual(TASKS), { timeout: 3000 });
  });

  it('an envelope with no CEL `source` to edit is shown as authored, read-only', () => {
    const astOnly = { dialect: 'cel', ast: { kind: 'literal', value: true } };
    render(<InspectorHost navigation={[{ ...TASKS, visible: astOnly }]} />);
    expect(screen.getByTestId('nav-visible-when')).toHaveTextContent(JSON.stringify(astOnly));
    expect(screen.queryByLabelText('Visible when')).toBeNull();
  });
});

describe('objectstack#26740 — `order` moves an entry in the running menu', () => {
  it('a lower `order` authored on the second entry puts it first', () => {
    const notes = { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' };
    const menuLabels = () => screen.getAllByRole('link').map((a) => a.textContent?.trim());

    renderMenu([TASKS, notes]);
    expect(menuLabels()).toEqual(['Tasks', 'Home']);
    cleanup();

    render(<InspectorHost navigation={[TASKS, notes]} at={1} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Order' }), { target: { value: '-1' } });
    expect(entryNow(1)).toEqual({ ...notes, order: -1 });
    cleanup();

    renderMenu(navNow());
    expect(menuLabels()).toEqual(['Home', 'Tasks']);
  });
});
