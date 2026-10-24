/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `ConsoleShell` SUPPLIES the host navigation seam (objectui#4989 defect 4).
 *
 * `HostNavigationBridge.test.tsx` pins what the bridge does; this file pins that
 * the console actually mounts it, which is a separate fact and the one that can
 * rot silently. The ruling's own words are that "the seam without a supplier
 * changes nothing" — so deleting one line from `ConsoleShell` would restore the
 * whole mount-blind behaviour with every other test in this repository still
 * green. Measured: without this file, that deletion is invisible.
 *
 * Mounted above every console route deliberately, because the renderers that
 * read the seam are reached from many of them and several arrive through
 * `ComponentRegistry`, where the shell never constructs the element and so could
 * not pass a prop.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useHostNavigation } from '@object-ui/react';
import { ConsoleShell } from '../ConsoleShell';

// Same two stubs the sibling ConsoleShell test uses: sonner is a global toast
// surface, and the ADR-0069 remediation gate needs an AuthProvider above it.
// Neither is what this file is about.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
    dismiss: vi.fn(), custom: vi.fn(), loading: vi.fn(), promise: vi.fn(),
  }),
  Toaster: () => null,
}));
vi.mock('../RemediationOverlay', () => ({ RemediationOverlay: () => null }));

const MOUNT = '/_console';

/** A stand-in for a renderer below the shell holding an accepted path. */
function RendererStub() {
  const { navigate } = useHostNavigation();
  const { pathname } = useLocation();
  return (
    <>
      <div data-testid="seam">{typeof navigate}</div>
      <div data-testid="at">{pathname}</div>
      <button type="button" onClick={() => navigate?.('/thanks')}>go</button>
    </>
  );
}

describe('ConsoleShell — the console supplies the host navigation seam', () => {
  it('offers a navigate to every renderer below it', async () => {
    render(
      <MemoryRouter basename={MOUNT} initialEntries={[`${MOUNT}/start`]}>
        <ConsoleShell>
          <RendererStub />
        </ConsoleShell>
      </MemoryRouter>,
    );

    // Absent here is exactly what defect 4 looked like: a renderer with no host
    // navigate falls back to `window.location.assign`, which resolves against
    // the origin root and leaves a mounted console.
    await waitFor(() => expect(screen.getByTestId('seam').textContent).toBe('function'));
  });

  it("wires it to the console's OWN router, not to a stub", async () => {
    render(
      <MemoryRouter basename={MOUNT} initialEntries={[`${MOUNT}/start`]}>
        <ConsoleShell>
          <RendererStub />
        </ConsoleShell>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('seam').textContent).toBe('function'));
    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    // The router this shell is mounted in moved, i.e. the supplied function is
    // that router's `navigate` — which is what makes the deployment's basename
    // apply (asserted against a real URL in `HostNavigationBridge.test.tsx`).
    await waitFor(() => expect(screen.getByTestId('at').textContent).toBe('/thanks'));
  });
});
