// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12270 — a list page's own `interfaceConfig.emptyState` wins over its
 * source view's, on every visualization, and its declared link is drawn.
 *
 * ## The defect this pins
 *
 * The spec declares `emptyState` on `InterfacePageConfigSchema` (the list
 * view's own `EmptyStateSchema`, by reference): a list page defines its own data
 * surface (ADR-0047 revised), so it says what belongs in its empty list. The
 * page relayed the source view's `emptyState` only, so a page's own empty state
 * parsed and was never drawn: the page showed the view's sentence, or the
 * default copy when the view declared none.
 *
 * The page's own block now wins, WHOLE, over the view's, which stays the
 * fallback, as the view's `appearance` and `userFilters` do. The precedence is
 * written once, before the visualization is chosen, so it holds on every one;
 * these rows read it on `grid` and on `gallery`, the two `ListView` draws an
 * empty state for.
 *
 * ## Why this renders the real `ListView`
 *
 * The sibling relay pins capture the schema this page hands `ListView`. This
 * one renders it, because the card's claim is what a user sees: the page's
 * sentence and the page's link, drawn by the real empty branch, the link
 * followed through the real action runner under an `ActionProvider` wired as
 * the console wires it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { ActionProvider } from '@object-ui/react';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return { ...actual, useAuth: () => ({}) };
});

let testDataSource: any;
let testObjects: any[];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useAdapter: () => testDataSource,
    useMetadata: () => ({ objects: testObjects }),
  };
});

import { InterfaceListPage } from './InterfaceListPage';

const OBJECT_NAME = 'pkg_package';
const VIEW_KEY = 'source';

const PAGE_TITLE = 'No packages yet';
const PAGE_LINK = { label: 'How to publish a package', url: '/apps/studio/docs/publish' };
const VIEW_TITLE = 'Nothing in this view';
const VIEW_MESSAGE = 'The view’s own sentence.';

const dataSourceAnswering = (rows: Record<string, unknown>[]) => ({
  find: vi.fn().mockResolvedValue(rows),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT_NAME, fields: { name: { type: 'text' } } }),
});

function objectWith(viewEmptyState: unknown) {
  return {
    name: OBJECT_NAME,
    label: 'Package',
    fields: {
      name: { type: 'text', label: 'Name' },
      // So a whitelisted gallery derives its cover binding, as a real page's does.
      cover: { type: 'image', label: 'Cover' },
    },
    listViews: {
      [`${OBJECT_NAME}.${VIEW_KEY}`]: {
        name: `${OBJECT_NAME}.${VIEW_KEY}`,
        label: 'Source',
        type: 'grid',
        columns: ['name'],
        ...(viewEmptyState === undefined ? {} : { emptyState: viewEmptyState }),
      },
    },
  };
}

function mountPage(
  visualization: 'grid' | 'gallery',
  pageEmptyState: unknown,
  viewEmptyState: unknown,
  rows: Record<string, unknown>[] = [],
) {
  testDataSource = dataSourceAnswering(rows);
  testObjects = [objectWith(viewEmptyState)];
  const page = {
    name: 'my_packages',
    label: 'My Packages',
    interfaceConfig: {
      source: OBJECT_NAME,
      sourceView: VIEW_KEY,
      recordAction: 'none',
      appearance: { allowedVisualizations: [visualization] },
      ...(pageEmptyState === undefined ? {} : { emptyState: pageEmptyState }),
    },
  };
  const onNavigate = vi.fn();
  const onToast = vi.fn();
  const result = render(
    <ActionProvider onNavigate={onNavigate} onToast={onToast}>
      <InterfaceListPage page={page as any} />
    </ActionProvider>,
  );
  return { ...result, onNavigate, onToast };
}

async function emptyStateOf(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull());
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

const headingOf = (state: HTMLElement) => state.querySelector('h3')?.textContent ?? null;
const messageOf = (state: HTMLElement) => state.querySelector('p')?.textContent ?? null;
const linkIn = (state: HTMLElement) => state.querySelector('[data-testid="empty-state-link"]') as HTMLElement | null;

beforeEach(() => {
  cleanup();
  testDataSource = undefined;
  testObjects = [];
});
afterEach(() => cleanup());

describe("a list page's own emptyState wins over its source view's (objectui#12270)", () => {
  it.each(['grid', 'gallery'] as const)('%s: the page’s own sentence and link are drawn, not the view’s', async (viz) => {
    const { container } = mountPage(
      viz,
      { title: PAGE_TITLE, link: PAGE_LINK },
      { title: VIEW_TITLE, message: VIEW_MESSAGE },
    );
    const state = await emptyStateOf(container);
    expect(headingOf(state)).toBe(PAGE_TITLE);
    // Whole, not merged per member: the view's message does not fill the page's gap.
    expect(messageOf(state)).not.toBe(VIEW_MESSAGE);
    expect(linkIn(state)?.textContent).toBe(PAGE_LINK.label);
  });

  it('the page’s link is followed in place, through the host router', async () => {
    const { container, onNavigate, onToast } = mountPage('grid', { title: PAGE_TITLE, link: PAGE_LINK }, undefined);
    fireEvent.click(linkIn(await emptyStateOf(container))!);
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(PAGE_LINK.url, expect.objectContaining({ external: false, newTab: false })),
    );
    expect(onToast).not.toHaveBeenCalled();
  });

  it.each(['grid', 'gallery'] as const)('%s: a page that declares no emptyState keeps the source view’s', async (viz) => {
    const { container } = mountPage(viz, undefined, { title: VIEW_TITLE, message: VIEW_MESSAGE });
    const state = await emptyStateOf(container);
    expect(headingOf(state)).toBe(VIEW_TITLE);
    expect(messageOf(state)).toBe(VIEW_MESSAGE);
    expect(linkIn(state)).toBeNull();
  });

  it('CONTROL: with a row, the gallery page mounts the gallery (cards, no table), so the gallery rows above are not the grid twice', async () => {
    const { container } = mountPage('gallery', { title: PAGE_TITLE }, undefined, [{ id: 'p1', name: 'billing-kit' }]);
    await waitFor(() => expect(screen.getByText('billing-kit')).toBeTruthy());
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
  });
});
