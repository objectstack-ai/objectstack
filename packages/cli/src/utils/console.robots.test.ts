// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a Console-serving runtime tells search engines.
 *
 * Every Console answer carries `X-Robots-Tag: noindex, nofollow` and every
 * Console document a `<meta name="robots">` tag, except the public form page
 * (`/_console/f/<slug>`), which stays indexable. `GET /robots.txt` answers the
 * default file only when nothing else serves that path.
 *
 * These run the REAL plugins on the REAL `HonoHttpServer` production resolves
 * as `http.server`, with its not-found seam installed, so the API's own
 * header (from the transport) and the Console's are read off the same app.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { createConsoleNotBuiltPlugin, createConsoleStaticPlugin, DEFAULT_ROBOTS_TXT } from './console.js';

const ORIGIN = 'http://robots.example.test';
const NOINDEX = 'noindex, nofollow';
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';

let consoleRoot: string;
let distPath: string;

beforeAll(() => {
  consoleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-robots-'));
  distPath = path.join(consoleRoot, 'dist');
  fs.mkdirSync(path.join(distPath, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distPath, 'index.html'), '<!doctype html><html><head></head><body>console</body></html>');
  fs.writeFileSync(path.join(distPath, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(distPath, 'favicon.svg'), '<svg/>');
});

afterAll(() => {
  fs.rmSync(consoleRoot, { recursive: true, force: true });
});

const ctxFor = (server: HonoHttpServer) => ({ getServiceAsync: async () => server, logger: { warn: () => {} } });

async function mount(opts: {
  plugin?: 'static' | 'not-built' | 'none';
  /** Registered BEFORE the Console plugin starts. */
  before?: (server: HonoHttpServer) => void;
  /** Registered AFTER the Console plugin starts. */
  after?: (server: HonoHttpServer) => void;
} = {}) {
  const server = new HonoHttpServer(0);
  server.installNotFoundSeam();
  server.get('/api/v1/runtime/config', (_req: any, res: any) => res.json({ branding: {} }));
  server.get('/api/v1/forms/:slug', (req: any, res: any) => res.json({ slug: req.params?.slug, form: {} }));
  opts.before?.(server);
  const which = opts.plugin ?? 'static';
  if (which === 'static') await createConsoleStaticPlugin(distPath).start(ctxFor(server));
  if (which === 'not-built') await createConsoleNotBuiltPlugin(null).start(ctxFor(server));
  opts.after?.(server);
  const app = server.getRawApp();
  return (p: string, init?: RequestInit) => app.request(`${ORIGIN}${p}`, init);
}

describe('the Console asks not to be indexed', () => {
  for (const page of ['/_console/', '/_console/login', '/_console/apps/crm/account', '/_console/index.html']) {
    it(`${page}: header and meta tag`, async () => {
      const request = await mount();
      const res = await request(page);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-robots-tag')).toBe(NOINDEX);
      const html = await res.text();
      expect(html).toContain(ROBOTS_META);
      expect(html.match(/<meta name="robots"/g)).toHaveLength(1);
    });
  }

  it('its assets and the asset 404 carry the header too', async () => {
    const request = await mount();
    for (const asset of ['/_console/assets/index-abc123.js', '/_console/favicon.svg', '/_console/assets/missing.js']) {
      const res = await request(asset);
      expect(res.headers.get('x-robots-tag'), asset).toBe(NOINDEX);
    }
  });

  it('a build that ships its own robots meta keeps it, unduplicated', async () => {
    const ownDist = path.join(consoleRoot, 'own-meta');
    fs.mkdirSync(ownDist);
    fs.writeFileSync(
      path.join(ownDist, 'index.html'),
      '<!doctype html><html><head><meta name="robots" content="noindex"></head><body>console</body></html>',
    );
    const server = new HonoHttpServer(0);
    server.installNotFoundSeam();
    await createConsoleStaticPlugin(ownDist).start(ctxFor(server));
    const html = await (await server.getRawApp().request(`${ORIGIN}/_console/`)).text();
    expect(html.match(/<meta name="robots"/g)).toHaveLength(1);
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('the 503 a refused Console answers carries the header', async () => {
    const request = await mount({ plugin: 'not-built' });
    const res = await request('/_console/');
    expect(res.status).toBe(503);
    expect(res.headers.get('x-robots-tag')).toBe(NOINDEX);
  });
});

describe('the public form surface stays indexable', () => {
  it('/_console/f/<slug> carries neither the header nor the meta tag', async () => {
    const request = await mount();
    const res = await request('/_console/f/contact-us');
    expect(res.status).toBe(200);
    expect(res.headers.has('x-robots-tag')).toBe(false);
    expect(await res.text()).not.toContain('name="robots"');
  });

  it('the /forms/<slug> redirect carries no header', async () => {
    const request = await mount();
    const res = await request('/forms/contact-us');
    expect(res.status).toBe(302);
    expect(res.headers.has('x-robots-tag')).toBe(false);
  });
});

describe('the API answers carry the header from the transport', () => {
  it('/api/v1/runtime/config and an unmatched /api path', async () => {
    const request = await mount();
    expect((await request('/api/v1/runtime/config')).headers.get('x-robots-tag')).toBe(NOINDEX);
    const missing = await request('/api/v1/auth');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-robots-tag')).toBe(NOINDEX);
  });
});

describe('GET /robots.txt', () => {
  it('answers the default file when nothing else serves the path', async () => {
    const request = await mount();
    const res = await request('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body).toBe(DEFAULT_ROBOTS_TXT);
    const rules = body.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(rules).toEqual([
      'User-agent: *',
      'Allow: /forms/',
      'Allow: /_console/f/',
      'Allow: /_console/assets/',
      'Allow: /api/v1/forms/',
      'Disallow: /_console/',
      'Disallow: /api/',
    ]);
  });

  it('carries no headers left over from the not-found answer it replaces', async () => {
    const request = await mount();
    const res = await request('/robots.txt');
    const length = res.headers.get('content-length');
    if (length !== null) expect(Number(length)).toBe(Buffer.byteLength(DEFAULT_ROBOTS_TXT));
    expect(await res.text()).toBe(DEFAULT_ROBOTS_TXT);
  });

  it('HEAD is answered like GET', async () => {
    const request = await mount();
    const res = await request('/robots.txt', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('an app robots.txt registered BEFORE the Console wins', async () => {
    const request = await mount({
      before: (server) => server.getRawApp().get('/robots.txt', (c: any) => c.text('User-agent: *\nAllow: /\n')),
    });
    expect(await (await request('/robots.txt')).text()).toBe('User-agent: *\nAllow: /\n');
  });

  it('an app robots.txt registered AFTER the Console wins', async () => {
    const request = await mount({
      after: (server) => server.get('/robots.txt', (_req: any, res: any) => {
        res.header('content-type', 'text/plain');
        res.send('User-agent: *\nDisallow:\n');
      }),
    });
    const res = await request('/robots.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('User-agent: *\nDisallow:\n');
  });

  it('is not served by a runtime that mounts no Console', async () => {
    const request = await mount({ plugin: 'none' });
    expect((await request('/robots.txt')).status).toBe(404);
  });
});
