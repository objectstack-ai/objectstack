// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6795 part C — the CONTRAST half of
 * {@link file://./StudioDesignSurface.designerRegistryMissing.test.tsx}.
 *
 * `Preview === undefined` has exactly two causes and the Interfaces canvas must
 * not confuse them:
 *
 *   1. **this type** has no designer while others do — a product fact;
 *   2. the registries are empty **wholesale** because the module-scope
 *      registration never ran — an environment fact.
 *
 * The retired single message asserted (2)'s cause in (1)'s words ("design
 * support is in progress"), which is why it was wrong for pages. The repair
 * tells them apart with `listMetadataPreviewTypes()` — a read of the same
 * already-imported registry module, inventing no state.
 *
 * This file pins branch (1), so it DOES register a designer — for an unrelated
 * type. It lives apart from the empty-registry pins because these registries are
 * plain `Map`s: module state shared by every test in a file. Splitting them is
 * what lets each file assert its own precondition instead of depending on test
 * order.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NAV = [{ id: 'nav_page', type: 'page', label: 'Home', pageName: 'home_page' }];

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'page') return { effective: { name: 'home_page', label: 'Home' } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
};

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

import { InterfacesPillar } from './StudioDesignSurface';
import { listMetadataPreviewTypes, registerMetadataPreview } from '../metadata-admin/preview-registry';

/**
 * A designer for an unrelated type. The registry is now demonstrably populated,
 * so a `page` leaf reaching the same fallback branch is reaching it for reason
 * (1), not reason (2).
 */
function StubDashboardPreview(): React.ReactElement {
  return <div data-testid="stub-dashboard-preview" />;
}
registerMetadataPreview('dashboard', StubDashboardPreview as never);

afterEach(cleanup);

describe('Interfaces canvas — a POPULATED registry still names the right cause (#6795 C)', () => {
  it('says no designer is registered for this type, not that none loaded at all', async () => {
    // Precondition, stated rather than assumed: the registry is non-empty, and
    // this leaf's own type is not in it. Without this the assertion below could
    // pass for the wrong reason.
    expect(listMetadataPreviewTypes()).toEqual(['dashboard']);
    expect(listMetadataPreviewTypes()).not.toContain('page');

    render(
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTitle('page · home_page'));
    await waitFor(() => expect(screen.getByTestId('canvas-mode-toggle')).toBeInTheDocument(), {
      timeout: 4000,
    });

    await screen.findByText(
      'No designer is registered for page, so it cannot be previewed or designed here.',
    );
    // ⛔ Must NOT claim the whole registry is missing — it demonstrably is not.
    expect(document.body.textContent ?? '').not.toContain(
      'No metadata designers are registered in this session',
    );
    // ⛔ And must not resurrect the retired roadmap claim either.
    expect(document.body.textContent ?? '').not.toContain('design support is in progress');
  });

  it('keeps the ordinary "click a block" empty state when designers ARE registered', async () => {
    expect(listMetadataPreviewTypes()).toEqual(['dashboard']);

    render(
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTitle('page · home_page'));
    await waitFor(() => expect(screen.getByTestId('canvas-mode-toggle')).toBeInTheDocument(), {
      timeout: 4000,
    });

    // The repair must not over-fire: with the registry populated the rail keeps
    // its normal invitation. Asserted on `textContent` rather than `findByText`
    // because the two lines are split by a `<br />`, so no single element's text
    // equals either line on its own.
    await waitFor(() =>
      expect(document.body.textContent ?? '').toContain(
        'Click a block on the canvas,and edit its properties right here.',
      ),
    );
  });
});
