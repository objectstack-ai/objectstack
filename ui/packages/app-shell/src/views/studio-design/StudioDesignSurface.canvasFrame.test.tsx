// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8219 item 1 — one frame around the Interfaces canvas preview.
 *
 * The canvas wrapper drew its own bordered, padded card, and the preview it
 * hosts draws another (`PreviewShell`), so a dashboard sat inside two frames
 * and paid for both borders and the wrapper's padding. The filer's direction:
 * 「预览层只留一层边框」.
 *
 * Pinned: with a registered preview on the canvas, exactly ONE bordered
 * element sits between the canvas `main` and the dashboard grid (the
 * preview's own shell). Canvas states that bring no shell of their own (the
 * "no designer registered" state here) keep the wrapper's frame.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// Module-scope import of the lazily loaded dashboard renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';

const NAV = [
  { id: 'nav_dash', type: 'dashboard', label: 'Customers', dashboardName: 'customer_dashboard' },
  // Only the dashboard designer is registered below, so this leaf renders the
  // canvas's own "no designer" state, which brings no shell.
  { id: 'nav_rep', type: 'report', label: 'Sales report', reportName: 'sales_report' },
];

const DASHBOARD = {
  name: 'customer_dashboard',
  label: 'Customers',
  widgets: [
    { id: 'by_industry', type: 'chart', title: 'By industry', layout: { x: 0, y: 0, w: 6, h: 4 } },
  ],
};

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'dashboard' && name === 'customer_dashboard') return { effective: DASHBOARD };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';

registerMetadataPreview('dashboard', DashboardPreview);

afterEach(cleanup);

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" />
    </MemoryRouter>,
  );
}

/** Elements between `from` (exclusive) and the canvas `main` (exclusive) that draw a border. */
function borderedAncestors(from: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let el = from.parentElement;
  while (el && el.tagName !== 'MAIN') {
    if (el.classList.contains('border')) out.push(el);
    el = el.parentElement;
  }
  expect(el?.tagName).toBe('MAIN');
  return out;
}

describe('Interfaces canvas — one frame around a preview (objectui#8219)', () => {
  it('a dashboard preview sits inside exactly one bordered frame, its own PreviewShell', async () => {
    const { container } = renderPillar();
    fireEvent.click(await screen.findByTitle('dashboard · customer_dashboard'));
    const grid = await waitFor(
      () => {
        const cell = container.querySelector<HTMLElement>('[style*="grid-column"]');
        if (!cell) throw new Error('dashboard grid not rendered yet');
        return cell.parentElement!;
      },
      { timeout: 4000 },
    );
    const frames = borderedAncestors(grid);
    expect(frames).toHaveLength(1);
    // The one frame left is the preview's shell, not the canvas wrapper's card:
    // the wrapper's padding went with its border.
    expect(frames[0].className).toMatch(/\boverflow-hidden\b/);
    expect(container.querySelector('main .rounded-lg.border.p-4')).toBeNull();
  });

  it('a canvas state with no preview shell keeps the wrapper frame', async () => {
    renderPillar();
    fireEvent.click(await screen.findByTitle('report · sales_report'));
    const empty = await screen.findByText(/cannot be previewed or designed here/, undefined, {
      timeout: 4000,
    });
    const frames = borderedAncestors(empty);
    expect(frames).toHaveLength(1);
    expect(frames[0].className).toMatch(/\bp-4\b/);
  });
});
