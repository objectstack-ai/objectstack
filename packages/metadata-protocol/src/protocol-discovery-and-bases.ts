// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Discovery, types, diagnostics, packaged bases,
 * credential carry-forward" section of `ObjectStackProtocolImplementation`: the
 * bodies of `getDiscovery`, `getMetaTypes`,
 * `rethrowUnlessMetadataStoreUnprovisioned`, `getPackagedObjectBase`,
 * `packagedArtifactBase`, `objectRegistrationRefusal`,
 * `restoreTranslatedObjectEchoes`, `restoreInjectedColumnEchoes`,
 * `registeredTranslationBundle`, `readCodeLayerForCarryForward` moved out of
 * `protocol.ts` whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as `packages/metadata-protocol/scripts/host-split.mjs` moves
 * one (ruling E, item E1): re-indented one level, with `this.<member>` read as
 * `host.<member>` and nothing else changed. Each method stays on the class
 * with its docblock and signature, which the published `.d.ts` prints, and
 * hands its body the host (`protocol-host.ts`); the docblock there is the
 * contract.
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import {
    CHANNEL_SURFACE_SLOTS,
    isSubscribableChannel,
    readAuthFamilies,
    readChannelRoute,
    readServiceSelfInfo,
    resolveDiscoveryEnvironment,
} from '@objectstack/spec/api';
import type { ApiRoutes, CapabilityDescriptor, ServiceInfo, WellKnownCapabilities } from '@objectstack/spec/api';
import { engineCanRollBack } from '@objectstack/core';
import { resolveDiscoveryVersion } from './discovery-version.js';
import type { SysMetadataRepository } from './sys-metadata-repository.js';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL, unrecognisedMetaTypeRefusal } from '@objectstack/spec/shared';
import { CORE_SERVICE_PROVIDER, serviceUnavailableMessage } from '@objectstack/spec/system';
import type { TranslationBundle } from '@objectstack/spec/system';
import { restoreTranslatedEchoes } from './protocol-translated-echo.js';
import type { RestoredTranslatedSlot } from './protocol-translated-echo.js';
import {
    DEFAULT_METADATA_TYPE_REGISTRY,
    getMetadataCreateSeed,
    getMetadataTypeActions,
    getMetadataTypeSchema,
} from '@objectstack/spec/kernel';
import { storedBodyForCarryForward } from './protocol-credential-carry-forward.js';
import type { Equal, MetaTypesListing } from './protocol-meta-types-listing.js';
import {
    HAND_CRAFTED_SCHEMAS,
    TYPE_TO_FORM,
    canonicalMetaType,
    toJsonSchemaSafe,
} from './protocol-meta-type-schema.js';
import { metadataReadFailureError } from './protocol-client-failures.js';
import { SERVICE_CONFIG } from './protocol-discovery-services.js';
import type { SaveMetaItemRequest } from './protocol-door-requests.js';
import type { ProtocolHost } from './protocol-host.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/** The body of `ObjectStackProtocolImplementation#getDiscovery`; the method's docblock there is its contract. */
export async function getDiscovery(host: Pick<ProtocolHost, 'engine' | 'getServicesRegistry' | 'searchAll'>) {
    // Get registered services from kernel if available
    const registeredServices = host.getServicesRegistry ? host.getServicesRegistry() : new Map();

    // Build dynamic service info with proper typing. Analytics is NOT in
    // this kernel-provided block: since the degraded ObjectQL fallback was
    // retired (#3891) it is an ordinary optional service, computed from the
    // registry via SERVICE_CONFIG below — absent means `unavailable`, and
    // no route is advertised (the pre-#2462 hardcode here is exactly what
    // the fallback was invented to make true).
    //
    // [#4089] The `metadata` slot is reported from whatever fills it, not
    // hardcoded `available`. The kernel auto-registers `createMemoryMetadata`
    // when no MetadataPlugin is present, and plugin-dev registers its own
    // in-memory registry; both self-describe as `degraded` (D12), and
    // hardcoding `available` here overstated them as exactly equivalent to a
    // sys_metadata-backed registry. Absent or unmarked ⇒ `available`, which
    // is what the real MetadataPlugin (carrying no marker) reports.
    //
    // This is also where the two builders stopped disagreeing: the runtime
    // dispatcher hardcoded the opposite verdict for the same slot
    // (`degraded` + "DB persistence pending"), so one host called a persisted
    // registry degraded while the other called an in-memory one available.
    // Both now compute it, and `handlerReady: true` is stated on both sides:
    // `/api/v1/meta` is served by the protocol, not by this service, so it is
    // mounted whichever implementation occupies the slot.
    const metadataSelf = readServiceSelfInfo(registeredServices.get('metadata'));

    // [#4130] `data` was the last self-judging entry in this block. Same
    // reasoning, one degree weaker: its hardcoded `available` is currently
    // true, but only because ObjectQL is the slot's sole producer and
    // plugin-dev (whose `data` stub declares `stub`) always loads
    // ObjectQLPlugin as a child. That is a load-order convention in another
    // package, not something this builder verifies — so verify it here.
    // Unmarked implementation ⇒ `available` + `handlerReady: true`, i.e.
    // exactly what the hardcode said, now derived rather than asserted.
    const dataSelf = readServiceSelfInfo(registeredServices.get('data'));

    const services: Record<string, ServiceInfo> = {
        // --- Kernel-provided (objectql is an example kernel implementation) ---
        metadata:  {
            enabled: true,
            status: metadataSelf?.status ?? ('available' as const),
            handlerReady: true,
            route: '/api/v1/meta',
            provider: 'objectql',
            ...(metadataSelf?.message ? { message: metadataSelf.message } : {}),
        },
        data:      {
            enabled: true,
            status: dataSelf?.status ?? ('available' as const),
            handlerReady: dataSelf?.handlerReady ?? true,
            route: '/api/v1/data',
            provider: 'objectql',
            ...(dataSelf?.message ? { message: dataSelf.message } : {}),
        },
    };

    // [#4000, #4058] The dispatcher answers a self-declared non-handler in
    // one of ITS domains' slots with the same 404/501 an empty slot gets
    // (`isServiceServeable`, runtime/src/service-serveable.ts), so this
    // builder must not advertise a route for one — that would be the
    // `declared ≠ enforced` gap discovery exists to close.
    //
    // Scoped to the dispatcher-owned domains on purpose. For the other
    // entries in SERVICE_CONFIG the route belongs to the plugin that
    // registers the service (service-storage's own `/api/v1/storage`
    // routes, plugin-search, plugin-graphql, …) rather than to a dispatcher
    // domain, so `handlerReady` there says nothing about whether THAT route
    // is mounted, and suppressing it would be a guess. `storage` stays
    // listed as the one entry with no dispatcher domain behind it — #4087
    // retired the `/storage` bridge — because for that slot `handlerReady`
    // is not a proxy for anything, it is the fact itself: an occupant that
    // mounts no HTTP surface must not have `/api/v1/storage` advertised on
    // its behalf. When service-storage is installed it registers a real
    // (unmarked) service and mounts the routes, so the entry never fires.
    const DISPATCHER_GATED_SERVICES = new Set([
        'analytics', 'automation', 'notification', 'ai', 'i18n', 'storage',
    ]);
    const unserveable = (serviceName: string) =>
        DISPATCHER_GATED_SERVICES.has(serviceName)
        && readServiceSelfInfo(registeredServices.get(serviceName))?.handlerReady === false;
    const advertisedRoute = (serviceName: string, route?: string) =>
        unserveable(serviceName) ? undefined : route;

    // Check which services are actually registered
    for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
        if (registeredServices.has(serviceName)) {
            // Registered — but honor a stub/dev/fallback self-description
            // instead of blindly reporting 'available' (ADR-0076 D12).
            const self = readServiceSelfInfo(registeredServices.get(serviceName));
            // [#14646] Channel slots answer a different question than every
            // other row here. `enabled` elsewhere means "the slot is
            // filled"; for a slot whose advertised capability IS a
            // subscribable channel that reading is what let `/discovery`
            // report `enabled: true` beside "no HTTP/WS realtime surface is
            // mounted" — both true, one field, two meanings. Here `enabled`
            // is the shared predicate itself, evaluated on the very entry a
            // consumer reads, so the field and the definition are one
            // computation. The route comes from the occupant because no
            // builder in the open framework mounts a realtime transport.
            if (CHANNEL_SURFACE_SLOTS.has(serviceName)) {
                const channelRoute = readChannelRoute(registeredServices.get(serviceName));
                const handlerReady = channelRoute !== undefined;
                services[serviceName] = {
                    enabled: isSubscribableChannel({ handlerReady, route: channelRoute }),
                    // A mounted channel makes an unmarked occupant plainly
                    // `available`; without one the slot keeps the reduced
                    // status its row declares (`degraded` for realtime — the
                    // capability it advertises IS the missing surface).
                    status: self?.status
                        ?? (handlerReady
                            ? ('available' as const)
                            : (config.noHttpSurface?.statusWhenUnmarked ?? ('available' as const))),
                    route: channelRoute,
                    provider: CORE_SERVICE_PROVIDER[serviceName] ?? undefined,
                    handlerReady,
                    // The "no surface" sentence is only true while there is
                    // no surface; a mounted channel drops it and keeps only
                    // whatever the occupant says about itself.
                    ...(self?.message
                        ? { message: self.message }
                        : !handlerReady && config.noHttpSurface
                            ? { message: config.noHttpSurface.message }
                            : {}),
                };
                continue;
            }
            // No HTTP surface at all: the handler can never be ready, and
            // the entry's own `noHttpSurface` declaration says whether that
            // also degrades the slot (realtime) or not (cache/queue/job —
            // in-process contracts, #4318).
            const noHttpSurface = !config.route;
            services[serviceName] = {
                enabled: true,
                status: self?.status ?? (config.noHttpSurface?.statusWhenUnmarked ?? ('available' as const)),
                route: advertisedRoute(serviceName, config.route),
                provider: CORE_SERVICE_PROVIDER[serviceName] ?? undefined,
                ...(noHttpSurface || self?.handlerReady !== undefined
                    ? { handlerReady: noHttpSurface ? false : self?.handlerReady }
                    : {}),
                ...(self?.message
                    ? { message: self.message }
                    : config.noHttpSurface
                        ? { message: config.noHttpSurface.message }
                        : {}),
            };
        } else {
            // Service is not registered
            services[serviceName] = {
                enabled: false,
                status: 'unavailable' as const,
                message: serviceUnavailableMessage(serviceName),
            };
        }
    }

    // [#9683] `file-storage` is the deprecated v17 alias of the `storage`
    // slot, and it is a key existing consumers really read off this
    // document (objectui's console endpoint catalog is keyed by it). The
    // registry resolves both names to the same instance, so discovery
    // mirrors the canonical row VERBATIM under the alias key until the
    // alias retires at the next major — dropping the key would be the
    // silent inside-a-major break the ruling forbids. Deliberately a
    // byte-equal copy, not a second opinion: one slot, two spellings.
    services['file-storage'] = { ...services['storage'] };

    // Build routes from services — a flat convenience map for client routing
    const serviceToRouteKey: Record<string, keyof ApiRoutes> = {
        analytics: 'analytics',
        auth: 'auth',
        automation: 'automation',
        ui: 'ui',
        realtime: 'realtime',
        notification: 'notifications',
        ai: 'ai',
        i18n: 'i18n',
        storage: 'storage',
        // [#6633] The package-management surface. `package` is NOT a
        // CoreServiceName slot, so it must not enter SERVICE_CONFIG — a
        // non-slot row there is the shape of the retired `graphql` defect,
        // and it would also fabricate a `services` availability entry whose
        // remedy line lies. Its route flows through the
        // NON_SLOT_SERVICE_ROUTES loop below instead: same gate
        // (registered service), same mapping table, one hop over.
        package: 'packages',
    };

    // [#6633] Routes advertised for registered services that are not
    // CoreServiceName slots. Advertised iff the service is registered —
    // the same convention every SERVICE_CONFIG row uses, and for `package`
    // it is exactly the predicate that decides the mount on both real host
    // types: the @objectstack/rest direct-mount registrar is gated on this
    // same service (`direct-mount-composition.ts`), and the runtime
    // dispatcher — whose `/packages` domain is unconditional — answers
    // discovery from its own `getDiscoveryInfo()`, never from this
    // builder.
    //
    // `datasources` is deliberately NOT here (same reasoning as `mcp`,
    // #5679): the federation mount belongs to the REST host, which this
    // builder cannot see, and the runtime dispatcher serves no
    // `/datasources` domain at all — advertising it from here would be the
    // advertise-the-unmounted half of ADR-0076 D12. The REST discovery
    // endpoint advertises it from its recorded direct mounts.
    const NON_SLOT_SERVICE_ROUTES: Record<string, string> = {
        package: '/api/v1/packages',
    };

    const optionalRoutes: Partial<ApiRoutes> = {};

    // Add routes for available plugin services. Services without an HTTP
    // surface (config.route undefined) advertise no route (D12, #2462).
    for (const serviceName of Object.keys(SERVICE_CONFIG)) {
        // [#14646] Read the route off the entry that was just built rather
        // than re-deriving it from the table. Byte-identical for every
        // table-routed slot, and it is the only spelling that stays correct
        // for a channel slot, whose route comes from the occupant — two
        // derivations of one fact is how `routes` and `services` drift.
        const route = services[serviceName]?.route;
        if (registeredServices.has(serviceName) && route) {
            const routeKey = serviceToRouteKey[serviceName];
            if (routeKey) {
                optionalRoutes[routeKey] = route;
            }
        }
    }

    // [#6633] Same flow for the non-slot routed services declared above.
    for (const [serviceName, route] of Object.entries(NON_SLOT_SERVICE_ROUTES)) {
        if (registeredServices.has(serviceName)) {
            const routeKey = serviceToRouteKey[serviceName];
            if (routeKey) {
                optionalRoutes[routeKey] = route;
            }
        }
    }

    const routes: ApiRoutes = {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        ...optionalRoutes,
    };

    // Build well-known capabilities from registered services.
    //
    // [#5672] `WellKnownCapabilitiesSchema` is THE capability vocabulary and
    // `DiscoverySchema.capabilities` is now a closed object over it, so this
    // literal must answer EVERY key — a capability this host does not
    // deliver is `enabled: false`, never an absent key (maintainer ruling A,
    // 2026-08-06). The `WellKnownCapabilities` annotation is what enforces
    // that at compile time: adding a key to the vocabulary breaks this line
    // until it is answered here.
    //
    // Each key's basis is recorded next to it. Where a capability is backed
    // by a service slot, the predicate is deliberately the SAME one that
    // decides whether the route is advertised (`advertisedRoute`/
    // `unserveable` above) — what we advertise and what we claim cannot
    // disagree.
    const capabilityServed = (serviceName: string) =>
        registeredServices.has(serviceName) && !unserveable(serviceName);

    const wellKnown: WellKnownCapabilities = {
        // Comments/chatter are served by the `sys_comment` object via the generic
        // data API (ADR-0052 §5) — not a dedicated service. The capability is true
        // iff that object is loaded (the always-on audit slate provides it); this
        // keeps declared === enforced (Prime Directive #10). #3180
        comments: !!host.engine.registry?.getObject?.('sys_comment'),
        automation: registeredServices.has('automation'),
        cron: registeredServices.has('job'),
        // [#7541] Serveability-gated on the protocol's OWN search
        // implementation, was slot presence. This is the same predicate the
        // route refuses on: `registerSearchEndpoints`
        // (packages/rest/src/rest-server.ts) 501s exactly when
        // `typeof protocol.searchAll !== 'function'`, so the two ends can no
        // longer answer the same question differently — the rule stated at
        // the top of this block, applied to the key that was still exempt.
        //
        // The old predicate was wrong in the direction discovery exists to
        // prevent: `searchAll` is implemented by this class unconditionally,
        // nothing in either repository registers the `search` slot
        // (CORE_SERVICE_PROVIDER records that, verified), so every REST host
        // served `GET /api/v1/search` 200 while advertising
        // `capabilities.search = false`. A conforming client — one that
        // trusts the document instead of probing — skipped a working
        // surface. Prime Directive #10 inverted.
        //
        // `services.search` is deliberately NOT collapsed into this. The
        // slot is a distinct question with its own answer: `CoreServiceName`
        // declares it "Search Engine (Elastic/Meili)" and `ISearchService`
        // is an index/query contract, so `services.search` reports WHICH
        // ENGINE occupies the slot while this bit reports WHETHER THE
        // SURFACE IS SERVED (`WellKnownCapabilitiesSchema.search`: "whether
        // the backend supports full-text search"). They may legitimately
        // differ — an empty slot with a served endpoint is today's normal
        // host — and `serviceUnavailableMessage('search')` now says so in
        // the same document, the way `ui` does for the same shape (#4146).
        search: typeof host.searchAll === 'function',
        export: registeredServices.has('automation') || registeredServices.has('queue'),
        // [#5672] Serveability-gated, was presence-only. Two reasons, and
        // the second is the binding one:
        //   1. `declared === enforced` — a self-declared stub storage service
        //      mounts no HTTP surface, so this builder already withholds
        //      `routes.storage` from it; advertising chunked upload anyway
        //      promised an upload endpoint that cannot exist.
        //   2. the runtime dispatcher answers this key `hasFiles`, i.e.
        //      `isServiceServeable(filesSvc)`. Leaving this one on presence
        //      would make the two producers give the SAME host opposite
        //      answers for the SAME key — a new dialect inside the
        //      vocabulary this issue exists to unify.
        chunkedUpload: capabilityServed('storage'),
        // Atomic cross-object batch (#3298 / #1604 / ADR-0034 item 4): the
        // REST /batch endpoint runs its ops inside `engine.transaction()`,
        // which only opens a real (all-or-nothing) transaction when the
        // DEFAULT DRIVER can carry one — otherwise it takes its declared
        // non-transactional path (ADR-0119 D1) and the batch degrades to a
        // non-atomic passthrough. Advertise the capability iff the runtime
        // can actually roll back, so `declared === enforced` (Prime
        // Directive #10). The rest-server producer ANDs this with
        // `api.enableBatch` so a server that doesn't mount the route reports
        // `false` at its layer.
        //
        // [#18997] `engineCanRollBack`, NOT `typeof this.engine?.transaction
        // === 'function'`. The refusal this advertisement exists to help a
        // caller avoid — `runAtomicBatch`'s `501 NOT_IMPLEMENTED`, whose own
        // remedy text says to probe `capabilities.transactionalBatch` on
        // /discovery first — already asks `engineCanRollBack`, which asks the
        // DRIVER as well as the engine. `engine.transaction` is a function on
        // every real engine, so the engine-only probe answered `true` for the
        // two compositions that 501: a default driver with no
        // `beginTransaction` at all, and one that INHERITED it and declared
        // `supports.transactionsUnsupported` (#18063). An advertised
        // capability must answer the same question the refusal path asks,
        // from the same predicate — two derivations of one capability is how
        // these drifted. Narrowing only: this predicate is the engine probe
        // AND a driver clause, so no composition newly advertises `true`
        // (`protocol.discovery-transactional-batch-honesty.test.ts` pins both
        // directions, and the driver clause is skipped where the registry is
        // not inspectable, so a test double keeps its old answer).
        transactionalBatch: engineCanRollBack(host.engine),

        // ── Joined the vocabulary with ruling A (#5672) ───────────────────
        // These six used to be the runtime dispatcher's half of the split.
        // This builder can answer all of them from the services registry it
        // already reads, so none of them is a "cannot deliver ⇒ false"
        // placeholder — they are measured, per key:

        // [#14646] Derived, not stated. This flag and `services.realtime`
        // answer the same question — "is there a channel to subscribe to?"
        // — so it is the same predicate applied to the same entry
        // (`isSubscribableChannel`), and a host that mounts a transport
        // flips both in one step. It was a literal `false` beside an entry
        // saying `enabled: true`: two constants that happened to be right
        // are not agreement, they are two places to forget. False on every
        // host the open framework ships, because `service-realtime` is an
        // in-process pub/sub bus that names no channel route (ADR-0076 D12,
        // #2462; maintainer ruling A, 2026-09-04).
        websockets: isSubscribableChannel(services['realtime']),
        // Storage: the `storage` slot (#9683), gated on serveability rather
        // than presence — a self-declared stub mounts nothing, and this
        // builder already withholds `routes.storage` from it.
        files: capabilityServed('storage'),
        analytics: capabilityServed('analytics'),
        ai: capabilityServed('ai'),
        // Slot is `notification` (singular, CoreServiceName); the capability
        // and the route key are plural. Same slot, three spellings — the
        // mapping is here so nothing has to guess it.
        notifications: capabilityServed('notification'),
        i18n: capabilityServed('i18n'),
    };

    // Convert flat booleans → hierarchical capability objects.
    //
    // [#5672] Keyed by the vocabulary, not by `string`. The old
    // `Record<string, …>` was assignable to the open record
    // `DiscoverySchema.capabilities` used to be; against the closed shape
    // it no longer is, and that is the closure doing its job — the compiler
    // now refuses a producer whose capability map is not the whole
    // vocabulary. Iterating `wellKnown`'s own keys means fullness is
    // carried over from the annotated literal above rather than re-asserted.
    const capabilities = {} as Record<keyof WellKnownCapabilities, CapabilityDescriptor>;
    for (const key of Object.keys(wellKnown) as Array<keyof WellKnownCapabilities>) {
        capabilities[key] = { enabled: wellKnown[key] };
    }

    // [#4828] Locale, derived from the registered i18n service exactly the
    // way the runtime dispatcher's `getDiscoveryInfo()` derives it — same
    // accessors, same fallback. `DiscoverySchema` declares `locale`
    // REQUIRED and this producer never emitted it, so the REST `/discovery`
    // shape could not satisfy the schema at all; deriving it (rather than
    // hardcoding `en`) keeps the answer honest on a stack that actually
    // ships translations.
    const i18nSvc = registeredServices.get('i18n');
    let locale = { default: 'en', supported: ['en'], timezone: 'UTC' };
    if (i18nSvc) {
        const defaultLocale = typeof i18nSvc.getDefaultLocale === 'function'
            ? i18nSvc.getDefaultLocale() : 'en';
        const locales = typeof i18nSvc.getLocales === 'function'
            ? i18nSvc.getLocales() : [];
        locale = {
            default: defaultLocale,
            supported: locales.length > 0 ? locales : [defaultLocale],
            timezone: 'UTC',
        };
    }

    // [#4828] `name` is the canonical identity key (`DiscoverySchema`
    // requires it); `apiName` is the deprecated alias, emitted with the
    // IDENTICAL value until its scheduled removal in protocol 18 (schedule
    // in `GetDiscoveryResponseSchema`). Before this, the two discovery
    // producers spelled the same concept differently and disjointly — this
    // one emitted only `apiName`, the dispatcher only `name` — so no
    // consumer had a key that worked against both.
    const name = 'ObjectStack API';

    // [#21046] Which optional `/auth` route families are mounted — the
    // registered auth service's OWN public-config answer, the object
    // `GET /auth/config` serves, through the one reader the runtime
    // dispatcher's `getDiscoveryInfo()` calls too (`readAuthFamilies`,
    // `@objectstack/spec/api`). This builder never re-derives "is the admin
    // plugin on" itself. `undefined` — no `auth` service in this kernel
    // (then no `routes.auth` either), or one that publishes no public
    // config — emits no key; the REST `/discovery` passes the value through.
    const authFamilies = readAuthFamilies(registeredServices.get('auth'));

    return {
        // [commit 376c70f98] The serving system's identity, DERIVED — an injected
        // `OS_RUNTIME_VERSION` stamp, falling back to this package's own
        // resolved version. It was the literal `'1.0'` while the other
        // `DiscoverySchema` producer (`HttpDispatcher.getDiscoveryInfo()`
        // in `@objectstack/runtime`) carried its own literal `'1.0.0'` —
        // two producers of the same field disagreeing with each other,
        // which is what proves neither constant was ever a contract value.
        // #10993 fixed that producer the same way; see
        // {@link resolveDiscoveryVersion} for the derivation, the fallback,
        // and why the resolver is a package-local copy rather than an
        // import.
        version: resolveDiscoveryVersion(),
        name,
        /** @deprecated Use `name`. Removed in protocol 18 (#4828). */
        apiName: name,
        // [#5936] The operator's value, passed as read — no local default.
        // What an ABSENT `NODE_ENV` advertises is decided once, inside
        // `resolveDiscoveryEnvironment` (`production`, per the 2026-08-07
        // ruling, direction 1), so this producer and the runtime dispatcher
        // cannot drift on it. Before that ruling the default lived at the
        // dispatcher's own call site and this producer had no equivalent, so
        // a deployment that forgot the variable was told `development` here
        // and `production` there — the exact drift the shared mapper exists
        // to prevent (#4828). Do not re-introduce a default here.
        environment: resolveDiscoveryEnvironment(
            (globalThis as { process?: { env?: Record<string, string | undefined> } })
                .process?.env?.NODE_ENV,
        ),
        routes,
        locale,
        services,
        capabilities,
        ...(authFamilies ? { authFamilies } : {}),
    };
}

/** The body of `ObjectStackProtocolImplementation#getMetaTypes`; the method's docblock there is its contract. */
export async function getMetaTypes(host: Pick<ProtocolHost, 'envWritableTypes' | 'listLiveMetadataTypes'>): Promise<MetaTypesListing> {
    const allTypes = await host.listLiveMetadataTypes();

    // Phase 3a-1: enrich response with per-type registry metadata so admin
    // UI can render directory pages, filter by domain, decide which types
    // expose write actions, etc. Existing clients keep working — the
    // `types: string[]` field is preserved alongside the new `entries`.
    //
    // Phase 3a-env-writable: `OS_METADATA_WRITABLE` env var (comma
    // separated singular type names) elevates `allowEnvironmentOverlay` on
    // listed types (`overrideSource: 'env'`). The same env var is consulted
    // by `isOverlayAllowed()` at write time — they must stay in sync — and
    // since ADR-0131 D6 it opens only items no managed package ships: a
    // managed item stays sealed whatever the hatch names
    // (`isSealedManagedItem`).
    //
    // ONE wire spelling, on BOTH arms below: the registry arm's `...base`
    // spread already carries `allowEnvironmentOverlay` at the registry
    // value, and the elevated value OVERWRITES that same key — never a
    // second field — so no entry carries `allowEnvironmentOverlay`, the spelling
    // retired in 18 (its tombstone is `MetadataTypeRegistryEntry`'s).
    const writableOverrides = host.envWritableTypes();
    const registryByType = new Map(
        DEFAULT_METADATA_TYPE_REGISTRY.map((e) => [e.type, e] as const)
    );

    const entries = allTypes.map((type) => {
        const singular = (PLURAL_TO_SINGULAR[type] ?? type) as string;
        // Phase 3a-schema: emit a JSON Schema per type so the generic
        // metadata admin UI can render real forms (no more raw-JSON
        // textareas for new resources). The canonical schema for every
        // built-in (and plugin-registered) metadata type lives in the
        // central `getMetadataTypeSchema()` registry; we delegate so
        // Studio's editor and the runtime overlay validator stay in
        // lock-step (one source of truth).
        const zodSchema = getMetadataTypeSchema(singular);
        // [#17501] `singular` is passed so the degenerate-derivation warning
        // can name the type it could not derive. A type with NO zod schema
        // never reaches the converter at all — absence is not degeneracy.
        const schema = (zodSchema ? toJsonSchemaSafe(zodSchema, singular) : undefined)
            ?? HAND_CRAFTED_SCHEMAS[singular];
        const form = TYPE_TO_FORM[singular];
        // Phase 2: the authoritative minimal create seed (single source of
        // truth in @objectstack/spec). Studio/CLI derive create defaults
        // from this via /meta/types instead of re-inventing them.
        const createSeed = getMetadataCreateSeed(singular);

        // Type-level actions: merge the registry's declarative actions
        // with any plugin-registered overlay (`registerMetadataTypeActions`).
        // This is the single accessor — a host plugin (e.g. the private
        // datasource-admin backend) contributes its `test_connection`
        // button here, co-located with the route handler it calls, so the
        // button only appears when the backend that serves it is installed.
        const typeActions = getMetadataTypeActions(singular);

        const base = registryByType.get(singular as any);
        if (base) {
            const isEnvOverridden = writableOverrides.has(singular);
            return {
                ...base,
                type: singular,
                schemaId: singular, // API client expects schemaId field
                allowEnvironmentOverlay: base.allowEnvironmentOverlay || isEnvOverridden,
                overrideSource: isEnvOverridden && !base.allowEnvironmentOverlay
                    ? 'env' as const
                    : 'registry' as const,
                schema,
                form,
                ...(createSeed !== undefined ? { createSeed } : {}),
                // Override the spread `base.actions` with the merged view
                // (declarative + plugin-registered). Omit when empty to
                // preserve the prior "no actions key" response shape.
                ...(typeActions.length ? { actions: typeActions } : {}),
            };
        }
        // Runtime-registered type with no registry entry — synthesise a
        // minimal descriptor so the UI can still surface it.
        //
        // [#8421] `allowRuntimeCreate` is DERIVED FROM THE MINT DOOR'S OWN
        // CONTRACT rather than synthesised as `true`. The two doors are the
        // same sentence read twice — this endpoint says which types a
        // caller may create, `refuseUnmintableMetaType` decides whether the
        // create is honoured — so they consult ONE predicate
        // ({@link unrecognisedMetaTypeRefusal}) instead of two
        // independently-maintained rules that drifted apart.
        //
        // What this keeps, and it is the whole point: the legitimate
        // plugin kinds with no static registry entry — `webhook`,
        // `connector`, `analytics_cube`, `rag_pipeline` — are IN the static
        // spelling contract (limb 1 of the URL map), so the predicate
        // accepts them and they stay advertised as creatable. (`theme` and
        // `sharing_rule` were two more: `theme` left the contract with its
        // carrier, and ADR-0131 D6 gave `sharing_rule` a code-only registry
        // entry, so it takes the registry arm above.)
        // `PUT /meta/theme/dark` is the operation the plugin path exists to
        // serve and this change must not touch it.
        //
        // What this withdraws: `policy`, `data`, `package`, `kind` — live
        // `SchemaRegistry` keys an ordinary `registerApp` produces, outside
        // that contract. They were advertised `allowRuntimeCreate: true` by
        // the blanket `true` below and nothing ever honoured a create on
        // them; the door has refused them since this card's first cut. The
        // read door now agrees at the honest value instead of promising a
        // write the platform will not perform (the same remedy the
        // 2026-08-07 ruling chose for `api`: withdraw the advertisement
        // rather than converge the read path onto it).
        //
        // ## The premise, and why it is a CURRENT one (maintainer, 2026-08-15)
        //
        // The blanket `true` was not careless: while a plugin could DECLARE
        // a metadata kind, a name with no registry entry might be a real
        // kind this synthesis had not heard of, so "permissive by
        // construction" was the safe reading. That premise is what expired.
        // The ruling, verbatim and untranslated:
        //
        //     暂时不考虑让插件申明新的元数据类型
        //
        // ⚠️ `暂时` is load-bearing and is recorded as such: this is the
        // platform's CURRENT posture, not a permanent architectural
        // closure. Plugin-declared metadata kinds were considered, are
        // understood, and are deferred — not ruled impossible. If they are
        // ever wanted again, this derivation and its twin
        // {@link isRuntimeCreateAllowed} are the two sites that encode the
        // deferral, and `unrecognisedMetaTypeRefusal` in `@objectstack/spec`
        // is the contract they both read; a declared-kind channel would
        // have to feed that predicate before either door could widen. Start
        // here rather than re-deriving the decision from the code's silence.
        const mintableByContract = unrecognisedMetaTypeRefusal(singular) === null;
        return {
            type: singular,
            schemaId: singular, // API client expects schemaId field
            label: singular,
            description: undefined,
            filePatterns: [],
            supportsOverlay: false,
            allowEnvironmentOverlay: writableOverrides.has(singular),
            allowRuntimeCreate: mintableByContract,
            supportsVersioning: false,
            executionPinned: false,
            loadOrder: 1000,
            domain: 'system' as const,
            overrideSource: writableOverrides.has(singular) ? 'env' as const : 'registry' as const,
            schema,
            form,
            ...(createSeed !== undefined ? { createSeed } : {}),
            // Plugin-registered actions on a type with no registry entry.
            ...(typeActions.length ? { actions: typeActions } : {}),
        };
    }).sort((a, b) => {
        if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
        return a.type.localeCompare(b.type);
    });

    const listing = { types: allTypes, entries };
    // [#29510] Compile-time pin: `false` (a type error) the moment the body and the name drift apart.
    const exact: Equal<typeof listing, MetaTypesListing> = true;
    void exact;
    return listing;
}

/** The body of `ObjectStackProtocolImplementation#rethrowUnlessMetadataStoreUnprovisioned`; the method's docblock there is its contract. */
export function rethrowUnlessMetadataStoreUnprovisioned(host: ProtocolHost, error: unknown, readObject: string): void {
    // [commit 4cda78c9b] `readObject` is REQUIRED, deliberately. This helper serves
    // callers that read four different tables (`sys_metadata`,
    // `sys_metadata_audit`, `sys_metadata_commit`, `sys_metadata_history`),
    // so a default would silently answer about the wrong one for three of
    // them — measured, not hypothetical: the first draft of this repair
    // hardcoded `sys_metadata` and turned `diffMetaItem`'s genuinely
    // unprovisioned `sys_metadata_history` into a loud failure. A required
    // parameter makes the compiler ask the question at every new call site.
    if (isMissingTableError(error, readObject)) return;
    // [#12536] CLASSIFY, do not assume. A read can fail because the store
    // is unreachable OR because a metadata app's hook refused it in its
    // own words — see {@link metadataReadFailureError}.
    throw metadataReadFailureError(error);
}

/** The body of `ObjectStackProtocolImplementation#getPackagedObjectBase`; the method's docblock there is its contract. */
export function getPackagedObjectBase(host: Pick<ProtocolHost, 'engine'>, name: string): unknown {
    if (typeof name !== 'string' || name === '') return undefined;
    const registry = (host.engine as any)?.registry;
    if (!registry) return undefined;
    try {
        if (typeof registry.getPackagedObjectBase === 'function') return registry.getPackagedObjectBase(name);
        if (typeof registry.getPackagedObjectOwner !== 'function') return undefined;
        return registry.getPackagedObjectOwner(name)?.definition;
    } catch {
        // Same rule as the fold above: a read over in-memory contributors
        // must never turn a served schema into a 5xx.
        return undefined;
    }
}

/** The body of `ObjectStackProtocolImplementation#packagedArtifactBase`; the method's docblock there is its contract. */
export function packagedArtifactBase(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: 'dashboard' | 'view' | 'report', name: string): unknown {
    if (typeof name !== 'string' || name === '') return undefined;
    try {
        return host.lookupArtifactItem(type, name);
    } catch {
        // A read over the in-memory registry; a failure here must never
        // turn a served document into a 5xx.
        return undefined;
    }
}

/** The body of `ObjectStackProtocolImplementation#objectRegistrationRefusal`; the method's docblock there is its contract. */
export function objectRegistrationRefusal(host: Pick<ProtocolHost, 'engine'>, body: unknown,
        layer: ReturnType<ObjectStackProtocolImplementation['classifyObjectContribution']>,): Error | null {
    if (layer.kind === 'mismatch') return null;
    const registry = host.engine?.registry as { objectRegistrationRefusal?: (...args: unknown[]) => Error | null } | undefined;
    if (typeof registry?.objectRegistrationRefusal !== 'function') return null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return registry.objectRegistrationRefusal(
        { ...(body as Record<string, unknown>), _provenance: 'org' },
        layer.packageId,
        layer.kind,
    );
}

/** The body of `ObjectStackProtocolImplementation#restoreTranslatedObjectEchoes`; the method's docblock there is its contract. */
export async function restoreTranslatedObjectEchoes(host: Pick<ProtocolHost, 'getPackagedObjectBase' | 'registeredTranslationBundle'>, request: SaveMetaItemRequest,
        repo: SysMetadataRepository,
        ref: Parameters<SysMetadataRepository['get']>[0],
        mode: 'draft' | 'publish',): Promise<{ item: SaveMetaItemRequest['item']; restored: RestoredTranslatedSlot[] }> {
    if (canonicalMetaType(request.type) !== 'object') return { item: request.item, restored: [] };
    if (!request.item || typeof request.item !== 'object' || Array.isArray(request.item)) {
        return { item: request.item, restored: [] };
    }
    // The packaged base the read translates against (`getPackagedObjectBase`,
    // what the REST read hands `translateObject` as `packagedBase`), and,
    // with no stored row, the source itself: the body a read of an object
    // with no overlay served. A registry lookup, never a MetadataService
    // read — so a degraded service fails no save here (a brand-new object
    // has no source beyond the platform columns the pure half handled).
    const packagedBase = host.getPackagedObjectBase(request.name);
    const source = await storedBodyForCarryForward.call(
        { readCodeLayerForCarryForward: async () => packagedBase },
        {
            type: 'object',
            repo,
            ref,
            state: mode === 'draft' ? 'draft' : 'active',
            packageId: request.packageId ?? null,
        },
    );
    return restoreTranslatedEchoes(request.item, {
        source,
        bundle: host.registeredTranslationBundle(),
        packagedBase: packagedBase ?? undefined,
    });
}

/** The body of `ObjectStackProtocolImplementation#restoreInjectedColumnEchoes`; the method's docblock there is its contract. */
export function restoreInjectedColumnEchoes(host: Pick<ProtocolHost, 'registeredTranslationBundle'>, request: SaveMetaItemRequest): SaveMetaItemRequest['item'] {
    if (canonicalMetaType(request.type) !== 'object') return request.item;
    if (!request.item || typeof request.item !== 'object' || Array.isArray(request.item)) return request.item;
    return restoreTranslatedEchoes(request.item, { source: undefined, bundle: host.registeredTranslationBundle() }).item;
}

/** The body of `ObjectStackProtocolImplementation#registeredTranslationBundle`; the method's docblock there is its contract. */
export function registeredTranslationBundle(host: Pick<ProtocolHost, 'getServicesRegistry'>): TranslationBundle | undefined {
    const service: any = host.getServicesRegistry?.().get('i18n');
    if (!service || typeof service.getLocales !== 'function' || typeof service.getTranslations !== 'function') {
        return undefined;
    }
    const bundle: Record<string, any> = {};
    for (const locale of service.getLocales() as string[]) {
        const data = service.getTranslations(locale);
        if (data && typeof data === 'object') bundle[locale] = data;
    }
    return Object.keys(bundle).length > 0 ? (bundle as TranslationBundle) : undefined;
}

/** The body of `ObjectStackProtocolImplementation#readCodeLayerForCarryForward`; the method's docblock there is its contract. */
export async function readCodeLayerForCarryForward(host: Pick<ProtocolHost, 'engine' | 'lookupArtifactItem' | 'readItemFromMetadataService' | 'throwMetadataServiceUnavailable'>, type: string,
        name: string,
        packageId: string | null,): Promise<unknown> {
    const pkg = packageId ?? undefined;
    const fromService = await host.readItemFromMetadataService(type, name, pkg);
    if (fromService.data !== undefined && fromService.data !== null) return fromService.data;
    let item: unknown = host.lookupArtifactItem(type, name, pkg) ?? host.engine.registry.getItem(type, name, pkg);
    if (item === undefined) {
        const alt = PLURAL_TO_SINGULAR[type] ?? SINGULAR_TO_PLURAL[type];
        if (alt) item = host.engine.registry.getItem(alt, name, pkg);
    }
    if (item !== undefined && item !== null) return item;
    if (fromService.degraded) host.throwMetadataServiceUnavailable(fromService.errors);
    return undefined;
}
