// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12519 (epic objectui#12446, decision 1) — editing the Interfaces
 * navigation keeps the 240 px rail.
 *
 * Edit turned the rail into the navigation editor and widened it, so the
 * content column and the inspector aside moved right on Edit and back on
 * Done. The rail now carries `STUDIO_RAIL_WIDTH` in both modes, and the
 * editor's rows carry an always-drawn remove control that Tab reaches.
 *
 * jsdom lays nothing out, so the width is read as the rail's class: the token
 * the 240 px comes from. The rendered widths were read once in Chromium for
 * the pull request; nothing here re-reads them.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  {
    id: 'nav_work',
    type: 'group',
    label: 'Work',
    expanded: true,
    children: [{ id: 'nav_tasks', type: 'object', label: 'Tasks', objectName: 'acme_task' }],
  },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };

const server = vi.hoisted(() => ({ active: new Map<string, Record<string, unknown>>() }));

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
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

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

import { InterfacesPillar } from './StudioDesignSurface';
import { STUDIO_RAIL_WIDTH } from './studio-tokens';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { PagePreview } from '../metadata-admin/previews/PagePreview';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('page', PagePreview);

beforeEach(() => {
  server.active.clear();
  server.active.set('app/acme_app', JSON.parse(JSON.stringify(APP)));
  server.active.set('page/home', JSON.parse(JSON.stringify(HOME)));
});

afterEach(cleanup);

/** The rail's width utilities: every `w-*` token on the `nav` element. */
const widthClasses = (rail: HTMLElement) => rail.className.split(/\s+/).filter((c) => /^w-/.test(c));

async function openRail(): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} draftNonce={0} onDraftSaved={() => undefined} />
    </MemoryRouter>,
  );
  const home = await screen.findByRole('button', { name: 'Home menu Page' }, { timeout: 8000 });
  return home.closest('nav') as HTMLElement;
}

describe('objectui#12519 — the Interfaces rail keeps its width while the navigation is edited', () => {
  it('the rail carries the same width class in and out of edit mode, and the content column stays its next sibling', async () => {
    const rail = await openRail();
    const column = screen.getByTestId('if-content-column');
    expect(widthClasses(rail)).toEqual([STUDIO_RAIL_WIDTH]);
    expect(rail.nextElementSibling).toBe(column);

    fireEvent.click(within(rail).getByRole('button', { name: /^Edit$/ }));
    // Edit mode: the rail holds the navigation editor now.
    expect(await within(rail).findAllByRole('button', { name: 'Remove nav item' })).not.toHaveLength(0);
    expect(widthClasses(rail)).toEqual([STUDIO_RAIL_WIDTH]);
    expect(rail.nextElementSibling).toBe(screen.getByTestId('if-content-column'));

    fireEvent.click(within(rail).getByRole('button', { name: /^Done$/ }));
    await within(rail).findByRole('button', { name: 'Home menu Page' });
    expect(widthClasses(rail)).toEqual([STUDIO_RAIL_WIDTH]);
  });

  it('in edit mode each top-level row draws its remove control without a hover, and Tab reaches it after its row', async () => {
    const user = userEvent.setup();
    const rail = await openRail();
    fireEvent.click(within(rail).getByRole('button', { name: /^Edit$/ }));
    const removes = await within(rail).findAllByRole('button', { name: 'Remove nav item' });
    // One per top-level entry; a group's children are edited in the inspector.
    expect(removes).toHaveLength(NAV.length);
    for (const remove of removes) {
      const classes = remove.className.split(/\s+/);
      expect(classes).toContain('w-6');
      expect(classes).not.toContain('w-0');
      expect(classes).not.toContain('opacity-0');
    }
    const row = removes[0].closest('button[aria-pressed]') as HTMLElement;
    row.focus();
    await user.tab();
    expect(removes[0]).toHaveFocus();
  });
});
