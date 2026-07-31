// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IPluginLifecycleEvents — the registry of kernel-bus events that actually fire.
 *
 * Every key in this interface is an event some shipping code path triggers via
 * `ctx.trigger(...)` (or `triggerHook` in the lite kernel), with its payload
 * tuple as observed at the fire site. The registry is *enforced*, not
 * aspirational, in two ways:
 *
 * - {@link LifecycleEventName} feeds `IPluginContext.hook` / `trigger`
 *   autocomplete in `@objectstack/core` (as `LifecycleEventName | (string & {})`,
 *   so custom cross-plugin events remain legal — the bus is open by design).
 * - `plugin-lifecycle-events.test.ts` pins the key set to the fire-site
 *   inventory. Adding a key here without a real emitter — or removing one that
 *   still fires — fails that test with a pointer back to this doc.
 *
 * ## Retired names (ADR-0049 enforce-or-remove)
 *
 * An earlier revision of this file also declared a typed-event system that was
 * never built: `kernel:before-init`, `kernel:after-init`, `plugin:registered`,
 * `plugin:before-init`, `plugin:init`, `plugin:after-init`,
 * `plugin:before-start`, `plugin:started`, `plugin:after-start`,
 * `plugin:before-destroy`, `plugin:destroyed`, `plugin:after-destroy`,
 * `plugin:error`, `service:registered`, `service:unregistered`,
 * `hook:registered`, `hook:triggered` — seventeen names with no emitter and no
 * listener anywhere — plus an `ITypedEventEmitter` interface and a parallel
 * set of Zod payload schemas (`kernel/plugin-lifecycle-events.zod.ts`) with
 * zero consumers. All of it is retired, same playbook as the PluginSchema
 * lifecycle-hook retirement (#4212): a declared-but-dead contract reads as a
 * promise and silently swallows anyone who codes against it. If per-plugin
 * phase events become real, re-add each name together with its emitter and a
 * fire-site pointer, and extend the pinning test.
 */
export interface IPluginLifecycleEvents {
    /**
     * Emitted when kernel is ready (all plugins initialized).
     *
     * Fired by `ObjectKernel.start()` and `LiteKernel.bootstrap()` after every
     * plugin's `start()` has completed. Handlers run sequentially in plugin
     * registration order — see `kernel:bootstrapped` for the ordering caveat.
     *
     * Payload: []
     */
    'kernel:ready': [];

    /**
     * Emitted AFTER every `kernel:ready` handler has completed, but BEFORE
     * `kernel:listening` (so before any HTTP socket opens).
     *
     * This is the "all synchronous bootstrap has settled" anchor. Because
     * `kernel:ready` handlers run sequentially in plugin-registration order,
     * a handler cannot rely on data produced by a plugin that starts later
     * (e.g. the security bootstrap seeds `sys_position`, the app plugin's
     * seed loader inserts records) — reconcile/backfill work that consumes
     * that data would race the very rows it needs. Do such work here instead:
     * every producer's `kernel:ready` handler has finished by the time this
     * fires. HTTP `listen()` is deliberately deferred one more phase to
     * `kernel:listening` so late route registration still lands.
     *
     * CAVEAT: this does NOT guarantee app *seed* data has settled. The app
     * plugin's inline seed only blocks the kernel for `OS_INLINE_SEED_BUDGET_MS`
     * (default 8s); a bundle that exceeds that budget continues seeding in the
     * background and can outlast `kernel:bootstrapped` and even `kernel:listening`
     * (#2996). Subscribe `app:seeded` for the true per-app seed-settle point.
     *
     * Payload: []
     */
    'kernel:bootstrapped': [];

    /**
     * Emitted AFTER all `kernel:ready` and `kernel:bootstrapped` handlers
     * have completed.
     *
     * Use this hook for actions that must happen *strictly after* every
     * other plugin has had a chance to register routes / services /
     * middleware during `kernel:ready` — most notably HTTP server
     * `listen()`.
     *
     * Why a separate phase: route registration in Hono (and similar
     * routers) seals the matcher the first time a request is matched.
     * If a server starts listening during `kernel:ready` while sibling
     * plugins are still adding routes in their own `kernel:ready`
     * hooks, an inbound request can build the matcher mid-init and
     * subsequent `app.get(...)` calls throw "matcher is already built".
     * On a fast-fronting platform (e.g. Cloudflare Containers) this
     * race fires on every cold boot.
     *
     * Payload: []
     */
    'kernel:listening': [];

    /**
     * Emitted when kernel is shutting down, before plugins are destroyed.
     *
     * Payload: []
     */
    'kernel:shutdown': [];

    /**
     * Emitted by the app plugin when an app's inline seed attempt has settled
     * — success, partial (dropped records), or fallback insert. Single-tenant
     * mode only, and only when the app actually has seed datasets.
     *
     * When the inline seed completes within `OS_INLINE_SEED_BUDGET_MS` this
     * fires during plugin start (before `kernel:ready`); when it overruns the
     * budget and finishes in the background it fires AFTER `kernel:ready` /
     * `kernel:bootstrapped` / `kernel:listening` — `overBudget` distinguishes
     * the two. May fire once per registered app bundle.
     *
     * Consumers MUST be idempotent: this is the settle signal for reconcilers
     * that read seeded rows. plugin-auth re-runs the ADR-0093 D6 membership
     * backfill here so users inserted by an over-budget seed (which bypass
     * better-auth's `user.create.after` reconciler) still get bound to the
     * default org without waiting for the next restart (#2996).
     *
     * Payload: [{ appId, overBudget }]
     */
    'app:seeded': [payload: { appId: string; overBudget: boolean }];

    /**
     * Emitted by the metadata plugin's artifact watcher after a changed
     * `dist/objectstack.json` has been re-parsed and re-registered mid-run.
     *
     * `changed` entries are `'{type}/{name}'` strings (e.g.
     * `'flow/ticket_closed'`). `metadata`, when present, carries the freshly
     * parsed artifact collections so subscribers can consume the ones that
     * never reach the MetadataManager (seed datasets under `data` have no
     * `name`). The app plugin uses it to load seeds for objects that appear
     * mid-run. The collections shape is owned by `@objectstack/metadata`; the
     * spec keeps it opaque.
     *
     * Payload: [{ changed, metadata? }]
     */
    'metadata:reloaded': [payload: { changed: string[]; metadata?: unknown }];

    /**
     * Emitted by `@objectstack/plugin-auth` while assembling its better-auth
     * config, BEFORE the auth instance is created. The open extension point
     * for packages that contribute auth providers (enterprise SSO, hosted
     * control-plane SSO, …) without forking the auth plugin: handlers mutate
     * the draft config in place. Both payload types are owned by plugin-auth;
     * the spec keeps them opaque.
     *
     * Payload: [authConfig, ctx]
     */
    'auth:configure': [authConfig: unknown, ctx: unknown];

    // ── The `{service}:ready` convention ─────────────────────────────────
    // Service plugins announce readiness as `{service}:ready`, passing the
    // live service instance so sibling plugins can extend it. Each instance
    // type is owned by its package; the spec keeps them opaque. A new service
    // adopting the convention adds its concrete name here (custom names are
    // legal without registration — the bus is open — but a registered name
    // autocompletes and is pinned to its fire site by the registry test).

    /**
     * Emitted by `@objectstack/mcp` once its server runtime is constructed
     * and tools are registered. Payload: the live `MCPServerRuntime`.
     *
     * Payload: [runtime]
     */
    'mcp:ready': [runtime: unknown];

    /**
     * Emitted by `@objectstack/service-automation` at start, once the flow
     * engine is ready. Payload: the live automation engine.
     *
     * Payload: [engine]
     */
    'automation:ready': [engine: unknown];

    /**
     * Emitted by `@objectstack/service-analytics` at start. Payload: the live
     * analytics service.
     *
     * Payload: [service]
     */
    'analytics:ready': [service: unknown];

    /**
     * Emitted by `@objectstack/service-datasource` at start. Payload: the
     * live external-datasource service.
     *
     * Payload: [service]
     */
    'external-datasource:ready': [service: unknown];

    /**
     * Emitted by `@objectstack/service-datasource`'s admin plugin at start.
     * Payload: the live datasource-admin service.
     *
     * Payload: [service]
     */
    'datasource-admin:ready': [service: unknown];

    /**
     * Emitted by the external-validation plugin's background drift checker
     * (ADR-0015 §5.2), one event per federated object whose remote schema no
     * longer matches its declared shape. Consumed by audit / notification
     * services. `diffs` entries are `SchemaDiffEntry` values owned by
     * `@objectstack/runtime`; the spec keeps them opaque.
     *
     * Payload: [{ datasource, object, diffs }]
     */
    'external.schema.drift': [
        event: { datasource: string; object: string; diffs: unknown[] },
    ];

    /**
     * Emitted by the cloud AI service plugin (out-of-repo emitter) with the
     * dynamic `RouteDefinition[]` it wants mounted; the dispatcher plugin
     * listens and mounts each route on the HTTP server (environment-scoped
     * variants included). Because plugin start order is not guaranteed, the
     * emitter also caches the routes on the kernel as `__aiRoutes` for the
     * dispatcher to recover when it starts late — see
     * `DispatcherPlugin` for the recovery half of the protocol.
     *
     * Payload: [routes]
     */
    'ai:routes': [routes: unknown[]];
}

/**
 * Union of every kernel-bus event name that actually fires.
 *
 * `IPluginContext.hook` / `trigger` in `@objectstack/core` accept
 * `LifecycleEventName | (string & {})`: known names autocomplete, custom
 * cross-plugin event names stay legal.
 */
export type LifecycleEventName = keyof IPluginLifecycleEvents & string;
