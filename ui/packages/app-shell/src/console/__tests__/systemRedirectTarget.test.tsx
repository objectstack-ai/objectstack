// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `SystemRedirect` — the legacy `/system*` bookmark forwarder (objectui#3611).
 *
 * ## The defect: the component disagreed with itself
 *
 * The forwarder was already HALF right. It built its target as
 *
 *     suffix ? `/apps/setup/system${suffix}` : '/apps/setup'
 *
 * so every SUFFIXED legacy bookmark (`/system/users`) was correctly forwarded
 * to `/apps/setup/system/users`, while the BARE `/system` bookmark dropped the
 * `system` segment entirely and landed on `/apps/setup`.
 *
 * That segment is not decoration: `AppContent` mounts the system hub only when
 * `isSystemRoute` (`pathname.includes('/system')`) holds, so on a zero-app
 * deployment the bare `/apps/setup` falls through to the "No Apps Configured"
 * empty state — it is that empty state's own URL. The fix makes the bare branch
 * agree with the suffixed branch beside it; it adds no new logic.
 *
 * ## Route shape
 *
 * The route below is spelled exactly as the real consumers spell it
 * (`apps/console/src/App.tsx`, `examples/console-starter/src/App.tsx`):
 * `<Route path="/system/*" />`. The splat also matches the bare `/system`, with
 * an empty splat — which is precisely how the defective branch was reachable.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import { SystemRedirect } from '../ConsoleShell';

/** Reports where the redirect actually landed, including search and hash. */
function Landing() {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="landing">{`${pathname}${search}${hash}`}</div>;
}

function landedFrom(entry: string): string {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        {/* The one route declaration every console consumer ships. */}
        <Route path="/system/*" element={<SystemRedirect />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('landing').textContent ?? '';
}

describe('SystemRedirect legacy bookmark forwarding (objectui#3611)', () => {
  it('THE FIX: the bare /system bookmark lands on the system hub, not the empty state URL', () => {
    expect(landedFrom('/system')).toBe('/apps/setup/system');
  });

  it('REGRESSION: suffixed bookmarks — the half that was already correct — are unchanged', () => {
    expect(landedFrom('/system/users')).toBe('/apps/setup/system/users');
  });

  it('REGRESSION: a deep suffix keeps every segment', () => {
    expect(landedFrom('/system/metadata/object')).toBe('/apps/setup/system/metadata/object');
  });

  it('preserves search and hash on the bare bookmark too', () => {
    // The bare branch is the one that changed, so its query/hash carry-over is
    // worth pinning explicitly rather than inferring it from the suffixed case.
    expect(landedFrom('/system?tab=general#audit')).toBe('/apps/setup/system?tab=general#audit');
  });
});
