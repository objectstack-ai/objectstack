/**
 * objectui#2628 — the console's pre-React boot indicator.
 *
 * These tests grade THE SHIPPED ARTIFACT, following the pattern
 * `insecure-origin-crypto.test.ts` established for this file: the fix is markup
 * plus one inline classic script in `apps/console/index.html`, so the tests
 * read that file through `?raw` and execute the script itself. There is
 * deliberately no TypeScript copy of the logic — a testable duplicate that can
 * drift from the one that ships would be graded green while the real bootstrap
 * rots.
 *
 * ⚠️ WHAT THIS FILE CANNOT SEE. The claim in objectui#2628 is a TIMING one —
 * "no pure-white frame in the window before `LoadingScreen` mounts" — and a
 * jsdom/happy-dom test has no compositor, no frames and no clock that means
 * anything. What is provable here is the STRUCTURE that makes the timing claim
 * possible: the indicator is in the HTML document rather than in the JS chunk
 * whose load IS the window, it is ahead of the module entry, it needs no
 * network to decide its colours, and it is torn down exactly on React's first
 * commit. The timing itself is measured in `e2e/console-boot-indicator.spec.ts`
 * (first-contentful-paint strictly before React mounts, against the real
 * production build) and, pixel-by-pixel, by the CDP screencast run recorded in
 * the pull request. Three instruments, three different things — none of them a
 * substitute for the others.
 */
import indexHtml from '../../index.html?raw';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SPLASH_ID = 'boot-splash';
const SCRIPT_MARKER = 'installBootSplash';
const THEME_STORAGE_KEY = 'vite-ui-theme';
const APP_ENTRY = '/src/main.tsx';

/**
 * The document with HTML COMMENTS REMOVED.
 *
 * Load-bearing, not tidiness, and the same hazard `insecure-origin-crypto.
 * placement.test.ts` records for script tags: the prose in `index.html`
 * DESCRIBES this markup, so it contains the literal strings `<div
 * id="boot-splash">` and `<div id="root">`. Every positional assertion below
 * that reads the raw file finds the COMMENT first and passes without ever
 * looking at the element — measured, while writing these tests.
 */
const documentHtml = indexHtml.replace(/<!--[\s\S]*?-->/g, '');

/** Every `<script>` open tag plus its inline body, in document order. */
function scriptsOf(html: string) {
  return [
    // Comments first: prose describing a script tag parses as one, and this
    // file's comments describe several.
    ...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
  ].map((match) => ({ attrs: match[1] ?? '', body: match[2] ?? '' }));
}

/**
 * The boot-splash script exactly as it ships. Extraction is by the IIFE's name,
 * so renaming or deleting it fails here rather than silently testing nothing.
 */
function extractBootSplashSource(html: string = indexHtml): string {
  const found = scriptsOf(html).filter((script) => script.body.includes(SCRIPT_MARKER));
  if (found.length !== 1) {
    throw new Error(
      `expected exactly 1 inline \`${SCRIPT_MARKER}\` script in index.html, found ${found.length}`,
    );
  }
  return found[0]?.body ?? '';
}

describe('apps/console/index.html — boot splash ships in the DOCUMENT', () => {
  it('puts the indicator in the HTML body, not in a bundled chunk', () => {
    // The whole point of objectui#2628: the gap being covered IS the load of
    // the JavaScript, so an indicator delivered BY that JavaScript cannot paint
    // during it. This assertion is the artifact-level half of that argument —
    // the element is in the document the server returns.
    const body = documentHtml.slice(documentHtml.indexOf('<body>'));
    expect(body).toContain(`id="${SPLASH_ID}"`);
  });

  it('styles it from an inline <style>, so no stylesheet request gates the paint', () => {
    const styles = [...documentHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '');
    expect(styles.some((css) => css.includes(`#${SPLASH_ID}`))).toBe(true);
  });

  it('runs its script BEFORE the parser reaches the element it configures', () => {
    // The ordering that survives the build. Comparing against the application
    // entry does NOT: Vite hoists `<script type="module">` into `<head>`, ahead
    // of `<body>`, so in `dist/index.html` the entry precedes this element
    // (measured: 7925 vs 8626). Harmless — a module script is deferred and
    // cannot run before the parse finishes — but an assertion about it would
    // pass here and be false of the artifact, which is the wrong way round.
    const scriptAt = documentHtml.indexOf(SCRIPT_MARKER);
    const splashAt = documentHtml.indexOf(`id="${SPLASH_ID}"`);
    expect(scriptAt).toBeGreaterThan(-1);
    expect(splashAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(splashAt);
  });

  it('keeps the application entry a module script', () => {
    // Not an ordering claim — the guarantee that makes the ordering above
    // sufficient. A classic entry would execute during parse and could beat the
    // splash to the screen.
    const entry = scriptsOf(indexHtml).find((script) => script.attrs.includes(APP_ENTRY));
    expect(entry, `no script carries ${APP_ENTRY}`).toBeDefined();
    expect(entry?.attrs).toContain('type="module"');
  });

  it('keeps the script a CLASSIC inline script that runs before every `src` script', () => {
    // `type="module"` is deferred and `src=` is a bundled chunk; either turns a
    // parse-time decision into one that happens after the window it governs.
    const all = scriptsOf(indexHtml);
    const index = all.findIndex((script) => script.body.includes(SCRIPT_MARKER));
    expect(index).toBeGreaterThan(-1);
    expect(all[index]?.attrs).not.toContain('type="module"');
    expect(all[index]?.attrs).not.toContain('src=');
    all.forEach((script, i) => {
      if (!script.attrs.includes('src=')) return;
      expect(
        i,
        `script #${i} (${script.attrs.trim()}) is scheduled before the #2628 boot splash`,
      ).toBeGreaterThan(index);
    });
  });

  it('ships no user-facing copy — there is no locale pack to translate it with', () => {
    // The i18n packs live in the bundle this markup is waiting for, so any
    // string here would be untranslatable English in a ten-language product,
    // and a product name would mean waiting for `GET /api/v1/runtime/config`.
    // `LoadingScreen` carries the copy the moment React mounts.
    const body = documentHtml.slice(documentHtml.indexOf('<body>'));
    // From the element's OPENING `<`, not from the id attribute: slicing
    // mid-tag leaves `id="boot-splash" ...>` outside any `<...>` pair, and the
    // tag strip below then reports it as visible copy.
    const idAt = body.indexOf(`id="${SPLASH_ID}"`);
    const splash = body.slice(body.lastIndexOf('<', idAt));
    const markup = splash.slice(0, splash.indexOf('<div id="root">'));
    const text = markup
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(text).toBe('');
  });

  it('does not fetch anything to decide what to draw', () => {
    const source = extractBootSplashSource();
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('XMLHttpRequest');
  });
});

describe('apps/console/index.html — boot splash behaviour', () => {
  let matchMediaSpy: ReturnType<typeof vi.fn> | undefined;

  function mountDocument(): void {
    document.documentElement.removeAttribute('data-boot-theme');
    document.body.innerHTML = `<div id="${SPLASH_ID}"></div><div id="root"></div>`;
  }

  function stubPrefersDark(dark: boolean): void {
    matchMediaSpy = vi.fn((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark') ? dark : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal('matchMedia', matchMediaSpy);
  }

  /** Execute the shipped script against the current document. */
  function runBootSplash(): void {
    new Function(extractBootSplashSource())();
  }

  beforeEach(() => {
    localStorage.clear();
    mountDocument();
    stubPrefersDark(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-boot-theme');
    document.body.innerHTML = '';
  });

  it('marks the boot canvas light when nothing is stored and the OS is light', () => {
    runBootSplash();
    expect(document.documentElement.getAttribute('data-boot-theme')).toBe('light');
  });

  it('marks it dark when the OS prefers dark and no explicit choice is stored', () => {
    stubPrefersDark(true);
    runBootSplash();
    expect(document.documentElement.getAttribute('data-boot-theme')).toBe('dark');
  });

  it("honours ThemeProvider's own storage key for an explicit dark choice", () => {
    // The same key `ThemeProvider` writes. A dark-theme user who saw a LIGHT
    // first frame would get the flash this card exists to remove, just in the
    // other direction.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runBootSplash();
    expect(document.documentElement.getAttribute('data-boot-theme')).toBe('dark');
  });

  it('honours an explicit light choice over a dark OS preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    stubPrefersDark(true);
    runBootSplash();
    expect(document.documentElement.getAttribute('data-boot-theme')).toBe('light');
  });

  it("treats the spec's `auto` and the provider's `system` as following the OS", () => {
    for (const stored of ['auto', 'system']) {
      document.documentElement.removeAttribute('data-boot-theme');
      localStorage.setItem(THEME_STORAGE_KEY, stored);
      stubPrefersDark(true);
      runBootSplash();
      expect(
        document.documentElement.getAttribute('data-boot-theme'),
        `stored theme \`${stored}\` should follow the OS`,
      ).toBe('dark');
    }
  });

  it('leaves the splash up while #root is still empty', async () => {
    runBootSplash();
    // A mutation elsewhere in the document must not be mistaken for a mount.
    document.body.appendChild(document.createElement('span'));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById(SPLASH_ID)).not.toBeNull();
  });

  it("removes the splash on React's first commit into #root", async () => {
    runBootSplash();
    document.getElementById('root')!.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById(SPLASH_ID)).toBeNull();
    // The attribute is scoped to the boot window; leaving it behind would let
    // it collide with the `light`/`dark` class ThemeProvider owns.
    expect(document.documentElement.hasAttribute('data-boot-theme')).toBe(false);
  });

  it('survives a browser with no localStorage access', () => {
    // objectui#7786 — the injected fault has to reach the SCRIPT, not merely
    // the prototype. What stood here was
    //   vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw ... })
    // and it never landed: measured on Node 22.22.2, the version CI pins, with
    // that spy installed a direct `localStorage.getItem(...)` in this very tick
    // does NOT throw. Two independent reasons, both live in this repo:
    //   - happy-dom hands `localStorage` out through a proxy that has already
    //     bound `getItem`, so a prototype patch installed after the store's
    //     method was first reached is invisible to it: `localStorage.getItem`
    //     is a THIRD function object, neither the patched prototype method nor
    //     the pre-patch one;
    //   - `vitest.setup.base.ts` may swap the store for a plain in-memory
    //     object that never inherited from `Storage.prototype` at all.
    // So this case asserted that a NORMAL boot does not throw, under a name
    // promising a blocked browser. The repair is the shape
    // `packages/i18n/src/__tests__/provider-locale-persistence.test.tsx`
    // already uses against the same hazard: replace the binding the script
    // resolves, so the throw is unavoidable however the store is handed out.
    const storedDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const blocked = () => {
      throw new Error('storage blocked');
    };
    // A pre-existing DARK choice, so the theme assertion below discriminates:
    // a boot that still reached storage would read it and mark the canvas dark,
    // while a boot that genuinely cannot read storage falls through to the
    // (light) OS preference. Without it, `light` is also what an empty store
    // produces, and the assertion would hold either way.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: blocked,
        setItem: blocked,
        removeItem: blocked,
        clear: blocked,
        key: blocked,
        length: 0,
      },
    });

    try {
      // COUNTER-PROBE. Before grading anything on the ABSENCE of a throw --
      // which a blind instrument satisfies for the wrong reason -- assert that
      // the fault is observable from exactly where the script reads it.
      expect(
        () => localStorage.getItem(THEME_STORAGE_KEY),
        'the injected fault never reached the store: `localStorage` is still readable here, so everything below would grade an ordinary boot under a name promising a blocked browser',
      ).toThrow('storage blocked');

      expect(() => runBootSplash()).not.toThrow();
      expect(document.documentElement.getAttribute('data-boot-theme')).toBe('light');
    } finally {
      if (storedDescriptor) Object.defineProperty(globalThis, 'localStorage', storedDescriptor);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }

    // Handed back exactly as it was found, so nothing downstream inherits the
    // blocked stub.
    expect(() => localStorage.getItem(THEME_STORAGE_KEY)).not.toThrow();
  });
});
