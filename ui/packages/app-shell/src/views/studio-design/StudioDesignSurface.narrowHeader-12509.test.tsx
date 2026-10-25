// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12509 — the Studio shell header on a narrow window.
 *
 * Measured in a 558 px window, the one 48 px row put the switcher's Access
 * segment under Changes and clipped Publish; at exactly 640 px the Create app
 * button still sat under Access. The header is now:
 *
 * - below `sm` (640 px): two rows. Home, the package chip and the package
 *   actions on the first; the pillar switcher on the second at full width,
 *   each segment an equal share, icon-only, its name kept as the link's
 *   accessible name;
 * - from `sm` up: one 48 px row, three columns, the switcher in the middle.
 *   The right column never drops below its content, so a tight row moves the
 *   switcher left and truncates the chip instead of overlapping.
 *
 * jsdom has no layout, so the pins read the Tailwind classes: the token
 * strings split into their unprefixed (below `sm`) and `sm:` halves, and the
 * real surface wearing those tokens. The 375 / 560 / 1280 px screenshots in
 * the PR are the layout evidence.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.n4rr';

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
import { STUDIO_HEADER, STUDIO_HEADER_PILLAR, STUDIO_HEADER_PILLAR_NAV } from './studio-tokens';
import { t } from '../metadata-admin/i18n';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** A class string's two halves: what applies below `sm`, and what `sm:` sets from 640 px up. */
function split(classes: string): { base: string[]; sm: string[] } {
  const all = classes.split(/\s+/).filter(Boolean);
  return {
    base: all.filter((c) => !/^[a-z0-9]+:/.test(c)),
    sm: all.filter((c) => c.startsWith('sm:')).map((c) => c.slice(3)),
  };
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({
            success: true,
            data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Field Ops' }, writable: true }] },
          })
        : answer([]),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio shell header below and above 640 px (objectui#12509)', () => {
  it('below `sm` the header is a two-column grid with no fixed height; the switcher is its own full-width last row', () => {
    const header = split(STUDIO_HEADER);
    expect(header.base).toEqual(expect.arrayContaining(['grid', 'grid-cols-[minmax(0,1fr)_auto]', 'py-2', 'gap-y-2']));
    // Two rows cannot fit in 48 px: the fixed height is an `sm:` class only.
    expect(header.base).not.toContain('h-12');

    const nav = split(STUDIO_HEADER_PILLAR_NAV);
    expect(nav.base).toEqual(expect.arrayContaining(['order-last', 'col-span-2', 'flex']));

    const segment = split(STUDIO_HEADER_PILLAR);
    expect(segment.base).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'justify-center']));
  });

  it('from `sm` up the header is one 48 px row of three columns; the right column never shrinks under its content', () => {
    const header = split(STUDIO_HEADER);
    expect(header.sm).toEqual(
      expect.arrayContaining(['h-12', 'py-0', 'grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)]']),
    );

    const nav = split(STUDIO_HEADER_PILLAR_NAV);
    expect(nav.sm).toEqual(expect.arrayContaining(['order-none', 'col-span-1']));

    const segment = split(STUDIO_HEADER_PILLAR);
    expect(segment.sm).toEqual(expect.arrayContaining(['flex-none', 'shrink-0']));
  });

  it('the real header wears the tokens; every segment keeps its name and reads as an icon below `lg`', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>,
    );

    const header = screen.getByTestId('studio-shell-header');
    expect(header).toHaveClass(...STUDIO_HEADER.split(' '));

    const nav = within(header).getByTestId('studio-pillar-nav');
    expect(nav).toHaveClass(...STUDIO_HEADER_PILLAR_NAV.split(' '));

    // Source order stays package · switcher · actions; only `order-last` moves the switcher below `sm`.
    const groups = Array.from(header.children);
    expect(groups).toHaveLength(3);
    expect(groups[1]).toBe(nav);
    expect(within(groups[2] as HTMLElement).getByText(t('engine.studio.publish', 'en'))).toBeInTheDocument();

    for (const key of ['data', 'automations', 'interfaces', 'access']) {
      const link = within(nav).getByRole('link', { name: t(`engine.studio.pillar.${key}`, 'en') });
      expect(link).toHaveClass(...STUDIO_HEADER_PILLAR.split(' '));
      // objectui#12725 — named from 1024 px (`lg`, was `xl`): the right slot
      // leaves the top bar room for the four names at the card's 1010 reading.
      expect(within(link).getByText(t(`engine.studio.pillar.${key}`, 'en'))).toHaveClass('sr-only', 'lg:not-sr-only');
    }

    // The chip is the piece that gives way on a tight row.
    const chip = await waitFor(() => {
      const el = within(header).getByTestId('studio-pkg-chip');
      expect(el).toHaveAttribute('data-pkg-list-state', 'loaded');
      return el;
    });
    expect(chip).toHaveClass('min-w-0');
  });
});
