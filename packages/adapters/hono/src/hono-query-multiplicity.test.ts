// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23214] The `${prefix}/*` catch-all hands `dispatch()` a REPEATED query name
 * as an array, and a single-valued one as the plain string it always handed.
 *
 * ## The defect
 *
 * The catch-all copied `new URL(c.req.url).searchParams.forEach` into an
 * object, so `?package=a&package=b` reached `dispatch()` as `'b'`: the first
 * value was dropped without a word, and every arity rule the dispatcher
 * declares was unreachable on a `createHonoApp` host. It now reads the query as
 * `plugin-hono-server`'s `readQuery` does (`readDispatchQuery`).
 *
 * ## What is pinned here
 *
 *  1. THE SHAPE: a repeated name arrives as the array of every value, in order.
 *  2. THE CONTROL: every single-valued name arrives as the string the old line
 *     produced — checked against a reference Hono app that runs that exact
 *     line, so "unchanged" is a comparison, not a recollection.
 *  3. `__proto__` is an OWN key and no prototype moves. The old dynamic write
 *     dropped the name silently; `Object.fromEntries` keeps it as data.
 *
 * The dispatcher is a recording fixture: this package's config aliases
 * `@objectstack/runtime` to a stub for the whole suite. That the REAL
 * dispatcher then refuses the repeat — `/meta`, `/packages`, `?keepData` — is
 * pinned through a real `createHonoApp` in
 * `packages/qa/http-conformance/src/hono-query-multiplicity.conformance.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const seen: unknown[] = [];

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(async () => ({ handled: true, response: { status: 200, body: { ok: true } } })),
  dispatch: vi.fn(async (_method: string, _path: string, _body: unknown, query: unknown) => {
    seen.push(query);
    return { handled: true, response: { status: 200, body: { ok: true } } };
  }),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
const app = createHonoApp({ kernel: { name: 'test-kernel' } as any, prefix: PREFIX, cors: false });

/** What `dispatch()` was handed as its query for one request through the catch-all. */
async function dispatchedQuery(search: string): Promise<any> {
  seen.length = 0;
  const res = await app.request(`http://localhost${PREFIX}/meta/app/crm${search}`);
  expect(res.status).toBe(200);
  expect(seen).toHaveLength(1);
  return seen[0];
}

/** The catch-all's query line as it was before #23214 — the reference for "unchanged". */
async function referenceQuery(search: string): Promise<Record<string, any>> {
  let out: Record<string, any> = {};
  const ref = new Hono();
  ref.get('/*', (c) => {
    const queryParams: Record<string, any> = {};
    const url = new URL(c.req.url);
    url.searchParams.forEach((val, key) => { queryParams[key] = val; });
    out = queryParams;
    return c.text('ok');
  });
  await ref.request(`http://localhost/x${search}`);
  return out;
}

beforeEach(() => { seen.length = 0; });

describe('[#23214] a repeated query name reaches dispatch() as an array', () => {
  it.each([
    ['?package=a&package=b', { package: ['a', 'b'] }],
    ['?package=a&package=b&package=c', { package: ['a', 'b', 'c'] }],
    ['?keepData=true&keepData=true&layers=1', { keepData: ['true', 'true'], layers: '1' }],
    ['?status=a&type=x&status=b', { status: ['a', 'b'], type: 'x' }],
  ])('%s', async (search, expected) => {
    expect(await dispatchedQuery(search)).toEqual(expected);
  });
});

describe('[#23214] a single-valued name arrives exactly as the old line produced it', () => {
  it.each([
    [''],
    ['?package=crm'],
    ['?package=crm&preview=draft&locale=fr'],
    ['?q=hello+world'],
    ['?q=hello%20world&x=%E4%B8%AD'],
    ['?na%6De=v'],
    ['?empty='],
    ['?flag'],
    ['?select=id,name'],
  ])('%j', async (search) => {
    const got = await dispatchedQuery(search);
    expect(got).toEqual(await referenceQuery(search));
    for (const value of Object.values(got)) expect(typeof value).toBe('string');
  });
});

describe('[#23214] `__proto__` is an own key, and no prototype moves', () => {
  it('keeps one `__proto__` as an own data property', async () => {
    const got = await dispatchedQuery('?__proto__=x&polluted=1');
    expect(Object.hasOwn(got, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(got, '__proto__')?.value).toBe('x');
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
    expect(got.polluted).toBe('1');
  });

  it('keeps a repeated `__proto__` as an own array', async () => {
    const got = await dispatchedQuery('?__proto__=x&__proto__=y');
    expect(Object.getOwnPropertyDescriptor(got, '__proto__')?.value).toEqual(['x', 'y']);
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
  });
});
