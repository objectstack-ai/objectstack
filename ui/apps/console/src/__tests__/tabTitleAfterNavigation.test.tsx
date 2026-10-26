// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The tab title survives an in-app navigation (objectui#8637).
 *
 * ## The defect this pins shut
 *
 * Two independent effects wrote `document.title`, keyed on different inputs.
 * `apps/console/src/App.tsx` rendered `BrandingSync` — a sibling mounted BEFORE
 * the shell, inside `BrowserRouter` — whose effect was keyed on `useLocation()`
 * and assigned the BARE product name on every route change. `AppShell`'s
 * `useAppShellBranding` assigns the composed `"App label — Product name"` from
 * an effect whose dependency list ends in that string, so it fires when the
 * title changes and NOT on navigation.
 *
 * On the commit that first mounts the shell both fire, in tree order, and the
 * composed title wins — which is why the tab looks right and the defect hides.
 * Navigating between two pages of the SAME app changes `location` and not the
 * composed title: only the route-keyed writer runs, and the tab falls back to
 * the bare product name.
 *
 * ## Why this file exists at all
 *
 * From the card: "the reason this survived is that no test asserts what the tab
 * title is after a navigation." Every earlier pin asserted a single write in
 * isolation — `app-shell-branding-title-assignment.test.tsx` pins that
 * `AppShell` assigns its `title` argument wholesale, and passes identically on
 * the defect and on the fix, because it never navigates. So the pin has to
 * render BOTH writers together and move the router, which is what the
 * `navigate` step below does.
 *
 * ## The real subjects, not replicas
 *
 * `FaviconSync` is imported from the console module it actually ships in, and
 * `AppShell` from `@object-ui/layout` — so re-adding a `document.title`
 * assignment to either one turns this file red. A hand-written replica of the
 * route-keyed effect would pin the replica instead, and the defect would walk
 * straight back in through the real component.
 *
 * ⚠️ happy-dom is not where this behaviour was MEASURED — effect ordering
 * against real navigation is not something a jsdom-style harness reproduces
 * faithfully, and the card's PM note ruled reading the code insufficient too.
 * The measurement is a real-Chromium before/after on objectui#8637's pull
 * request, driving the same two components under a real `BrowserRouter`. This
 * file is the cheap regression guard that runs in CI afterwards; the first test
 * below is an environment control so a vacuous green is distinguishable from a
 * real one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { AppShell } from '@object-ui/layout';
import { FaviconSync } from '../components/FaviconSync';

/** What `main.tsx` writes before React mounts: the bare product name. */
const PRODUCT = 'ObjectOS';
/** What `ConsoleLayout` composes and hands to `AppShell.branding.title`. */
const COMPOSED = 'Sales CRM — ObjectOS';

/**
 * Navigation is driven by clicking a real `<Link>`, the way the console's own
 * sidebar and breadcrumbs move between pages of an app — not by calling the
 * router imperatively from outside a component.
 */
function goTo(label: string) {
  fireEvent.click(screen.getByText(label));
}

/** Mirrors `App.tsx`: the route-keyed sync is a sibling rendered BEFORE the shell. */
function ConsoleTree({ inApp }: { inApp: boolean }) {
  return (
    <>
      <FaviconSync />
      <nav>
        <Link to="/apps/crm/a">go to page a</Link>
        <Link to="/apps/crm/b">go to page b</Link>
      </nav>
      {inApp ? (
        <AppShell branding={{ title: COMPOSED }}>
          <Routes>
            <Route path="/apps/crm/a" element={<div>page a</div>} />
            <Route path="/apps/crm/b" element={<div>page b</div>} />
          </Routes>
        </AppShell>
      ) : (
        <div>no shell</div>
      )}
    </>
  );
}

beforeEach(() => {
  document.title = PRODUCT;
});

afterEach(() => {
  cleanup();
});

describe('environment control', () => {
  it('happy-dom lets `document.title` be written and read back', () => {
    // Without this every assertion below could be vacuous in a DOM whose
    // `title` setter is a no-op. Measured, not assumed.
    document.title = 'probe';
    expect(document.title).toBe('probe');
    document.title = PRODUCT;
    expect(document.title).toBe(PRODUCT);
  });
});

describe('the tab title after an in-app navigation (objectui#8637)', () => {
  it('mounting the shell puts the composed title up — the state the defect started from', () => {
    render(
      <MemoryRouter initialEntries={['/apps/crm/a']}>
        <ConsoleTree inApp />
      </MemoryRouter>,
    );
    expect(document.title).toBe(COMPOSED);
  });

  it('navigating to another page of the SAME app leaves the composed title alone', () => {
    render(
      <MemoryRouter initialEntries={['/apps/crm/a']}>
        <ConsoleTree inApp />
      </MemoryRouter>,
    );
    expect(document.title).toBe(COMPOSED);

    goTo('go to page b');

    expect(
      document.title,
      [
        'The tab title reverted after an in-app navigation. A second writer keyed on the',
        'ROUTE is assigning `document.title` again — that is objectui#8637. `AppShell`',
        '(`useAppShellBranding`) owns the title while a shell is mounted; a route-keyed',
        'writer beside it cannot know the app label, so it can only write the bare product',
        'name over the specific one. Remove the assignment, do not try to order the two.',
      ].join('\n'),
    ).toBe(COMPOSED);
  });

  it('navigating a third time still leaves it alone — the effect is not merely deferred', () => {
    render(
      <MemoryRouter initialEntries={['/apps/crm/a']}>
        <ConsoleTree inApp />
      </MemoryRouter>,
    );
    goTo('go to page b');
    goTo('go to page a');
    expect(document.title).toBe(COMPOSED);
  });
});

describe('leaving the app hands the tab back (objectui#8637)', () => {
  it('unmounting the shell restores the title it found, without a route-keyed reset', () => {
    // The route-keyed writer used to double as the reset that took the app
    // label back off the tab when the shell went away. Deleting it without a
    // replacement would strand `"Sales CRM — ObjectOS"` on `/home`; the
    // replacement is `useAppShellBranding`'s own restore-on-unmount, and this
    // is the assertion that keeps the two halves of the change together.
    const view = render(
      <MemoryRouter initialEntries={['/apps/crm/a']}>
        <ConsoleTree inApp />
      </MemoryRouter>,
    );
    expect(document.title).toBe(COMPOSED);

    view.rerender(
      <MemoryRouter initialEntries={['/apps/crm/a']}>
        <ConsoleTree inApp={false} />
      </MemoryRouter>,
    );

    expect(document.title).toBe(PRODUCT);
  });
});
