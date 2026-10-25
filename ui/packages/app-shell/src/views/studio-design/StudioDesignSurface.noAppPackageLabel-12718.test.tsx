// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12718 — the Interfaces pillar of a package that has no app yet
 * names the package by its display name, the one the Studio top bar prints,
 * and never by its id.
 *
 * `InterfacesPillar` seeded its app label with `packageId`, and the app
 * resolve returned on the no-app branch before it ever set one, so the rail
 * heading read `com.qa.recheck · Navigation` and the pillar title
 * `com.qa.recheck` beside a top bar reading `QA Recheck`. The surface now
 * hands the pillar the name from the package list it already reads for the
 * writability gate (no new request), and the pillar holds no app label until
 * an app is found.
 *
 * A draft-only app is named by the label its `_drafts` row serves
 * (objectstack-ai/objectstack#22200), not by its machine name. The controls:
 * a published app keeps its own label, and a package that declares no name
 * still reads as its id, the only name it has.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'com.qa.recheck';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

/** What the mocked server answers for this package's app. */
const state: {
  published: Array<Record<string, unknown>>;
  drafts: Array<Record<string, unknown>>;
} = { published: [], drafts: [] };

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? state.published : [])),
  listDrafts: vi.fn(async (opts?: { type?: string }) => (opts?.type === 'app' ? state.drafts : [])),
  layered: vi.fn(async (_t: string, name: string) => ({ effective: { name } })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** The package list the top bar and the writability gate read. */
function servePackage(manifest: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest, writable: true }] } })
        : answer([]),
    ),
  );
}

function renderInterfaces() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The pillar's own text: the rail heading and the item header title, not the top bar. */
function pillarText(): string {
  const header = screen.getByTestId('studio-shell-header');
  let text = '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!header.contains(node)) text += `${node.textContent ?? ''}\n`;
  }
  return text;
}

/** Waits for the top bar to have the package list in hand. */
async function packageListLoaded() {
  const header = screen.getByTestId('studio-shell-header');
  await waitFor(() =>
    expect(within(header).getByTestId('studio-pkg-chip')).toHaveAttribute('data-pkg-list-state', 'loaded'),
  );
}

beforeEach(() => {
  state.published = [];
  state.drafts = [];
  for (const fn of Object.values(mockClient)) fn.mockClear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio Interfaces names a package with no app by its display name (objectui#12718)', () => {
  it('no app: the rail heading and the pillar title read the package name, never its id', async () => {
    servePackage({ id: PACKAGE_ID, name: 'QA Recheck' });
    renderInterfaces();

    expect(await screen.findByText('QA Recheck · Navigation', undefined, { timeout: 8000 })).toBeInTheDocument();
    await packageListLoaded();
    expect(mockClient.list).toHaveBeenCalledWith('app', { packageId: PACKAGE_ID });
    expect(mockClient.listDrafts).toHaveBeenCalledWith({ packageId: PACKAGE_ID, type: 'app' });
    const text = pillarText();
    // The title is the package name on a line of its own; the heading is the other line naming it.
    expect(text.split('\n').filter((line) => line.trim() === 'QA Recheck')).not.toHaveLength(0);
    expect(text).not.toContain(PACKAGE_ID);
    // The package list is the one the surface already reads: no request is added for the name.
    const reads = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([input]) => String(input) === '/api/v1/packages',
    );
    expect(reads.length).toBeLessThanOrEqual(1);
  });

  it('a draft-only app: its label from the `_drafts` row, not its machine name', async () => {
    servePackage({ id: PACKAGE_ID, name: 'QA Recheck' });
    state.drafts = [{ type: 'app', name: 'recheck_app', label: 'Recheck Desk', packageId: PACKAGE_ID }];
    renderInterfaces();

    expect(await screen.findByText('Recheck Desk · Navigation', undefined, { timeout: 8000 })).toBeInTheDocument();
    await packageListLoaded();
    expect(pillarText()).not.toContain('recheck_app ·');
  });

  it('CONTROL: a published app keeps its own label over the package name', async () => {
    servePackage({ id: PACKAGE_ID, name: 'QA Recheck' });
    state.published = [{ name: 'recheck_app', label: 'Recheck Desk' }];
    renderInterfaces();

    expect(await screen.findByText('Recheck Desk · Navigation', undefined, { timeout: 8000 })).toBeInTheDocument();
    await packageListLoaded();
    expect(screen.queryByText('QA Recheck · Navigation')).toBeNull();
  });

  it('CONTROL: a package that declares no name reads as its id, the only name it has', async () => {
    servePackage({ id: PACKAGE_ID });
    renderInterfaces();

    await packageListLoaded();
    expect(await screen.findByText(`${PACKAGE_ID} · Navigation`, undefined, { timeout: 8000 })).toBeInTheDocument();
  });
});
