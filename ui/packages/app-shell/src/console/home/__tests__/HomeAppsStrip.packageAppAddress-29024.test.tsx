// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29024 — a "Your apps" tile opens the app it
 * names, a package's second app included.
 *
 * `/apps/PACKAGE_ID` resolves to the package's FIRST app among the metadata
 * app list, so a tile keyed on the package id opened that first app for every
 * other app of the package. A tile now links to the app's one address
 * (`appAddressSegment`) among `routeApps`, the list the route resolves on:
 * the package id where it resolves back to the app, else the app's name.
 * Resolving among the tiles alone would miss a package whose first app is
 * hidden (no tile) and so still opens on the package id.
 *
 * A real render inside a `MemoryRouter`, as `HomeAppsStrip.tilesAreLinks-12305`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomeAppsStrip } from '../HomeAppsStrip';

const R6_APP = { name: 'r6_app', label: 'R6 App', _packageId: 'com.qa.r6nav' };
const R6_BOARD = { name: 'r6_board', label: 'R6 Board', _packageId: 'com.qa.r6nav' };
const LEAD_SETTINGS = { name: 'lead_settings', label: 'Lead Settings', hidden: true, _packageId: 'com.qa.lead' };
const LEAD_APP = { name: 'lead_app', label: 'Lead App', _packageId: 'com.qa.lead' };
const SOLO = { name: 'solo', label: 'Solo', _packageId: 'com.qa.solo' };

/** The metadata app list; the tiles are its visible apps, as Home passes them. */
const ROUTE_APPS = [R6_APP, R6_BOARD, LEAD_SETTINGS, LEAD_APP, SOLO];
const TILES = [R6_APP, R6_BOARD, LEAD_APP, SOLO];

afterEach(() => cleanup());

function renderStrip() {
  render(
    <MemoryRouter initialEntries={['/home']}>
      <HomeAppsStrip apps={TILES} routeApps={ROUTE_APPS} favorites={[]} onBrowseMarketplace={() => {}} isAdmin={false} />
    </MemoryRouter>,
  );
}

describe('HomeAppsStrip tiles open the app they name (objectstack-ai/objectstack#29024)', () => {
  it('a package\'s second app links by its name; the first keeps its package id', () => {
    renderStrip();
    expect(screen.getByTestId('app-tile-r6_board')).toHaveAttribute('href', '/apps/r6_board');
    expect(screen.getByTestId('app-tile-r6_app')).toHaveAttribute('href', '/apps/com.qa.r6nav');
  });

  it('a visible app behind its package\'s hidden first app links by its name', () => {
    renderStrip();
    expect(screen.queryByTestId('app-tile-lead_settings')).toBeNull();
    expect(screen.getByTestId('app-tile-lead_app')).toHaveAttribute('href', '/apps/lead_app');
  });

  it('an app alone in its package keeps its package-id address', () => {
    renderStrip();
    expect(screen.getByTestId('app-tile-solo')).toHaveAttribute('href', '/apps/com.qa.solo');
  });
});
