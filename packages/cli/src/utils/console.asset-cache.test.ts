// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How long a browser may keep each file the console static plugin serves.
 *
 * Before this change, every non-HTML file under the console dist was answered
 * with a `content-type` and nothing else. With no lifetime and no validator, a
 * browser could reuse none of the ~2,450 chunks, so every self-hosted console
 * load downloaded the whole SPA again. Files now fall into three classes:
 *
 *   - A content-hashed build output (`assets/<name>-<hash>.<ext>`) gets
 *     `public, max-age=31536000, immutable`.
 *   - Every other non-HTML file gets a short lifetime and a content `etag`,
 *     and a matching `If-None-Match` is answered with `304`. This covers
 *     objectui's stable-named maplibre copies in `assets/` and the `public/`
 *     copies at the root.
 *   - HTML (the shell, a direct `index.html`, the SPA fallback) gets no
 *     lifetime, because it is rewritten per request.
 *
 * The hashed names below are real ones, read from the published
 * `@objectstack/console@17.7.0` dist. They were picked for the shapes a
 * name-only rule can get wrong: `-` and `_` inside the hash, a hash whose only
 * non-lowercase character is `_`, and a `[name]` that itself ends in an
 * uppercase dash segment. The two maplibre files are the only files in that
 * dist's `assets/` without a hash. The lookalikes are not from the dist; they
 * mark the rule's edges, where a stable file would otherwise be pinned for a
 * year.
 *
 * These tests run the REAL plugin on a REAL Hono app (the `HonoHttpServer`
 * that production resolves as `http.server`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { createConsoleStaticPlugin } from './console.js';

const ORIGIN = 'http://console.example.test';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The longest lifetime a file that can change under its name may be given. */
const SHORT_LIFETIME_CEILING_S = 300;

/** Real hashed names from the published dist, each a shape the rule must match. */
const HASHED_ASSETS = [
  'index-v2Ijn9Gr.css',
  'index-ocmkyCt6.js',
  'maplibre-gl-Dw-skPj7.js',
  'vendor-icon-calendar-sync-Ccwp9IC-.js',
  'vendor-icon-arrow-down-Bo-fuW7k.js',
  'solarized-light-C1IUL_tW.js',
  'vendor-icon-diamond-percent-ekt_smur.js',
  'chunk-POPQ4Y6H-D8IrqNW7.js',
];

/** The published dist's only `assets/` files without a hash, and two root `public/` copies. */
const STABLE_FILES = ['assets/maplibre-gl-worker.mjs', 'assets/maplibre-gl-shared.mjs', 'favicon.svg', 'manifest.json'];

/** Not from the dist: names at the rule's edges, each of which must stay revalidated. */
const LOOKALIKES = [
  'assets/pdf-renderer.js', // an eight-letter lowercase word after a dash
  'assets/maplibre-gl-worker-dev.mjs', // maplibre's other worker name
  'logo-Cluzi2Zq.svg', // hash-shaped, but outside assets/
  'assets/nested/chunk-AbCd1234.js', // hash-shaped, but below a subdirectory
];

const HTML_REQUESTS = ['/_console/', '/_console/index.html', '/_console/apps/crm/records/42'];

let consoleRoot: string;

beforeAll(() => {
  consoleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-cache-'));
});

afterAll(() => {
  fs.rmSync(consoleRoot, { recursive: true, force: true });
});

/** The bytes the fixture holds for a dist-relative path. */
function fixtureBytes(rel: string): Buffer {
  return Buffer.from(`/* ${rel} */\n`);
}

/** A console dist holding `index.html` and every named file. */
function makeDist(name: string, files: string[]): string {
  const dist = path.join(consoleRoot, name);
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head></head><body>console</body></html>');
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), fixtureBytes(rel));
  }
  return dist;
}

async function mountConsole(dist: string): Promise<(p: string, init?: RequestInit) => Promise<Response>> {
  const server = new HonoHttpServer(0);
  const plugin = createConsoleStaticPlugin(dist, { rootRedirect: false });
  await plugin.start({ getServiceAsync: async () => server, logger: { warn: () => {} } });
  const app = server.getRawApp();
  return async (p: string, init?: RequestInit) => app.request(`${ORIGIN}${p}`, init);
}

/** `max-age` in seconds, or `null` when the header carries none. */
function maxAgeOf(cacheControl: string | null): number | null {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? '');
  return match ? Number(match[1]) : null;
}

/** Whether a response lets the browser reuse it without asking: any positive lifetime, or `immutable`. */
function grantsLifetime(cacheControl: string | null): boolean {
  return /\bimmutable\b/i.test(cacheControl ?? '') || (maxAgeOf(cacheControl) ?? 0) > 0;
}

describe('a content-hashed build output is immutable for a year', () => {
  let request: Awaited<ReturnType<typeof mountConsole>>;
  beforeAll(async () => {
    request = await mountConsole(makeDist('hashed', HASHED_ASSETS.map((name) => `assets/${name}`)));
  });

  it.each(HASHED_ASSETS)('assets/%s', async (name) => {
    const res = await request(`/_console/assets/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(fixtureBytes(`assets/${name}`));
  });

  it('a missing hashed asset is a 404 the browser may not keep', async () => {
    const res = await request('/_console/assets/index-Zz9Zz9Zz.js');
    expect(res.status).toBe(404);
    expect(grantsLifetime(res.headers.get('cache-control'))).toBe(false);
  });
});

describe('a file that can change under its name gets a short lifetime and a content etag, never immutable', () => {
  let request: Awaited<ReturnType<typeof mountConsole>>;
  beforeAll(async () => {
    request = await mountConsole(makeDist('stable', [...STABLE_FILES, ...LOOKALIKES]));
  });

  it.each([...STABLE_FILES, ...LOOKALIKES])('%s', async (rel) => {
    const res = await request(`/_console/${rel}`);
    expect(res.status).toBe(200);
    const cacheControl = res.headers.get('cache-control');
    expect(cacheControl).not.toMatch(/immutable/i);
    const maxAge = maxAgeOf(cacheControl);
    expect(maxAge).not.toBeNull();
    expect(maxAge!).toBeLessThanOrEqual(SHORT_LIFETIME_CEILING_S);
    expect(res.headers.get('etag')).toMatch(/^"[^"]+"$/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(fixtureBytes(rel));
  });
});

describe('a stable file revalidates against its etag', () => {
  const WORKER = 'assets/maplibre-gl-worker.mjs';
  let request: Awaited<ReturnType<typeof mountConsole>>;
  let etag: string;
  let cacheControl: string | null;

  beforeAll(async () => {
    request = await mountConsole(makeDist('revalidate', [WORKER]));
    const first = await request(`/_console/${WORKER}`);
    etag = first.headers.get('etag')!;
    cacheControl = first.headers.get('cache-control');
  });

  it.each([
    ['its own tag', () => etag],
    ['its own tag, weak', () => `W/${etag}`],
    ['a list holding its tag', () => `"some-other-tag", ${etag}`],
    ['*', () => '*'],
  ])('answers 304 with no body to If-None-Match: %s', async (_label, header) => {
    const res = await request(`/_console/${WORKER}`, { headers: { 'if-none-match': header() } });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe(etag);
    expect(res.headers.get('cache-control')).toBe(cacheControl);
  });

  it('answers 200 with the bytes to an If-None-Match that names another tag', async () => {
    const res = await request(`/_console/${WORKER}`, { headers: { 'if-none-match': '"some-other-tag"' } });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(fixtureBytes(WORKER));
  });

  it('gives new bytes a new tag even when their size and mtime are unchanged', async () => {
    // `tar` extraction gives every file of a console tarball the same fixed
    // mtime, so an upgrade can replace a file with bytes of the same length and
    // the same stat time. Only a validator computed from the content tells
    // the two apart.
    const dist = makeDist('replaced', [WORKER]);
    const file = path.join(dist, WORKER);
    const packTime = new Date('1985-10-26T08:15:00Z');
    fs.utimesSync(file, packTime, packTime);
    const requestReplaced = await mountConsole(dist);
    const before = await requestReplaced(`/_console/${WORKER}`);
    const oldTag = before.headers.get('etag')!;

    const next = Buffer.from(fixtureBytes(WORKER).toString().toUpperCase());
    expect(next.length).toBe(fixtureBytes(WORKER).length);
    fs.writeFileSync(file, next);
    fs.utimesSync(file, packTime, packTime);

    const after = await requestReplaced(`/_console/${WORKER}`, { headers: { 'if-none-match': oldTag } });
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(oldTag);
    expect(Buffer.from(await after.arrayBuffer())).toEqual(next);
  });
});

describe('HTML is rewritten per request and is never given a lifetime', () => {
  let request: Awaited<ReturnType<typeof mountConsole>>;
  beforeAll(async () => {
    request = await mountConsole(makeDist('html', []));
  });

  it.each(HTML_REQUESTS)('%s', async (p) => {
    const res = await request(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(grantsLifetime(res.headers.get('cache-control'))).toBe(false);
  });
});
