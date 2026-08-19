// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { createMemoryMetadata, CORE_FALLBACK_FACTORIES } from '@objectstack/core';
import { ObjectQL } from './engine.js';

describe('ObjectStackProtocolImplementation - Dynamic Service Discovery', () => {
  let protocol: ObjectStackProtocolImplementation;
  let engine: ObjectQL;
  
  beforeEach(() => {
    engine = new ObjectQL();
  });

  it('should return unavailable auth service when no services registered', async () => {
    // Create protocol without service registry
    protocol = new ObjectStackProtocolImplementation(engine);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services.auth).toBeDefined();
    expect(discovery.services.auth.enabled).toBe(false);
    expect(discovery.services.auth.status).toBe('unavailable');
    expect(discovery.services.auth.message).toContain('plugin-auth');
    // capabilities removed — derive from services. (`workflow` was the slot
    // pinned here until it retired in #4451; it must now be absent entirely.)
    expect(discovery.services).not.toHaveProperty('workflow');
  });

  it('should return available auth service when auth is registered', async () => {
    // Mock service registry with auth service
    const mockServices = new Map<string, any>();
    mockServices.set('auth', { /* mock auth service */ });
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services.auth).toBeDefined();
    expect(discovery.services.auth.enabled).toBe(true);
    expect(discovery.services.auth.status).toBe('available');
    expect(discovery.services.auth.route).toBe('/api/v1/auth');
    // [#4093 follow-up] Scoped now: `provider` comes from CORE_SERVICE_PROVIDER,
    // which names the package you can actually install rather than a bare label.
    expect(discovery.services.auth.provider).toBe('@objectstack/plugin-auth');
    expect(discovery.routes.auth).toBe('/api/v1/auth');
  });

  it('should return available automation service when registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('automation', { /* mock automation service */ });
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services.automation).toBeDefined();
    expect(discovery.services.automation.enabled).toBe(true);
    expect(discovery.services.automation.status).toBe('available');
  });

  it('should return multiple available services when registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('auth', {});
    mockServices.set('realtime', {});
    mockServices.set('ai', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);

    const discovery = await protocol.getDiscovery();

    // Check auth
    expect(discovery.services.auth.enabled).toBe(true);
    expect(discovery.services.auth.status).toBe('available');

    // Check realtime — honest capabilities (ADR-0076 D12, #2462): the
    // realtime service is an in-process bus with NO HTTP surface, so it is
    // registered/enabled but degraded, with no advertised route (a route
    // would 404).
    expect(discovery.services.realtime.enabled).toBe(true);
    expect(discovery.services.realtime.status).toBe('degraded');
    expect(discovery.services.realtime.handlerReady).toBe(false);
    expect(discovery.services.realtime.route).toBeUndefined();

    // Check AI
    expect(discovery.services.ai.enabled).toBe(true);
    expect(discovery.services.ai.status).toBe('available');

    // Routes should include available services — but never realtime (D12)
    expect(discovery.routes.auth).toBe('/api/v1/auth');
    expect(discovery.routes.realtime).toBeUndefined();
    expect(discovery.routes.ai).toBe('/api/v1/ai');
  });

  // ── Honest capabilities (ADR-0076 D12, #2462) ─────────────────────────────

  it('should report a stub-marked service as a stub, never available', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('ai', { __serviceInfo: { status: 'stub', message: 'Development stub — not a production implementation' } });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.ai.enabled).toBe(true);
    expect(discovery.services.ai.status).toBe('stub');
    expect(discovery.services.ai.handlerReady).toBe(false);
    expect(discovery.services.ai.message).toContain('stub');
  });

  it('should report a __serviceInfo-marked service with its declared status', async () => {
    // Was pinned on `workflow` until that slot retired (#4451, v17); `auth`
    // exercises the same marked-service path.
    const mockServices = new Map<string, any>();
    mockServices.set('auth', {
      __serviceInfo: { status: 'degraded', message: 'partial impl' },
    });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.auth.enabled).toBe(true);
    expect(discovery.services.auth.status).toBe('degraded');
    expect(discovery.services.auth.handlerReady).toBe(true);
    expect(discovery.services.auth.message).toBe('partial impl');
  });

  it('should report a registered analytics service with its self-declared status', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('analytics', {
      __serviceInfo: { status: 'degraded', handlerReady: true, message: 'partial engine' },
    });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.analytics.enabled).toBe(true);
    expect(discovery.services.analytics.status).toBe('degraded');
    expect(discovery.services.analytics.message).toBe('partial engine');
  });

  it('should always show core services as available', async () => {
    protocol = new ObjectStackProtocolImplementation(engine);

    const discovery = await protocol.getDiscovery();

    // Core services should always be available
    expect(discovery.services.metadata.enabled).toBe(true);
    expect(discovery.services.metadata.status).toBe('available');
    expect(discovery.services.data.enabled).toBe(true);
    expect(discovery.services.data.status).toBe('available');
  });

  // #4089 — `metadata` was in the hardcoded kernel block, so it reported
  // `available` even when the slot held the kernel's in-memory fallback: a
  // registry that never reaches disk read exactly like a sys_metadata-backed
  // one. The slot is now computed from the implementation's own D12
  // self-description, like every optional service below it.
  it('should report the kernel in-memory metadata fallback as degraded, never available', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('metadata', createMemoryMetadata());

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.metadata.enabled).toBe(true);
    expect(discovery.services.metadata.status).toBe('degraded');
    // The message names what is missing and what to install for the real thing.
    expect(discovery.services.metadata.message).toContain('MetadataPlugin');
    // Still served: `/api/v1/meta` is the protocol's route, not this service's.
    expect(discovery.services.metadata.handlerReady).toBe(true);
    expect(discovery.services.metadata.route).toBe('/api/v1/meta');
    expect(discovery.routes.metadata).toBe('/api/v1/meta');
  });

  it('should report an unmarked (real) metadata service as available', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('metadata', { register: async () => {}, list: async () => [] });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.metadata.status).toBe('available');
    expect(discovery.services.metadata.message).toBeUndefined();
    expect(discovery.services.metadata.handlerReady).toBe(true);
  });

  // #4130 — `data` was the last hardcoded entry in the kernel block. Its
  // `available` happened to be true, but only because ObjectQL is the slot's
  // sole producer and plugin-dev always loads it as a child, so its `data` stub
  // never lands there. A convention in another package is not something this
  // builder verifies — now it does.
  it('should report a self-declared data stub as a stub, never available', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('data', {
      __serviceInfo: { status: 'stub', message: 'Dev stub — find() always returns []. Register ObjectQLPlugin for a real engine.' },
      find: async () => [],
    });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.data.enabled).toBe(true);
    expect(discovery.services.data.status).toBe('stub');
    expect(discovery.services.data.handlerReady).toBe(false);
    expect(discovery.services.data.message).toContain('ObjectQLPlugin');
  });

  it('should keep reporting a real (unmarked) data engine as available', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('data', { find: async () => [], insert: async () => ({ id: '1' }) });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    // Byte-for-byte what the hardcode said, now derived from the slot.
    expect(discovery.services.data.status).toBe('available');
    expect(discovery.services.data.handlerReady).toBe(true);
    expect(discovery.services.data.route).toBe('/api/v1/data');
    expect(discovery.services.data.provider).toBe('objectql');
    expect(discovery.services.data.message).toBeUndefined();
  });

  // ── The class-wide gate (#3898): the fake INVENTORY, not spot checks ──────
  // Same gate as the dispatcher's: every in-memory fallback the kernel can
  // auto-register (CORE_FALLBACK_FACTORIES — the complete fake inventory now
  // that plugin-dev's stub table is retired, ADR-0115, and the `_fallback`
  // marker was eliminated rather than recognized, #4058 step 1) goes through
  // THIS builder too and must never come out `available`. Table-driven so a
  // new fallback is gated the day it is added; cache/queue/job had no
  // per-slot pin here either.
  it('reports every CORE_FALLBACK_FACTORIES product as degraded, never available (#3898)', async () => {
    expect(Object.keys(CORE_FALLBACK_FACTORIES).length).toBeGreaterThan(0);

    for (const [slot, factory] of Object.entries(CORE_FALLBACK_FACTORIES)) {
      const mockServices = new Map<string, any>();
      mockServices.set(slot, factory());

      protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
      const reported = (await protocol.getDiscovery()).services[slot];

      expect(reported, `services.${slot}`).toBeDefined();
      expect(reported.enabled, `services.${slot}.enabled`).toBe(true);
      expect(reported.status, `services.${slot}.status`).toBe('degraded');
      expect(reported.message, `services.${slot}.message`).toBeTruthy();
    }
  });

  // #3891 — the degraded ObjectQL fallback is retired. Analytics is an
  // ordinary optional service now: absent ⇒ unavailable, and the route must
  // NOT be advertised (an advertised route with no handler 404s — the exact
  // discovery lie the fallback was invented to make true).
  it('should report analytics unavailable with no advertised route when not registered', async () => {
    protocol = new ObjectStackProtocolImplementation(engine);

    const discovery = await protocol.getDiscovery();

    expect(discovery.services.analytics.enabled).toBe(false);
    expect(discovery.services.analytics.status).toBe('unavailable');
    expect(discovery.services.analytics.message).toContain('service-analytics');
    expect(discovery.services.analytics.route).toBeUndefined();
    expect(discovery.routes.analytics).toBeUndefined();
  });

  it('should advertise analytics route and availability when the real engine registers', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('analytics', { /* real engine — no self-info means available */ });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.analytics.enabled).toBe(true);
    expect(discovery.services.analytics.status).toBe('available');
    expect(discovery.services.analytics.route).toBe('/api/v1/analytics');
    expect(discovery.routes.analytics).toBe('/api/v1/analytics');
  });

  // #4000 — the same rule one step further: a stub occupying the slot is not
  // the capability either. The dispatcher answers it with the empty-slot 404,
  // so advertising a route here would re-tell the lie #3891 removed. The
  // service entry itself still self-reports as a stub — that says more than
  // `unavailable` would.
  it('should not advertise the analytics route for a self-declared stub', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('analytics', { __serviceInfo: { status: 'stub' }, query: async () => ({ rows: [], fields: [] }) });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.analytics.enabled).toBe(true);
    expect(discovery.services.analytics.status).toBe('stub');
    expect(discovery.services.analytics.handlerReady).toBe(false);
    expect(discovery.services.analytics.route).toBeUndefined();
    expect(discovery.routes.analytics).toBeUndefined();
  });

  // #4058 — the same rule for every OTHER slot whose HTTP surface is a
  // dispatcher domain, now that those domains gate on `handlerReady` too.
  it('should not advertise routes for self-declared stubs in the other dispatcher-owned slots', async () => {
    const mockServices = new Map<string, any>();
    for (const name of ['automation', 'notification', 'ai', 'i18n', 'storage']) {
      mockServices.set(name, { __serviceInfo: { status: 'stub', message: 'dev fake' } });
    }

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    for (const name of ['automation', 'notification', 'ai', 'i18n', 'storage']) {
      expect(discovery.services[name].enabled, `${name}.enabled`).toBe(true);
      expect(discovery.services[name].status, `${name}.status`).toBe('stub');
      expect(discovery.services[name].handlerReady, `${name}.handlerReady`).toBe(false);
      expect(discovery.services[name].route, `${name}.route`).toBeUndefined();
    }
    for (const key of ['automation', 'notifications', 'ai', 'i18n', 'storage']) {
      expect(discovery.routes[key], `routes.${key}`).toBeUndefined();
    }
  });

  // The limit of that rule: `degraded` means "really serves, reduced
  // capability", so the route stays advertised — plugin-dev's in-memory file
  // store and i18n provider are exactly this, and the dispatcher keeps serving
  // them.
  it('should keep advertising routes for degraded implementations that really serve', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('storage', { __serviceInfo: { status: 'degraded', message: 'in-memory' } });
    mockServices.set('i18n', { __serviceInfo: { status: 'degraded', message: 'in-memory' } });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services['storage'].status).toBe('degraded');
    expect(discovery.services['storage'].handlerReady).toBe(true);
    expect(discovery.routes.storage).toBe('/api/v1/storage');
    expect(discovery.routes.i18n).toBe('/api/v1/i18n');
  });

  // Not every SERVICE_CONFIG entry is dispatcher-owned: `search` (REST
  // layer) has its route mounted by the plugin that registers the service,
  // so `handlerReady` there says nothing about whether THAT route is mounted
  // and the advertisement stays presence-gated. Suppressing it would be a
  // guess, not honesty. (cache/queue/job used to be named here on the same
  // theory, but nothing mounts routes for them at all — route-less
  // kernel-internal slots since #4318; `workflow` and `graphql` retired
  // outright in #4451.)
  it('should leave non-dispatcher-owned routes presence-gated', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('search', { __serviceInfo: { status: 'stub', message: 'dev fake' } });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.services.search.status).toBe('stub');
    expect(discovery.services.search.route).toBe('/api/v1/search');
  });

  // ── Kernel-internal slots advertise no route, ever (#4318) ────────────────
  // SERVICE_CONFIG used to declare /api/v1/cache, /api/v1/queue and
  // /api/v1/jobs — three paths that existed nowhere else in the repository:
  // no dispatcher domain, no adapter mount, no plugin registration, and the
  // shipped providers (service-cache/-queue/-job) are in-process contracts
  // that will never mount one. Every default boot therefore advertised a
  // route inside the same ServiceInfo whose `handlerReady: false` said the
  // opposite. The slots are route-less now, like realtime — but unlike
  // realtime an unmarked real implementation stays `available`, because the
  // slot's contract is in-process and "no HTTP surface" is not reduced
  // capability for it.
  it('reports an unmarked cache/queue/job occupant available with no route and handlerReady false (#4318)', async () => {
    const mockServices = new Map<string, any>();
    for (const slot of ['cache', 'queue', 'job']) mockServices.set(slot, { /* real, unmarked */ });

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    for (const slot of ['cache', 'queue', 'job']) {
      const reported = discovery.services[slot];
      expect(reported.enabled, `${slot}.enabled`).toBe(true);
      expect(reported.status, `${slot}.status`).toBe('available');
      expect(reported.handlerReady, `${slot}.handlerReady`).toBe(false);
      expect(reported.route, `${slot}.route`).toBeUndefined();
      expect(reported.message, `${slot}.message`).toContain('no HTTP surface');
    }
  });

  it('never advertises a route for a cache/queue/job fallback either (#4318)', async () => {
    for (const slot of ['cache', 'queue', 'job']) {
      const mockServices = new Map<string, any>();
      mockServices.set(slot, CORE_FALLBACK_FACTORIES[slot]());

      protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
      const reported = (await protocol.getDiscovery()).services[slot];

      // Self-description wins for status/message (the class-wide #3898 gate
      // pins `degraded`); the route stays gone and handlerReady stays false.
      expect(reported.route, `${slot}.route`).toBeUndefined();
      expect(reported.handlerReady, `${slot}.handlerReady`).toBe(false);
    }
  });

  it('should map the storage service slot to the storage route', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('storage', {});
    
    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    expect(discovery.services['storage'].enabled).toBe(true);
    expect(discovery.services['storage'].status).toBe('available');
    expect(discovery.routes.storage).toBe('/api/v1/storage');
  });

  // [#9683] `file-storage` is the deprecated v17 alias of the `storage` slot.
  // Existing discovery readers key on it, so both producers mirror the
  // canonical row verbatim under the alias key until it retires at the next
  // major — filled or empty alike.
  it('mirrors the storage row verbatim under the deprecated file-storage alias key', async () => {
    const filled = new Map<string, any>([['storage', {}]]);
    protocol = new ObjectStackProtocolImplementation(engine, () => filled);
    const withStorage = await protocol.getDiscovery();
    expect(withStorage.services['file-storage']).toEqual(withStorage.services['storage']);
    expect(withStorage.services['file-storage'].enabled).toBe(true);

    protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    const without = await protocol.getDiscovery();
    expect(without.services['file-storage']).toEqual(without.services['storage']);
    expect(without.services['file-storage'].enabled).toBe(false);
  });

  it('should use consistent /api/v1/ route prefix for all services', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('auth', {});
    mockServices.set('automation', {});
    mockServices.set('ai', {});
    mockServices.set('analytics', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    
    const discovery = await protocol.getDiscovery();
    
    // All routes should use consistent /api/v1/ prefix
    expect(discovery.routes.data).toBe('/api/v1/data');
    expect(discovery.routes.metadata).toBe('/api/v1/meta');
    expect(discovery.routes.auth).toBe('/api/v1/auth');
    expect(discovery.routes.automation).toBe('/api/v1/automation');
    expect(discovery.routes.ai).toBe('/api/v1/ai');
    expect(discovery.routes.analytics).toBe('/api/v1/analytics');
    
    // Service routes should match the routes map
    expect(discovery.services.data.route).toBe('/api/v1/data');
    expect(discovery.services.metadata.route).toBe('/api/v1/meta');
    expect(discovery.services.auth.route).toBe('/api/v1/auth');
    expect(discovery.services.analytics.route).toBe('/api/v1/analytics');
  });

  it('should return capabilities field populated from registered services', async () => {
    // Was pinned on `workflow` until that slot retired (#4451, v17); `ui`
    // is likewise registered without mapping to a well-known capability.
    const mockServices = new Map<string, any>();
    mockServices.set('ui', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    // capabilities field should now exist in the response
    expect(discovery.capabilities).toBeDefined();
    // ui is registered but doesn't map to a well-known capability directly
    expect(discovery.services.ui.enabled).toBe(true);
    // The SLOT-DERIVED well-known capabilities should be disabled since ui maps
    // to none of them (comments derives from the sys_comment object, which is
    // not registered here).
    expect(discovery.capabilities!.comments).toEqual({ enabled: false });
    expect(discovery.capabilities!.automation).toEqual({ enabled: false });
    expect(discovery.capabilities!.cron).toEqual({ enabled: false });
    expect(discovery.capabilities!.export).toEqual({ enabled: false });
    expect(discovery.capabilities!.chunkedUpload).toEqual({ enabled: false });
    // [#7541] `search` is NOT in that list any more. It is no longer derived
    // from a service slot at all — it reports whether this protocol can serve
    // `/search` (`typeof searchAll === 'function'`, the predicate the route's
    // own 501 uses), and this class always can. Asserting `false` here was
    // asserting the defect: the endpoint served 200s while the document said
    // the capability was off.
    expect(discovery.capabilities!.search).toEqual({ enabled: true });
  });

  it('should set all slot-derived capabilities to false when no services are registered', async () => {
    protocol = new ObjectStackProtocolImplementation(engine);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities).toBeDefined();
    expect(discovery.capabilities!.comments).toEqual({ enabled: false });
    expect(discovery.capabilities!.automation).toEqual({ enabled: false });
    expect(discovery.capabilities!.cron).toEqual({ enabled: false });
    expect(discovery.capabilities!.export).toEqual({ enabled: false });
    expect(discovery.capabilities!.chunkedUpload).toEqual({ enabled: false });
    // [#7541] Same reason as above — and this is the exact host the issue was
    // reported against: an empty registry, a live `/search`. The two halves of
    // the document stay independent and both stay honest: the SLOT is still
    // empty here...
    expect(discovery.capabilities!.search).toEqual({ enabled: true });
    expect(discovery.services.search.enabled).toBe(false);
    expect(discovery.services.search.status).toBe('unavailable');
    // ...and its message now says which question that answers, instead of
    // reading as "search is dead on this host".
    expect(discovery.services.search.message).toMatch(/capabilities\.search/);
  });

  it('should dynamically set capabilities based on registered services', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('automation', {});
    mockServices.set('search', {});
    mockServices.set('storage', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.automation).toEqual({ enabled: true });
    expect(discovery.capabilities!.cron).toEqual({ enabled: false });
    expect(discovery.capabilities!.export).toEqual({ enabled: true });
    expect(discovery.capabilities!.chunkedUpload).toEqual({ enabled: true });
    // comments is independent of services — it tracks the sys_comment object (#3180).
    expect(discovery.capabilities!.comments).toEqual({ enabled: false });
    // [#7541] `search` is true here too, but NOT because the slot above is
    // filled — this line proves nothing about the slot and is kept only so the
    // reader is not left thinking it does. The discriminating cases live in
    // `packages/rest/src/discovery-search-capability-agreement.test.ts`, which
    // drives the capability builder and the route together.
    expect(discovery.capabilities!.search).toEqual({ enabled: true });
    // What the slot DOES still decide, unchanged: the `services` half.
    expect(discovery.services.search.enabled).toBe(true);
  });

  // ── Atomic cross-object batch capability (#3298 / #1604 / ADR-0034) ─────────
  // The bit tracks whether the runtime engine can honour a transaction (the
  // REST /batch endpoint runs inside `engine.transaction()`), NOT a registered
  // service — so it is independent of the services map.
  it('advertises transactionalBatch when the engine exposes transaction() — the real ObjectQL engine (#3298)', async () => {
    protocol = new ObjectStackProtocolImplementation(engine);
    const discovery = await protocol.getDiscovery();

    // ObjectQL always implements transaction() (ADR-0034), so a real engine
    // reports the capability regardless of which services are registered.
    expect(typeof (engine as unknown as { transaction?: unknown }).transaction).toBe('function');
    expect(discovery.capabilities!.transactionalBatch).toEqual({ enabled: true });
  });

  it('does NOT advertise transactionalBatch when the engine has no transaction() (declared === enforced, #3298)', async () => {
    // A minimal engine without transaction(): the /batch endpoint would 501, so
    // discovery must report false — never let a client drop its non-atomic
    // fallback against a runtime that cannot honour an atomic batch.
    const noTxEngine = { registry: { getObject: () => undefined } } as any;
    protocol = new ObjectStackProtocolImplementation(noTxEngine);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.transactionalBatch).toEqual({ enabled: false });
  });

  it('should enable comments capability when the sys_comment object is registered (#3180)', async () => {
    // comments/chatter are served by the sys_comment object via the data API
    // (ADR-0052 §5), not a dedicated service — so the capability tracks that
    // object's presence, keeping declared === enforced.
    engine.registerObject(
      { name: 'sys_comment', label: 'Comment', fields: { body: { type: 'text' } } } as any,
      'plugin-audit',
    );
    protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.comments).toEqual({ enabled: true });
  });

  it('should enable cron capability when job service is registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('job', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.cron).toEqual({ enabled: true });
  });

  it('should enable export capability when queue service is registered', async () => {
    const mockServices = new Map<string, any>();
    mockServices.set('queue', {});

    protocol = new ObjectStackProtocolImplementation(engine, () => mockServices);
    const discovery = await protocol.getDiscovery();

    expect(discovery.capabilities!.export).toEqual({ enabled: true });
  });
});
