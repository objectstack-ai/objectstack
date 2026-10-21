// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `createHonoApp`'s CORS answer ADMITS — through the real `hono/cors`
 * middleware (`app.request`), never a captured config.
 *
 * The governing text is `docs/HARDENING.md` § CORS: "Do **not** use
 * `origin: '*'` with `credentials: true`", and the go-live checklist's "CORS
 * origin list is explicit, not `*`". This door reads the same rule
 * `HonoServerPlugin` does (`resolveCorsAdmission` in
 * `@objectstack/plugin-hono-server`, which this package's vitest config
 * resolves to SOURCE), so a configuration gets the same answer here as there:
 *
 *  1. no origin list (neither `cors.origin` nor `OS_CORS_ORIGIN`): no
 *     cross-origin caller is admitted; a loopback origin is admitted on a
 *     development boot only;
 *  2. a configured list is admitted with credentials, and nothing else is — a
 *     loopback origin beside it on a development boot only;
 *  3. `'*'`, or a pattern whose host part is the bare `*`, together with
 *     credentials is refused when the app is created; without credentials it
 *     is served.
 *
 * "Admitted" is read off `Access-Control-Allow-Origin` — the one header a
 * browser checks before handing a cross-origin response to the page.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

// `@objectstack/runtime` resolves to `src/__mocks__/runtime.ts` (this
// package's vitest alias): the dispatcher is never reached on `/probe`.
import { createHonoApp, type ObjectStackHonoOptions } from './index';

const FOREIGN = 'https://other.example';
const CONFIGURED = 'https://app.example.com';
const LOOPBACK = 'http://localhost:5173';

/** Every variable the CORS block reads, canonical and legacy spellings. */
const CORS_ENV = [
  'OS_CORS_ENABLED', 'CORS_ENABLED',
  'OS_CORS_ORIGIN', 'CORS_ORIGIN',
  'OS_CORS_CREDENTIALS', 'CORS_CREDENTIALS',
  'OS_CORS_MAX_AGE', 'CORS_MAX_AGE',
  'NODE_ENV',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const name of CORS_ENV) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  // Not a development boot unless a case says so.
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  for (const name of CORS_ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const kernel = { name: 'cors-admission-kernel' } as unknown as ObjectStackHonoOptions['kernel'];

/** The real `createHonoApp`, with one probe route behind its middleware. */
function app(cors?: ObjectStackHonoOptions['cors']): Hono {
  const created = createHonoApp({ kernel, prefix: '/api/v1', ...(cors === undefined ? {} : { cors }) });
  created.get('/probe', (c) => c.text('ok'));
  return created;
}

/** The `Access-Control-Allow-Origin` a credentialed GET from `origin` is answered with. */
async function allowedOnGet(target: Hono, origin: string): Promise<string | null> {
  const res = await target.request('/probe', { headers: { Origin: origin, Cookie: 'session=1' } });
  expect(res.status).toBe(200);
  return res.headers.get('access-control-allow-origin');
}

/** The same, for the preflight a browser sends ahead of a non-simple request. */
async function allowedOnPreflight(target: Hono, origin: string): Promise<string | null> {
  const res = await target.request('/probe', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  return res.headers.get('access-control-allow-origin');
}

/** What `createHonoApp` threw; an app that was created fails the case. */
function refusal(cors?: ObjectStackHonoOptions['cors']): Error {
  let thrown: unknown = null;
  try {
    app(cors);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(Error);
  return thrown as Error;
}

describe('1. with no origin list configured, no cross-origin caller is admitted', () => {
  it('answers a foreign origin with no Access-Control-Allow-Origin, on a request and on a preflight', async () => {
    const target = app();
    expect(await allowedOnGet(target, FOREIGN)).toBeNull();
    expect(await allowedOnPreflight(target, FOREIGN)).toBeNull();
  });

  it('does not admit a loopback origin either, outside a development boot', async () => {
    const target = app();
    expect(await allowedOnGet(target, LOOPBACK)).toBeNull();
    expect(await allowedOnPreflight(target, LOOPBACK)).toBeNull();
  });

  it('admits a loopback origin, and still no foreign one, on a development boot', async () => {
    process.env.NODE_ENV = 'development';
    const target = app();
    expect(await allowedOnGet(target, LOOPBACK)).toBe(LOOPBACK);
    expect(await allowedOnGet(target, FOREIGN)).toBeNull();
  });
});

describe('2. a configured list is admitted with credentials, and nothing else is', () => {
  it('via the `cors.origin` option', async () => {
    const target = app({ origin: [CONFIGURED] });
    const res = await target.request('/probe', { headers: { Origin: CONFIGURED } });
    expect(res.headers.get('access-control-allow-origin')).toBe(CONFIGURED);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(await allowedOnGet(target, FOREIGN)).toBeNull();
  });

  it('via OS_CORS_ORIGIN, comma-separated, patterns included', async () => {
    process.env.OS_CORS_ORIGIN = `${CONFIGURED}, https://*.example.net`;
    const target = app();
    expect(await allowedOnGet(target, CONFIGURED)).toBe(CONFIGURED);
    expect(await allowedOnGet(target, 'https://tenant.example.net')).toBe('https://tenant.example.net');
    expect(await allowedOnGet(target, FOREIGN)).toBeNull();
  });

  it('admits a loopback origin beside the list on a development boot only', async () => {
    for (const origin of [[CONFIGURED], 'https://*.example.net']) {
      process.env.NODE_ENV = 'production';
      expect(await allowedOnGet(app({ origin }), LOOPBACK)).toBeNull();
      process.env.NODE_ENV = 'development';
      expect(await allowedOnGet(app({ origin }), LOOPBACK)).toBe(LOOPBACK);
    }
  });
});

describe("3. '*', or a pattern whose host part is the bare `*`, with credentials is refused when the app is created", () => {
  it('from the `cors.origin` option, with credentials left at their default, naming the entry', () => {
    for (const entry of ['*', 'https://*', '*://*', 'http://*:*']) {
      const err = refusal({ origin: entry });
      expect(err.message).toContain(`'${entry}'`);
      expect(err.message).toContain('OS_CORS_ORIGIN');
      expect(err.message).toContain('OS_CORS_CREDENTIALS');
    }
  });

  it('from OS_CORS_ORIGIN, alone or inside a list', () => {
    for (const value of ['*', ' * ', `${CONFIGURED},*`, 'https://*', `${CONFIGURED}, *://*`]) {
      process.env.OS_CORS_ORIGIN = value;
      refusal();
    }
  });

  it('with credentials named explicitly, by option or by OS_CORS_CREDENTIALS', () => {
    refusal({ origin: ['*'], credentials: true });
    process.env.OS_CORS_ORIGIN = 'https://*';
    process.env.OS_CORS_CREDENTIALS = 'true';
    refusal();
  });

  it('serves them without credentials, admitting any origin with no credentials header', async () => {
    process.env.OS_CORS_CREDENTIALS = 'false';
    for (const value of ['*', 'https://*']) {
      process.env.OS_CORS_ORIGIN = value;
      const res = await app().request('/probe', { headers: { Origin: FOREIGN } });
      expect(res.headers.get('access-control-allow-origin')).toBe(FOREIGN);
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    }
  });
});
