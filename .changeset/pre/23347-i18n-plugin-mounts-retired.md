---
'@objectstack/service-i18n': minor
---

fix(service-i18n)!: `I18nServicePlugin` no longer mounts its own copy of `/api/v1/i18n/*`; the runtime dispatcher is the one owner, and the `registerRoutes` / `basePath` options are removed

Clause-②: no

<!-- adr-0087: not-required (runtime-interface-only packages/services/service-i18n/src/i18n-service-plugin.ts#I18nServicePluginOptions) One TypeScript-only declaration in one runtime file narrows: the plugin's constructor options interface loses its `registerRoutes` and `basePath` members, which drove the plugin's own HTTP mounts and nothing else. No spec key, authorable metadata spelling, Zod schema or stored shape moves, and no stored row is read or rewritten, so `objectstack migrate meta` has nothing to rewrite. The channel that reaches an affected consumer is the compiler, at the consumer's own constructor call. The other half of the change is runtime routing in compositions that carry no dispatcher, which no ledger entry can describe. -->

**BREAKING** for code that constructs `I18nServicePlugin` with route options, and for a composition that serves HTTP without the runtime dispatcher. It ships as `minor` under the launch-window convention for breaking changes.

**What changed.** The three i18n routes (`GET /api/v1/i18n/locales`, `/translations/:locale`, `/labels/:object/:locale`) had two registrations: the runtime dispatcher's, in its `start()`, and this plugin's, in a `kernel:ready` hook. Measured on `objectstack serve` over the showcase app, the dispatcher's registration answered every request on all three paths, because it registers first and the HTTP adapter answers a duplicate path with its first registration. The plugin's copy was never reached there. Where it could be reached — a composition with an HTTP server and no dispatcher — it did not apply the authenticated-caller floor the dispatcher's i18n domain applies (ADR-0056 D2). It is removed: one route, one owner. The plugin still registers the `i18n` service and still syncs runtime-authored translations; the dispatcher's `/i18n` domain serves the routes from that service, exactly as before on `objectstack serve` and `objectstack dev`.

**If you passed `registerRoutes` or `basePath`.** Delete them from the options object. `registerRoutes: false` is now what always happens. There is no replacement for `basePath`: the routes live where the dispatcher mounts them.

**If you serve HTTP without the dispatcher.** The plugin no longer answers `/api/v1/i18n/*` there. Compose the runtime dispatcher (`createDispatcherPlugin` from `@objectstack/runtime`) to serve the i18n routes, with its authenticated-caller floor.
