// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describeEndpoint, type PrintPlacement, type ResolvedPrintPlacement } from './config.js';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
import type { PrintSessionCookie } from './principal-session.js';

/**
 * The print service's one engine: headless Chromium, driven through
 * `playwright-core` (pinned exact on this package only), in either placement
 * {@link ResolvedPrintPlacement} names.
 *
 *  - **local** — `chromium.launchServer({ executablePath, host: '127.0.0.1' })`
 *    and a connection to it, one browser process per render. Disposed by
 *    closing the connection and the server; a process whose close does not
 *    settle within {@link CLOSE_GRACE_MS} is killed. The server's control
 *    socket is bound to the IPv4 loopback address by THIS package
 *    ({@link LOCAL_CONTROL_HOST}), never left to playwright-core's default
 *    host: whoever reaches that socket and knows its path drives a browser
 *    signed in as the requesting user, so how far it reaches is decided here,
 *    where a version bump cannot change it without a diff. A host with no IPv4
 *    loopback address cannot open it, and the open fails; it is never bound
 *    anywhere else instead.
 *  - **remote** — `chromium.connectOverCDP(endpoint)`, one connection per
 *    render. The context this render opened is closed first, so its cookies
 *    leave the remote browser with it; then the connection is closed, which
 *    leaves the remote browser running. Each close waits at most
 *    {@link CLOSE_GRACE_MS}: playwright opens a CDP context with
 *    `disposeOnDetach`, so dropping the connection disposes the context even
 *    when the browser no longer answers its close.
 *
 * ## The budget, and what it bounds
 *
 * Every step of a render — open, the context, the cookie, the page, the load,
 * the ready wait, the fonts and the PDF — runs inside ONE deadline (the
 * caller's `timeoutMs`): a browser that stalls on any of them answers
 * `TIMEOUT` / `504` when the deadline passes. The cleanup that follows is
 * bounded too, by {@link CLOSE_GRACE_MS} per close, so the call returns within
 * the budget plus the grace periods even when the browser answers nothing
 * more. A browser that arrives after the deadline (an open that settled
 * late) is disposed by the abandoned render itself, never kept.
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
  waitForFunction(fn: (stablePolls: number) => boolean, arg: number, options: { timeout: number; polling: number }): Promise<unknown>;
  evaluate(fn: string): Promise<unknown>;
  pdf(options: { preferCSSPageSize: boolean; printBackground: boolean }): Promise<Buffer>;
}
/** The subset of playwright-core's browser server this driver uses (local placement). */
interface ServerHandle {
  wsEndpoint(): string;
  close(): Promise<void>;
  kill(): Promise<void>;
}
interface ChromiumLauncher {
  /** `host` is required here so the local placement can never open its control socket on the library's default host. */
  launchServer(options: { executablePath: string; headless: boolean; timeout: number; host: string }): Promise<ServerHandle>;
  connect(wsEndpoint: string, options: { timeout: number }): Promise<BrowserHandle>;
  connectOverCDP(endpoint: string, options: { timeout: number }): Promise<BrowserHandle>;
}

/** How long each close in a cleanup may take before the driver stops waiting for it. */
export const CLOSE_GRACE_MS = 2_000;

/** The address the local placement binds its browser server's control socket to: IPv4 loopback, and only that. */
const LOCAL_CONTROL_HOST = '127.0.0.1';

/** Whether `promise` settles within `ms`; it is never awaited past that. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true, () => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** An open browser, and the bounded way to let go of it. */
interface OpenBrowser {
  browser: BrowserHandle;
  dispose(): Promise<void>;
}

/**
 * The ready predicate, run in the page on every poll. A function, never a
 * string, because of how playwright-core polls: it evaluates the predicate's
 * text with `eval` in the page. A string is evaluated again on every poll, from
 * a page timer, where the page's own CSP applies, so under the console's
 * default `script-src` (no `'unsafe-eval'`) the second poll throws EvalError
 * and every print fails. A function's text is evaluated once, inside the
 * DevTools call that starts the wait, which a page's CSP does not govern; each
 * poll then calls the function that evaluation produced.
 *
 * The page receives the function's text only, so it reads nothing from this
 * module's scope: the poll count arrives as its argument.
 */
function printReady(stablePolls: number): boolean {
  const page = globalThis as unknown as {
    document: { querySelector(selector: string): unknown };
    __objectui?: { idle?: unknown };
    __objectstackPrintStable?: number;
  };
  const ready = page.document.querySelector('[data-print-page]') !== null
    && page.__objectui !== undefined && page.__objectui.idle === true;
  page.__objectstackPrintStable = ready ? (page.__objectstackPrintStable || 0) + 1 : 0;
  return page.__objectstackPrintStable >= stablePolls;
}

const FONTS_READY = `document.fonts.ready.then(() => true)`;

/**
 * An ADR-0112-shaped refusal: an `Error` carrying `code` and `status`. Its codes are from the standard catalog.
 */
function refusalError(code: StandardErrorCode | RegisteredErrorCode, status: number, message: string): Error {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = code;
  err.status = status;
  return err;
}

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
    private readonly closeGraceMs: number,
  ) {
    this.placement = resolved.placement;
  }

  /** Where the engine is, as a log line may name it. */
  private where(): string {
    return this.placement === 'local'
      ? `the local executable ${this.resolved.target}`
      : `the remote endpoint ${describeEndpoint(this.resolved.target)}`;
  }

  private async open(timeoutMs: number): Promise<OpenBrowser> {
    const chromium = await this.launcher();
    const grace = this.closeGraceMs;
    if (this.placement === 'remote') {
      const browser = await chromium.connectOverCDP(this.resolved.target, { timeout: timeoutMs });
      return { browser, dispose: async () => void (await settlesWithin(browser.close(), grace)) };
    }
    const server = await chromium.launchServer({
      executablePath: this.resolved.target,
      headless: true,
      timeout: timeoutMs,
      host: LOCAL_CONTROL_HOST,
    });
    let browser: BrowserHandle;
    try {
      browser = await chromium.connect(server.wsEndpoint(), { timeout: timeoutMs });
    } catch (err) {
      if (!(await settlesWithin(server.close(), grace))) await settlesWithin(server.kill(), grace);
      throw err;
    }
    return {
      browser,
      dispose: async () => {
        await settlesWithin(browser.close(), grace);
        // The process this render launched: closed, or killed when the close
        // does not settle.
        if (!(await settlesWithin(server.close(), grace))) await settlesWithin(server.kill(), grace);
      },
    };
  }

  async probe(timeoutMs: number): Promise<{ version: string }> {
    let opened: OpenBrowser;
    try {
      opened = await this.open(timeoutMs);
    } catch (err) {
      throw new Error(
        `Chromium could not be reached at ${this.where()}: ${redact(String((err as Error)?.message ?? err), [this.resolved.target])}`,
      );
    }
    try {
      return { version: opened.browser.version() };
    } finally {
      await opened.dispose();
    }
  }

  async renderPdf(input: ChromiumRenderInput): Promise<Buffer> {
    const secrets = [this.resolved.target, input.cookie.value];
    const started = Date.now();
    const remaining = (): number => Math.max(1, input.timeoutMs - (Date.now() - started));
    const grace = this.closeGraceMs;
    const held: { opened?: OpenBrowser; context?: ContextHandle } = {};
    let abandoned = false;
    /** Let go of everything this render holds, each close bounded. */
    const release = async (): Promise<void> => {
      const { opened, context } = held;
      held.opened = undefined;
      held.context = undefined;
      // The context first: on the remote placement it holds the session cookie
      // inside a browser this process does not own.
      if (context) await settlesWithin(context.close(), grace);
      if (opened) await opened.dispose();
    };
    /** After a step settles: an abandoned render releases what it just got, and stops. */
    const stillWanted = async (): Promise<void> => {
      if (abandoned) {
        await release();
        throw Object.assign(new Error('the render was abandoned at its deadline'), { name: 'TimeoutError' });
      }
    };
    const render = (async (): Promise<Buffer> => {
      held.opened = await this.open(remaining());
      await stillWanted();
      held.context = await held.opened.browser.newContext();
      await stillWanted();
      await held.context.addCookies([cookieFor(input.url, input.cookie)]);
      const page = await held.context.newPage();
      await page.goto(input.url, { waitUntil: 'load', timeout: remaining() });
      await page.waitForFunction(printReady, STABLE_POLLS, { timeout: remaining(), polling: POLL_INTERVAL_MS });
      await page.evaluate(FONTS_READY);
      return page.pdf({ preferCSSPageSize: true, printBackground: true });
    })();
    // Once the deadline answers, a late rejection of the abandoned render is
    // expected: it is the abandoned render releasing what it opened late.
    render.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('the render budget ran out'), { name: 'TimeoutError' })),
        input.timeoutMs,
      );
    });
    try {
      return await Promise.race([render, deadline]);
    } catch (err) {
      if (isTimeout(err)) {
        throw refusalError(
          'TIMEOUT',
          504,
          `The print page did not finish rendering within ${Math.round(input.timeoutMs / 1000)} s at ${input.url}: ` +
            'the console never showed a print page for the record (a root carrying data-print-page, with no request ' +
            'in flight), or the browser stalled. Check that the console is served at that URL and reachable from the ' +
            'browser.',
        );
      }
      throw refusalError(
        'INTERNAL_ERROR',
        500,
        `The print engine failed at ${this.where()}: ${redact(String((err as Error)?.message ?? err), secrets)}`,
      );
    } finally {
      clearTimeout(timer);
      abandoned = true;
      await release();
    }
  }
}

/**
 * The driver for a resolved placement. `launcher` and `options` exist for
 * tests that stage a browser; a deployment passes neither.
 */
export function createChromiumDriver(
  resolved: ResolvedPrintPlacement,
  launcher: () => Promise<ChromiumLauncher> = loadLauncher,
  options: { closeGraceMs?: number } = {},
): ChromiumDriver {
  return new PlaywrightChromiumDriver(resolved, launcher, options.closeGraceMs ?? CLOSE_GRACE_MS);
}

export type { ChromiumLauncher, BrowserHandle, ContextHandle, PageHandle, ServerHandle };
