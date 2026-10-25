// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12453 — a read-only package says so twice, the same in every
 * pillar: a lock and "Read-only" in the app chip, muted, its title the
 * package's read-only sentence; and one "Read-only · Customize with an
 * overlay" link at the right of the item header, landing on the package's
 * metadata directory (`/apps/setup/metadata?package=ID`, the route the Studio
 * home's read-only package card already uses).
 *
 * The count reads the text a sighted author sees: text inside an `sr-only`
 * element is left out, because those are the disabled controls' reasons,
 * which objectui#12303 puts in a visually hidden copy beside the tooltip.
 * A writable package is the control: no lock, no link.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.r34d';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
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
import { t } from '../metadata-admin/i18n';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const PILLARS = ['data', 'automations', 'interfaces', 'access'] as const;
const READ_ONLY = t('engine.studio.pkg.readonly', 'en');
const LINK = t('engine.studio.pkg.readonlyLink', 'en');

function servePackage(writable: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Field Ops' }, writable }] } })
        : answer([]),
    ),
  );
}

function renderPillar(pillar: (typeof PILLARS)[number]) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/${pillar}`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** How often `Read-only` appears in the text a sighted author sees. */
function visibleReadOnlyCount(): number {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('.sr-only')) text += node.textContent ?? '';
  }
  return (text.match(/Read-only/g) ?? []).length;
}

beforeEach(() => {
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

describe('Studio read-only posture: the app chip and the item header link (objectui#12453)', () => {
  it.each(PILLARS)('%s: the chip carries a muted lock, the header one link to the package’s metadata', async (pillar) => {
    servePackage(false);
    renderPillar(pillar);

    const header = screen.getByTestId('studio-shell-header');
    const chip = await within(header).findByTestId('studio-pkg-readonly');
    expect(chip).toHaveTextContent(READ_ONLY);
    expect(chip).toHaveAttribute('title', t('engine.studio.pkg.readonlyHint', 'en'));
    expect(chip).toHaveClass('text-muted-foreground');
    expect(chip.className).not.toMatch(/amber/);

    const links = await screen.findAllByTestId('studio-readonly-link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent(LINK);
    expect(links[0]).toHaveAttribute('href', `/apps/setup/metadata?package=${PACKAGE_ID}`);
    expect(links[0]).toHaveAttribute('title');

    expect(visibleReadOnlyCount()).toBe(2);
  });

  it.each(PILLARS)('CONTROL — %s on a writable package: no lock, no link', async (pillar) => {
    servePackage(true);
    renderPillar(pillar);

    const header = screen.getByTestId('studio-shell-header');
    await waitFor(() =>
      expect(within(header).getByTestId('studio-pkg-chip')).toHaveAttribute(
        'data-pkg-list-state',
        'loaded',
      ),
    );
    expect(screen.queryByTestId('studio-pkg-readonly')).toBeNull();
    expect(screen.queryByTestId('studio-readonly-link')).toBeNull();
    expect(visibleReadOnlyCount()).toBe(0);
  });
});
