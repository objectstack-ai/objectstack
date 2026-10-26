/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A collapsed sidebar survives a reload — objectui#4234.
 *
 * `SidebarProvider` wrote `sidebar_state` on every toggle (7-day max-age) and
 * never read it back, so the cookie was present and correct after a reload and
 * nothing consulted it: the sidebar came back expanded (QA measured 255px /
 * `data-state=expanded` at +2s, +4s and +8s, reproduced 3x). Upstream Shadcn
 * reads that cookie in a **server component** and passes it down as
 * `defaultOpen`; the console is a pure SPA with no such step, so the read
 * happens client-side in the provider.
 *
 * ## The precedence these tests pin
 *
 *   controlled `open` prop  >  cookie  >  `defaultOpen` prop  >  `true`
 *
 * The cookie overrides the DEFAULT — never a controlled usage. With no cookie
 * present, `defaultOpen` semantics are unchanged, which is what keeps the
 * `defaultOpen={false}` marketing demos in `apps/site` behaving exactly as
 * before; those cases are controls here and are green on both sides of the fix.
 *
 * ## Why "first render" and not "eventually"
 *
 * The reported symptom is measured at first paint, so a mount effect that
 * collapses after one expanded frame would still be the bug. Every assertion
 * below is therefore synchronous — no `waitFor` — and `renderSequence` pins the
 * state of the FIRST render, which an effect-based implementation would fail
 * (it would record `['expanded', 'collapsed']`).
 *
 * The source-level half of this contract — that the primitive keeps carrying
 * the patch through a `pnpm shadcn:update`, since `src/ui/**` is regenerated —
 * lives in `scripts/__tests__/shadcn-local-patches.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar } from '../ui/sidebar';
import { readSidebarStateCookie } from '../lib/sidebar-cookie';

const COOKIE = 'sidebar_state';

function clearCookies() {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

afterEach(() => {
  // Unstub FIRST — the SSR case stubs `document` away, and `clearCookies`
  // needs the real one back before it can run.
  vi.unstubAllGlobals();
  cleanup();
  clearCookies();
});

/** Records the sidebar state of every render pass, first one first. */
function StateProbe({ sequence }: { sequence: string[] }) {
  const { state } = useSidebar();
  sequence.push(state);
  return null;
}

/**
 * Renders the primitive the way a shell does, and returns the state observed
 * on the very first render pass plus the committed `data-state`.
 *
 * `data-state` is read off the element that actually carries it — `Sidebar`'s
 * outer wrapper, which is also the element QA measured. That element does NOT
 * receive `{...props}` (the primitive spreads those onto an inner div), so it
 * cannot be tagged with a `data-testid`; scoping the query to this render's own
 * `container` is what keeps it unambiguous when a test mounts twice.
 */
function renderSidebar(props: React.ComponentProps<typeof SidebarProvider> = {}) {
  const sequence: string[] = [];
  const { container } = render(
    <SidebarProvider {...props}>
      <StateProbe sequence={sequence} />
      <Sidebar>
        <div>nav</div>
      </Sidebar>
    </SidebarProvider>,
  );
  return {
    sequence,
    // Read synchronously: no waitFor, so a post-mount correction cannot pass.
    state: () => container.querySelector('[data-state]')?.getAttribute('data-state') ?? null,
  };
}

describe('SidebarProvider restores the persisted collapse state (objectui#4234)', () => {
  it('starts collapsed on the first render when the cookie says collapsed', () => {
    document.cookie = `${COOKIE}=false; path=/`;

    const sidebar = renderSidebar();

    // The QA repro: cookie present and false, sidebar must not come back open.
    expect(sidebar.state()).toBe('collapsed');
    // ...and it must never have rendered expanded, not even for one frame.
    expect(sidebar.sequence[0]).toBe('collapsed');
    expect(sidebar.sequence).not.toContain('expanded');
  });

  it('starts expanded on the first render when the cookie says expanded', () => {
    document.cookie = `${COOKIE}=true; path=/`;

    const sidebar = renderSidebar();

    expect(sidebar.state()).toBe('expanded');
    expect(sidebar.sequence[0]).toBe('expanded');
  });
});

describe('precedence: controlled open > cookie > defaultOpen > true', () => {
  it('lets the cookie override an explicit defaultOpen, in both directions', () => {
    document.cookie = `${COOKIE}=true; path=/`;
    const expanded = renderSidebar({ defaultOpen: false });
    expect(expanded.state()).toBe('expanded');
    expect(expanded.sequence[0]).toBe('expanded');

    cleanup();
    clearCookies();

    document.cookie = `${COOKIE}=false; path=/`;
    const collapsed = renderSidebar({ defaultOpen: true });
    expect(collapsed.state()).toBe('collapsed');
    expect(collapsed.sequence[0]).toBe('collapsed');
  });

  it('lets a controlled open prop override the cookie, in both directions', () => {
    document.cookie = `${COOKIE}=false; path=/`;
    const forcedOpen = renderSidebar({ open: true });
    expect(forcedOpen.state()).toBe('expanded');

    cleanup();
    clearCookies();

    document.cookie = `${COOKIE}=true; path=/`;
    const forcedClosed = renderSidebar({ open: false });
    expect(forcedClosed.state()).toBe('collapsed');
  });

  /**
   * The control pin. No cookie ⇒ behaviour is exactly what it was before the
   * fix, which is what the `defaultOpen={false}` demos in `apps/site` rely on.
   * Green on both sides of the change.
   */
  it('honours defaultOpen unchanged when no cookie is present', () => {
    // The precondition is "no persisted preference", which is exactly what the
    // reader reports — not "the substring is absent from the jar". (happy-dom
    // keeps a cleared cookie around as an empty value; an empty value IS no
    // preference, and the assertion should say so rather than describe the
    // host's deletion bookkeeping.)
    expect(readSidebarStateCookie(COOKIE)).toBeUndefined();

    const collapsed = renderSidebar({ defaultOpen: false });
    expect(collapsed.state()).toBe('collapsed');

    cleanup();

    const explicitlyOpen = renderSidebar({ defaultOpen: true });
    expect(explicitlyOpen.state()).toBe('expanded');

    cleanup();

    // `defaultOpen` omitted entirely still defaults to `true`.
    const byDefault = renderSidebar();
    expect(byDefault.state()).toBe('expanded');
  });
});

describe('the write side still works, and round-trips', () => {
  /** Control: the behaviour the issue reported as already correct. */
  it('still writes the cookie on every toggle', () => {
    render(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(document.cookie).toContain(`${COOKIE}=false`);
  });

  /**
   * End-to-end version of the QA repro: collapse it, throw the whole tree away
   * (the reload), mount it again against the cookie that survived.
   */
  it('comes back collapsed after a remount, which is what a reload is', () => {
    const { container } = render(
      <SidebarProvider>
        <SidebarTrigger />
        <Sidebar>
          <div>nav</div>
        </Sidebar>
      </SidebarProvider>,
    );
    const state = () => container.querySelector('[data-state]')?.getAttribute('data-state');
    expect(state()).toBe('expanded');

    fireEvent.click(screen.getByRole('button'));
    expect(state()).toBe('collapsed');

    cleanup();
    expect(document.cookie).toContain(`${COOKIE}=false`);

    const reloaded = renderSidebar();
    expect(reloaded.state()).toBe('collapsed');
    expect(reloaded.sequence[0]).toBe('collapsed');
  });
});

describe('readSidebarStateCookie', () => {
  it('reads only the two values the write side produces', () => {
    document.cookie = `${COOKIE}=true; path=/`;
    expect(readSidebarStateCookie(COOKIE)).toBe(true);

    clearCookies();
    document.cookie = `${COOKIE}=false; path=/`;
    expect(readSidebarStateCookie(COOKIE)).toBe(false);
  });

  it('returns undefined for a value it did not write, so the caller keeps its default', () => {
    for (const value of ['1', '0', 'collapsed', 'TRUE', '']) {
      clearCookies();
      document.cookie = `${COOKIE}=${value}; path=/`;
      expect(readSidebarStateCookie(COOKIE)).toBeUndefined();
    }
  });

  it('returns undefined when the cookie is absent', () => {
    document.cookie = 'unrelated=value; path=/';
    expect(readSidebarStateCookie(COOKIE)).toBeUndefined();
  });

  it('matches the cookie name exactly, not by substring', () => {
    document.cookie = `my_${COOKIE}=false; path=/`;
    document.cookie = `${COOKIE}_v2=false; path=/`;

    expect(readSidebarStateCookie(COOKIE)).toBeUndefined();

    // ...and a neighbour with a confusable name does not shadow the real one.
    document.cookie = `${COOKIE}=true; path=/`;
    expect(readSidebarStateCookie(COOKIE)).toBe(true);
  });

  it('reads a cookie sitting anywhere in the jar', () => {
    document.cookie = 'first=a; path=/';
    document.cookie = `${COOKIE}=false; path=/`;
    document.cookie = 'last=z; path=/';

    expect(readSidebarStateCookie(COOKIE)).toBe(false);
  });

  /**
   * `apps/site` is Next.js and these primitives are `"use client"`, which Next
   * still renders on the SERVER for the initial HTML — where there is no
   * `document`. The guard is load-bearing, not defensive noise.
   */
  it('does not throw where there is no document (SSR)', () => {
    vi.stubGlobal('document', undefined);

    expect(() => readSidebarStateCookie(COOKIE)).not.toThrow();
    expect(readSidebarStateCookie(COOKIE)).toBeUndefined();
  });
});
