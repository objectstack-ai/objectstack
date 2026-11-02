/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29155 — the generated `'app-shell'` worker, run against a fake
 * worker global: cache versioning by build, the API-bypass rule, the HTML
 * entry's offline fallback, and the `push` / `notificationclick` handlers.
 */

import { describe, it, expect, vi } from 'vitest';
import { getServiceWorkerSource, SERVICE_WORKER_CACHE_URLS_MESSAGE } from '../serviceWorkerSource';

const ORIGIN = 'https://app.test';
const CONSOLE_SCOPE = `${ORIGIN}/_console/`;
let SCOPE = CONSOLE_SCOPE;

type Listener = (event: any) => void;
type NetworkAnswer = (url: string) => Response | Promise<Response>;

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

function keyOf(input: string | { url: string }): string {
  return typeof input === 'string' ? new URL(input).href : input.url;
}

function basic(body: string, init: ResponseInit = {}): Response {
  const res = new Response(body, { status: 200, ...init });
  Object.defineProperty(res, 'type', { value: 'basic' });
  return res;
}

/** A fake worker global running the generated source. */
function bootWorker(source: string, options: { network?: NetworkAnswer; caches?: Record<string, Record<string, string>> } = {}) {
  const listeners = new Map<string, Listener[]>();
  const store = new Map<string, Map<string, Response>>();
  for (const [name, entries] of Object.entries(options.caches ?? {})) {
    store.set(name, new Map(Object.entries(entries).map(([url, body]) => [url, basic(body)])));
  }

  let online = true;
  const network = options.network ?? ((url: string) => basic(`network:${url}`));
  const requested: string[] = [];
  const fetchImpl = vi.fn(async (input: string | { url: string }) => {
    const url = keyOf(input);
    requested.push(url);
    if (!online) throw new TypeError('Failed to fetch');
    return network(url);
  });

  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name)!;
    return {
      match: async (req: string | { url: string }) => entries.get(keyOf(req))?.clone(),
      put: async (req: string | { url: string }, res: Response) => {
        entries.set(keyOf(req), res.clone());
      },
      addAll: async (reqs: Array<string | { url: string }>) => {
        for (const req of reqs) {
          const res = await fetchImpl(req);
          if (!res.ok) throw new TypeError(`addAll: ${keyOf(req)} answered ${res.status}`);
          entries.set(keyOf(req), res);
        }
      },
    };
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (req: string | { url: string }, opts: { cacheName?: string } = {}) => {
      const names = opts.cacheName ? [opts.cacheName] : [...store.keys()];
      for (const name of names) {
        const hit = store.get(name)?.get(keyOf(req));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };

  const windows: any[] = [];
  const self = {
    location: new URL(`${SCOPE}service-worker.js`),
    registration: { scope: SCOPE, showNotification: vi.fn(async () => {}) },
    skipWaiting: vi.fn(async () => {}),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };

  new Function('self', 'caches', 'fetch', source)(self, caches, fetchImpl);

  async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      respondWith: (p: Promise<Response>) => {
        response = p;
      },
    };
    for (const fn of listeners.get(type) ?? []) fn(event);
    const answer = response ? await response.catch((error: unknown) => error) : undefined;
    await Promise.all(pending);
    // A waitUntil registered while the answer resolved.
    await Promise.all(pending);
    return { answered: response !== undefined, answer, event };
  }

  return {
    self,
    store,
    windows,
    fetchImpl,
    requested,
    setOnline: (value: boolean) => {
      online = value;
    },
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    fetch: (url: string, init: Partial<FakeRequest> = {}) =>
      dispatch('fetch', { request: { url: new URL(url, SCOPE).href, method: 'GET', mode: 'cors', ...init } }),
    message: (data: unknown) => dispatch('message', { data }),
    push: (data: unknown) =>
      dispatch('push', {
        data:
          data === undefined
            ? null
            : { json: () => (typeof data === 'string' ? JSON.parse(data) : data), text: () => String(data) },
      }),
    click: (route: unknown) => {
      const notification = { data: { route }, close: vi.fn() };
      return dispatch('notificationclick', { notification }).then((r) => ({ ...r, notification }));
    },
  };
}

function appShell(build: string, extra: Record<string, unknown> = {}) {
  return getServiceWorkerSource({
    strategy: 'app-shell',
    build,
    cacheName: 'objectui-console',
    precache: ['./assets/index-AbC12345.js', './assets/index-XyZ98765.css'],
    notifications: true,
    ...extra,
  });
}

const cacheOf = (build: string) => `objectui-console::/_console/::${build}`;

describe('getServiceWorkerSource — options contract', () => {
  it("keeps the default worker as it was: API network-first with a cached fallback, no push handlers", () => {
    const source = getServiceWorkerSource();
    expect(source).toContain('const CACHE = "objectui-shell-v1";');
    expect(source).toContain('// Network-first for API');
    expect(source).not.toContain("addEventListener('push'");
    expect(source).not.toContain("addEventListener('notificationclick'");
  });

  it("refuses 'app-shell' without a build, a build under 'offline-first', and an unknown strategy", () => {
    expect(() => getServiceWorkerSource({ strategy: 'app-shell' })).toThrow(/needs `build`/);
    expect(() => getServiceWorkerSource({ strategy: 'app-shell', build: '  ' })).toThrow(/needs `build`/);
    expect(() => getServiceWorkerSource({ build: 'b1' })).toThrow(/read only by the 'app-shell' strategy/);
    expect(() => getServiceWorkerSource({ strategy: 'other' as never, build: 'b1' })).toThrow(/unknown strategy/);
  });

  it('emits source that parses', () => {
    expect(() => new Function(appShell('b1'))).not.toThrow();
    expect(() => new Function(getServiceWorkerSource({ notifications: true }))).not.toThrow();
  });
});

describe("'app-shell' worker — cache versioning by build", () => {
  it('precaches the HTML entry and the entry assets into a cache named after the scope and the build', async () => {
    const sw = bootWorker(appShell('b1'));
    await sw.install();
    expect([...sw.store.keys()]).toEqual([cacheOf('b1')]);
    expect([...sw.store.get(cacheOf('b1'))!.keys()].sort()).toEqual([
      SCOPE,
      `${SCOPE}assets/index-AbC12345.js`,
      `${SCOPE}assets/index-XyZ98765.css`,
    ]);
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("activation deletes every older cache of this app and nothing else, then claims the app's windows", async () => {
    const sw = bootWorker(appShell('b2'), {
      caches: {
        [cacheOf('b1')]: { [`${SCOPE}assets/old-Aa111111.js`]: 'old' },
        [cacheOf('b0')]: { [SCOPE]: 'older' },
        'objectui-console::/other-app/::b1': { [`${ORIGIN}/other-app/`]: 'other app' },
        'someone-elses-cache': { [`${ORIGIN}/x`]: 'x' },
      },
    });
    await sw.install();
    await sw.activate();
    expect([...sw.store.keys()].sort()).toEqual(
      [cacheOf('b2'), 'objectui-console::/other-app/::b1', 'someone-elses-cache'].sort(),
    );
    expect(sw.self.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe("'app-shell' worker — the API bypass rule", () => {
  it('never answers, reads or writes an API request, even with that URL in its cache', async () => {
    const api = `${ORIGIN}/api/v1/data/account`;
    const sw = bootWorker(appShell('b1'), { caches: { [cacheOf('b1')]: { [api]: 'stale private data' } } });
    for (const mode of ['cors', 'navigate', 'same-origin']) {
      const { answered } = await sw.fetch(api, { mode });
      expect(answered, `mode ${mode}`).toBe(false);
    }
    // A cross-origin API server is bypassed by both rules.
    expect((await sw.fetch('https://api.example.com/api/v1/auth/session')).answered).toBe(false);
    expect([...sw.store.get(cacheOf('b1'))!.keys()]).toEqual([api]);
    expect(sw.fetchImpl).not.toHaveBeenCalled();
  });

  it('leaves non-GET requests, other origins and paths outside its scope to the network', async () => {
    const sw = bootWorker(appShell('b1'));
    expect((await sw.fetch(`${SCOPE}assets/a-Bb222222.js`, { method: 'POST' })).answered).toBe(false);
    expect((await sw.fetch('https://tiles.example.com/1/2/3.png')).answered).toBe(false);
    expect((await sw.fetch(`${ORIGIN}/forms/abc`, { mode: 'navigate' })).answered).toBe(false);
    expect(sw.fetchImpl).not.toHaveBeenCalled();
    expect(sw.store.size).toBe(0);
  });

  it('bypasses the API prefix on its own, at a root mount where /api/ is inside the scope', async () => {
    SCOPE = `${ORIGIN}/`;
    try {
      const sw = bootWorker(appShell('b1'));
      for (const mode of ['cors', 'navigate']) {
        expect((await sw.fetch(`${ORIGIN}/api/v1/data/account`, { mode })).answered, `mode ${mode}`).toBe(false);
      }
      // The control: a file under the same root mount is answered.
      expect((await sw.fetch(`${ORIGIN}/favicon.svg`)).answered).toBe(true);
    } finally {
      SCOPE = CONSOLE_SCOPE;
    }
  });

  it('honours a custom API prefix', async () => {
    const sw = bootWorker(appShell('b1', { apiPrefix: '/_console/rpc/' }));
    expect((await sw.fetch(`${SCOPE}rpc/call`)).answered).toBe(false);
  });
});

describe("'app-shell' worker — HTML entry and assets", () => {
  it('serves navigations from the network while online, and the cached entry offline', async () => {
    let html = '<html>build b1</html>';
    const sw = bootWorker(appShell('b1'), {
      network: (url) => basic(url === SCOPE || url.startsWith(`${SCOPE}apps/`) ? html : `asset ${url}`),
    });
    await sw.install();

    // A deploy changes the document: the next navigation runs it, no stale shell.
    html = '<html>build b2</html>';
    const online = await sw.fetch(`${SCOPE}apps/crm`, { mode: 'navigate' });
    expect(await (online.answer as Response).text()).toBe('<html>build b2</html>');

    sw.setOnline(false);
    const offline = await sw.fetch(`${SCOPE}apps/crm/account`, { mode: 'navigate' });
    expect(await (offline.answer as Response).text()).toBe('<html>build b1</html>');
  });

  it('a navigation offline with no cached entry fails as a network error', async () => {
    const sw = bootWorker(appShell('b1'));
    sw.setOnline(false);
    const { answered, answer } = await sw.fetch(SCOPE, { mode: 'navigate' });
    expect(answered).toBe(true);
    expect(answer).toBeInstanceOf(TypeError);
  });

  it('answers hashed assets cache-first and caches them on fetch', async () => {
    const sw = bootWorker(appShell('b1'));
    const chunk = `${SCOPE}assets/route-login-Cc333333.js`;
    const first = await sw.fetch(chunk);
    expect(await (first.answer as Response).text()).toBe(`network:${chunk}`);
    sw.setOnline(false);
    const second = await sw.fetch(chunk);
    expect(await (second.answer as Response).text()).toBe(`network:${chunk}`);
    expect(sw.requested.filter((u) => u === chunk)).toHaveLength(1);
  });

  it('answers other files in scope network-first, with the cached copy offline', async () => {
    let logo = 'logo v1';
    const sw = bootWorker(appShell('b1'), { network: () => basic(logo) });
    await sw.fetch(`${SCOPE}favicon.svg`);
    logo = 'logo v2';
    expect(await ((await sw.fetch(`${SCOPE}favicon.svg`)).answer as Response).text()).toBe('logo v2');
    sw.setOnline(false);
    expect(await ((await sw.fetch(`${SCOPE}favicon.svg`)).answer as Response).text()).toBe('logo v2');
  });

  it('caches only the in-scope, non-API files a page posts', async () => {
    const sw = bootWorker(appShell('b1'));
    await sw.message({
      type: SERVICE_WORKER_CACHE_URLS_MESSAGE,
      urls: [
        `${SCOPE}assets/lazy-Dd444444.js`,
        `${ORIGIN}/api/v1/auth/get-session`,
        'https://cdn.example.com/font.woff2',
        `${ORIGIN}/elsewhere.js`,
        42,
      ],
    });
    expect([...sw.store.get(cacheOf('b1'))!.keys()]).toEqual([`${SCOPE}assets/lazy-Dd444444.js`]);
  });
});

describe('notification handlers', () => {
  it('shows a push payload with its route, and tolerates a missing or non-JSON payload', async () => {
    const sw = bootWorker(appShell('b1'));
    await sw.push({ title: 'Approval needed', body: 'Deal #42', route: '/apps/crm/deal/42', tag: 'deal-42' });
    expect(sw.self.registration.showNotification).toHaveBeenLastCalledWith('Approval needed', {
      body: 'Deal #42',
      tag: 'deal-42',
      data: { route: '/apps/crm/deal/42' },
    });
    await sw.push(undefined);
    expect(sw.self.registration.showNotification).toHaveBeenLastCalledWith('', { data: { route: null } });
  });

  it('a click focuses an open app window at the route', async () => {
    const sw = bootWorker(appShell('b1'));
    const focused = { focus: vi.fn(async () => {}) };
    const win = { url: `${SCOPE}apps/crm`, navigate: vi.fn(async () => focused), focus: vi.fn() };
    sw.windows.push({ url: `${ORIGIN}/other/`, navigate: vi.fn(), focus: vi.fn() }, win);
    const { notification } = await sw.click('/apps/crm/deal/42?tab=history');
    expect(notification.close).toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledWith(`${SCOPE}apps/crm/deal/42?tab=history`);
    expect(focused.focus).toHaveBeenCalled();
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('a click opens a window at the route when none is open, or when the open one is not controlled', async () => {
    const sw = bootWorker(appShell('b1'));
    await sw.click('/apps/crm/deal/42');
    expect(sw.self.clients.openWindow).toHaveBeenLastCalledWith(`${SCOPE}apps/crm/deal/42`);

    sw.windows.push({ url: SCOPE, navigate: vi.fn(async () => Promise.reject(new TypeError('not controlled'))) });
    await sw.click('/');
    expect(sw.self.clients.openWindow).toHaveBeenLastCalledWith(SCOPE);

    await sw.click(null);
    expect(sw.self.clients.openWindow).toHaveBeenLastCalledWith(SCOPE);
  });

  it.each([
    ['climbs out of the scope', '/../api/v1/data/user'],
    ['climbs out encoded', '/%2e%2e/%2e%2e/admin'],
    ['is protocol-relative', '//evil.example.com/phish'],
    ['is an absolute URL', 'https://evil.example.com/'],
    ['has a backslash', '/\\evil.example.com'],
    ['has a control character', '/apps\n/crm'],
    ['is relative', 'apps/crm'],
    ['is not a string', 42],
  ])('refuses a route that %s: no window opens or moves', async (_label, route) => {
    const sw = bootWorker(appShell('b1'));
    const win = { url: SCOPE, navigate: vi.fn(async () => null), focus: vi.fn() };
    sw.windows.push(win);
    const { notification } = await sw.click(route);
    expect(notification.close).toHaveBeenCalled();
    expect(win.navigate).not.toHaveBeenCalled();
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled();
  });
});
