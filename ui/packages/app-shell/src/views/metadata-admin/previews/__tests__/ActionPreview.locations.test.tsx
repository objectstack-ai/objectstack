// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#6888 / objectstack#7100 — the placement preview draws a frame for
 * every action location the product actually renders, and for no other.
 *
 * ## What this replaces
 *
 * `ActionPreview` used to close its `PlacementPreview` with a `global_nav`
 * frame drawing the author a mock command palette:
 *
 *     ⌘K · Command palette
 *        [ New Task ]
 *
 * No such surface exists. The console's palette (`chrome/CommandPalette.tsx`)
 * builds its groups from nav items, objects, dashboards, pages, reports, recent
 * items, record search and theme; it holds no reference to `global_nav`, to
 * `actionRendersAt`, or to any action-metadata source at all. So an author who
 * declared `locations: ['global_nav']`, saw it previewed and shipped it got a
 * button that rendered nowhere — the ADR-0078 "declares, 'renders', reports
 * success, and does nothing" shape, arriving through the location vocabulary.
 * The maintainer's 2026-08-09 ruling on #6888 (direction 2) retired the member;
 * @objectstack/spec 17.0.0-rc.6 shipped that retirement.
 *
 * ## Why the assertions are paired
 *
 * Deleting the frame makes any "does not render global_nav" check pass forever,
 * including if `PlacementPreview` were deleted whole or silently stopped
 * rendering. So each negative pin here sits next to a positive one over the SAME
 * render: a live location must still draw its frame in the same tree where the
 * retired one must not appear. A vacuous pass then requires both halves to fail
 * at once, which no plausible edit does.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { ACTION_LOCATIONS } from '@objectstack/spec/ui';

import { ActionPreview } from '../ActionPreview';

afterEach(cleanup);

function renderWithLocations(locations: string[]) {
  return render(
    <ActionPreview
      type="action"
      name="new_task"
      draft={{
        name: 'new_task',
        label: 'New Task',
        type: 'script',
        target: 'true',
        locations,
      }}
    />,
  );
}

/**
 * The "Where it appears" section — the PLACEMENT simulation, and the only
 * surface this change is about.
 *
 * Scoping matters and is not incidental. Higher up, the metadata strip echoes
 * every token the draft declares as a chip under "Locations:", so an unscoped
 * `queryByText('global_nav')` matches the ECHO and can never distinguish it
 * from a frame. The echo is correct and deliberately untouched: it reports what
 * this (possibly stale) draft says, which is honest, whereas the frame CLAIMED
 * the platform renders it. That distinction is the whole retirement, so the
 * test has to be able to see it.
 */
function placement() {
  const heading = screen.getByText('Where it appears');
  // Section renders: <div><div><span>{title}</span></div>{children}</div>
  return within(heading.parentElement!.parentElement!);
}

describe('ActionPreview placement frames', () => {
  it('draws a frame for a live location', () => {
    renderWithLocations(['record_header']);
    expect(placement().getByText('record_header')).toBeTruthy();
  });

  it('does NOT draw a frame for the retired global_nav location', () => {
    // Both halves over one render: `record_header` proves the placement preview
    // is alive and drawing, `global_nav` proves the retired frame is gone.
    renderWithLocations(['record_header', 'global_nav']);
    expect(placement().getByText('record_header')).toBeTruthy();
    expect(placement().queryByText('global_nav')).toBeNull();
  });

  it('renders no command-palette mock for a global_nav-only action', () => {
    renderWithLocations(['global_nav']);
    // The mock frame's caption was literally "⌘K · Command palette". Asserting
    // the visible string rather than a testid is deliberate: the harm the
    // ruling names is what the AUTHOR SEES, so the pin is on what is displayed.
    expect(screen.queryByText(/Command palette/i)).toBeNull();
    expect(placement().queryByText('global_nav')).toBeNull();
    // The section header still renders (it is gated on `locations.length`, not
    // on how many frames draw), and its body is now empty. That is the truthful
    // answer for a stale draft whose only location the platform retired — it
    // appears nowhere — so it is pinned rather than left to look like a bug.
    expect(screen.getByText('Where it appears')).toBeTruthy();
  });

  it('the vocabulary this preview draws from no longer declares global_nav', () => {
    // The upstream half of the same fact. Without it, a future spec that
    // re-added the member would leave the pins above passing while the designer
    // silently stopped previewing a location the product does declare.
    expect(ACTION_LOCATIONS as readonly string[]).not.toContain('global_nav');
    expect(ACTION_LOCATIONS.length).toBe(6);
  });
});
