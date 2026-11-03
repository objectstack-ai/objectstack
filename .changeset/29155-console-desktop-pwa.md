---
'@object-ui/mobile': patch
'@object-ui/console': patch
'@objectstack/cli': patch
---

feat(console): the Console is an installable PWA on desktop, with an offline app shell and a Service Worker ready for Web Push

Clause-②: yes (widening)
Metadata-protocol: none

The Console already injected a web app manifest, but nothing registered a Service Worker, so the installed app showed a browser error page on a cold start without network, and Web Push had no worker to reach. Under the CLI's content-security-policy the branded manifest was refused too, so the served Console was not installable at all.

- **`@object-ui/mobile` gains an `'app-shell'` worker strategy.** `getServiceWorkerSource({ strategy: 'app-shell', build })` writes a build-versioned shell worker: its cache is named after the scope and the build, and activation deletes the scope's caches of every other build. Requests under `apiPrefix` and every request outside the scope are network-only (the worker never answers them, never reads or writes the cache for them, so no data and no cookie is stored). Navigations are network-first with the precached HTML entry as the offline fallback; hashed `assets/` files are cache-first. `build` is required by `'app-shell'` and refused by `'offline-first'`. The default `'offline-first'` worker is byte-identical to before.
- **`notifications: true`** adds `push` and `notificationclick` handlers. A click focuses or opens an app window at the payload's `route`, an in-app path relative to the scope; a route that is not an in-app path, or that climbs out of the scope, opens nothing. No push subscription is made.
- **`cacheLoadedResources(worker)`** asks an `'app-shell'` worker to cache the files the page loaded before the worker controlled it, so the first visit's lazy chunks are there for an offline start. `SERVICE_WORKER_CACHE_URLS_MESSAGE` and `ServiceWorkerStrategy` are exported beside it.
- **The Console registers it.** The build emits `service-worker.js` at its root (precache: the entry chunk, its static imports and their CSS), and the Console registers it under its own mount (`/_console/`), never the site root, in production builds. The next navigation after a deploy runs the new build. Inside the ObjectStack mobile shell no worker is registered, and one registered earlier in that WebView is removed. The generated manifest's `start_url`, `scope` and icon are absolute URLs under the mount.
- **`@objectstack/cli`**: the Console document's policy adds `manifest-src 'self' blob:`, so the branded manifest loads and the Console is installable.
