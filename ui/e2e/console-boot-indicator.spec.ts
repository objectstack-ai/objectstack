import { test, expect } from '@playwright/test';
import { CONSOLE_BASE, waitForReactMount } from './helpers';

/**
 * objectui#2628 — the window BEFORE `LoadingScreen` mounts must not be a pure
 * white page.
 *
 * These run against the same production build the rest of this directory uses,
 * which is what makes them worth anything: the gap is the download and
 * evaluation of the real chunk graph (2.21 MB over 64 requests, measured on
 * this build), and a dev server does not have it.
 *
 * ⚠️ WHAT THESE CAN AND CANNOT SEE. Playwright has no frame buffer, so nothing
 * here reads pixels. Two things are observable and both are load-bearing:
 *
 *   1. ORDER — `first-contentful-paint` against the moment React first commits
 *      into `#root`. Before this fix those were the SAME event (the first
 *      content in the document was React's), so `fcp < reactMount` is false by
 *      construction on the old shell and true only when something paints ahead
 *      of the bundle. That is the timing claim, in the only form a browser will
 *      state it.
 *   2. CAUSE — with every script blocked, the page still renders the indicator.
 *      A component-level test cannot distinguish "the skeleton exists" from
 *      "the skeleton can paint during the gap"; blocking the bundle is what
 *      separates them, because the gap IS the bundle.
 *
 * The pixel-level reading — CDP `Page.startScreencast`, every frame classified
 * white/not — is recorded in the pull request rather than here: it needs a
 * throttled network profile per run and is chromium-only.
 */

interface BootProbe {
  fcp?: number;
  reactMountAt?: number;
  splashPresentAtMount?: boolean;
}

declare global {
  interface Window {
    __bootProbe?: BootProbe;
  }
}

const SPLASH = '#boot-splash';

test.describe('Console boot indicator', () => {
  test('ships the indicator in the HTML document, not in a JS chunk', async ({ page, baseURL }) => {
    // The artifact-level half of the argument, read off the SERVED bytes: the
    // gap being covered is the load of the JavaScript, so an indicator that
    // travels with the JavaScript becomes visible exactly when it is no longer
    // needed. It has to be in the document itself.
    const response = await page.request.get(`${baseURL}${CONSOLE_BASE}/`);
    expect(response.ok()).toBe(true);
    // Comments stripped FIRST: the prose in `index.html` describes this markup
    // and contains the literal string `<div id="boot-splash">`, so a raw search
    // finds the COMMENT and passes without ever seeing the element.
    const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');

    // All three parts must travel in the document: the element, the rules that
    // give it a shape and a non-white canvas, and the script that themes it.
    expect(html).toContain('id="boot-splash"');
    expect(html).toMatch(/<style\b[^>]*>[\s\S]*?#boot-splash[\s\S]*?<\/style>/);
    expect(html).toContain('installBootSplash');

    // The script stays a CLASSIC inline script — `type="module"` is deferred
    // and `src=` is a chunk, and either one runs after the frame it governs.
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    const boot = scripts.find((match) => (match[2] ?? '').includes('installBootSplash'));
    expect(boot, 'no inline installBootSplash script in the served document').toBeDefined();
    expect(boot?.[1]).not.toContain('type="module"');
    expect(boot?.[1]).not.toContain('src=');

    // ...and it precedes the element it configures, so the first painted frame
    // already carries the right canvas colour.
    //
    // NOTE the comparison this deliberately does NOT make: the application
    // entry is NOT after the splash in the built document. Vite hoists
    // `<script type="module">` into `<head>`, ahead of `<body>` entirely
    // (measured: entry at 7925, element at 8626). That is harmless because a
    // module script is DEFERRED — it cannot execute before the parser is done —
    // and asserting document order against it would fail on the artifact while
    // passing against the source, which is the reverse of useful.
    expect(html.indexOf('installBootSplash')).toBeLessThan(html.indexOf('id="boot-splash"'));
  });

  test('renders the indicator with the app bundle blocked', async ({ page }) => {
    // Deterministic version of the window this card is about: no script ever
    // arrives, so nothing React could have drawn is on screen. Whatever is
    // visible here is visible during the real gap too.
    await page.route('**/*.js', (route) => route.abort());

    await page.goto(`${CONSOLE_BASE}/`);
    const splash = page.locator(SPLASH);
    await expect(splash).toBeVisible();

    // Something occupies the middle of the viewport — not the bare body.
    const centreTag = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` : null;
    });
    expect(centreTag).not.toBeNull();
    expect(centreTag).not.toBe('body');
    expect(centreTag).not.toBe('html');

    // And the canvas it draws on is the app's own background token, resolved
    // from the inline <style> — not the user agent's white.
    const background = await splash.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    expect(background).not.toBe('rgb(255, 255, 255)');

    // The mark itself has real geometry, so "not white" is not just a tinted
    // empty page.
    const tile = page.locator(`${SPLASH} .boot-splash-tile`);
    const box = await tile.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
  });

  test('paints content BEFORE React mounts, and hands over without a gap', async ({
    page,
    browserName,
  }) => {
    // WebKit does not implement the Paint Timing API, so this reading is not
    // available there. Skipping is the honest outcome — the other two tests in
    // this file still run on every browser.
    test.skip(browserName === 'webkit', 'no Paint Timing API in WebKit');

    await page.addInitScript(() => {
      const probe: BootProbe = {};
      window.__bootProbe = probe;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name === 'first-contentful-paint' && probe.fcp === undefined) {
              probe.fcp = entry.startTime;
            }
          }
        }).observe({ type: 'paint', buffered: true });
      } catch {
        /* reported as an undefined fcp below, never as a pass */
      }
      // Registered from an init script, so it is ahead of the page's own
      // handoff observer and sees the DOM as React leaves it, before the
      // splash is torn down.
      const observer = new MutationObserver(() => {
        const root = document.getElementById('root');
        if (!root || !root.firstChild) return;
        observer.disconnect();
        probe.reactMountAt = performance.now();
        probe.splashPresentAtMount = document.getElementById('boot-splash') !== null;
      });
      // `document`, NOT `document.documentElement`: an init script runs at
      // document-start, where there is no `<html>` element yet and the
      // observe() call throws. (Measured — it made this probe time out.)
      observer.observe(document, { childList: true, subtree: true });
    });

    await page.goto(`${CONSOLE_BASE}/`);
    await waitForReactMount(page);

    // A paint follows the commit we just observed; on a REGRESSED build the
    // first contentful paint IS that one, so it has not been reported yet at
    // this instant. Waiting for it here is what makes the failure below say
    // "fcp did not precede the commit" instead of "there was no fcp" — the
    // second sentence is true on a regression but names the wrong subject.
    await page
      .waitForFunction(() => window.__bootProbe?.fcp !== undefined, null, { timeout: 15_000 })
      .catch(() => {
        /* absence is graded by the assertion below, which says what it means */
      });

    const probe = await page.evaluate(() => window.__bootProbe);
    expect(probe?.fcp, 'no first-contentful-paint was reported').toBeDefined();
    expect(probe?.reactMountAt, "React's first commit was not observed").toBeDefined();

    const fcp = probe?.fcp ?? Number.POSITIVE_INFINITY;
    const mount = probe?.reactMountAt ?? 0;
    expect(
      fcp,
      `first-contentful-paint (${Math.round(fcp)}ms) must precede React's first commit ` +
        `(${Math.round(mount)}ms). Equal or later means nothing painted during the bundle ` +
        `load and the white frame of objectui#2628 is back.`,
    ).toBeLessThan(mount);

    // The window is covered for its whole length: the indicator was still up at
    // the instant React committed, so there is no frame between the two.
    expect(
      probe?.splashPresentAtMount,
      'the boot indicator was already gone when React committed — that gap is a white frame',
    ).toBe(true);

    // ...and it is gone immediately afterwards, so `LoadingScreen` never shares
    // the screen with a second indicator.
    await expect(page.locator(SPLASH)).toHaveCount(0);
  });
});

/**
 * objectui#6378 — the window AFTER `LoadingScreen` has painted.
 *
 * A different window from the one above, and independent of it: #2628 covers
 * the gap BEFORE React commits (the bundle download), and this one is a
 * fully-white frame that appears after the splash has already painted, on
 * roughly one boot in three.
 *
 * ⚠️ WHAT THIS CAN AND CANNOT SEE — the same caveat as the tests above, applied
 * to a defect that is intermittent by nature. Playwright has no frame buffer, so
 * this asserts nothing about pixels; the pixel ledger (CDP
 * `Page.startScreencast` at everyNthFrame:1, every frame classified white/not)
 * is recorded in the pull request, as it is for #2628.
 *
 * What IS observable here, and is the whole mechanism: whether the DOM ever
 * holds nothing for the viewport to show. The flash is intermittent only
 * because it depends on the compositor happening to swap a frame inside the
 * window — the WINDOW ITSELF was present on every measured boot. So the DOM
 * reading is the deterministic half of an intermittent defect, which makes it
 * the right thing to gate on: it goes red on the broken build every time,
 * where a pixel assertion would go red about one run in three.
 *
 * The window is produced by the console's boot redirects. Every readiness gate
 * renders the splash while it WAITS and a bare `<Navigate>` the moment it
 * DECIDES; `<Navigate>` renders null and react-router runs the navigation as a
 * transition, so the destination tree renders while the commit that dropped the
 * splash is already on screen. Measured on the production bundle: 41–147 ms of
 * empty `#root`.
 *
 * ## What this boot reaches, and what it does not (objectui#6507)
 *
 * The mocked boot below is SIGNED OUT, which is what makes it short enough to
 * be deterministic: `/console/` takes the catch-all redirect, then the auth
 * gate's redirect to `/login`. Those are two of the three sites #6506 fixed.
 *
 * #6507 converted seven further gates, and every one of them decides only AFTER
 * a session exists — `RequireOrganization` (no active org), `RequireAiSurface`
 * (a runtime serving no agent), `SetupRedirect` (the `/setup` deep link) and
 * `AppContent`'s no-accessible-app bounce all sit behind `ProtectedRoute`, so a
 * signed-out boot bounces to `/login` before reaching any of them. One more —
 * `AuthenticatedRoute` — is published by `@object-ui/app-shell` for consumers
 * and is not mounted by `apps/console` at all (it uses its own
 * `ProtectedRoute`), so no boot of THIS bundle can reach it at any session
 * state. The published `/` element that used to sit beside it in that sentence
 * was removed by objectui#10042: `/`'s only resolver is the console's own
 * `RootLandingRedirect`, which this bundle does mount.
 *
 * A signed-in mock boot for the first four WAS built and run, and the result is
 * the reason no per-site case was added here: those scenarios stay GREEN against
 * a bundle rebuilt from ablated source — with the fix removed — and they stay
 * green under 20x CPU throttling too. They do not bind to the defect, so
 * committing them would have added a gate that cannot fail.
 *
 * The diagnosis is not a missing browser. A browser is available and this file
 * runs against the production bundle; the acceptance spec passes. What is
 * missing is a reproducible WINDOW: the pre-React `#boot-splash` counts as
 * covering, and on those mocked boots the redirect chain resolves before the
 * indicator is torn down, so at the moment the gate decides there is no blank
 * for a sampler to catch. Making a per-site e2e gate that CAN fail therefore
 * needs the window reproduced with the indicator already gone — not more
 * endpoints, and not a browser.
 *
 * Until such a gate exists, those sites are pinned at the DOM level, one file
 * per population, with an explicit control arm that must read "covered" so an
 * "empty" reading stays falsifiable:
 * `packages/app-shell/src/console/__tests__/bootRedirectCoverage.test.tsx` and
 * `…/AppContent.bootRedirectCoverage.test.tsx`. Those measure the deciding
 * COMMIT rather than the milliseconds, and under the ablation above they turn
 * red where the e2e scenarios did not.
 */
interface CoverProbe {
  reactMountAt?: number;
  /**
   * Samples taken at every mutation and every animation frame after mount.
   * `why` records what the named hosts held at that instant, so a red run says
   * whether the viewport was really empty or merely hidden behind something.
   */
  uncovered: Array<{ t: number; centre: string | null; path: string; why: string }>;
  covered: number;
  lastSampleAt?: number;
}

declare global {
  interface Window {
    __coverProbe?: CoverProbe;
  }
}

test.describe('Console boot continuity', () => {
  test('never hands the viewport to an empty document between splash and destination', async ({
    page,
  }) => {
    // Boot endpoints mocked so the boot RESOLVES rather than sitting on the
    // splash forever — an unresolved boot never reaches the handoff this test
    // is about, and would pass it vacuously. Signed-out is the shortest
    // complete boot: `/console/` is not a route the router knows (the built
    // document carries no `<base href>`, so the basename is `/`), so it takes
    // the catch-all redirect, then the auth gate's redirect to `/login` —
    // two of the three redirects this fix covers, in one boot.
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (body: unknown) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      if (path.endsWith('/api/v1/runtime/config')) {
        return json({ success: true, data: { productName: 'ObjectOS', logoUrl: '', faviconUrl: '' } });
      }
      if (path.includes('/api/v1/i18n/locales')) return json({ success: true, data: [{ code: 'en', name: 'English' }] });
      if (path.includes('/api/v1/i18n/translations')) return json({ success: true, data: {} });
      if (path.includes('/api/v1/auth/get-session')) return json(null);
      if (path.includes('/api/v1/discovery')) {
        return json({ name: 'ObjectStack', mode: 'production', services: { auth: { status: 'ok', handlerReady: true } } });
      }
      return json({ success: true, data: null });
    });

    await page.addInitScript(() => {
      const probe: CoverProbe = { uncovered: [], covered: 0 };
      window.__coverProbe = probe;

      // "Covered" = a hit test at the viewport centre lands on something the
      // app is responsible for. The pre-React indicator is a SIBLING of
      // `#root`, not a child, so it is named explicitly: during the handoff
      // both are legitimately on screen and either one alone is enough.
      //
      // ⚠️ THE HIT TEST ALONE READS AN OPEN MODAL AS A BLANK VIEWPORT
      // (objectui#6578, measured on #6570's fixture). A Radix `DialogPortal`
      // renders the overlay and the dialog as body-level SIBLINGS of `#root`,
      // so the centre hit test lands outside both named hosts; and
      // `DismissableLayer` parks `pointer-events: none` on the body while a
      // modal layer is open, and hit testing skips those elements, so `#root`
      // and its whole subtree leave the stack — reading the full
      // `elementsFromPoint` does not rescue it either. Measured, 20/20 boots:
      // `#root` holding 2 children, a 1280x720 box and 196 characters of
      // rendered text, with not one element of it anywhere in the hit stack.
      // A modal `DropdownMenu` is the same shape without an overlay: there the
      // centre element is the bare `html`, so a portal-aware hit test does not
      // rescue it either (measured on the four control arms of #6578).
      //
      // So when the hit test says "uncovered", ask the second question — the
      // one the defect is actually about: does a named host still HOLD the
      // sample point with something rendered inside it? objectui#6378's window
      // is an EMPTY `#root`, which answers NO and stays red; an app underneath
      // a portal answers YES.
      //
      // Deliberately consulted only AFTER the hit test has already failed. It
      // costs nothing on a covered sample, and it can only ever reclassify a
      // sample the old rule called uncovered — it can never turn a covered
      // sample into an uncovered one, so nothing this file already asserts is
      // weakened by it.
      const hostHoldsPoint = (host: HTMLElement | null, cx: number, cy: number) => {
        if (!host) return false;
        const box = host.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        if (cx < box.left || cx >= box.right || cy < box.top || cy >= box.bottom) return false;
        // Geometry is not paint. A box survives `visibility: hidden`, a zero
        // `opacity` and `content-visibility: hidden`, and none of those put a
        // pixel on the screen — so the whole ancestor chain is asked, not just
        // the host.
        for (let node: Element | null = host; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none') return false;
          if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
          if (Number(style.opacity) === 0) return false;
          if (style.getPropertyValue('content-visibility') === 'hidden') return false;
        }
        return true;
      };

      const hostHasRenderedContent = (host: HTMLElement | null) => {
        if (!host || host.childElementCount === 0) return false;
        // `innerText`, NOT `textContent`: it is layout-aware, so it is empty
        // for a subtree that is not being rendered. That is the reading wanted
        // here — `textContent` would answer about the source instead.
        if ((host.innerText || '').trim().length > 0) return true;
        // A tree that paints images or a canvas and no text still counts.
        for (const descendant of host.querySelectorAll('*')) {
          const box = descendant.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) return true;
        }
        return false;
      };

      const appStillHoldsPoint = (cx: number, cy: number) => {
        for (const id of ['root', 'boot-splash']) {
          const host = document.getElementById(id);
          if (hostHoldsPoint(host, cx, cy) && hostHasRenderedContent(host)) return true;
        }
        return false;
      };

      /** What the named hosts held at a sample the rule called uncovered. */
      const describeHosts = (cx: number, cy: number) => {
        const parts: string[] = [];
        for (const id of ['root', 'boot-splash']) {
          const host = document.getElementById(id);
          if (!host) {
            parts.push(`#${id} absent`);
            continue;
          }
          const box = host.getBoundingClientRect();
          parts.push(
            `#${id} ${Math.round(box.width)}x${Math.round(box.height)}, ` +
              `${host.childElementCount} child element(s), ` +
              `${(host.innerText || '').trim().length} chars of rendered text, ` +
              `holds the sample point: ${hostHoldsPoint(host, cx, cy)}`,
          );
        }
        return parts.join('; ');
      };

      const sample = (t: number) => {
        const cx = Math.floor(window.innerWidth / 2);
        const cy = Math.floor(window.innerHeight / 2);
        const el = document.elementFromPoint(cx, cy);
        const hit = !!el && !!(el.closest('#root') || el.closest('#boot-splash'));
        const ok = hit || appStillHoldsPoint(cx, cy);
        probe.lastSampleAt = t;
        if (ok) probe.covered++;
        else {
          probe.uncovered.push({
            t,
            centre: el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') : null,
            path: location.pathname,
            why: describeHosts(cx, cy),
          });
        }
      };

      const observer = new MutationObserver(() => {
        const root = document.getElementById('root');
        if (probe.reactMountAt === undefined && root && root.firstChild) {
          probe.reactMountAt = performance.now();
        }
        // Only from React's first commit: before it, coverage is #2628's
        // subject and is asserted by the tests above.
        if (probe.reactMountAt !== undefined) sample(performance.now());
      });
      // `document`, NOT `document.documentElement` — an init script runs at
      // document-start, where there is no `<html>` element yet and the
      // observe() call throws (measured, in the test above).
      observer.observe(document, { childList: true, subtree: true });

      // A mutation log alone cannot see a window that outlives the commit that
      // opened it, which is exactly this defect's shape: one commit empties the
      // tree and the next one fills it, tens of frames later. The frame loop is
      // what samples the time in between.
      const tick = () => {
        if (probe.reactMountAt !== undefined) sample(performance.now());
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.goto(`${CONSOLE_BASE}/`);
    await waitForReactMount(page);

    // GHOST-ASSERTION GUARD. "Nothing uncovered" is also true of a page that
    // never booted, never redirected, or was observed too late — so the boot is
    // required to have COMPLETED, on its own evidence, before the invariant
    // below is allowed to mean anything.
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 30_000 });
    // ...and let the last frames of the handoff be sampled.
    await page.waitForTimeout(500);

    const probe = await page.evaluate(() => window.__coverProbe);
    expect(probe?.reactMountAt, "React's first commit was not observed").toBeDefined();
    expect(probe?.covered ?? 0, 'the coverage probe never sampled a covered frame').toBeGreaterThan(5);

    const uncovered = probe?.uncovered ?? [];
    const window0 = uncovered[0];
    const spanMs = uncovered.length
      ? Math.round(uncovered[uncovered.length - 1].t - uncovered[0].t)
      : 0;
    expect(
      uncovered.length,
      `the viewport was empty for ${uncovered.length} sample(s) spanning ~${spanMs}ms after React's ` +
        `first commit — first at t=${Math.round(window0?.t ?? 0)}ms on ${window0?.path} with the ` +
        `centre hit test landing on <${window0?.centre}> and the named hosts holding ` +
        `[${window0?.why}]. A boot redirect that renders null hands the screen back to the bare ` +
        `page background; that is the white flash of objectui#6378. This is NOT the open-modal ` +
        `false positive of objectui#6578 — that one is filtered above, and the host reading in ` +
        `this message is what tells the two apart.`,
    ).toBe(0);
  });
});
