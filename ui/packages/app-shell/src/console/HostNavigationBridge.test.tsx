/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The SUPPLY half of objectui#4989 defect 4 — the console handing published
 * renderers its own router-aware navigate through `HostNavigationContext`.
 *
 * The seam alone changes nothing: a renderer that finds no provider keeps its
 * `window.location.assign`, which is exactly the mount-blind behaviour the card
 * filed. So the thing worth pinning here is not that a context exists but that
 * this console's supplier applies the deployment's BASENAME — the whole point of
 * the ruling, and the one property a test inside `plugin-form` structurally
 * cannot see (it has no router, by design).
 *
 * The mount used below (`/_console`) is the one the framework CLI configures for
 * an embedded deployment, and `apps/console/src/App.tsx` passes as
 * `<BrowserRouter basename={BASENAME}>`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useHostNavigation } from '@object-ui/react';
import { HostNavigationBridge } from './HostNavigationBridge';

const MOUNT = '/_console';

/** A stand-in for a renderer that holds an accepted, already-resolved path. */
function RendererStub({ to }: { to: string }) {
  const { navigate } = useHostNavigation();
  return (
    <button type="button" onClick={() => navigate?.(to)}>
      go
    </button>
  );
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="at">{pathname}</div>;
}

/**
 * What a renderer below the bridge sees. Rendered into the DOM rather than
 * captured into an outer variable — assigning during render is a side effect
 * (`react-hooks/globals` refuses it, rightly: it makes the observation depend on
 * when React happens to re-render).
 */
function SeamProbe() {
  const { navigate } = useHostNavigation();
  return (
    <>
      <div data-testid="seam">{typeof navigate}</div>
      <div>content</div>
    </>
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', `${MOUNT}/start`);
});

describe('HostNavigationBridge — the console supplies a basename-aware navigate', () => {
  it('offers a navigate at all (absent is what the defect looked like)', () => {
    render(
      <BrowserRouter basename={MOUNT}>
        <HostNavigationBridge>
          <SeamProbe />
        </HostNavigationBridge>
      </BrowserRouter>,
    );
    expect(screen.getByTestId('seam').textContent).toBe('function');
  });

  it('applies the deployment basename to a rooted in-app path', async () => {
    render(
      <BrowserRouter basename={MOUNT}>
        <HostNavigationBridge>
          <RendererStub to="/thanks" />
        </HostNavigationBridge>
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    // The defect, in one assertion: `window.location.assign('/thanks')` would
    // have put the browser at `/thanks` — OUTSIDE the mounted app. Through this
    // supplier the same string lands at `/_console/thanks`, still inside it.
    await waitFor(() => expect(window.location.pathname).toBe(`${MOUNT}/thanks`));
  });

  it('keeps the transition in-app: the destination route renders, no page load', async () => {
    render(
      <MemoryRouter basename={MOUNT} initialEntries={[`${MOUNT}/start`]}>
        <HostNavigationBridge>
          <Routes>
            <Route path="/start" element={<RendererStub to="/thanks" />} />
            <Route path="/thanks" element={<div>thank you</div>} />
          </Routes>
          <LocationProbe />
        </HostNavigationBridge>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    // A client-side transition, i.e. the host's routing table answered — which
    // is the responsibility a host takes on by supplying the seam.
    await waitFor(() => expect(screen.getByText('thank you')).toBeTruthy());
    expect(screen.getByTestId('at').textContent).toBe('/thanks');
  });

  it('supplies nothing, and does not throw, when mounted with no router above it', () => {
    // A partial tree (a test mounting the shell for something else, a
    // storybook). `useNavigate()` throws outside a router, and turning
    // ConsoleShell's documented "put me inside a BrowserRouter" into a crash
    // would be a behaviour change with no diagnostic value — a router-less
    // console is already broken one component lower. Renderers below simply see
    // the seam's absent state and keep their own fallback.
    expect(() =>
      render(
        <HostNavigationBridge>
          <SeamProbe />
        </HostNavigationBridge>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId('seam').textContent).toBe('undefined');
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('passes `replace` through when the caller asks for it', async () => {
    function ReplacingStub() {
      const { navigate } = useHostNavigation();
      return (
        <button type="button" onClick={() => navigate?.('/thanks', { replace: true })}>
          go
        </button>
      );
    }
    const before = window.history.length;
    render(
      <BrowserRouter basename={MOUNT}>
        <HostNavigationBridge>
          <ReplacingStub />
        </HostNavigationBridge>
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    await waitFor(() => expect(window.location.pathname).toBe(`${MOUNT}/thanks`));
    // Replace, not push: the option is forwarded rather than swallowed by the
    // adapter. (History length is the observable; a push would grow it.)
    expect(window.history.length).toBe(before);
  });
});
