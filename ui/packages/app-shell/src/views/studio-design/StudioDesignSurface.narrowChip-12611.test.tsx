// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12611 — the shell header's package chip on a narrow header. At
 * 1024 px the chip read "Hot… 🔒 Read-only ▾": a viewport-keyed 180 px cap
 * gave the lock and the word objectui#12453 added the room, and the name
 * kept three letters. Now the chip's room is the header's package column
 * (a container), the cap is the chip's own, and the chip gives way in order:
 * the "Read-only" word first (the lock stays), then the name truncates. The
 * whole name, the posture and what the chip does are in its tooltip.
 *
 * jsdom has no layout: the pull request carries the browser readings (the
 * chip's visible text at 1024 and 1280 px). This file pins the contract that
 * produces them: the DOM order, which part carries the truncating and the
 * hiding classes, the container, and the tooltip.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.objectstack.hotcrm';
const NAME = 'HotCRM';

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
import { STUDIO_HEADER_PACKAGE_COLUMN, STUDIO_PKG_READONLY_WORD } from './studio-tokens';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function servePackage(writable: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: NAME }, writable }] } })
        : answer([]),
    ),
  );
}

function renderData() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
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

describe('the package chip on a narrow header (objectui#12611)', () => {
  it('reads the name first; the lock stays and only the word carries the hiding class', async () => {
    servePackage(false);
    renderData();
    const header = screen.getByTestId('studio-shell-header');
    const readOnly = await within(header).findByTestId('studio-pkg-readonly');
    const chip = within(header).getByTestId('studio-pkg-chip');

    // The chip's text starts with the whole name.
    expect(chip.textContent?.startsWith(NAME)).toBe(true);
    const name = chip.querySelector('[data-slot="pkg-name"]') as HTMLElement;
    expect(name).toHaveTextContent(NAME);
    expect(name).toHaveClass('truncate');

    // Order: the name, then the lock and the word, then the chevron.
    const parts = Array.from(chip.children);
    expect(parts.indexOf(name)).toBeLessThan(parts.indexOf(readOnly));
    expect(parts.indexOf(readOnly)).toBe(parts.length - 2);

    // The lock is the posture's part that stays: outside the folding word.
    const word = readOnly.querySelector('[data-slot="pkg-readonly-word"]') as HTMLElement;
    expect(word).toHaveTextContent(t('engine.studio.pkg.readonly', 'en'));
    expect(word).toHaveClass(...STUDIO_PKG_READONLY_WORD.split(' '));
    expect(STUDIO_PKG_READONLY_WORD).toBe('hidden @min-[300px]:inline');
    const lock = readOnly.querySelector('svg');
    expect(lock).not.toBeNull();
    expect(word.contains(lock)).toBe(false);
    expect(readOnly).toHaveClass('shrink-0');
    // objectui#12453's reason stays the posture's own title.
    expect(readOnly).toHaveAttribute('title', t('engine.studio.pkg.readonlyHint', 'en'));
  });

  it('the room is the header column’s, never the viewport’s: a container column and a cap of the chip’s own', async () => {
    servePackage(false);
    renderData();
    const header = screen.getByTestId('studio-shell-header');
    await within(header).findByTestId('studio-pkg-readonly');
    const chip = within(header).getByTestId('studio-pkg-chip');

    const column = header.children[0] as HTMLElement;
    expect(column.contains(chip)).toBe(true);
    expect(column).toHaveClass(STUDIO_HEADER_PACKAGE_COLUMN);
    expect(STUDIO_HEADER_PACKAGE_COLUMN).toBe('@container');
    expect(chip).toHaveClass('min-w-0', 'max-w-[280px]');
    // No breakpoint variant sizes the chip.
    expect(chip.className).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
    // The native title moved into the tooltip: one tooltip, not two.
    expect(chip).not.toHaveAttribute('title');
  });

  it('the tooltip holds the whole name, the posture and what the chip does', async () => {
    servePackage(false);
    renderData();
    const header = screen.getByTestId('studio-shell-header');
    await within(header).findByTestId('studio-pkg-readonly');
    await userEvent.setup().hover(within(header).getByTestId('studio-pkg-chip'));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(NAME);
    expect(tip).toHaveTextContent(t('engine.studio.pkg.readonlyHint', 'en'));
    expect(tip).toHaveTextContent(t('engine.studio.pkg.switchTitle', 'en'));
  });

  it('CONTROL — a writable package: the tooltip names the package and says nothing of read-only', async () => {
    servePackage(true);
    renderData();
    const header = screen.getByTestId('studio-shell-header');
    const chip = within(header).getByTestId('studio-pkg-chip');
    await vi.waitFor(() => expect(chip).toHaveAttribute('data-pkg-list-state', 'loaded'));
    await userEvent.setup().hover(chip);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(NAME);
    expect(tip).not.toHaveTextContent(t('engine.studio.pkg.readonlyHint', 'en'));
    expect(within(header).queryByTestId('studio-pkg-readonly')).toBeNull();
  });
});
