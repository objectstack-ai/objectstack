/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Generates a Service Worker source string with offline support for
 * ObjectUI apps. The output is intended to be written to a file by the
 * application's build pipeline; it is *not* shipped at runtime by the
 * mobile package itself.
 *
 * Two strategies:
 *
 * `'offline-first'` (the default, unchanged) does three things:
 *  1. Caches the application shell on install (`cache-first` strategy).
 *  2. Falls back to network-first for API calls, so reads are fresh
 *     when online and degrade to cached responses when offline.
 *  3. Listens for `sync` events with tag `objectui-offline-queue` and
 *     posts a `REPLAY_QUEUE` message to all clients so the running
 *     pages can flush their queues from the foreground.
 *
 * `'app-shell'` is a build-versioned shell that never holds data
 * (objectstack#29155). The worker must be served from the app's base
 * directory, so its registration scope is the app itself:
 *  1. Its cache is named after the scope and the build (`options.build`).
 *     Activation deletes every other cache of the same scope, so the previous
 *     build's chunks go when the new build takes over.
 *  2. Requests under `apiPrefix`, and every request outside the scope, are
 *     network-only: the worker never answers them, never reads the cache for
 *     them and never writes them to it, so no data and no cookie is stored.
 *  3. Navigations are network-first. Offline, they get the cached HTML entry
 *     (the scope root, precached on install), so a cold start shows the shell.
 *  4. Hashed assets under `<scope>assets/` are cache-first; every other file
 *     in scope is network-first with a cached fallback. Both cache on fetch.
 *  5. A page can post `{ type: 'objectui:cache-urls', urls }` to cache the
 *     in-scope files it loaded before the worker controlled it.
 *  6. It installs with `skipWaiting()` and claims its clients on activation.
 *     With the entry network-first, the next navigation after a deploy runs
 *     the new build, and no shell can pin a user to an old one.
 *
 * `notifications: true` adds `push` and `notificationclick` handlers (either
 * strategy). A push payload is JSON `{ title, body?, route?, tag? }`; `route`
 * is an in-app path relative to the scope, the field the mobile shell reads.
 * A click focuses (or opens) an app window at that route. A route that is not
 * an in-app path, or that resolves outside the scope (`/../api/...`), is
 * refused: the click only closes the notification.
 */

export type ServiceWorkerStrategy = 'offline-first' | 'app-shell';

export interface ServiceWorkerSourceOptions {
  /**
   * Cache name; bump to invalidate on deploy. Under `'app-shell'` it is the
   * prefix of the cache name, which adds the scope and the build to it.
   */
  cacheName?: string;
  /**
   * Application shell URLs to pre-cache on install. Under `'app-shell'` they
   * resolve against the worker's own URL, and the scope root (`./`) is always
   * added.
   */
  precache?: string[];
  /** URL path prefix that identifies API requests. */
  apiPrefix?: string;
  /** Background-sync tag name. */
  syncTag?: string;
  /** Caching strategy; see the module notes. Default `'offline-first'`. */
  strategy?: ServiceWorkerStrategy;
  /**
   * The build's identity, which names the `'app-shell'` cache. Required by
   * `'app-shell'` and refused by `'offline-first'`, which does not read it.
   */
  build?: string;
  /** Add the `push` and `notificationclick` handlers. Default `false`. */
  notifications?: boolean;
}

/** The message a page posts to an `'app-shell'` worker to cache files it already loaded. */
export const SERVICE_WORKER_CACHE_URLS_MESSAGE = 'objectui:cache-urls';

/**
 * Build a Service Worker JavaScript source string. Customize the cache
 * version, app shell, and sync tag via `options`.
 */
export function getServiceWorkerSource(options: ServiceWorkerSourceOptions = {}): string {
  const strategy = options.strategy ?? 'offline-first';
  if (strategy !== 'offline-first' && strategy !== 'app-shell') {
    throw new Error(
      `getServiceWorkerSource: unknown strategy ${JSON.stringify(strategy)}; use 'offline-first' or 'app-shell'.`,
    );
  }
  const build = options.build?.trim();
  if (strategy === 'app-shell' && !build) {
    throw new Error(
      "getServiceWorkerSource: the 'app-shell' strategy needs `build` (the build's identity), which names its cache.",
    );
  }
  if (strategy === 'offline-first' && options.build !== undefined) {
    throw new Error(
      "getServiceWorkerSource: `build` is read only by the 'app-shell' strategy; the 'offline-first' worker is versioned by `cacheName`.",
    );
  }

  const apiPrefix = options.apiPrefix ?? '/api/';
  const syncTag = options.syncTag ?? 'objectui-offline-queue';
  const body =
    strategy === 'app-shell'
      ? appShellSource({
          cachePrefix: options.cacheName ?? 'objectui-app-shell',
          build: build as string,
          precache: options.precache ?? [],
          apiPrefix,
          syncTag,
        })
      : offlineFirstSource({
          cacheName: options.cacheName ?? 'objectui-shell-v1',
          precache: options.precache ?? ['/', '/index.html'],
          apiPrefix,
          syncTag,
        });

  return `// Auto-generated by @object-ui/mobile getServiceWorkerSource()
${body}

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of all) {
      client.postMessage({ type: 'REPLAY_QUEUE', tag: SYNC_TAG });
    }
  })());
});
${options.notifications ? NOTIFICATION_HANDLERS : ''}`;
}

function offlineFirstSource(o: { cacheName: string; precache: string[]; apiPrefix: string; syncTag: string }): string {
  return `const CACHE = ${JSON.stringify(o.cacheName)};
const PRECACHE = ${JSON.stringify(o.precache)};
const API_PREFIX = ${JSON.stringify(o.apiPrefix)};
const SYNC_TAG = ${JSON.stringify(o.syncTag)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.pathname.startsWith(API_PREFIX)) {
    // Network-first for API
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Cache-first for shell assets
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })),
  );
});`;
}

function appShellSource(o: {
  cachePrefix: string;
  build: string;
  precache: string[];
  apiPrefix: string;
  syncTag: string;
}): string {
  return `const BUILD = ${JSON.stringify(o.build)};
const API_PREFIX = ${JSON.stringify(o.apiPrefix)};
const SYNC_TAG = ${JSON.stringify(o.syncTag)};
const SCOPE = new URL(self.registration.scope);
// One cache per build of THIS app: the scope keeps two apps of one origin apart.
const CACHE_PREFIX = ${JSON.stringify(o.cachePrefix)} + '::' + SCOPE.pathname + '::';
const CACHE = CACHE_PREFIX + BUILD;
// The HTML entry: the scope root, which serves the app's index document.
const ENTRY = SCOPE.href;
const ASSETS = new URL('assets/', SCOPE).pathname;
const PRECACHE = Array.from(new Set([ENTRY].concat(
  ${JSON.stringify(o.precache)}.map((u) => new URL(u, self.location.href).href),
)));
const CACHE_URLS_MESSAGE = ${JSON.stringify(SERVICE_WORKER_CACHE_URLS_MESSAGE)};

// Network-only: under the API prefix, or outside this app.
function bypasses(url) {
  return url.pathname.startsWith(API_PREFIX)
    || url.origin !== SCOPE.origin
    || !url.pathname.startsWith(SCOPE.pathname);
}

function storable(res) {
  return !!res && res.ok && res.type === 'basic' && !res.redirected;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'no-cache' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

// Navigations: network-first; offline, the precached HTML entry.
async function navigation(event) {
  try {
    return await fetch(event.request);
  } catch (error) {
    const cached = await caches.match(ENTRY, { cacheName: CACHE });
    if (cached) return cached;
    throw error;
  }
}

// Hashed assets: cache-first, cached on fetch.
async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (storable(res)) event.waitUntil(cache.put(event.request, res.clone()));
  return res;
}

// Every other file in scope: network-first, cached on fetch, cached copy offline.
async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(event.request);
    if (storable(res)) event.waitUntil(cache.put(event.request, res.clone()));
    return res;
  } catch (error) {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (bypasses(url)) return;
  if (req.mode === 'navigate') event.respondWith(navigation(event));
  else if (url.pathname.startsWith(ASSETS)) event.respondWith(cacheFirst(event));
  else event.respondWith(networkFirst(event));
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== CACHE_URLS_MESSAGE || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const raw of data.urls) {
      if (typeof raw !== 'string') continue;
      let url;
      try { url = new URL(raw, SCOPE); } catch { continue; }
      url.hash = '';
      if (bypasses(url) || url.href === ENTRY) continue;
      if (await cache.match(url.href)) continue;
      try {
        const res = await fetch(url.href);
        if (storable(res)) await cache.put(url.href, res);
      } catch {
        // Offline or gone: the next controlled load caches it on fetch.
      }
    }
  })());
});`;
}

// Shared by both strategies. `isInAppRoute` follows `@object-ui/mobile`'s
// page-side check of the same name; the scope test after it is what refuses
// a route that climbs out (`/../api/x`) once the URL parser normalizes it.
const NOTIFICATION_HANDLERS = `
const NOTIFICATION_SCOPE = new URL(self.registration.scope);

function isInAppRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return false;
  for (let i = 0; i < route.length; i += 1) {
    const c = route.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return false;
  }
  return true;
}

// The window URL for an in-app route, or null when the route is refused.
function routeTarget(route) {
  if (!isInAppRoute(route)) return null;
  let target;
  try { target = new URL('.' + route, NOTIFICATION_SCOPE); } catch { return null; }
  if (target.origin !== NOTIFICATION_SCOPE.origin) return null;
  if (!target.pathname.startsWith(NOTIFICATION_SCOPE.pathname)) return null;
  return target.href;
}

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try { payload = event.data.json() || {}; } catch { payload = { body: event.data.text() }; }
  }
  const title = typeof payload.title === 'string' ? payload.title : '';
  const options = { data: { route: typeof payload.route === 'string' ? payload.route : null } };
  if (typeof payload.body === 'string') options.body = payload.body;
  if (typeof payload.tag === 'string' && payload.tag) options.tag = payload.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data && event.notification.data.route;
  const target = route == null ? NOTIFICATION_SCOPE.href : routeTarget(route);
  if (!target) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(NOTIFICATION_SCOPE.href));
    if (open) {
      // \`navigate()\` answers only for a window this worker controls.
      const moved = await open.navigate(target).catch(() => null);
      if (moved) {
        await moved.focus();
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
`;
