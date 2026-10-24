// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console document's `content-security-policy`.
 *
 * The Console keeps its session token where any script on the page can read
 * it, so the document is served with a nonce-based `script-src`: a fresh nonce
 * per response, named in the header and stamped on every `<script>` the
 * document carries. These cases run the REAL plugin on a REAL Hono app (the
 * `HonoHttpServer` production resolves as `http.server`); the error-reporting
 * case adds the REAL `RuntimeConfigPlugin`, so the `connect-src` follows what
 * that door serves.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { RuntimeConfigPlugin } from '@objectstack/cloud-connection';

import { createConsoleStaticPlugin } from './console.js';

const ORIGIN = 'http://csp.example.test';

/**
 * The shell's script shapes, as objectui ships them: classic inline scripts in
 * the head, one of them mentioning a closing tag inside a string, and the
 * module entry with attributes.
 */
const SHELL = [
  '<!doctype html><html><head><meta charset="UTF-8"><title></title>',
  '<script>window.early = 1;</script>',
  '<SCRIPT>window.shim = "</" + "script>";</SCRIPT>',
  '<style>#boot-splash{display:flex}</style>',
  '<script type="module" crossorigin src="./assets/index-BQWjE1TW.js"></script>',
  '</head><body><div id="root"></div></body></html>',
].join('\n');

/** The environment this suite sets; each test starts with all of it unset and leaves it as it found it. */
const ENV = [
  'OS_PAGE_REACT',
  'OS_CONSOLE_CSP_CONNECT_SRC',
  'OS_CLOUD_URL',
  'OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN',
];

let saved: Record<string, string | undefined>;
let consoleRoot: string;
let distPath: string;

beforeAll(() => {
  consoleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-csp-'));
  distPath = path.join(consoleRoot, 'dist');
  fs.mkdirSync(path.join(distPath, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distPath, 'index.html'), SHELL);
  fs.writeFileSync(path.join(distPath, 'assets', 'index-BQWjE1TW.js'), 'export {};');
});

afterAll(() => {
  fs.rmSync(consoleRoot, { recursive: true, force: true });
});

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
});

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

async function mount(opts: { runtimeConfig?: ConstructorParameters<typeof RuntimeConfigPlugin>[0] } = {}) {
  const server = new HonoHttpServer(0);
  server.installNotFoundSeam();
  const logger = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} };
  if (opts.runtimeConfig) {
    const hooks: Array<() => Promise<void>> = [];
    await new RuntimeConfigPlugin(opts.runtimeConfig).start({
      hook: (name: string, fn: () => Promise<void>) => { if (name === 'kernel:ready') hooks.push(fn); },
      getService: (name: string) => {
        if (name === 'http.server') return server;
        throw new Error(`no service ${name}`);
      },
      logger,
    } as any);
    for (const fn of hooks) await fn();
  }
  await createConsoleStaticPlugin(distPath).start({ getServiceAsync: async () => server, logger });
  const app = server.getRawApp();
  return async (p: string, init?: RequestInit): Promise<Response> => app.request(`${ORIGIN}${p}`, init);
}

/** The policy's directives by name; a directive named twice fails. */
function directives(policy: string | null): Map<string, string[]> {
  expect(policy, 'content-security-policy header').toBeTruthy();
  const map = new Map<string, string[]>();
  for (const part of policy!.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    expect(map.has(name), `${name} named twice`).toBe(false);
    map.set(name, sources);
  }
  return map;
}

/** The nonce `script-src` names; exactly one. */
function headerNonce(policy: string | null): string {
  const nonces = directives(policy).get('script-src')!.filter((s) => s.startsWith("'nonce-"));
  expect(nonces).toHaveLength(1);
  return nonces[0].slice("'nonce-".length, -1);
}

/** Every `<script` start tag in `html`, whatever its case. */
function scriptTags(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
}

describe('the console document is served with a nonce-based content-security-policy', () => {
  it('names the policy\'s fixed directives on the document', async () => {
    const request = await mount();
    const res = await request('/_console/');
    expect(res.status).toBe(200);
    const policy = directives(res.headers.get('content-security-policy'));

    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(expect.arrayContaining(["'self'", "'wasm-unsafe-eval'"]));
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'", 'https://demotiles.maplibre.org']);
  });

  it('stamps every <script> in the served document with the nonce the header names', async () => {
    const request = await mount();
    const res = await request('/_console/');
    const nonce = headerNonce(res.headers.get('content-security-policy'));
    const html = await res.text();

    const tags = scriptTags(html);
    expect(tags).toHaveLength(3);
    for (const tag of tags) expect(tag).toContain(` nonce="${nonce}"`);
    expect(html.match(/ nonce="/g)).toHaveLength(3);
  });

  it('draws a fresh nonce for every response', async () => {
    const request = await mount();
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const res = await request('/_console/');
      const nonce = headerNonce(res.headers.get('content-security-policy'));
      expect(await res.text()).toContain(`nonce="${nonce}"`);
      seen.add(nonce);
    }
    expect(seen.size).toBe(5);
  });

  it('carries the policy on every HTML answer: an SPA fallback and a direct .html hit', async () => {
    const request = await mount();
    for (const p of ['/_console/apps/crm/record/42', '/_console/index.html']) {
      const res = await request(p);
      const nonce = headerNonce(res.headers.get('content-security-policy'));
      for (const tag of scriptTags(await res.text())) expect(tag, p).toContain(`nonce="${nonce}"`);
    }
  });

  it('leaves the build\'s other files without a document policy', async () => {
    const request = await mount();
    const res = await request('/_console/assets/index-BQWjE1TW.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('\'unsafe-eval\' follows the react-pages tier', () => {
  it('is allowed while the tier is on, which is the default', async () => {
    const request = await mount();
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('script-src')).toContain("'unsafe-eval'");
  });

  it('is refused with OS_PAGE_REACT=off, and the injected disable global carries the nonce', async () => {
    process.env.OS_PAGE_REACT = 'off';
    const request = await mount();
    const res = await request('/_console/');
    const policy = res.headers.get('content-security-policy');
    expect(directives(policy).get('script-src')).not.toContain("'unsafe-eval'");

    const nonce = headerNonce(policy);
    const html = await res.text();
    const tags = scriptTags(html);
    expect(tags).toHaveLength(4);
    for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`);
    expect(html).toContain(`<script nonce="${nonce}">window.__OBJECTUI_CAPABILITIES_DISABLED__=`);
  });
});

describe('frame-ancestors', () => {
  it('is omitted on the public form page, which authors embed on their own sites', async () => {
    const request = await mount();
    const res = await request('/_console/f/contact-us');
    const policy = directives(res.headers.get('content-security-policy'));
    expect(policy.has('frame-ancestors')).toBe(false);
    expect(policy.get('script-src')!.some((s) => s.startsWith("'nonce-"))).toBe(true);
  });

  it('is kept on a page whose path only begins like it', async () => {
    const request = await mount();
    const res = await request('/_console/forms/contact-us');
    expect(directives(res.headers.get('content-security-policy')).get('frame-ancestors')).toEqual(["'self'"]);
  });
});

describe('connect-src', () => {
  it('names the origin of the error-reporting DSN the runtime serves, without its key', async () => {
    const request = await mount({ runtimeConfig: { clientErrorReporting: { dsn: 'https://abc123@o1.ingest.sentry.io/42' } } });
    const served = await (await request('/api/v1/runtime/config')).json();
    expect(served.telemetry.errorReporting.dsn).toBe('https://abc123@o1.ingest.sentry.io/42');

    const res = await request('/_console/');
    const policy = res.headers.get('content-security-policy')!;
    expect(directives(policy).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://o1.ingest.sentry.io',
    ]);
    expect(policy).not.toContain('abc123');
  });

  it('names no error-reporting origin when the runtime serves no DSN', async () => {
    const request = await mount({ runtimeConfig: {} });
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
    ]);
  });

  it('adds the sources an operator names in OS_CONSOLE_CSP_CONNECT_SRC', async () => {
    process.env.OS_CONSOLE_CSP_CONNECT_SRC = '  https://tiles.example.com\twss://*.example.com:8443/rt/ https: ';
    const request = await mount();
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://tiles.example.com',
      'wss://*.example.com:8443/rt/',
      'https:',
    ]);
  });

  it.each([
    ["'unsafe-inline'"],
    ['https://tiles.example.com;script-src'],
    ['*'],
    ['javascript:'],
    ['tiles.example.com'],
  ])('refuses the boot when OS_CONSOLE_CSP_CONNECT_SRC names %j', async (value) => {
    process.env.OS_CONSOLE_CSP_CONNECT_SRC = `https://ok.example.com ${value}`;
    await expect(mount()).rejects.toThrow(/OS_CONSOLE_CSP_CONNECT_SRC names .*not a connect-src source/);
  });
});
