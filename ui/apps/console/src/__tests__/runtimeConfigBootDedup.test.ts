/**
 * objectui#5544 — one cold load, one `GET /api/v1/runtime/config`.
 *
 * The card measured this endpoint TWICE on prod and twice on staging. The two
 * callers are the pre-React branding script inlined in `index.html` (it must run
 * during parse) and `initRuntimeConfig()` in `@object-ui/app-shell` (awaited
 * before `createRoot().render()`, so it is on the critical path to first paint).
 * Neither can see the other, which is why no per-component guard closes it.
 *
 * objectui#12808 measured it twice again: the first fix shared the request only
 * while it was IN FLIGHT, and the pre-boot request settles hundreds of ms before
 * the bundle asks, so there was never anything to join. The script now keeps its
 * answer for the page's lifetime and `initRuntimeConfig()` takes it once.
 *
 * These tests grade THE SHIPPED ARTIFACT, the same way
 * `insecure-origin-crypto.test.ts` does: the inline script's text is extracted
 * from `index.html` and executed. That is what keeps the slot the script spells
 * out by hand — a classic script cannot import — from drifting away from the
 * reader in `runtime-config.ts`. A drift would not break anything visibly; it
 * would just quietly restore the duplicate, which is exactly the failure a
 * hand-copied contract produces.
 */

import indexHtml from '../../index.html?raw';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initRuntimeConfig,
  getRuntimeConfig,
  resetRuntimeConfigForTesting,
} from '@object-ui/app-shell';
import { resetInflightGetsForTesting } from '@object-ui/types';

/** The `/api/v1/runtime/config` answer, as the server sends it. */
const CONFIG_BODY = {
  cloudUrl: 'https://cloud.example.test',
  singleEnvironment: false,
  branding: { productName: 'Acme Ops', productShortName: 'Acme' },
};

/**
 * The pre-boot script exactly as it ships. Extraction is by the IIFE's name, so
 * renaming or deleting it fails here rather than silently testing nothing.
 */
function extractEarlyBrandingSource(html: string = indexHtml): string {
  const scripts = [
    ...html
      // Comments first — prose describing a script tag parses as one.
      .replace(/<!--[\s\S]*?-->/g, '')
      .matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  const found = scripts.filter((match) => match[1]?.includes('applyEarlyBranding'));
  if (found.length !== 1) {
    throw new Error(
      `expected exactly 1 inline early-branding script in index.html, found ${found.length}`,
    );
  }
  return found[0]?.[1] ?? '';
}

/** Run the shipped pre-boot script, as the browser would during parse. */
function runEarlyBranding(html: string = indexHtml): void {
  new Function(extractEarlyBrandingSource(html))();
}

/**
 * Vite's `%ENV%` substitution over the HTML, as `htmlEnvHook` performs it:
 * `html.replace(/%(\S+?)%/g, ...)`, the value when the key is present and the
 * token VERBATIM when it is not.
 *
 * The `?raw` import above deliberately bypasses that hook — it reads the file
 * off disk — so these tests apply it themselves. That is the only way to grade
 * BOTH halves of the contract from the shipped artifact: the substituted page a
 * split-origin dev serves, and the unsubstituted one every same-origin
 * production build ships.
 */
function applyViteHtmlEnv(html: string, env: Record<string, string>): string {
  return html.replace(/%(\S+?)%/g, (text, key: string) => (key in env ? env[key]! : text));
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(body),
    headers: { get: () => null },
  } as unknown as Response;
}

/** The slot the pre-boot script leaves its answer in (see `index.html`). */
const EARLY_SLOT = Symbol.for('objectui.earlyRuntimeConfig');

/** Let the pre-boot request settle, as it does long before the bundle asks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[EARLY_SLOT];
  resetInflightGetsForTesting();
  resetRuntimeConfigForTesting();
  document.title = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetInflightGetsForTesting();
});

describe('the shipped pre-boot script is findable', () => {
  it('is exactly one inline script in index.html', () => {
    const source = extractEarlyBrandingSource();
    expect(source).toContain('/api/v1/runtime/config');
    expect(source).toContain("Symbol.for('objectui.earlyRuntimeConfig')");
  });

  it('fails loudly if the script is gone rather than passing vacuously', () => {
    expect(() => extractEarlyBrandingSource('<html></html>')).toThrow(/found 0/);
  });
});

describe('one cold load, one runtime/config request', () => {
  it('lets app-shell join the pre-boot request instead of issuing a second one', async () => {
    const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    // Parse-time script, then the module chunk — the real boot order.
    runEarlyBranding();
    await initRuntimeConfig('');

    // ── the duplicate is gone ──
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]![0]).toBe('/api/v1/runtime/config');

    // ── and BOTH consumers still got their data ──
    // A dedup that starved the second caller would show the same call count.
    expect(getRuntimeConfig().cloudUrl).toBe('https://cloud.example.test');
    expect(getRuntimeConfig().branding.productName).toBe('Acme Ops');
    await Promise.resolve();
    await Promise.resolve();
    expect(document.title).toBe('Acme Ops');
  });

  it('reads the pre-boot answer even after it settled — the real gap (objectui#12808)', async () => {
    const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    runEarlyBranding();
    // The bundle arrives well after the parse-time request has settled.
    await settle();
    expect(document.title).toBe('Acme Ops');
    await initRuntimeConfig('');

    // Before the fix this was 2: the in-flight share had nothing left to join.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(getRuntimeConfig().cloudUrl).toBe('https://cloud.example.test');
    expect(getRuntimeConfig().branding.productName).toBe('Acme Ops');
  });

  it('still fetches on its own when the page has no pre-boot script', async () => {
    const fetchStub = vi.fn(async () => jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    // No pre-boot script this time (a tenant runtime serving its own HTML).
    await initRuntimeConfig('');

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(getRuntimeConfig().branding.productName).toBe('Acme Ops');
  });

  it('re-fetches on a later call, keeping the documented repeat-call contract', async () => {
    const fetchStub = vi.fn(async () => jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    runEarlyBranding();
    await initRuntimeConfig('');
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // `initRuntimeConfig` is documented as safe to call again, and a second call
    // must re-fetch and re-merge. The pre-boot answer is taken once, so it
    // does — a later call never replays the boot body.
    await initRuntimeConfig('');
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('CONTROL: a failed pre-boot request still lets app-shell fetch once', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null, 503))
      .mockResolvedValueOnce(jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    runEarlyBranding();
    await settle();
    // The failure is not reused: app-shell asks the server itself, as it did
    // before there was any handoff.
    await initRuntimeConfig('');
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(getRuntimeConfig().branding.productName).toBe('Acme Ops');
  });

  it('CONTROL: a failure on both asks keeps the defaults, boot uninterrupted', async () => {
    const fetchStub = vi.fn(async () => jsonResponse(null, 503));
    vi.stubGlobal('fetch', fetchStub);

    runEarlyBranding();
    await initRuntimeConfig('');
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(getRuntimeConfig().branding.productName).toBe('ObjectOS');
  });
});

/**
 * objectui#5660 — one page, one server origin.
 *
 * Sharing keys on the FULL URL (the slot carries the URL it asked), so the dedup above only ever
 * fires while both callers agree on the origin. They did not: this script read
 * `window.__CONSOLE_SERVER_URL`, which nothing in the repository sets, while
 * `main.tsx` reads `import.meta.env.VITE_SERVER_URL`. Same-origin production
 * hid it completely — both spellings collapse to '' — so the split only ever
 * appeared in a dev pointing the console at a separate server, where it cost
 * two requests to two different servers and pre-boot branding read from the
 * wrong one.
 *
 * These grade the SHIPPED html through Vite's substitution rather than a copy
 * of the script, so a future edit that reintroduces a second spelling of the
 * origin fails here.
 */
describe('one page, one server origin', () => {
  const SERVER = 'https://api.example.test';

  it('sends the pre-boot request to VITE_SERVER_URL, so app-shell joins it', async () => {
    const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    // The page a split-origin dev actually serves.
    runEarlyBranding(applyViteHtmlEnv(indexHtml, { VITE_SERVER_URL: SERVER }));
    // `main.tsx:65` hands `initRuntimeConfig` the same env var.
    await initRuntimeConfig(SERVER);

    // Before the fix this was 2 — '/api/v1/runtime/config' from the inline
    // script and the SERVER-based one from app-shell, two keys, no sharing.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]![0]).toBe(`${SERVER}/api/v1/runtime/config`);
    expect(getRuntimeConfig().branding.productName).toBe('Acme Ops');
  });

  it('normalises trailing slashes the same way app-shell does', async () => {
    const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    runEarlyBranding(applyViteHtmlEnv(indexHtml, { VITE_SERVER_URL: `${SERVER}///` }));
    await initRuntimeConfig(`${SERVER}///`);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]![0]).toBe(`${SERVER}/api/v1/runtime/config`);
  });

  it('falls back to same-origin when the variable is unset, never to the raw token', async () => {
    const fetchStub = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(CONFIG_BODY));
    vi.stubGlobal('fetch', fetchStub);

    // Vite leaves its token verbatim when the variable is unset, and that is the
    // ORDINARY production build. An unsubstituted token must never reach the URL.
    const productionHtml = applyViteHtmlEnv(indexHtml, {});
    expect(extractEarlyBrandingSource(productionHtml)).toContain('%VITE_SERVER_URL%');

    runEarlyBranding(productionHtml);
    await initRuntimeConfig('');

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]![0]).toBe('/api/v1/runtime/config');
    expect(String(fetchStub.mock.calls[0]![0])).not.toContain('%');
  });

  it('reads the origin from one place only — no second spelling survives', () => {
    const source = extractEarlyBrandingSource();
    // The global nothing ever set is gone from the executable text.
    expect(source).not.toContain('window.__CONSOLE_SERVER_URL');
    // And the one it does read is the variable the modules read.
    expect(source).toContain('%VITE_SERVER_URL%');
  });
});
