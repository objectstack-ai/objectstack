/**
 * `withConsoleBase` — the console mount prefix for full-page navigations
 * (objectui#4181).
 *
 * This file measures the helper against the THREE mount configurations the
 * console actually ships in, because the bug it exists to prevent is invisible
 * in one of them. Under the default `/` mount the prefixed and unprefixed
 * spellings coincide, which is exactly why `SetupPage` could go without the
 * helper for as long as it did and no `os dev` run ever noticed.
 *
 * The assertion is deliberately not "the helper returns string X". It is where
 * the returned string LANDS once the browser resolves it against the document's
 * base URL — the same resolution `window.location.assign` performs. That is the
 * only form in which the embedded case can be stated honestly: there the helper
 * returns a RELATIVE url (`'./'`), which is correct precisely because the
 * framework CLI injects the `<base href>` it resolves against. A string-equality
 * test would have to assert `'./'` and would tell the reader nothing about
 * whether that lands inside the SPA or outside it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { withConsoleBase, withConsoleBaseRootRelative } from './consoleBase';

let baseEl: HTMLBaseElement | null = null;

/**
 * Configure a console mount.
 *
 * @param href    the `<base href>` the framework CLI injects, or null for a
 *                bare standalone deployment.
 * @param baseUrl what Vite bakes into `import.meta.env.BASE_URL` for that build
 *                (`'/'` in dev, `'./'` for the shipped embeddable build,
 *                `'/_console/'` when pinned via `VITE_BASE_PATH`).
 */
function mountConsole(href: string | null, baseUrl: string): void {
  baseEl?.remove();
  baseEl = null;
  if (href) {
    baseEl = document.createElement('base');
    baseEl.setAttribute('href', href);
    document.head.appendChild(baseEl);
  }
  vi.stubEnv('BASE_URL', baseUrl);
}

/** Where a full-page navigation to `target` actually ends up. */
function lands(target: string): string {
  return new URL(target, document.baseURI).pathname;
}

afterEach(() => {
  baseEl?.remove();
  baseEl = null;
  vi.unstubAllEnvs();
});

describe('withConsoleBase', () => {
  describe('the shipped embeddable build — relative base + injected <base href>', () => {
    // `vite.config.ts` defaults to `base: './'` so one dist/ works under any
    // mount point; Vite 8 resolves that to a literal './' for BASE_URL at build
    // time. The mount is then communicated at RUNTIME by the injected base href.
    it('lands inside the SPA mount', () => {
      mountConsole('/_console/', './');
      expect(lands(withConsoleBase('/'))).toBe('/_console/');
      expect(lands(withConsoleBase('/organizations'))).toBe('/_console/organizations');
    });

    it('THE BUG: an unprefixed path escapes the mount entirely', () => {
      mountConsole('/_console/', './');
      // This is the spelling SetupPage carried at both of its exits. It is a
      // ROOT-relative url, so the base href cannot reel it back in.
      expect(lands('/')).toBe('/');
      expect(lands('/')).not.toBe('/_console/');
    });
  });

  describe('pinned absolute base (VITE_BASE_PATH)', () => {
    it('lands inside the SPA mount', () => {
      mountConsole('/_console/', '/_console/');
      expect(withConsoleBase('/')).toBe('/_console/');
      expect(lands(withConsoleBase('/'))).toBe('/_console/');
      expect(lands(withConsoleBase('/organizations'))).toBe('/_console/organizations');
    });
  });

  describe('the default `/` mount', () => {
    it('is a no-op — which is why the bug is invisible on a standalone run', () => {
      mountConsole(null, '/');
      expect(withConsoleBase('/')).toBe('/');
      expect(withConsoleBase('/organizations')).toBe('/organizations');
      // The prefixed and unprefixed spellings are indistinguishable here.
      expect(lands(withConsoleBase('/'))).toBe(lands('/'));
    });
  });

  describe('paths that already name their own absolute SPA mount', () => {
    it('passes `/_`-prefixed targets through untouched', () => {
      mountConsole('/_console/', '/_console/');
      expect(withConsoleBase('/_studio/apps')).toBe('/_studio/apps');
      expect(withConsoleBase('/_account')).toBe('/_account');
      // Not re-prefixed into `/_console/_studio/apps`.
      expect(lands(withConsoleBase('/_studio/apps'))).toBe('/_studio/apps');
    });
  });

  it('tolerates a relative path by making it absolute against the mount', () => {
    mountConsole('/_console/', '/_console/');
    expect(withConsoleBase('organizations')).toBe('/_console/organizations');
  });
});

/**
 * `withConsoleBaseRootRelative` — the same route as a server-side redirect
 * target (objectui#10893). The server never sees `<base href>`, and
 * better-auth refuses a document-relative `./…` callbackURL with
 * `403 INVALID_CALLBACK_URL` (failing the whole sign-up), so every mount must
 * yield a ROOT-relative path — and it must be the path a full-page navigation
 * to the same route lands on.
 */
describe('withConsoleBaseRootRelative', () => {
  const ROUTE = '/accept-invitation/inv_1';

  it('THE HAZARD it exists for: the embedded build\'s withConsoleBase answer is document-relative', () => {
    mountConsole('/_console/', './');
    expect(withConsoleBase(ROUTE)).toBe('./accept-invitation/inv_1');
  });

  it.each([
    ['the shipped embeddable build', '/_console/', './', '/_console/accept-invitation/inv_1'],
    ['a pinned absolute base', '/_console/', '/_console/', '/_console/accept-invitation/inv_1'],
    ['the default `/` mount', null, '/', '/accept-invitation/inv_1'],
  ])('%s: root-relative, and where a navigation to the route lands', (_name, href, baseUrl, expected) => {
    mountConsole(href, baseUrl);
    const target = withConsoleBaseRootRelative(ROUTE);
    expect(target).toBe(expected);
    expect(target.startsWith('/') && !target.startsWith('//')).toBe(true);
    expect(target).toBe(lands(withConsoleBase(ROUTE)));
  });

  it('keeps the query and hash of the route', () => {
    mountConsole('/_console/', './');
    expect(withConsoleBaseRootRelative('/settings?tab=members#invites')).toBe(
      '/_console/settings?tab=members#invites',
    );
  });

  it('leaves a target that names its own absolute SPA mount untouched', () => {
    mountConsole('/_console/', './');
    expect(withConsoleBaseRootRelative('/_studio/apps')).toBe('/_studio/apps');
  });
});
