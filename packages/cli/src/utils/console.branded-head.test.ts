// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console document's server-written `<title>`, description and Open Graph
 * tags.
 *
 * A link-preview crawler runs no script, so the shell's early-branding script
 * (which sets `document.title` from `GET /api/v1/runtime/config`) never names
 * the product to it. `createConsoleStaticPlugin` writes the tags into the HTML
 * from the same door, asked in-process for the same request.
 *
 * The "one source" cases run the REAL plugin on a REAL Hono app (the
 * `HonoHttpServer` production resolves as `http.server`) beside the REAL
 * `RuntimeConfigPlugin`, and compare the served tags against what that door
 * answers to the same request. The value-shape cases register a stub door, so
 * each one says which answer the tags follow.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { RuntimeConfigPlugin } from '@objectstack/cloud-connection';

import { createConsoleStaticPlugin } from './console.js';

const ORIGIN = 'http://share.example.test';

/** The shell as objectui ships it, cut down: an empty `<title>` and no meta tags. */
const SHELL = '<!doctype html><html><head><meta charset="UTF-8"><title></title></head><body>console</body></html>';

let consoleRoot: string;
let distPath: string;

beforeAll(() => {
  consoleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-branded-head-'));
  distPath = path.join(consoleRoot, 'dist');
  fs.mkdirSync(distPath);
  fs.writeFileSync(path.join(distPath, 'index.html'), SHELL);
});

afterAll(() => {
  fs.rmSync(consoleRoot, { recursive: true, force: true });
});

interface Mounted {
  request(p: string, init?: RequestInit): Promise<Response>;
  warnings: string[];
  probeHeaders: Headers[];
}

type StubDoor =
  | { kind: 'json'; body: unknown }
  | { kind: 'status'; status: number }
  | { kind: 'throw' };

async function mount(opts: { runtimeConfig?: ConstructorParameters<typeof RuntimeConfigPlugin>[0]; stub?: StubDoor }): Promise<Mounted> {
  const server = new HonoHttpServer(0);
  server.installNotFoundSeam();
  const warnings: string[] = [];
  const probeHeaders: Headers[] = [];
  const logger = { warn: (m: string) => warnings.push(m), info: () => {}, debug: () => {}, error: () => {} };

  if (opts.runtimeConfig) {
    const hooks: Array<() => Promise<void>> = [];
    const plugin = new RuntimeConfigPlugin(opts.runtimeConfig);
    await plugin.start({
      hook: (name: string, fn: () => Promise<void>) => { if (name === 'kernel:ready') hooks.push(fn); },
      getService: (name: string) => {
        if (name === 'http.server') return server;
        throw new Error(`no service ${name}`);
      },
      logger,
    } as any);
    for (const fn of hooks) await fn();
  }

  const app = server.getRawApp();
  if (opts.stub) {
    const stub = opts.stub;
    app.get('/api/v1/runtime/config', (c: any) => {
      probeHeaders.push(new Headers(c.req.raw.headers));
      if (stub.kind === 'throw') throw new Error('door exploded');
      if (stub.kind === 'status') return c.json({ code: 'BROKEN' }, stub.status);
      return c.json(stub.body);
    });
  }

  const plugin = createConsoleStaticPlugin(distPath);
  await plugin.start({ getServiceAsync: async () => server, logger });
  return {
    request: async (p: string, init?: RequestInit) => app.request(`${ORIGIN}${p}`, init),
    warnings,
    probeHeaders,
  };
}

/** The `content` of the one meta tag with this `name`/`property`, or `null`; two such tags fail. */
function metaContent(html: string, key: string): string | null {
  const found = [...html.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)">/g)].filter((m) => m[1] === key);
  expect(found.length, `meta ${key} written ${found.length} times`).toBeLessThanOrEqual(1);
  return found[0]?.[2] ?? null;
}

function titles(html: string): string[] {
  return [...html.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => m[1]);
}

describe('the console document carries the runtime branding, read from the door the early script reads', () => {
  const branding = { productName: 'Acme Cloud', pwaDescription: 'Acme operations console', logoUrl: '/brand/logo.svg' };

  it('writes the title, description and the four Open Graph tags', async () => {
    const app = await mount({ runtimeConfig: branding });
    const res = await app.request('/_console/');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(titles(html)).toEqual(['Acme Cloud']);
    expect(metaContent(html, 'description')).toBe('Acme operations console');
    expect(metaContent(html, 'og:title')).toBe('Acme Cloud');
    expect(metaContent(html, 'og:description')).toBe('Acme operations console');
    expect(metaContent(html, 'og:image')).toBe(`${ORIGIN}/brand/logo.svg`);
    expect(metaContent(html, 'og:url')).toBe(ORIGIN);
    expect(app.warnings).toEqual([]);
  });

  it('writes exactly what GET /api/v1/runtime/config answers to the same request', async () => {
    const app = await mount({ runtimeConfig: branding });
    const served = (await (await app.request('/api/v1/runtime/config')).json()).branding;
    const html = await (await app.request('/_console/')).text();

    expect(titles(html)).toEqual([served.productName]);
    expect(metaContent(html, 'og:title')).toBe(served.productName);
    expect(metaContent(html, 'description')).toBe(served.pwaDescription);
    expect(metaContent(html, 'og:image')).toBe(new URL(served.logoUrl, `${ORIGIN}/`).href);
  });

  it('follows the door\'s DERIVED description: unset, it is built from the product name served', async () => {
    const app = await mount({ runtimeConfig: { productName: 'Acme Cloud' } });
    const served = (await (await app.request('/api/v1/runtime/config')).json()).branding;
    const html = await (await app.request('/_console/')).text();

    expect(served.pwaDescription).toContain('Acme Cloud');
    expect(metaContent(html, 'description')).toBe(served.pwaDescription);
  });

  it('writes the tags on every HTML answer: an SPA fallback and a direct .html hit', async () => {
    const app = await mount({ runtimeConfig: branding });
    for (const p of ['/_console/apps/crm/record/42', '/_console/index.html']) {
      const html = await (await app.request(p)).text();
      expect(titles(html), p).toEqual(['Acme Cloud']);
      expect(metaContent(html, 'og:url'), p).toBe(ORIGIN);
    }
  });

  it('keeps the base tag the shell was already given', async () => {
    const app = await mount({ runtimeConfig: branding });
    const html = await (await app.request('/_console/')).text();
    expect(html).toContain('<base href="/_console/">');
  });
});

describe('every value is escaped, and a missing value writes no tag', () => {
  it('escapes markup and quotes in the title and in every attribute', async () => {
    const app = await mount({
      stub: {
        kind: 'json',
        body: { branding: { productName: 'A<b>"&\'$&', pwaDescription: '"><script>x()</script>', logoUrl: '/l.png?a=1&b=2' } },
      },
    });
    const html = await (await app.request('/_console/')).text();

    expect(html).not.toContain('<script>x()');
    expect(html).not.toContain('<b>');
    expect(titles(html)).toEqual(['A&lt;b&gt;&quot;&amp;&#39;$&amp;']);
    expect(metaContent(html, 'og:title')).toBe('A&lt;b&gt;&quot;&amp;&#39;$&amp;');
    expect(metaContent(html, 'description')).toBe('&quot;&gt;&lt;script&gt;x()&lt;/script&gt;');
    expect(metaContent(html, 'og:image')).toBe(`${ORIGIN}/l.png?a=1&amp;b=2`);
  });

  it('a branding with only a product name writes no description and no image tag', async () => {
    const app = await mount({ stub: { kind: 'json', body: { branding: { productName: 'Acme', pwaDescription: '  ', logoUrl: '' } } } });
    const html = await (await app.request('/_console/')).text();

    expect(titles(html)).toEqual(['Acme']);
    expect(metaContent(html, 'og:title')).toBe('Acme');
    expect(metaContent(html, 'og:url')).toBe(ORIGIN);
    expect(metaContent(html, 'description')).toBeNull();
    expect(metaContent(html, 'og:description')).toBeNull();
    expect(metaContent(html, 'og:image')).toBeNull();
    expect(html).not.toContain('content=""');
  });

  it('a logo that does not resolve to an http(s) URL writes no og:image', async () => {
    const app = await mount({ stub: { kind: 'json', body: { branding: { productName: 'Acme', logoUrl: 'data:image/png;base64,AAAA' } } } });
    const html = await (await app.request('/_console/')).text();
    expect(metaContent(html, 'og:image')).toBeNull();
  });

  it('an absolute logo URL is written as it is', async () => {
    const app = await mount({ stub: { kind: 'json', body: { branding: { productName: 'Acme', logoUrl: 'https://cdn.example.com/acme.png' } } } });
    const html = await (await app.request('/_console/')).text();
    expect(metaContent(html, 'og:image')).toBe('https://cdn.example.com/acme.png');
  });

  it('a shell with no <title> element gets one', async () => {
    const bare = path.join(consoleRoot, 'bare-dist');
    fs.mkdirSync(bare, { recursive: true });
    fs.writeFileSync(path.join(bare, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    const server = new HonoHttpServer(0);
    server.installNotFoundSeam();
    const app = server.getRawApp();
    app.get('/api/v1/runtime/config', (c: any) => c.json({ branding: { productName: 'Acme' } }));
    await createConsoleStaticPlugin(bare).start({ getServiceAsync: async () => server, logger: { warn: () => {} } });
    const html = await (await app.request(`${ORIGIN}/_console/`)).text();
    expect(titles(html)).toEqual(['Acme']);
  });
});

describe('og:url is the origin the visitor addressed', () => {
  it('takes the scheme a proxy states in x-forwarded-proto', async () => {
    const app = await mount({ stub: { kind: 'json', body: { branding: { productName: 'Acme', logoUrl: '/l.svg' } } } });
    const html = await (await app.request('/_console/', { headers: { 'x-forwarded-proto': 'https' } })).text();
    expect(metaContent(html, 'og:url')).toBe('https://share.example.test');
    expect(metaContent(html, 'og:image')).toBe('https://share.example.test/l.svg');
  });

  it('ignores an x-forwarded-proto that is not http or https', async () => {
    const app = await mount({ stub: { kind: 'json', body: { branding: { productName: 'Acme' } } } });
    const html = await (await app.request('/_console/', { headers: { 'x-forwarded-proto': 'javascript' } })).text();
    expect(metaContent(html, 'og:url')).toBe(ORIGIN);
  });
});

describe('the branding read is the visitor\'s own request, re-addressed', () => {
  it('forwards the host and cookies, and drops the headers that would change the answer\'s encoding or status', async () => {
    const app = await mount({ stub: { kind: 'json', body: { branding: { productName: 'Acme' } } } });
    await app.request('/_console/', {
      headers: { host: 'share.example.test', cookie: 'session=abc', 'accept-encoding': 'gzip', 'if-none-match': '"x"', accept: 'text/html' },
    });
    expect(app.probeHeaders).toHaveLength(1);
    const sent = app.probeHeaders[0];
    expect(sent.get('cookie')).toBe('session=abc');
    expect(sent.get('host')).toBe('share.example.test');
    expect(sent.get('accept-encoding')).toBeNull();
    expect(sent.get('if-none-match')).toBeNull();
    expect(sent.get('accept')).toBe('application/json');
  });
});

describe('with no branding to read, the document is served as before', () => {
  /**
   * The shell as it was served before this change: the base tag and the
   * react-pages capability script added (off by default), nothing else. The
   * script's per-response nonce is read off by `served`.
   */
  const BEFORE = SHELL.replace(
    '<head>',
    '<head>\n    <script>window.__OBJECTUI_CAPABILITIES_DISABLED__=(window.__OBJECTUI_CAPABILITIES_DISABLED__||[]).concat(\'react-pages\');</script>'
      + '\n    <base href="/_console/">',
  );
  const served = async (res: Response) => (await res.text()).replace(/ nonce="[^"]*"/g, '');

  it('a composition with no branding door serves the shell unchanged, and says nothing', async () => {
    const app = await mount({});
    const html = await served(await app.request('/_console/'));
    expect(html).toBe(BEFORE);
    expect(app.warnings).toEqual([]);
  });

  it('a door that answers no branding block serves the shell unchanged', async () => {
    const app = await mount({ stub: { kind: 'json', body: { cloudUrl: '' } } });
    expect(await served(await app.request('/_console/'))).toBe(BEFORE);
  });

  it('a door that fails serves the shell unchanged and warns once', async () => {
    const app = await mount({ stub: { kind: 'status', status: 500 } });
    expect(await served(await app.request('/_console/'))).toBe(BEFORE);
    expect(await served(await app.request('/_console/apps/x'))).toBe(BEFORE);
    expect(app.warnings).toHaveLength(1);
    expect(app.warnings[0]).toContain('/api/v1/runtime/config');
    expect(app.warnings[0]).toContain('500');
  });

  it('a door that throws serves the shell unchanged and warns once', async () => {
    const app = await mount({ stub: { kind: 'throw' } });
    const res = await app.request('/_console/');
    expect(res.status).toBe(200);
    expect(await served(res)).toBe(BEFORE);
    expect(app.warnings).toHaveLength(1);
  });
});
