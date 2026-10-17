// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { PluginContext } from '@objectstack/core';
import { createChromiumDriver, type ChromiumDriver, type ChromiumLauncher } from './chromium-driver.js';
import { PRINT_SERVICE, PrintServicePlugin } from './print-service-plugin.js';
import type { PrintService } from './print-service.js';
import type { PrintSessionCookie } from './principal-session.js';

/**
 * The one engine, on BOTH placements, against a real headless Chromium.
 *
 *  - **local** — the driver launches the executable itself.
 *  - **remote** — the test spawns that same executable with its DevTools
 *    WebSocket endpoint open, and the driver reaches it ONLY through the remote
 *    placement's code path (`connectOverCDP`), the path a deployment's remote
 *    endpoint takes.
 *
 * The page is a fixture "console" served here: it shows a print page (a root
 * carrying `data-print-page`, settling `window.__objectui.idle` after a fake
 * request) only to a browser that sends the minted session cookie, which is how
 * the real console treats a session it cannot resolve.
 *
 * ## The CJK pin
 *
 * Extracting the PDF's text cannot tell rendered glyphs from empty boxes:
 * measured, `pdftotext` returns the Chinese text from a PDF printed with no
 * CJK font at all. What does tell them apart is the fonts' ToUnicode maps. A
 * glyph Chromium actually drew is embedded with a ToUnicode entry naming its
 * code point; a character drawn as an empty box is the font's `.notdef`, which
 * maps to nothing. So the pin is: every Chinese code point on the page is the
 * target of some embedded font's ToUnicode map. Measured both ways — with the
 * host's CJK font, every code point mapped; with Chromium's fonts narrowed to a
 * Latin-only fontconfig, none did.
 *
 * ## Which Chromium
 *
 * `OS_TEST_PRINT_CHROMIUM_PATH`, else Playwright's provisioned browser
 * (`$PLAYWRIGHT_BROWSERS_PATH/chromium`), whose provisioning installs a CJK
 * font beside it. With neither, the whole file is skipped, and says so: a
 * skipped engine test is not a passed one.
 */

function chromiumUnderTest(): string | undefined {
  const candidates = [
    process.env.OS_TEST_PRINT_CHROMIUM_PATH,
    process.env.PLAYWRIGHT_BROWSERS_PATH ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not this one
    }
  }
  return undefined;
}

const CHROMIUM = chromiumUnderTest();
if (!CHROMIUM) {
  console.warn(
    '[service-print] chromium-driver.test.ts SKIPPED: no Chromium (set OS_TEST_PRINT_CHROMIUM_PATH, or ' +
      'PLAYWRIGHT_BROWSERS_PATH holding a provisioned chromium). The engine was NOT measured on this host.',
  );
}

const COOKIE: PrintSessionCookie = {
  name: 'os.session_token',
  value: 'minted-session-cookie-value',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'lax',
};
const CJK_TEXT = '发票客户名称上海示例有限公司合计金额';
const RECORD_PATH = '/_console/apps/showcase/invoice/record/inv_1';

function printPageHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>@media print { @page { size: A4 portrait; margin: 15mm; } nav { display: none; } }</style>
</head><body><nav>console chrome</nav><div id="root"></div>
<script>
  window.__objectui = { idle: false };
  setTimeout(() => {
    document.getElementById('root').innerHTML =
      '<div data-print-page><h1>Invoice INV-1</h1><p>${CJK_TEXT}</p></div>';
    setTimeout(() => { window.__objectui.idle = true; }, 150);
  }, 150);
</script></body></html>`;
}

const SIGNED_OUT_HTML = `<!doctype html><html><body><div>Sign in</div>
<script>window.__objectui = { idle: true };</script></body></html>`;

interface Fixture {
  server: Server;
  origin: string;
  cookieSeen: string[];
}

async function startFixture(): Promise<Fixture> {
  const cookieSeen: string[] = [];
  const server = createServer((req, res) => {
    const cookie = req.headers.cookie ?? '';
    cookieSeen.push(cookie);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const signedIn = cookie.split(/;\s*/).includes(`${COOKIE.name}=${COOKIE.value}`);
    res.end(req.url === RECORD_PATH && signedIn ? printPageHtml() : SIGNED_OUT_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, origin: `http://127.0.0.1:${port}`, cookieSeen };
}

/** A Chromium the test runs itself, with its DevTools WebSocket endpoint open — the remote placement's far end. */
async function spawnRemoteBrowser(executable: string): Promise<{ child: ChildProcess; endpoint: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'os-print-remote-'));
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--no-sandbox',
      '--no-first-run',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await new Promise<string>((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`no DevTools endpoint: ${stderr.slice(0, 500)}`)), 20_000);
    child.stderr!.on('data', (chunk) => {
      stderr += String(chunk);
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
  });
  return { child, endpoint, dir };
}

/** Every code point some embedded font's ToUnicode map names. */
function toUnicodeTargets(pdf: Buffer): Set<number> {
  const text = pdf.toString('latin1');
  const targets = new Set<number>();
  const stream = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = stream.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    let body: string;
    try {
      body = inflateSync(pdf.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    if (!body.includes('begincmap')) continue;
    for (const block of body.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        targets.add(parseInt(pair[2]!.slice(0, 4), 16));
      }
    }
    for (const block of body.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const lo = parseInt(range[1]!, 16);
        const hi = parseInt(range[2]!, 16);
        const dst = parseInt(range[3]!.slice(0, 4), 16);
        for (let i = 0; i <= hi - lo; i++) targets.add(dst + i);
      }
    }
  }
  return targets;
}

function mediaBox(pdf: Buffer): [number, number] {
  const m = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!m) throw new Error('no MediaBox in the PDF');
  return [Number(m[1]), Number(m[2])];
}

function fakeContext(): { ctx: PluginContext; logged: Array<{ level: string; message: string }>; services: Map<string, unknown> } {
  const logged: Array<{ level: string; message: string }> = [];
  const services = new Map<string, unknown>();
  const ctx = {
    logger: {
      info: (message: string) => logged.push({ level: 'info', message }),
      warn: (message: string) => logged.push({ level: 'warn', message }),
      error: (message: string) => logged.push({ level: 'error', message }),
      debug: () => undefined,
    },
    registerService: (name: string, service: unknown) => services.set(name, service),
    getService: (name: string) => {
      if (!services.has(name)) throw new Error(`service ${name} not found`);
      return services.get(name);
    },
    hook: () => undefined,
  } as unknown as PluginContext;
  return { ctx, logged, services };
}

async function refusalOf(p: Promise<unknown>): Promise<{ code: unknown; status: unknown; message: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown; message: string };
    return { code: e.code, status: e.status, message: e.message };
  }
  throw new Error('expected a refusal, the call resolved');
}

describe.skipIf(!CHROMIUM)('the Chromium engine on both placements', () => {
  let fixture: Fixture;
  let remote: { child: ChildProcess; endpoint: string; dir: string };

  beforeAll(async () => {
    fixture = await startFixture();
    remote = await spawnRemoteBrowser(CHROMIUM!);
  }, 60_000);

  afterAll(async () => {
    fixture?.server.close();
    if (remote) {
      const exited = new Promise<void>((resolve) => {
        if (remote.child.exitCode !== null) resolve();
        else remote.child.once('exit', () => resolve());
      });
      remote.child.kill();
      await exited;
      rmSync(remote.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const placements = (): Array<{ label: 'local' | 'remote'; driver: ChromiumDriver; options: Record<string, string> }> => [
    {
      label: 'local',
      driver: createChromiumDriver({ placement: 'local', target: CHROMIUM!, consoleUrl: `${fixture.origin}/_console` }),
      options: { chromiumPath: CHROMIUM! },
    },
    {
      label: 'remote',
      driver: createChromiumDriver({ placement: 'remote', target: remote.endpoint, consoleUrl: `${fixture.origin}/_console` }),
      options: { browserEndpoint: remote.endpoint },
    },
  ];

  for (const label of ['local', 'remote'] as const) {
    describe(`${label} placement`, () => {
      const pick = () => placements().find((p) => p.label === label)!;

      it('start() probes the engine and logs its placement and Chromium version', async () => {
        const { ctx, logged, services } = fakeContext();
        const plugin = new PrintServicePlugin({ ...pick().options, consoleUrl: `${fixture.origin}/_console` });
        await plugin.init(ctx);
        await plugin.start(ctx);
        const info = logged.filter((l) => l.level === 'info');
        expect(info).toHaveLength(1);
        expect(info[0]!.message).toMatch(new RegExp(`Chromium \\d+\\.\\d+.* on the ${label} `));
        expect(logged.filter((l) => l.level === 'warn')).toHaveLength(0);
        const status = (services.get(PRINT_SERVICE) as PrintService).status();
        expect(status.placement).toBe(label);
        expect(status.version).toMatch(/^\d+\./);
        await plugin.destroy();
      }, 60_000);

      it('renders the print page as the session, on A4 from the page’s own @page rule, with its Chinese glyphs drawn', async () => {
        const before = fixture.cookieSeen.length;
        const pdf = await pick().driver.renderPdf({
          url: `${fixture.origin}${RECORD_PATH}`,
          cookie: COOKIE,
          timeoutMs: 30_000,
        });
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        const [w, h] = mediaBox(pdf);
        expect(Math.round(w)).toBe(595);
        expect(Math.round(h)).toBe(842);
        expect(fixture.cookieSeen.slice(before).some((c) => c.includes(`${COOKIE.name}=${COOKIE.value}`))).toBe(true);

        const targets = toUnicodeTargets(pdf);
        const missing = [...CJK_TEXT].filter((ch) => !targets.has(ch.codePointAt(0)!));
        expect(missing, 'Chinese characters printed as empty boxes (no embedded glyph maps to them)').toEqual([]);
      }, 60_000);

      it('a page that never shows a print root is refused TIMEOUT / 504, not printed', async () => {
        const r = await refusalOf(
          pick().driver.renderPdf({
            url: `${fixture.origin}${RECORD_PATH}`,
            cookie: { ...COOKIE, value: 'a-session-the-console-does-not-know' },
            timeoutMs: 3_000,
          }),
        );
        expect([r.code, r.status]).toEqual(['TIMEOUT', 504]);
        expect(r.message).not.toContain('a-session-the-console-does-not-know');
      }, 60_000);
    });
  }

  it('local: the control socket the driver opens is bound to IPv4 loopback — its wsEndpoint names 127.0.0.1', async () => {
    // The real launcher, recording each server it starts. playwright-core builds
    // `wsEndpoint()` from the listening socket's own `address()`, so it names where
    // the socket is actually bound, not the host that was asked for.
    const { chromium } = (await import('playwright-core')) as unknown as { chromium: ChromiumLauncher };
    const endpoints: string[] = [];
    const recording: ChromiumLauncher = {
      launchServer: async (options) => {
        const server = await chromium.launchServer(options);
        endpoints.push(server.wsEndpoint());
        return server;
      },
      connect: (wsEndpoint, options) => chromium.connect(wsEndpoint, options),
      connectOverCDP: (endpoint, options) => chromium.connectOverCDP(endpoint, options),
    };
    const driver = createChromiumDriver(
      { placement: 'local', target: CHROMIUM!, consoleUrl: `${fixture.origin}/_console` },
      async () => recording,
    );
    const { version } = await driver.probe(30_000);
    expect(version).toMatch(/^\d+\./);
    expect(endpoints).toHaveLength(1);
    expect(new URL(endpoints[0]!).hostname).toBe('127.0.0.1');
  }, 60_000);

  it('remote: the render leaves no context (and so no session cookie) in a browser it does not own, and leaves it running', async () => {
    const driver = placements().find((p) => p.label === 'remote')!.driver;
    await driver.renderPdf({ url: `${fixture.origin}${RECORD_PATH}`, cookie: COOKIE, timeoutMs: 30_000 });
    expect(remote.child.exitCode).toBeNull();
    const { chromium } = (await import('playwright-core')) as unknown as {
      chromium: { connectOverCDP(e: string): Promise<{ contexts(): Array<{ cookies(): Promise<Array<{ value: string }>> }>; close(): Promise<void> }> };
    };
    const browser = await chromium.connectOverCDP(remote.endpoint);
    try {
      for (const context of browser.contexts()) {
        const cookies = await context.cookies();
        expect(cookies.map((c) => c.value)).not.toContain(COOKIE.value);
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
