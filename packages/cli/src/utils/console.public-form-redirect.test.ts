// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console's `GET /forms/:slug` redirect (#22079).
 *
 * An app author writes a public form's `sharing.publicLink` as `/forms/<slug>`,
 * and the Console serves that form at `/_console/f/<slug>`. The console static
 * plugin now answers the authored path with a 302 to the page, but only when
 * the anonymous form door (`GET /api/v1/forms/:slug`, `@objectstack/rest`)
 * serves the slug to the same request. Every other request keeps the answer it
 * got before: the transport's unmatched-request 404.
 *
 * These run the REAL plugin on a REAL Hono app (the `HonoHttpServer` production
 * resolves as `http.server`, with its not-found seam installed), with a stub
 * door registered the way `@objectstack/rest` registers the real one. The stub
 * is the door's answer and nothing else, so each case says which answer the
 * redirect follows. The real door, on a real showcase boot, is
 * `packages/qa/dogfood/test/showcase-public-form-redirect.dogfood.test.ts`.
 *
 * "The answer it got before" is measured, not written down: every fall-through
 * case compares status AND body, byte for byte, against the same request sent
 * to the same app WITHOUT the plugin mounted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { createConsoleStaticPlugin } from './console.js';

const ORIGIN = 'http://forms.example.test';
const OPEN = 'contact-us';

/** One stub door answer per slug; anything unlisted is the door's not-found. */
type DoorAnswer = 'serve' | 'not-found' | 'fail' | 'throw';

interface DoorCall {
  method: string;
  slug: string;
  query: unknown;
  host: unknown;
  cookie: unknown;
}

interface App {
  request(p: string, init?: RequestInit): Promise<Response>;
  doorCalls: DoorCall[];
}

let consoleRoot: string;
let distPath: string;

beforeAll(() => {
  consoleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-forms-'));
  distPath = path.join(consoleRoot, 'dist');
  fs.mkdirSync(distPath);
  fs.writeFileSync(path.join(distPath, 'index.html'), '<!doctype html><html><head></head><body>console</body></html>');
});

afterAll(() => {
  fs.rmSync(consoleRoot, { recursive: true, force: true });
});

async function mount(opts: {
  console: boolean;
  dist?: string;
  door?: (slug: string) => DoorAnswer;
}): Promise<App> {
  const server = new HonoHttpServer(0);
  server.installNotFoundSeam();
  const doorCalls: DoorCall[] = [];
  const door = opts.door ?? ((slug: string) => (slug === OPEN ? 'serve' : 'not-found'));

  server.get('/api/v1/forms/:slug', async (req: any, res: any) => {
    const slug = String(req.params?.slug ?? '');
    doorCalls.push({ method: req.method, slug, query: req.query, host: req.headers?.host, cookie: req.headers?.cookie });
    const answer = door(slug);
    if (answer === 'throw') throw new Error('door exploded');
    if (answer === 'fail') {
      res.status(500).json({ code: 'FORM_RESOLVE_FAILED', error: 'resolve failed' });
      return;
    }
    if (answer === 'not-found') {
      res.status(404).json({ code: 'FORM_NOT_FOUND', error: `No public form configured at /forms/${slug}` });
      return;
    }
    res.json({ slug, object: 'showcase_inquiry', form: {} });
  });

  if (opts.console) {
    const plugin = createConsoleStaticPlugin(opts.dist ?? distPath);
    await plugin.start({ getServiceAsync: async () => server, logger: { warn: () => {} } });
  }
  const app = server.getRawApp();
  return {
    request: async (p: string, init?: RequestInit) => app.request(`${ORIGIN}${p}`, init),
    doorCalls,
  };
}

async function answerOf(res: Response): Promise<{ status: number; body: string; location: string | null }> {
  return { status: res.status, body: await res.text(), location: res.headers.get('location') };
}

/** The request's answer with the plugin mounted, and the same request's answer without it. */
async function withAndWithout(p: string, init?: RequestInit, door?: (slug: string) => DoorAnswer) {
  const mounted = await mount({ console: true, door });
  const bare = await mount({ console: false, door });
  const answer = await answerOf(await mounted.request(p, init));
  const before = await answerOf(await bare.request(p, init));
  return { answer, before, doorCalls: mounted.doorCalls };
}

describe('GET /forms/:slug — redirects when the anonymous form door serves the slug', () => {
  it('answers 302 to the console public form page', async () => {
    const app = await mount({ console: true });
    const res = await app.request(`/forms/${OPEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/_console/f/${OPEN}`);
    expect(app.doorCalls.map((d) => [d.method, d.slug])).toEqual([['GET', OPEN]]);
  });

  it('the page it redirects to is served by the console bundle', async () => {
    const app = await mount({ console: true });
    const location = (await app.request(`/forms/${OPEN}`)).headers.get('location')!;
    const page = await app.request(location);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('console');
  });

  it('HEAD is answered like GET, and the door is still asked with GET', async () => {
    const app = await mount({ console: true });
    const res = await app.request(`/forms/${OPEN}`, { method: 'HEAD' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/_console/f/${OPEN}`);
    expect(app.doorCalls.map((d) => d.method)).toEqual(['GET']);
  });

  it('asks the door with the visitor\'s own headers, which pick the environment', async () => {
    const app = await mount({ console: true });
    // `@hono/node-server` builds the request from the socket's `Host` header;
    // an injected request carries it only when it is sent explicitly.
    await app.request(`/forms/${OPEN}`, { headers: { host: 'tenant-a.example.test', cookie: 'session=abc' } });
    expect(app.doorCalls).toHaveLength(1);
    expect(app.doorCalls[0].host).toBe('tenant-a.example.test');
    expect(app.doorCalls[0].cookie).toBe('session=abc');
  });

  it('a percent-encoded slug is asked decoded and redirected re-encoded', async () => {
    const app = await mount({ console: true });
    const res = await app.request('/forms/contact%2Dus');
    expect(app.doorCalls.map((d) => d.slug)).toEqual([OPEN]);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/_console/f/${OPEN}`);
  });
});

describe('GET /forms/:slug — the Location cannot be steered off the console page', () => {
  // A door that serves every slug is the worst case: the redirect then fires
  // for whatever the request carried, so the Location must stay one encoded
  // path segment under `/_console/f/` on the same origin whatever that was.
  const servesEverything = (): DoorAnswer => 'serve';

  for (const [requested, expected] of [
    ['/forms/%2F%2Fevil.example', '/_console/f/%2F%2Fevil.example'],
    ['/forms/%5C%5Cevil.example', '/_console/f/%5C%5Cevil.example'],
    ['/forms/https%3A%2F%2Fevil.example', '/_console/f/https%3A%2F%2Fevil.example'],
    ['/forms/a%2F..%2F..%2Fadmin', '/_console/f/a%2F..%2F..%2Fadmin'],
    ['/forms/x%0D%0ASet-Cookie%3A%20a%3Db', '/_console/f/x%0D%0ASet-Cookie%3A%20a%3Db'],
    ['/forms/x%3Fnext%3D%2F%2Fevil.example%23y', '/_console/f/x%3Fnext%3D%2F%2Fevil.example%23y'],
  ] as const) {
    it(`${requested} → ${expected}`, async () => {
      const app = await mount({ console: true, door: servesEverything });
      const res = await app.request(requested);
      expect(res.status).toBe(302);
      const location = res.headers.get('location')!;
      expect(location).toBe(expected);
      expect(res.headers.get('set-cookie')).toBeNull();
      const resolved = new URL(location, ORIGIN);
      expect(resolved.origin).toBe(ORIGIN);
      expect(resolved.pathname.startsWith('/_console/f/')).toBe(true);
      expect(resolved.pathname.slice('/_console/f/'.length)).not.toContain('/');
      expect(resolved.search).toBe('');
      expect(resolved.hash).toBe('');
    });
  }

  it('a query string cannot steer it either: origin and path stay the console page', async () => {
    const app = await mount({ console: true, door: servesEverything });
    for (const query of ['?next=https://evil.example', '?x=%0D%0ASet-Cookie:%20a=b', '?/..//evil.example']) {
      const res = await app.request(`/forms/${OPEN}${query}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('set-cookie')).toBeNull();
      const location = res.headers.get('location')!;
      expect(location).toBe(`/_console/f/${OPEN}${query}`);
      const resolved = new URL(location, ORIGIN);
      expect(resolved.origin).toBe(ORIGIN);
      expect(resolved.pathname).toBe(`/_console/f/${OPEN}`);
    }
  });
});

describe('GET /forms/:slug — the request\'s query string travels to the page', () => {
  // The public form page seeds its fields from `?prefill_<field>=`, so a link
  // that carries one must land with it, byte for byte.
  for (const query of [
    '?prefill_source=website&utm_campaign=spring',
    '?prefill_name=Ada%20Lovelace&prefill_email=ada%40example.com&ref=a+b',
    '?prefill_message=line%0Aone&prefill_message=dup',
  ]) {
    it(`${query} arrives on Location unchanged`, async () => {
      const app = await mount({ console: true });
      const res = await app.request(`/forms/${OPEN}${query}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/_console/f/${OPEN}${query}`);
    });
  }

  it('a slug that needs encoding, together with a query: the path is re-encoded, the query is untouched', async () => {
    const app = await mount({ console: true, door: () => 'serve' });
    const query = '?prefill_source=website&lang=fr';
    const res = await app.request(`/forms/caf%C3%A9%20form${query}`);
    expect(app.doorCalls.map((d) => d.slug)).toEqual(['café form']);
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toBe(`/_console/f/caf%C3%A9%20form${query}`);
    const resolved = new URL(location, ORIGIN);
    expect(resolved.pathname).toBe('/_console/f/caf%C3%A9%20form');
    expect(resolved.searchParams.get('prefill_source')).toBe('website');
    expect(resolved.searchParams.get('lang')).toBe('fr');
  });

  it('the door is asked without the query', async () => {
    const app = await mount({ console: true });
    await app.request(`/forms/${OPEN}?prefill_source=website&utm_campaign=spring`);
    expect(app.doorCalls).toHaveLength(1);
    expect(app.doorCalls[0].query).toEqual({});
  });

  it('HEAD carries it too', async () => {
    const app = await mount({ console: true });
    const res = await app.request(`/forms/${OPEN}?prefill_source=website`, { method: 'HEAD' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/_console/f/${OPEN}?prefill_source=website`);
  });

  it('an empty query or a fragment adds nothing', async () => {
    const app = await mount({ console: true });
    expect((await app.request(`/forms/${OPEN}?`)).headers.get('location')).toBe(`/_console/f/${OPEN}`);
    expect((await app.request(`/forms/${OPEN}?a=1#frag`)).headers.get('location')).toBe(`/_console/f/${OPEN}?a=1`);
  });

  it('a slug the door does not serve keeps the same 404 with a query, byte for byte', async () => {
    const { answer, before } = await withAndWithout('/forms/unknown-slug?prefill_source=website');
    expect(before.status).toBe(404);
    expect(answer).toEqual(before);
  });
});

describe('GET /forms/:slug — every other request keeps the answer it got before', () => {
  it('a slug the door does not serve: the same 404, byte for byte', async () => {
    const { answer, before, doorCalls } = await withAndWithout('/forms/unknown-slug');
    expect(before.status).toBe(404);
    expect(JSON.parse(before.body)).toEqual({
      success: false,
      error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
    });
    expect(answer).toEqual(before);
    expect(doorCalls.map((d) => d.slug)).toEqual(['unknown-slug']);
  });

  it('a door that answers 500: the same 404, not a redirect', async () => {
    const { answer, before } = await withAndWithout(`/forms/${OPEN}`, undefined, () => 'fail');
    expect(before.status).toBe(404);
    expect(answer).toEqual(before);
  });

  it('a door that throws: the same 404, not a redirect', async () => {
    const { answer, before } = await withAndWithout(`/forms/${OPEN}`, undefined, () => 'throw');
    expect(before.status).toBe(404);
    expect(answer).toEqual(before);
  });

  for (const [label, p, init] of [
    ['a POST to an open slug (still 404, not 405)', `/forms/${OPEN}`, { method: 'POST' }],
    ['a trailing slash', `/forms/${OPEN}/`, undefined],
    ['the bare prefix', '/forms', undefined],
    ['the prefix with a slash', '/forms/', undefined],
    ['a nested path', `/forms/${OPEN}/submit`, undefined],
    ['a root-level slug (no catch-all)', `/${OPEN}`, undefined],
  ] as const) {
    it(`${label}: the same answer, and the door is never asked`, async () => {
      const { answer, before, doorCalls } = await withAndWithout(p, init as RequestInit | undefined);
      expect(before.status).toBe(404);
      expect(answer).toEqual(before);
      expect(doorCalls).toEqual([]);
    });
  }
});

describe('GET /forms/:slug — mounted only with the console', () => {
  it('no console plugin: an open slug answers the unmatched 404', async () => {
    const app = await mount({ console: false });
    const res = await app.request(`/forms/${OPEN}`);
    expect(res.status).toBe(404);
    expect(app.doorCalls).toEqual([]);
  });

  it('a console plugin with no built dist mounts nothing, the redirect included', async () => {
    const app = await mount({ console: true, dist: path.join(consoleRoot, 'missing-dist') });
    const res = await app.request(`/forms/${OPEN}`);
    expect(res.status).toBe(404);
    expect(app.doorCalls).toEqual([]);
  });

  it('control: the signed-in console route /_console/forms/:name is still the console bundle', async () => {
    const { answer, doorCalls } = await withAndWithout('/_console/forms/showcase_inquiry.contact');
    expect(answer.status).toBe(200);
    expect(answer.location).toBeNull();
    expect(answer.body).toContain('console');
    expect(doorCalls).toEqual([]);
  });
});
