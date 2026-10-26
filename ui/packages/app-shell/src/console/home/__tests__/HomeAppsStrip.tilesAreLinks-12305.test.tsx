// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12305 — each "Your apps" tile is a real link to the app's route.
 *
 * ## The defect
 *
 * The tile was a `button` whose `onClick` called `navigate()`. A button has no
 * address, so the browser's link affordances were absent: middle-click and
 * ⌘/Ctrl-click opened nothing, the context menu had no "Open link in new tab"
 * or "Copy link address", and hovering showed no destination.
 *
 * ## What these cases pin
 *
 * A real render of the strip inside a `MemoryRouter` that carries the console's
 * basename, because the address has two halves and both must be right:
 *
 *   - `href` is the app's route WITH the basename (what the browser opens in a
 *     new tab or copies), and the route segment follows ADR-0048: the package id
 *     when the app has one, else the app name;
 *   - a plain left-click still navigates IN PLACE (the router's location moves
 *     to the basename-relative route, and the click is cancelled so the browser
 *     does not also load the page);
 *   - a modified click (⌘, Ctrl, Shift, Alt) or a non-primary button is left to
 *     the browser: the click is not cancelled and the router does not move.
 *
 * "Left to the browser" is read off the event itself. A window listener runs
 * after React's root listener in the bubble phase, so it sees `defaultPrevented`
 * exactly as the tile's own handler left it. It then cancels the event, so
 * happy-dom does not perform its own anchor navigation inside the test window.
 *
 * The controls that open nothing addressable ("More", "Show less" and the
 * marketplace shortcut) are pinned as buttons, so this fix cannot spread to them.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { HomeAppsStrip } from '../HomeAppsStrip';

/** The console's mount path, as `App.tsx` reads it from the injected base href. */
const MOUNT = '/_console';

const APPS = [
  // No package id: the route segment falls back to the app name.
  { name: 'crm', label: 'CRM', icon: 'Building2' },
  // A package id: ADR-0048 routes on it, not on the name.
  { name: 'ops', label: 'Operations', icon: 'Wrench', _packageId: 'com.acme.ops' },
];

/** Publishes the router's (basename-relative) pathname. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderStrip(
  apps: Record<string, unknown>[] = APPS,
  props: Partial<React.ComponentProps<typeof HomeAppsStrip>> = {},
) {
  return render(
    <MemoryRouter basename={MOUNT} initialEntries={[`${MOUNT}/home`]}>
      <LocationProbe />
      <HomeAppsStrip
        apps={apps}
        favorites={[]}
        onBrowseMarketplace={() => {}}
        isAdmin={false}
        {...props}
      />
    </MemoryRouter>,
  );
}

/**
 * Clicks `el` and returns whether the click was cancelled by the time it left
 * the React tree (see the header), then cancels it for happy-dom's sake.
 */
function clickAndReadCancelled(el: Element, init: MouseEventInit = {}): boolean {
  let cancelled: boolean | undefined;
  const probe = (e: Event) => {
    cancelled = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener('click', probe);
  try {
    fireEvent.click(el, init);
  } finally {
    window.removeEventListener('click', probe);
  }
  if (cancelled === undefined) throw new Error('the click never reached window');
  return cancelled;
}

afterEach(() => cleanup());

describe('HomeAppsStrip — app tiles are links (objectui#12305)', () => {
  it('renders each tile as a link whose href is the app route under the basename', () => {
    renderStrip();

    const crm = screen.getByRole('link', { name: 'CRM' });
    expect(crm).toBe(screen.getByTestId('app-tile-crm'));
    expect(crm).toHaveAttribute('href', `${MOUNT}/apps/crm`);

    const ops = screen.getByRole('link', { name: 'Operations' });
    expect(ops).toBe(screen.getByTestId('app-tile-ops'));
    expect(ops).toHaveAttribute('href', `${MOUNT}/apps/com.acme.ops`);

    // No tile is a button any more.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('navigates in place on a plain left-click', () => {
    renderStrip();
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/home$/);

    const cancelled = clickAndReadCancelled(screen.getByTestId('app-tile-ops'));

    expect(cancelled).toBe(true);
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/apps\/com\.acme\.ops$/);
  });

  it.each([
    ['⌘-click', { metaKey: true }],
    ['Ctrl-click', { ctrlKey: true }],
    ['Shift-click', { shiftKey: true }],
    ['Alt-click', { altKey: true }],
    ['middle button', { button: 1 }],
  ] as const)('leaves a %s to the browser', (_label, init) => {
    renderStrip();

    const cancelled = clickAndReadCancelled(screen.getByTestId('app-tile-crm'), init);

    expect(cancelled).toBe(false);
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/home$/);
  });

  it('keeps "More", "Show less" and the marketplace shortcut as buttons', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `app_${i}`, label: `App ${i}` }));
    renderStrip(many, { isAdmin: true });

    expect(screen.getByTestId('browse-marketplace-btn').tagName).toBe('BUTTON');
    const more = screen.getByTestId('apps-show-all');
    expect(more.tagName).toBe('BUTTON');

    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    // Expanding is local state, not navigation.
    expect(screen.getByTestId('pathname')).toHaveTextContent(/^\/home$/);
    expect(screen.getAllByRole('link')).toHaveLength(25);
  });
});
