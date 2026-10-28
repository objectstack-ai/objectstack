// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { createChromiumDriver, STABLE_POLLS, type ChromiumLauncher } from './chromium-driver.js';
import type { PrintSessionCookie } from './principal-session.js';

/**
 * The driver with an injected launcher — no browser, so this file runs on every
 * host. What a real Chromium cannot be made to do on demand is staged here: an
 * engine error that echoes the session cookie, and a browser that stalls.
 */

const COOKIE: PrintSessionCookie = {
  name: 'os.session_token',
  value: 'minted-cookie-value-9f2c.signature',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'lax',
};
const URL_ = 'http://127.0.0.1:3000/_console/apps/showcase/invoice/record/inv_1';
const ENDPOINT_TOKEN = 'endpoint-token-7d1a';

/** A step that never settles: a stalled browser. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

interface Stage {
  goto?: () => Promise<unknown>;
  newContext?: () => Promise<unknown>;
  pdf?: () => Promise<Buffer>;
  connect?: () => Promise<unknown>;
  contextClose?: () => Promise<void>;
  browserClose?: () => Promise<void>;
  serverClose?: () => Promise<void>;
}

function stagedLauncher(stage: Stage) {
  const closed = { context: 0, browser: 0, server: 0, killed: 0 };
  const page = {
    goto: vi.fn(stage.goto ?? (async () => undefined)),
    waitForFunction: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => true),
    pdf: vi.fn(stage.pdf ?? (async () => Buffer.from('%PDF-1.4'))),
  };
  const context = {
    addCookies: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {
      closed.context++;
      if (stage.contextClose) await stage.contextClose();
    }),
  };
  const browser = {
    version: () => '141.0.0.0',
    newContext: vi.fn(stage.newContext ?? (async () => context)),
    close: vi.fn(async () => {
      closed.browser++;
      if (stage.browserClose) await stage.browserClose();
    }),
  };
  const server = {
    wsEndpoint: () => 'ws://127.0.0.1:40001/local-server',
    close: vi.fn(async () => {
      closed.server++;
      if (stage.serverClose) await stage.serverClose();
    }),
    kill: vi.fn(async () => {
      closed.killed++;
    }),
  };
  const launchServer = vi.fn(async (_options: Record<string, unknown>) => server);
  const launcher = {
    launchServer,
    connect: vi.fn(stage.connect ?? (async () => browser)),
    connectOverCDP: vi.fn(stage.connect ?? (async () => browser)),
  } as unknown as ChromiumLauncher;
  return { launcher: async () => launcher, closed, page, browser, launchServer };
}

async function refusalOf(p: Promise<unknown>): Promise<{ code?: unknown; status?: unknown; message: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown; message: string };
    return { code: e.code, status: e.status, message: e.message };
  }
  throw new Error('expected a refusal, the call resolved');
}

describe('the local placement binds its control socket to loopback itself', () => {
  it('launchServer receives host 127.0.0.1 on the boot probe and on every render, never the library default', async () => {
    const { launcher, launchServer } = stagedLauncher({});
    const driver = createChromiumDriver({ placement: 'local', target: '/usr/bin/chromium', consoleUrl: 'x' }, launcher);
    await driver.probe(5_000);
    await driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 5_000 });
    expect(launchServer.mock.calls.map(([options]) => options.host)).toEqual(['127.0.0.1', '127.0.0.1']);
  });
});

describe('the driver redacts the session cookie from an engine error', () => {
  it('an engine error carrying the cookie value answers INTERNAL_ERROR / 500 with it replaced by [redacted]', async () => {
    const { launcher, closed } = stagedLauncher({
      goto: async () => {
        throw new Error(`net::ERR_ABORTED loading ${URL_} with cookie ${COOKIE.name}=${COOKIE.value}`);
      },
    });
    const driver = createChromiumDriver({ placement: 'local', target: '/usr/bin/chromium', consoleUrl: 'x' }, launcher);
    const r = await refusalOf(driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 5_000 }));
    expect([r.code, r.status]).toEqual(['INTERNAL_ERROR', 500]);
    expect(r.message).toContain('[redacted]');
    expect(r.message).not.toContain(COOKIE.value);
    expect(closed).toMatchObject({ context: 1, browser: 1, server: 1, killed: 0 });
  });

  it('a remote endpoint carrying a token is redacted from an engine error, and never named beyond scheme and host', async () => {
    const endpoint = `wss://browser.example.com/devtools?token=${ENDPOINT_TOKEN}`;
    const { launcher } = stagedLauncher({
      connect: async () => {
        throw new Error(`WebSocket error: ${endpoint} 403 Forbidden`);
      },
    });
    const driver = createChromiumDriver({ placement: 'remote', target: endpoint, consoleUrl: 'x' }, launcher);
    const r = await refusalOf(driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 5_000 }));
    expect([r.code, r.status]).toEqual(['INTERNAL_ERROR', 500]);
    expect(r.message).toContain('wss://browser.example.com');
    expect(r.message).not.toContain(ENDPOINT_TOKEN);
  });
});

describe('one budget bounds the whole render', () => {
  for (const [step, stage] of [
    ['opening a context', { newContext: () => never() }],
    ['printing the PDF', { pdf: () => never<Buffer>() }],
  ] as const) {
    it(`a browser that stalls ${step} answers TIMEOUT / 504 within the budget, and what was opened is closed`, async () => {
      const { launcher, closed } = stagedLauncher(stage);
      const driver = createChromiumDriver({ placement: 'remote', target: 'ws://127.0.0.1:9222/x', consoleUrl: 'x' }, launcher);
      const started = Date.now();
      const r = await refusalOf(driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 300 }));
      const elapsed = Date.now() - started;
      expect([r.code, r.status]).toEqual(['TIMEOUT', 504]);
      expect(elapsed).toBeGreaterThanOrEqual(290);
      expect(elapsed).toBeLessThan(2_000);
      expect(closed.browser).toBe(1);
      expect(r.message).not.toContain(COOKIE.value);
    });
  }
});

describe('the cleanup after the deadline is bounded, and nothing opened late is kept', () => {
  const GRACE = 100;

  it('remote: a context and a connection whose close never settles — the call still answers TIMEOUT within budget plus grace', async () => {
    const { launcher, closed } = stagedLauncher({
      pdf: () => never<Buffer>(),
      contextClose: () => never(),
      browserClose: () => never(),
    });
    const driver = createChromiumDriver({ placement: 'remote', target: 'ws://127.0.0.1:9222/x', consoleUrl: 'x' }, launcher, {
      closeGraceMs: GRACE,
    });
    const started = Date.now();
    const r = await refusalOf(driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 300 }));
    const elapsed = Date.now() - started;
    expect([r.code, r.status]).toEqual(['TIMEOUT', 504]);
    expect(elapsed).toBeLessThan(300 + 2 * GRACE + 500);
    expect(closed).toMatchObject({ context: 1, browser: 1 });
  });

  it('local: a browser process whose close never settles is killed, and the call still answers within budget plus grace', async () => {
    const { launcher, closed } = stagedLauncher({
      pdf: () => never<Buffer>(),
      browserClose: () => never(),
      serverClose: () => never(),
    });
    const driver = createChromiumDriver({ placement: 'local', target: '/usr/bin/chromium', consoleUrl: 'x' }, launcher, {
      closeGraceMs: GRACE,
    });
    const started = Date.now();
    const r = await refusalOf(driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 300 }));
    const elapsed = Date.now() - started;
    expect([r.code, r.status]).toEqual(['TIMEOUT', 504]);
    expect(elapsed).toBeLessThan(300 + 4 * GRACE + 500);
    expect(closed).toMatchObject({ server: 1, killed: 1 });
  });

  it('an open that settles after the deadline is closed by the abandoned render, and never given a context', async () => {
    let arrive!: () => void;
    const arrived = new Promise<void>((r) => (arrive = r));
    const ref: { browser?: unknown } = {};
    const { launcher, closed, browser } = stagedLauncher({ connect: () => arrived.then(() => ref.browser) });
    ref.browser = browser;
    const driver = createChromiumDriver({ placement: 'remote', target: 'ws://127.0.0.1:9222/x', consoleUrl: 'x' }, launcher, {
      closeGraceMs: GRACE,
    });
    const r = await refusalOf(driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 200 }));
    expect([r.code, r.status]).toEqual(['TIMEOUT', 504]);
    expect(closed.browser).toBe(0);
    arrive();
    await new Promise((r2) => setTimeout(r2, 50));
    expect(closed.browser).toBe(1);
    expect(browser.newContext).not.toHaveBeenCalled();
  });
});

describe('the ready wait hands the page a function, never a string', () => {
  /**
   * playwright-core evaluates a string predicate with `eval` in the page on
   * EVERY poll, from a timer the page's CSP governs: under the console's
   * default `script-src` (no `'unsafe-eval'`) the second poll throws EvalError
   * and every print fails. CI has no Chromium for the render tests, so this is
   * the guard it runs.
   */
  async function readyWait() {
    const { launcher, page } = stagedLauncher({});
    const driver = createChromiumDriver({ placement: 'remote', target: 'ws://127.0.0.1:9222/x', consoleUrl: 'x' }, launcher);
    await driver.renderPdf({ url: URL_, cookie: COOKIE, timeoutMs: 5_000 });
    expect(page.waitForFunction).toHaveBeenCalledTimes(1);
    const [predicate, arg, options] = page.waitForFunction.mock.calls[0] as unknown as [unknown, unknown, { timeout: number; polling: number }];
    return { predicate, arg, options };
  }

  it('waitForFunction receives a function and the stable-poll count as its argument, polling every 100 ms within the budget', async () => {
    const { predicate, arg, options } = await readyWait();
    expect(typeof predicate).toBe('function');
    expect(arg).toBe(STABLE_POLLS);
    expect(options.polling).toBe(100);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(5_000);
  });

  it('the function means what the wait meant: a data-print-page root AND an idle console, held for STABLE_POLLS polls in a row', async () => {
    const { predicate, arg } = await readyWait();
    const poll = predicate as (stablePolls: unknown) => boolean;
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { document: g.document, __objectui: g.__objectui, stable: g.__objectstackPrintStable };
    let root: unknown = null;
    g.document = { querySelector: (selector: string) => (selector === '[data-print-page]' ? root : null) };
    try {
      // No console yet, then a console that is idle before any print root exists.
      expect(poll(arg)).toBe(false);
      g.__objectui = { idle: true };
      expect(poll(arg)).toBe(false);
      // The root appears, but a request is in flight.
      root = {};
      g.__objectui = { idle: false };
      expect(poll(arg)).toBe(false);
      g.__objectui = { idle: true };
      const run = Array.from({ length: STABLE_POLLS }, () => poll(arg));
      expect(run).toEqual([...Array(STABLE_POLLS - 1).fill(false), true]);
      // A not-ready poll resets the run.
      g.__objectui = { idle: false };
      expect(poll(arg)).toBe(false);
      g.__objectui = { idle: true };
      expect(Array.from({ length: STABLE_POLLS }, () => poll(arg))[STABLE_POLLS - 1]).toBe(true);
      expect(poll(arg)).toBe(true);
    } finally {
      for (const [key, value] of [['document', saved.document], ['__objectui', saved.__objectui], ['__objectstackPrintStable', saved.stable]] as const) {
        if (value === undefined) delete g[key];
        else g[key] = value;
      }
    }
  });
});
