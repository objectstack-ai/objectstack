// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — a create on Setup's metadata list that names no package
 * asks the person to pick a package or create one (`PackageCreateAsk.tsx`).
 *
 * A package is NAMED by a `?package=` the person put in the address — on
 * arrival, or by choosing in the scope selector. The list's repair writes the
 * heuristic pick into the address too, marked as its own write, and that pick
 * is not named: New asks, with the pick pre-selected. Pinned beside each:
 *
 *  - on arrival with no `?package=` (the repair writes the pick): New asks,
 *    the pick pre-selected; the answer is where the create opens;
 *  - on arrival with `?package=PKG`, and after a choice in the selector:
 *    no ask, the create opens there;
 *  - while the packages load: New is disabled;
 *  - Setup's catalog (the environment scope, decisions Q-a of topic
 *    objectstack#37424): New opens the create in the scope with no ask; the
 *    editor's Save asks, once (`ResourceListPage.catalogAsksOnce-38149`);
 *  - Studio's cross-package leg (`/studio/~all/metadata/TYPE`): New asks;
 *  - Cancel opens nothing.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
// The page reaches `celAuthoring`'s dynamic `@objectstack/lint` import; its
// first load is paid here, at collection (`check:test-source-alias`).
import '@objectstack/lint';
import '@objectstack/spec/identity';

const PKG_A = 'app.alpha';
const PKG_B = 'app.bravo';
const TYPE = 'permission';

/** Package B owns the rows, so the list's heuristic picks it. */
const ITEMS: Record<string, unknown>[] = [
  { name: 'bravo_set', label: 'Bravo set', _packageId: PKG_B, _provenance: 'package' },
];

let packageList: () => Promise<unknown[]> = async () => [
  { manifest: { id: PKG_A, scope: 'project', name: 'Alpha' } },
  { manifest: { id: PKG_B, scope: 'project', name: 'Bravo' } },
];

/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) => (type === 'package' ? packageList() : type === TYPE ? ITEMS : []),
};

const ENTRY = { type: TYPE, label: 'Permission Set', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [ENTRY] }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));

/** The server's package list the ask reads, with its `writable` verdict. */
vi.mock('../studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPackages: async () => [
    { id: PKG_A, name: 'Alpha', writable: true, namespace: 'alpha' },
    { id: PKG_B, name: 'Bravo', writable: true, namespace: 'bravo' },
  ],
}));

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';
import { t } from './i18n';

beforeEach(() => {
  packageList = async () => [
    { manifest: { id: PKG_A, scope: 'project', name: 'Alpha' } },
    { manifest: { id: PKG_B, scope: 'project', name: 'Bravo' } },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(JSON.stringify({ object: 'x', records: [], hasMore: false, url }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Where a create opened: the editor route's address. */
function CreateProbe() {
  const location = useLocation();
  return <div data-testid="create-opened">{location.search}</div>;
}

/** The scope selector's write: a navigation that names a package, carrying no state. */
function SelectorStub() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="selector-stub" onClick={() => navigate(`/apps/setup/metadata/${TYPE}?package=${PKG_A}`)}>
      choose
    </button>
  );
}

function mount(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${TYPE}${search}`]}>
      <SelectorStub />
      <Routes>
        <Route path="/apps/setup/metadata/:type" element={<MetadataResourceListPage type={TYPE} />} />
        <Route path="/apps/setup/metadata/:type/new" element={<CreateProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const newButton = () => screen.findByTestId('metadata-list-create');
const ask = () => screen.findByTestId('package-create-ask');

describe('Setup list: a heuristic pick asks (objectstack#38149)', () => {
  it('on arrival with no ?package=, New asks with the repaired pick pre-selected, and opens the create where the person chose', async () => {
    mount('');
    // The repair has written the heuristic pick (Bravo owns the rows).
    await waitFor(() => expect(screen.getByText('bravo_set')).toBeInTheDocument());
    fireEvent.click(await newButton());
    const dialog = await ask();
    const bravo = await within(dialog).findByTestId(`package-create-ask-option-${PKG_B}`);
    expect(bravo).toHaveAttribute('data-state', 'checked');
    expect(screen.queryByTestId('create-opened')).toBeNull();

    fireEvent.click(within(dialog).getByTestId(`package-create-ask-option-${PKG_A}`));
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));
    expect(await screen.findByTestId('create-opened')).toHaveTextContent(`?package=${PKG_A}`);
  });

  it('Cancel opens no create', async () => {
    mount('');
    await waitFor(() => expect(screen.getByText('bravo_set')).toBeInTheDocument());
    fireEvent.click(await newButton());
    const dialog = await ask();
    fireEvent.click(within(dialog).getByTestId('package-create-ask-cancel'));
    await waitFor(() => expect(screen.queryByTestId('package-create-ask')).toBeNull());
    expect(screen.queryByTestId('create-opened')).toBeNull();
  });
});

describe('Setup list: a named package does not ask (objectstack#38149)', () => {
  it('on arrival with ?package=PKG, New opens the create there with no ask', async () => {
    mount(`?package=${PKG_A}`);
    const button = await newButton();
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(await screen.findByTestId('create-opened')).toHaveTextContent(`?package=${PKG_A}`);
    expect(screen.queryByTestId('package-create-ask')).toBeNull();
  });

  it('after a choice in the scope selector, New opens the create there with no ask', async () => {
    mount('');
    await waitFor(() => expect(screen.getByText('bravo_set')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('selector-stub'));
    const button = await newButton();
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(await screen.findByTestId('create-opened')).toHaveTextContent(`?package=${PKG_A}`);
    expect(screen.queryByTestId('package-create-ask')).toBeNull();
  });
});

describe('Setup list: New waits for the packages (objectstack#38149)', () => {
  it('is disabled while the package list loads', async () => {
    packageList = () => new Promise(() => {});
    mount('');
    expect(await newButton()).toBeDisabled();
  });
});

describe('Setup catalog: a new permission set opens in the environment scope (objectstack#38149, Q-a)', () => {
  // The environment scope binds no package, and Studio's area drops a
  // `?package=` under it: an answer asked here was lost, and Save asked again.
  it('New asks nothing and opens the create in the scope, naming no package', async () => {
    mount('?scope=environment');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('engine.list.create', 'en-US')) }));
    expect(await screen.findByTestId('create-opened')).toHaveTextContent('?scope=environment');
    expect(screen.getByTestId('create-opened')).not.toHaveTextContent('package=');
    expect(screen.queryByTestId('package-create-ask')).toBeNull();
  });
});

describe("Studio's cross-package leg: New asks for its package (objectstack#38149)", () => {
  const ALL: MetadataAreaHost = { packageId: null, readOnly: false, basePath: '/studio/~all/metadata' };

  it('New asks, and the create opens in the leg under the chosen package', async () => {
    render(
      <MetadataAreaHostContext.Provider value={ALL}>
        <MemoryRouter initialEntries={[`/studio/~all/metadata/${TYPE}`]}>
          <Routes>
            <Route path="/studio/~all/metadata/:type" element={<MetadataResourceListPage type={TYPE} />} />
            <Route path="/studio/~all/metadata/:type/new" element={<CreateProbe />} />
          </Routes>
        </MemoryRouter>
      </MetadataAreaHostContext.Provider>,
    );
    fireEvent.click(await newButton());
    const dialog = await ask();
    expect(screen.queryByTestId('create-opened')).toBeNull();
    fireEvent.click(await within(dialog).findByTestId(`package-create-ask-option-${PKG_A}`));
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));
    expect(await screen.findByTestId('create-opened')).toHaveTextContent(`?package=${PKG_A}`);
  });
});
