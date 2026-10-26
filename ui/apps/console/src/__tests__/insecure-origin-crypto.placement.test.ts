/**
 * objectui#4563 — the shim's PLACEMENT is the fix, not just its code.
 *
 * A `crypto.randomUUID` fallback that runs after a consumer has already called
 * the missing method fixes nothing, so what this file defends is ORDER.
 *
 * The guarantee relied upon is that a CLASSIC inline script executes
 * synchronously during parse, before any module script and therefore before any
 * bundled chunk. The weaker guarantee — document order between two
 * `type="module"` scripts — was tried first and MEASURED to fail: Vite merges
 * multiple HTML module entries into one chunk, whose static imports are hoisted
 * above the merged body, so 16 chunks (`vendor-react`, `ui-components` and
 * `RecordDetailView` among them) evaluated before the shim installed. Document
 * order is real in the browser but it does not survive bundling.
 *
 * Hence the assertions below: the shim must stay a classic inline script, and
 * it must stay ahead of every script that carries a `src`.
 */
// Read through Vite's `?raw` rather than `node:fs`: this app's tsconfig is
// browser-only (`lib: ES2020, DOM`, and `types` without `node`), so a
// `node:fs`/`node:path` import fails `tsc` in the console's build even while
// the test itself passes under Vitest.
import html from '../../index.html?raw';
import { describe, it, expect } from 'vitest';

const SHIM_MARKER = 'installInsecureOriginRandomUuid';
const APP_ENTRY = '/src/main.tsx';

/**
 * Every `<script ...>` open tag plus its inline body, in document order.
 *
 * HTML comments are stripped FIRST, and that is load-bearing rather than
 * tidiness: prose describing a script tag reads as a script tag to any regex,
 * and a comment above this very shim once did exactly that — the parse paired
 * the comment's opening tag with the shim's closing tag and reported the shim
 * as a `type="module" src=...` script. (Measured; this test failed that way.)
 */
const scripts = [
  ...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
].map((match) => ({
  attrs: match[1] ?? '',
  body: match[2] ?? '',
}));

const shimIndex = scripts.findIndex((script) => script.body.includes(SHIM_MARKER));
const entryIndex = scripts.findIndex((script) => script.attrs.includes(APP_ENTRY));

describe('apps/console/index.html — insecure-origin crypto shim placement', () => {
  it('is present at all', () => {
    expect(shimIndex).toBeGreaterThan(-1);
  });

  it('is a CLASSIC inline script, not a module', () => {
    // The whole guarantee rests on this: `type="module"` would make it
    // deferred, and `src=` would make it a bundled chunk. Either turns the
    // synchronous parse-time install into an install that happens too late.
    const shim = scripts[shimIndex];
    expect(shim?.attrs).not.toContain('type="module"');
    expect(shim?.attrs).not.toContain('src=');
  });

  it('runs BEFORE the application entry', () => {
    expect(entryIndex).toBeGreaterThan(-1);
    expect(shimIndex).toBeLessThan(entryIndex);
  });

  it('runs before EVERY script that loads external code', () => {
    // Stronger than the pairwise check: no `src`-carrying script — the entry
    // today, anything added later — may be scheduled ahead of the shim.
    scripts.forEach((script, index) => {
      if (!script.attrs.includes('src=')) return;
      expect(
        index,
        `script #${index} (${script.attrs.trim()}) is scheduled before the #4563 shim`
      ).toBeGreaterThan(shimIndex);
    });
  });

  it('is preceded only by inline classic scripts', () => {
    // Everything before the shim (early branding, the `window.process`
    // polyfill) must itself be inline and classic, so nothing can execute
    // bundled code ahead of the install.
    for (const script of scripts.slice(0, shimIndex)) {
      expect(script.attrs).not.toContain('src=');
      expect(script.attrs).not.toContain('type="module"');
    }
  });

  it('keeps the application entry a module script', () => {
    expect(scripts[entryIndex]?.attrs).toContain('type="module"');
  });
});
