/**
 * objectui#6378 — the console boot must never hand the viewport to an empty
 * document.
 *
 * ## What this file can and cannot see
 *
 * The defect is a TIMING one: a bare `<Navigate>` renders null, and the
 * destination tree then renders at transition priority, so for 41–147 ms
 * (measured on the production bundle — a CDP screencast frame ledger correlated
 * against a DOM-state ledger on the same clock) `#root` holds no view and the
 * compositor may swap a fully white frame.
 *
 * jsdom has no compositor and no CSS engine, so **nothing here measures that
 * window**. Asserting "no flash" in jsdom would be a test that passes because
 * the phenomenon cannot exist there, which is precisely the shape this card
 * exists to avoid. What this file pins is the STRUCTURAL half, which is where
 * the fix lives: the element the gate hands off to renders the splash, and it
 * still performs the same navigation with the same history semantics. The
 * timing claim is measured only in a real browser —
 * `e2e/console-boot-indicator.spec.ts` carries the end-to-end invariant and the
 * pixel ledger is recorded in the pull request.
 *
 * The two halves are pinned SEPARATELY on purpose. A single "it redirects"
 * assertion stays green when the splash is dropped (the navigation is
 * unaffected), and losing the splash is the only regression this component
 * exists to prevent.
 *
 * Nothing in react-router is stubbed: the real `<Navigate>` renders null, and
 * that nullness IS the thing being worked around, so replacing it with a marker
 * would hide the subject.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';

// Imported at module scope, not inside a test: `@object-ui/components` is a
// heavy barrel and resolving it mid-assertion would race the RTL timeouts
// (AGENTS.md § 测试纪律).
import '@object-ui/components';

import { RedirectWithSplash } from './RedirectWithSplash.js';

/** Reports where the router ended up and how it got there. */
function RouterProbe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <>
      <div data-testid="path">{location.pathname + location.search}</div>
      <div data-testid="nav-type">{type}</div>
    </>
  );
}

describe('RedirectWithSplash', () => {
  it('paints the splash — the screen the gate hands off is never handed back empty', () => {
    // Rendered OUTSIDE a `<Routes>` sink so the element under test stays
    // mounted after it navigates; what is asserted is what it renders, not what
    // survives the route change.
    const { container } = render(
      <MemoryRouter>
        <RedirectWithSplash to="/login" replace />
      </MemoryRouter>,
    );

    // The real `LoadingScreen`, not a marker: its product name and its status
    // line are exactly what the gate one state earlier was already painting,
    // and the point of the fix is that those pixels do not change across the
    // handoff.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ObjectOS');
    expect(screen.getByText('Opening your console…')).toBeTruthy();

    // ...and it is the full-viewport splash root, so nothing shows through
    // around it. Class names, not computed style — jsdom resolves no Tailwind
    // (see the header), so a style assertion here would measure nothing.
    expect(
      container.querySelector('div.h-screen.bg-background'),
      'LoadingScreen renders its full-viewport root',
    ).toBeTruthy();
  });

  it('lands the router on the destination, with the search string intact', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouterProbe />
        <Routes>
          <Route path="/" element={<RedirectWithSplash to="/login?redirect=%2Fapps" replace />} />
          <Route path="/login" element={<div data-testid="login-sink" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('path').textContent).toBe('/login?redirect=%2Fapps');
    expect(screen.getByTestId('login-sink')).toBeTruthy();
  });

  it('honours `replace` — a boot redirect must not fossilize `/` in history', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouterProbe />
        <Routes>
          <Route path="/" element={<RedirectWithSplash to="/home" replace />} />
          <Route path="/home" element={<div data-testid="home-sink" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('nav-type').textContent).toBe('REPLACE');
  });

  it('leaves a push a push when the caller omits `replace`', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouterProbe />
        <Routes>
          <Route path="/" element={<RedirectWithSplash to="/home" />} />
          <Route path="/home" element={<div data-testid="home-sink" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('nav-type').textContent).toBe('PUSH');
  });
});
