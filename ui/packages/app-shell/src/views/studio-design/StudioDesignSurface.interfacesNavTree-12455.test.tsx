// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12455 (epic objectui#12446, decision 5) — the Interfaces pillar's
 * rail is the app's navigation tree as the running sidebar draws it, the "+"
 * offers the ten nav kinds the spec declares, and the item header and the
 * nav-item inspector follow the redesign artboards.
 *
 *  - every leaf row carries its kind as a tag after its label (an object entry
 *    bound to a named view reads "View"; a url entry "Link"), and the internal
 *    `type · name` pair stays on its tooltip;
 *  - groups open as the sidebar opens them: the spec's `expanded` when set,
 *    and they collapse and reopen from their header; an empty group says so;
 *  - the "+" lists the ten kinds in the spec's order, each with a line on what
 *    it opens; Separator and Group add an entry the spec takes and the nav
 *    save sends; Link adds an unbound entry, left out of the save until it has
 *    a URL, whose inspector offers URL and Open in;
 *  - the header's properties toggle says whether the aside is open
 *    (`aria-pressed`) and opens and closes it;
 *  - the nav-item inspector shows the entry's `visible` predicate read-only
 *    and removes the entry.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema } from '@objectstack/spec/ui';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  {
    id: 'nav_work',
    type: 'group',
    label: 'Work',
    expanded: true,
    children: [
      { id: 'nav_tasks', type: 'object', label: 'Tasks', objectName: 'acme_task' },
      { id: 'nav_my_tasks', type: 'object', label: 'My tasks', objectName: 'acme_task', viewName: 'mine' },
      { id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://example.com/docs' },
    ],
  },
  {
    id: 'nav_archive',
    type: 'group',
    label: 'Archive',
    expanded: false,
    children: [{ id: 'nav_old', type: 'page', label: 'Old page', pageName: 'home' }],
  },
  { id: 'nav_service', type: 'group', label: 'Service', expanded: true, children: [] },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };
const TASK = { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Each app save as the server received it, and whether the spec took it. */
  appSaves: [] as Array<{ navigation: Array<Record<string, unknown>>; accepted: boolean }>,
}));

const appSchema = vi.hoisted(() => ({ parse: null as null | ((body: unknown) => boolean) }));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      const draft = server.drafts.get(k(type, name));
      if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown> };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
      if (type === 'app') {
        const accepted = appSchema.parse!(body);
        server.appSaves.push({ navigation: (body.navigation as Array<Record<string, unknown>>) ?? [], accepted });
        if (!accepted) throw Object.assign(new Error('validation failed'), { status: 400 });
      }
      server.drafts.set(k(type, name), body);
      return { type, name, item };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

appSchema.parse = (body: unknown) => AppSchema.safeParse(body).success;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { InterfacesPillar, StudioNavItemInspector } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { PagePreview } from '../metadata-admin/previews/PagePreview';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

// The first leaf the pillar opens is a page.
registerMetadataPreview('page', PagePreview);

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.appSaves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(key('app', APP.name), JSON.parse(JSON.stringify(APP)));
  server.active.set(key('page', HOME.name), JSON.parse(JSON.stringify(HOME)));
  server.active.set(key('object', TASK.name), JSON.parse(JSON.stringify(TASK)));
});

afterEach(cleanup);

/** The pillar as the Studio surface mounts it: its draft-saved signal re-reads the app. */
function NavHost() {
  const [nonce, setNonce] = React.useState(0);
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} draftNonce={nonce} onDraftSaved={() => setNonce((n) => n + 1)} />
    </MemoryRouter>
  );
}

async function ready(): Promise<HTMLElement> {
  const home = await screen.findByRole('button', { name: 'Home menu Page' }, { timeout: 8000 });
  const rail = home.closest('nav');
  expect(rail).not.toBeNull();
  return rail as HTMLElement;
}

describe('objectui#12455 — the rail is the app navigation tree', () => {
  it('each leaf carries its kind as a tag after its label; the internal pair stays on the tooltip', async () => {
    render(<NavHost />);
    const rail = await ready();
    const tasks = within(rail).getByRole('button', { name: 'Tasks Object' });
    expect(tasks).toHaveAttribute('title', 'object · acme_task');
    expect(tasks).not.toHaveTextContent('acme_task');
    // An object entry bound to a named view is a view.
    expect(within(rail).getByRole('button', { name: 'My tasks View' })).toBeEnabled();
    // A url entry opens no design surface: a disabled row, tagged as a link.
    expect(within(rail).getByRole('button', { name: 'Docs Link' })).toBeDisabled();
  });

  it("groups open as the sidebar opens them — `expanded: false` starts closed — and toggle from their header", async () => {
    render(<NavHost />);
    const rail = await ready();
    const archive = within(rail).getByRole('button', { name: 'Archive' });
    expect(archive).toHaveAttribute('aria-expanded', 'false');
    expect(within(rail).queryByRole('button', { name: 'Old page Page' })).toBeNull();
    fireEvent.click(archive);
    expect(archive).toHaveAttribute('aria-expanded', 'true');
    expect(within(rail).getByRole('button', { name: 'Old page Page' })).toBeInTheDocument();
    // CONTROL: an `expanded: true` group starts open, and closes from its header.
    const work = within(rail).getByRole('button', { name: 'Work' });
    expect(work).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(work);
    expect(within(rail).queryByRole('button', { name: 'Tasks Object' })).toBeNull();
  });

  it('an empty group says so in its place', async () => {
    render(<NavHost />);
    const rail = await ready();
    expect(within(rail).getByRole('button', { name: 'Service' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(rail).getByText('No items in this package')).toBeInTheDocument();
  });
});

describe('objectui#12455 — the "+" offers the ten nav kinds', () => {
  async function openPicker(): Promise<HTMLElement[]> {
    await ready();
    fireEvent.pointerDown(screen.getByTestId('if-create-menu'), { button: 0, ctrlKey: false });
    return screen.findAllByRole('menuitem');
  }

  it('lists every kind the spec declares, in its order, each with what it opens', async () => {
    render(<NavHost />);
    const items = await openPicker();
    expect(items.map((i) => i.textContent)).toEqual([
      'ObjectA list view or one record',
      'PageA custom page built from blocks',
      'DashboardWidgets over filters',
      'ReportA saved report',
      'LinkAn external URL, same or new tab',
      'ActionRuns a global action from the menu',
      'ComponentA registered component, like the approvals inbox',
      'DocA doc page, a book, or both',
      'GroupA titled section of the menu',
      'SeparatorA divider, no label, opens nothing',
    ]);
  });

  it('Separator adds a rule the spec takes, and the nav save sends it', async () => {
    render(<NavHost />);
    await openPicker();
    fireEvent.click(screen.getByTestId('if-add-nav-separator'));
    await waitFor(() => expect(server.appSaves.length).toBeGreaterThan(0), { timeout: 8000 });
    const last = server.appSaves[server.appSaves.length - 1];
    expect(last.accepted).toBe(true);
    expect(last.navigation[last.navigation.length - 1]).toEqual({ id: 'nav_item_5', type: 'separator' });
  });

  it('Group adds a header the spec takes, born with the empty list its member requires', async () => {
    render(<NavHost />);
    await openPicker();
    fireEvent.click(screen.getByTestId('if-add-nav-group'));
    await waitFor(() => expect(server.appSaves.length).toBeGreaterThan(0), { timeout: 8000 });
    const last = server.appSaves[server.appSaves.length - 1];
    expect(last.accepted).toBe(true);
    expect(last.navigation[last.navigation.length - 1]).toEqual({ id: 'nav_item_5', type: 'group', children: [] });
  });

  it('Link adds an unbound entry whose inspector offers URL and Open in; the save leaves it out until it has a URL', async () => {
    render(<NavHost />);
    await openPicker();
    fireEvent.click(screen.getByTestId('if-add-nav-url'));
    const aside = await screen.findByTestId('if-inspector');
    expect(within(aside).getByText('Nav item · Link')).toBeInTheDocument();
    expect(within(aside).getByLabelText('URL')).toHaveValue('');
    expect(within(aside).getByRole('combobox', { name: 'Open in' })).toBeInTheDocument();
    // Whatever the autosave sends, it does not send the unbound link.
    await new Promise((r) => setTimeout(r, 1200));
    for (const save of server.appSaves) {
      expect(save.navigation.some((n) => n.type === 'url' && n.id === 'nav_item_5')).toBe(false);
    }
  });
});

describe('objectui#12455 — the item header', () => {
  it('the properties toggle says whether the aside is open, and opens and closes it', async () => {
    render(<NavHost />);
    await ready();
    const toggle = await screen.findByTestId('if-properties-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('if-inspector')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('if-inspector')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('if-inspector')).toBeInTheDocument();
  });

  it('names the open entry by its label and kind, with no api chip (objectui#7254)', async () => {
    render(<NavHost />);
    await ready();
    const header = await screen.findByTestId('if-item-header');
    await waitFor(() => expect(within(header).getByTestId('if-canvas-caption')).toHaveTextContent('Page'));
    expect(header).toHaveTextContent('Home menu');
    expect(header.textContent).not.toContain('home ·');
    expect(header.querySelector('code')).toBeNull();
  });
});

describe('objectui#12455 — the nav-item inspector', () => {
  const entry = { id: 'nav_gated', type: 'page', label: 'Gated', pageName: 'home', visible: 'READS_OPPORTUNITIES' };

  it("shows the entry's `visible` predicate as authored, read-only", () => {
    render(
      <StudioNavItemInspector
        navId="navigation[0]"
        appDraft={{ navigation: [entry] }}
        objects={[]}
        packageId={PKG}
        onNavPatch={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText('Visible when')).toBeInTheDocument();
    expect(screen.getByTestId('nav-visible-when')).toHaveTextContent('READS_OPPORTUNITIES');
    expect(screen.queryByDisplayValue('READS_OPPORTUNITIES')).toBeNull();
  });

  it('CONTROL: an entry with no `visible` shows no such row', () => {
    const { visible: _ignored, ...plain } = entry;
    render(
      <StudioNavItemInspector
        navId="navigation[0]"
        appDraft={{ navigation: [plain] }}
        objects={[]}
        packageId={PKG}
        onNavPatch={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.queryByText('Visible when')).toBeNull();
  });

  it('"Remove nav item" removes exactly that entry and closes the inspector', () => {
    const onNavPatch = vi.fn();
    const onClear = vi.fn();
    const other = { id: 'nav_other', type: 'page', label: 'Other', pageName: 'home' };
    render(
      <StudioNavItemInspector
        navId="navigation[1]"
        appDraft={{ navigation: [other, entry] }}
        objects={[]}
        packageId={PKG}
        onNavPatch={onNavPatch}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove nav item' }));
    expect(onNavPatch).toHaveBeenCalledWith({ navigation: [other] });
    expect(onClear).toHaveBeenCalled();
  });
});
