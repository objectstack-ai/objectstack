/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `global:search` block hosts its record links on an app ROUTE SEGMENT
 * (objectui#11818).
 *
 * ADR-0048 option A keys `/apps/<segment>` on the package id; the app name is
 * only a fallback alias. Inside the `/apps/:appName/*` router the block builds
 * on the URL's own segment. Outside it — a page block has no route of its own
 * there — it fell back to `currentAppName`, which the shell publishes as the
 * app's NAME, spliced in raw; with no app remembered the segment was empty,
 * and the rendered link collapsed `/apps//OBJECT/record/ID` to
 * `/apps/OBJECT/record/ID` — the object's name in the app's place. It now
 * resolves the hint through `resolveHostAppSegment`, as the inbox drills do.
 *
 * Direction, written before the run: on the pre-fix fallback both "outside the
 * app router" cases are RED; the in-router controls are GREEN on both sides.
 * Observed on that run: `/apps/showcase_app/…` and `/apps/showcase_task/…`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdapterCtx, MetadataCtx } from '@object-ui/react';

let currentAppNameFixture: string | undefined;
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: currentAppNameFixture }),
}));

import { GlobalSearchRenderer } from '../global-search-renderer';

const OBJECT = 'showcase_task';
const REC = 'T1';

/** The showcase app as the catalog serves it: a name AND a package id. */
const SHOWCASE = { name: 'showcase_app', label: 'Showcase', _packageId: 'com.example.showcase' };

const META = {
  apps: [SHOWCASE],
  objects: [{ name: OBJECT, label: 'Task', fields: { name: { label: 'Name', type: 'text' } } }],
  dashboards: [], reports: [], pages: [],
  loading: false, error: null,
  refresh: async () => {}, invalidate: () => {},
  ensureType: async () => [], getItem: async () => null,
  getItemsByType: () => [], getTypeStatus: () => 'ready' as const,
};

/** Mount the block at `path` under `routePath`, search, and return the hit link's href. */
async function hitHref(path: string, routePath: string): Promise<string> {
  const ds = { find: vi.fn(async () => ({ data: [{ id: REC, name: 'Write the brief' }] })) };
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdapterCtx.Provider value={ds as never}>
        <MetadataCtx.Provider value={META as never}>
          <Routes>
            <Route path={routePath} element={<GlobalSearchRenderer />} />
          </Routes>
        </MetadataCtx.Provider>
      </AdapterCtx.Provider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'brief' } });
  const link = await waitFor(
    () => {
      const a = screen.getByRole('link');
      expect(a).toBeTruthy();
      return a;
    },
    { timeout: 3000 },
  );
  return link.getAttribute('href') ?? '';
}

beforeEach(() => {
  currentAppNameFixture = undefined;
});
afterEach(cleanup);

describe('global:search hosts its record links on an app route segment (objectui#11818)', () => {
  describe('outside the app router', () => {
    it('the remembered app is addressed by its package id, not its name', async () => {
      currentAppNameFixture = 'showcase_app';
      expect(await hitHref('/home', '/home')).toBe(`/apps/com.example.showcase/${OBJECT}/record/${REC}`);
    });

    it('with no app remembered, the link still names an app', async () => {
      expect(await hitHref('/home', '/home')).toBe(`/apps/com.example.showcase/${OBJECT}/record/${REC}`);
    });
  });

  describe('CONTROLS — inside the app router the URL segment is kept, before and after', () => {
    it('the package-id route', async () => {
      currentAppNameFixture = 'showcase_app';
      expect(await hitHref('/apps/com.example.showcase', '/apps/:appName')).toBe(
        `/apps/com.example.showcase/${OBJECT}/record/${REC}`,
      );
    });

    it('the name alias route', async () => {
      currentAppNameFixture = 'showcase_app';
      expect(await hitHref('/apps/showcase_app', '/apps/:appName')).toBe(`/apps/showcase_app/${OBJECT}/record/${REC}`);
    });
  });
});
