// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A branded app's favicon survives an in-app navigation (objectui#10379).
 *
 * ## The defect this pins shut
 *
 * It is the favicon twin of the title race objectui#8637 removed.
 * `apps/console/src/App.tsx` renders `FaviconSync` as the router's first
 * child, before the shell. Its effect was keyed on `useLocation()` and wrote
 * the operator favicon, `getFaviconUrl()`, onto the icon link on every route
 * change. `AppShell`'s `useAppShellBranding` writes the app's `branding.favicon`
 * from an effect keyed on that URL, so it fires when the branding changes and
 * NOT on navigation. With an operator favicon configured, moving between two
 * pages of the same app ran only the route-keyed writer, and the operator's
 * icon replaced the app's for as long as the user stayed in the app.
 *
 * ## The real subjects, and the one stub
 *
 * `FaviconSync` comes from the console module it ships in and `AppShell` from
 * `@object-ui/layout`, under a real router, so a favicon write put back into
 * `FaviconSync` turns this file red. The operator favicon arrives the way it
 * does in a real boot. The icon link is copied from the shipped `index.html`.
 * The shipped pre-React branding script in that file is executed against a
 * stubbed `GET /api/v1/runtime/config`, and `initRuntimeConfig()` joins its
 * request. So the icon link carries the operator favicon before anything
 * renders, and `getFaviconUrl()` answers from the real runtime-config
 * singleton. `fetch` is the only stub.
 *
 * ⚠️ This is a DOM-level reading of React's effect order under happy-dom, not
 * a browser reading. The first block is the environment control: it proves the
 * boot put the operator favicon up, so a green below is not a vacuous one.
 */

import indexHtml from '../../index.html?raw';
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link, useParams } from 'react-router-dom';
import { AppShell } from '@object-ui/layout';
import {
  getFaviconUrl,
  initRuntimeConfig,
  resetRuntimeConfigForTesting,
} from '@object-ui/app-shell';
import { resetInflightGetsForTesting } from '@object-ui/types';
import { FaviconSync } from '../components/FaviconSync';

/** What an operator configures as `branding.faviconUrl` on the runtime. */
const OPERATOR = '/operator-O.png';
/** Two apps that declare their own `branding.favicon`. */
const APP_A = 'https://cdn.example.test/app-a.svg';
const APP_B = 'https://cdn.example.test/app-b.svg';

/**
 * Each app's `branding.favicon`, the way `ConsoleLayout` hands the active app's
 * branding to `AppShell`. `plain` declares branding (a colour) but no favicon.
 */
const APP_FAVICONS: Record<string, string | undefined> = { a: APP_A, b: APP_B, plain: undefined };

/** The shipped pre-React branding script, found by its IIFE name. */
function extractEarlyBrandingSource(): string {
  const scripts = [
    ...indexHtml
      .replace(/<!--[\s\S]*?-->/g, '')
      .matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  const found = scripts.filter((match) => match[1]?.includes('applyEarlyBranding'));
  if (found.length !== 1) {
    throw new Error(`expected exactly 1 inline early-branding script in index.html, found ${found.length}`);
  }
  return found[0]?.[1] ?? '';
}

/** Puts the icon link that `index.html` ships into `document.head`. */
function addShippedIconLink(): HTMLLinkElement {
  const shipped = new DOMParser().parseFromString(indexHtml, 'text/html').getElementById('favicon');
  if (!shipped) throw new Error('index.html no longer ships an icon link with id="favicon"');
  const link = document.importNode(shipped, true) as HTMLLinkElement;
  document.head.appendChild(link);
  return link;
}

function removeIconLinks() {
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
}

function iconHref(): string | null {
  return document.getElementById('favicon')?.getAttribute('href') ?? null;
}

/**
 * The boot, in its real order: the parse-time script, then the module chunk's
 * `initRuntimeConfig()`, which joins the same request. `faviconUrl: null` is a
 * runtime with no operator favicon configured.
 */
async function boot({ faviconUrl }: { faviconUrl: string | null }) {
  const body = { branding: faviconUrl ? { faviconUrl } : { productName: 'ObjectOS' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => structuredClone(body),
      headers: { get: () => null },
    })),
  );
  addShippedIconLink();
  new Function(extractEarlyBrandingSource())();
  await initRuntimeConfig('');
  // Let the script's own continuation finish before anything renders.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** What the `/apps/:appName/*` route renders: a shell branded from the active app. */
function AppRoute() {
  const { appName = '' } = useParams();
  const favicon = APP_FAVICONS[appName];
  return (
    <AppShell branding={favicon ? { favicon } : { primaryColor: '#3B82F6' }}>
      <Routes>
        <Route index element={<div>first page of {appName}</div>} />
        <Route path="page-2" element={<div>second page of {appName}</div>} />
      </Routes>
    </AppShell>
  );
}

/**
 * Mirrors `App.tsx`: `FaviconSync` sits beside the routes, rendered before
 * them. `syncAfterShell` moves it behind them, to read the other order.
 */
function ConsoleTree({ syncAfterShell = false }: { syncAfterShell?: boolean }) {
  return (
    <>
      {!syncAfterShell && <FaviconSync />}
      <nav>
        <Link to="/apps/a">go to app a</Link>
        <Link to="/apps/a/page-2">go to app a, page 2</Link>
        <Link to="/apps/b">go to app b</Link>
        <Link to="/apps/plain">go to the plain app</Link>
        <Link to="/apps/plain/page-2">go to the plain app, page 2</Link>
        <Link to="/home">leave the apps</Link>
      </nav>
      <Routes>
        <Route path="/apps/:appName/*" element={<AppRoute />} />
        <Route path="/home" element={<div>home, no shell</div>} />
      </Routes>
      {syncAfterShell && <FaviconSync />}
    </>
  );
}

function renderAt(path: string, options: { syncAfterShell?: boolean; strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <ConsoleTree syncAfterShell={options.syncAfterShell} />
    </MemoryRouter>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** Navigation clicks a real `<Link>`, the way the console's own sidebar moves between pages. */
function goTo(label: string) {
  fireEvent.click(screen.getByText(label));
}

beforeEach(() => {
  removeIconLinks();
  resetInflightGetsForTesting();
  resetRuntimeConfigForTesting();
});

afterEach(() => {
  cleanup();
  removeIconLinks();
  vi.unstubAllGlobals();
  resetInflightGetsForTesting();
  resetRuntimeConfigForTesting();
});

describe('environment control', () => {
  it('the shipped boot puts the operator favicon on the shipped icon link before React mounts', async () => {
    await boot({ faviconUrl: OPERATOR });
    // Both halves are needed below: the link is what the tab shows, and
    // `getFaviconUrl()` is what a route-keyed writer would read.
    expect(iconHref()).toBe(OPERATOR);
    expect(getFaviconUrl()).toBe(OPERATOR);
  });

  it('with no operator favicon the shipped link keeps its empty href', async () => {
    await boot({ faviconUrl: null });
    expect(iconHref()).toBe('');
    expect(getFaviconUrl()).toBeUndefined();
  });
});

describe('a branded app keeps its favicon across in-app navigation (objectui#10379)', () => {
  it('entering the app shows its own favicon, the state the defect started from', async () => {
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a');
    expect(iconHref()).toBe(APP_A);
  });

  it('moving to another page of the SAME app leaves the app favicon alone', async () => {
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a');
    expect(iconHref()).toBe(APP_A);

    goTo('go to app a, page 2');
    expect(screen.getByText('second page of a')).toBeTruthy();

    expect(
      iconHref(),
      [
        'The app favicon was replaced after an in-app navigation. A second writer keyed on the',
        'ROUTE is writing the icon link again, which is objectui#10379. While a shell is mounted,',
        '`useAppShellBranding` owns the favicon. A route-keyed writer beside it cannot know the',
        "app's icon, so it can only write the operator favicon over it. Remove the write; do not",
        'try to order the two writers.',
      ].join('\n'),
    ).toBe(APP_A);
  });

  it('moving a third time still leaves it alone, so the write is gone and not merely deferred', async () => {
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a');
    goTo('go to app a, page 2');
    goTo('go to app a');
    expect(screen.getByText('first page of a')).toBeTruthy();
    expect(iconHref()).toBe(APP_A);
  });

  it('switching to another branded app shows that app favicon', async () => {
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a/page-2');
    goTo('go to app b');
    expect(screen.getByText('first page of b')).toBeTruthy();
    expect(iconHref()).toBe(APP_B);
  });
});

describe('leaving the app shows the operator favicon again (objectui#10379)', () => {
  it('the shell hands back the operator favicon it found, with no route-keyed write', async () => {
    // The route-keyed writer used to double as the thing that put the operator
    // favicon back after an app. Since objectui#10040 the shell captures the
    // icon it found on mount and restores it on unmount. This test keeps the two
    // halves together: no route-keyed write, and still the operator icon after
    // the app.
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a');
    goTo('go to app a, page 2');
    goTo('leave the apps');
    expect(screen.getByText('home, no shell')).toBeTruthy();
    expect(iconHref()).toBe(OPERATOR);
  });

  it('after visiting two branded apps, leaving still shows the operator favicon, not the first app', async () => {
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a');
    goTo('go to app b');
    goTo('leave the apps');
    expect(iconHref()).toBe(OPERATOR);
  });

  it('with no operator favicon, leaving restores the empty href the page shipped', async () => {
    await boot({ faviconUrl: null });
    renderAt('/apps/a');
    goTo('go to app a, page 2');
    expect(iconHref()).toBe(APP_A);
    goTo('leave the apps');
    expect(iconHref()).toBe('');
  });
});

describe('an app with no branded favicon keeps the operator favicon', () => {
  it('entering, moving inside and leaving the app all show the operator favicon', async () => {
    // The shell writes no icon when `branding.favicon` is absent. Nothing else
    // may take the operator favicon off the tab either.
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/plain');
    expect(iconHref()).toBe(OPERATOR);

    goTo('go to the plain app, page 2');
    expect(screen.getByText('second page of plain')).toBeTruthy();
    expect(iconHref()).toBe(OPERATOR);

    goTo('leave the apps');
    expect(iconHref()).toBe(OPERATOR);
  });

  it('moving from a branded app to one without a favicon shows the operator favicon', async () => {
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a');
    goTo('go to the plain app');
    expect(screen.getByText('first page of plain')).toBeTruthy();
    expect(iconHref()).toBe(OPERATOR);
  });
});

describe('the result does not depend on the order the writers mount in', () => {
  it('a cold deep link with FaviconSync rendered AFTER the shell still shows the app favicon', async () => {
    // `App.tsx` renders `FaviconSync` before the shell, so a mount write there
    // runs first and the shell captures the operator favicon. Rendered after
    // the shell, any write it makes lands on top of the app icon. With no write
    // at all, the two orders read the same.
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a', { syncAfterShell: true });
    expect(iconHref()).toBe(APP_A);
    goTo('go to app a, page 2');
    expect(iconHref()).toBe(APP_A);
    goTo('leave the apps');
    expect(iconHref()).toBe(OPERATOR);
  });

  it('a cold deep link under StrictMode, as `main.tsx` renders the console, shows the app favicon', async () => {
    // StrictMode runs every effect's cleanup and setup once more after mount,
    // so the shell restores and re-captures. The re-capture must still read the
    // operator favicon, not the app favicon the first setup wrote.
    await boot({ faviconUrl: OPERATOR });
    renderAt('/apps/a', { strict: true });
    expect(iconHref()).toBe(APP_A);
    goTo('go to app a, page 2');
    expect(iconHref()).toBe(APP_A);
    goTo('leave the apps');
    expect(iconHref()).toBe(OPERATOR);
  });
});
