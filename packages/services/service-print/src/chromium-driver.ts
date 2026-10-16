// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describeEndpoint, type PrintPlacement, type ResolvedPrintPlacement } from './config.js';
import { refusalError } from './refusal.js';
import type { PrintSessionCookie } from './principal-session.js';

/**
 * The print service's one engine: headless Chromium, driven through
 * `playwright-core` (pinned exact on this package only), in either placement
 * {@link ResolvedPrintPlacement} names.
 *
 *  - **local** — `chromium.launch({ executablePath })`, one browser per render,
 *    closed in a `finally`.
 *  - **remote** — `chromium.connectOverCDP(endpoint)`, one connection per
 *    render. Closing a connected browser disconnects from it and leaves the
 *    remote browser running; the context this render opened is closed first,
 *    so its cookies leave the remote browser with it.
 *
 * Both placements run the SAME render code after the browser is open — the
 * remote placement is not a second driver, only a second way to reach the one
 * engine.
 *
 * ## What a render waits for
 *
 * The console renders a record on the page bound to it. A page that declares
 * `print` stamps `data-print-page` on its root, and its stylesheet puts only
 * that page on paper (every rule sits inside `@media print`, which `page.pdf`
 * renders under). The console also mirrors its in-flight request count onto
 * `window.__objectui.idle` (ADR-0054 C5). A render prints once BOTH hold, and
 * have held for {@link STABLE_POLLS} polls in a row: `idle` is also true before
 * the first request leaves, so the marker alone or a single idle reading
 * could print a page whose blocks have not loaded yet. Then it waits for the
 * document's fonts, so a glyph is never printed from a fallback that a web
 * font was about to replace.
 *
 * The PDF takes its sheet size and margins from the page's own `@page` rule
 * (`preferCSSPageSize`): the print declaration is mapped to CSS once, by the
 * console, and never a second time here.
 */

/** What a render needs: the page to load, the session to load it as, and its time budget. */
export interface ChromiumRenderInput {
  /** The console URL of the record's print page. */
  url: string;
  /** The requesting user's short-lived session cookie. A secret: never logged. */
  cookie: PrintSessionCookie;
  /** The whole render's time budget, in milliseconds. */
  timeoutMs: number;
}

/** The engine, in one placement. */
export interface ChromiumDriver {
  readonly placement: PrintPlacement;
  /** Open the browser, read its version, close it. Throws when the engine cannot be reached. */
  probe(timeoutMs: number): Promise<{ version: string }>;
  /** Render one page to PDF bytes. Throws an ADR-0112-shaped refusal on a timeout or an engine failure. */
  renderPdf(input: ChromiumRenderInput): Promise<Buffer>;
}

/** How many consecutive ready polls a render waits for before it prints. */
export const STABLE_POLLS = 3;
/** The interval between ready polls, in milliseconds. */
const POLL_INTERVAL_MS = 100;

/** The subset of playwright-core's browser this driver uses. */
interface BrowserHandle {
  version(): string;
  newContext(): Promise<ContextHandle>;
  close(): Promise<void>;
}
interface ContextHandle {
  addCookies(cookies: Array<Record<string, unknown>>): Promise<void>;
  newPage(): Promise<PageHandle>;
  close(): Promise<void>;
}
interface PageHandle {
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>;
  waitForFunction(fn: string, arg: undefined, options: { timeout: number; polling: number }): Promise<unknown>;
  evaluate(fn: string): Promise<unknown>;
  pdf(options: { preferCSSPageSize: boolean; printBackground: boolean }): Promise<Buffer>;
}
interface ChromiumLauncher {
  launch(options: { executablePath: string; headless: boolean; timeout: number }): Promise<BrowserHandle>;
  connectOverCDP(endpoint: string, options: { timeout: number }): Promise<BrowserHandle>;
}

/**
 * The ready predicate, evaluated in the page. A string, not a function, so the
 * page sees exactly this text and nothing from this module's scope.
 */
const PRINT_READY_PREDICATE = `(() => {
  const ready = document.querySelector('[data-print-page]') !== null
    && window.__objectui !== undefined && window.__objectui.idle === true;
  window.__objectstackPrintStable = ready ? (window.__objectstackPrintStable || 0) + 1 : 0;
  return window.__objectstackPrintStable >= ${STABLE_POLLS};
})()`;

const FONTS_READY = `document.fonts.ready.then(() => true)`;

/** `SameSite` as playwright spells it. */
function sameSiteOf(value: PrintSessionCookie['sameSite']): 'Strict' | 'Lax' | 'None' | undefined {
  if (value === 'strict') return 'Strict';
  if (value === 'lax') return 'Lax';
  if (value === 'none') return 'None';
  return undefined;
}

/** The session cookie, scoped to the console's host unless the auth service gave it a domain of its own. */
function cookieFor(url: string, cookie: PrintSessionCookie): Record<string, unknown> {
  const sameSite = sameSiteOf(cookie.sameSite);
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? new URL(url).hostname,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    ...(sameSite ? { sameSite } : {}),
  };
}

function isTimeout(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'TimeoutError';
}

/** A message with every secret this render held replaced, so an engine error can be passed on. */
function redact(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('[redacted]');
  }
  return out;
}

async function loadLauncher(): Promise<ChromiumLauncher> {
  const mod = (await import('playwright-core')) as unknown as { chromium: ChromiumLauncher };
  return mod.chromium;
}

class PlaywrightChromiumDriver implements ChromiumDriver {
  readonly placement: PrintPlacement;

  constructor(
    private readonly resolved: ResolvedPrintPlacement,
    private readonly launcher: () => Promise<ChromiumLauncher>,
  ) {
    this.placement = resolved.placement;
  }

  /** Where the engine is, as a log line may name it. */
  private where(): string {
    return this.placement === 'local'
      ? `the local executable ${this.resolved.target}`
      : `the remote endpoint ${describeEndpoint(this.resolved.target)}`;
  }

  private async open(timeoutMs: number): Promise<BrowserHandle> {
    const chromium = await this.launcher();
    return this.placement === 'local'
      ? chromium.launch({ executablePath: this.resolved.target, headless: true, timeout: timeoutMs })
      : chromium.connectOverCDP(this.resolved.target, { timeout: timeoutMs });
  }

  async probe(timeoutMs: number): Promise<{ version: string }> {
    let browser: BrowserHandle;
    try {
      browser = await this.open(timeoutMs);
    } catch (err) {
      throw new Error(
        `Chromium could not be reached at ${this.where()}: ${redact(String((err as Error)?.message ?? err), [this.resolved.target])}`,
      );
    }
    try {
      return { version: browser.version() };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  async renderPdf(input: ChromiumRenderInput): Promise<Buffer> {
    const secrets = [this.resolved.target, input.cookie.value];
    const started = Date.now();
    const remaining = (): number => Math.max(1, input.timeoutMs - (Date.now() - started));
    let browser: BrowserHandle | undefined;
    let context: ContextHandle | undefined;
    try {
      browser = await this.open(remaining());
      context = await browser.newContext();
      await context.addCookies([cookieFor(input.url, input.cookie)]);
      const page = await context.newPage();
      await page.goto(input.url, { waitUntil: 'load', timeout: remaining() });
      await page.waitForFunction(PRINT_READY_PREDICATE, undefined, { timeout: remaining(), polling: POLL_INTERVAL_MS });
      await page.evaluate(FONTS_READY);
      return await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } catch (err) {
      if (isTimeout(err)) {
        throw refusalError(
          'TIMEOUT',
          504,
          `The print page did not finish loading within ${Math.round(input.timeoutMs / 1000)} s at ${input.url}: ` +
            'the console never showed a print page for the record (a root carrying data-print-page, with no request ' +
            'in flight). Check that the console is served at that URL and reachable from the browser.',
        );
      }
      throw refusalError(
        'INTERNAL_ERROR',
        500,
        `The print engine failed at ${this.where()}: ${redact(String((err as Error)?.message ?? err), secrets)}`,
      );
    } finally {
      // The context first: on the remote placement it holds the session cookie
      // inside a browser this process does not own.
      if (context) await context.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
    }
  }
}

/**
 * The driver for a resolved placement. `launcher` exists for tests that
 * observe the calls; a deployment never passes it.
 */
export function createChromiumDriver(
  resolved: ResolvedPrintPlacement,
  launcher: () => Promise<ChromiumLauncher> = loadLauncher,
): ChromiumDriver {
  return new PlaywrightChromiumDriver(resolved, launcher);
}

export type { ChromiumLauncher, BrowserHandle, ContextHandle, PageHandle };
