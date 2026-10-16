// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { createChromiumDriver, type ChromiumLauncher } from './chromium-driver.js';
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
}

function stagedLauncher(stage: Stage) {
  const closed = { context: 0, browser: 0 };
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
    }),
  };
  const browser = {
    version: () => '141.0.0.0',
    newContext: vi.fn(stage.newContext ?? (async () => context)),
    close: vi.fn(async () => {
      closed.browser++;
    }),
  };
  const launcher = {
    launch: vi.fn(async () => browser),
    connectOverCDP: vi.fn(stage.connect ?? (async () => browser)),
  } as unknown as ChromiumLauncher;
  return { launcher: async () => launcher, closed, page };
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
    expect(closed).toEqual({ context: 1, browser: 1 });
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
