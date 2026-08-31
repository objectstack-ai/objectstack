// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13408 — WHICH datasource is the primary one, i.e. the one whose failure must
// take a replica out of the load-balancer rotation.
//
// Ruled 2026-08-31 (第 6 场总监席决裁批 #12, maintainer verbatim 「同意」):
//
//   「主/默认」判据必须是一条读得出来的事实:定义为「承载平台系统对象(sys_*)的
//   那个数据源」或等价的可机读事实,⛔ 不得用「第一个注册的」之类启发式。
//
// These pins hold BOTH halves of that: the criterion answers from where the
// platform's system objects actually live, and it refuses to answer — rather
// than guessing — whenever that fact is not readable. The consequence of the
// refusal (drain the node) is pinned on the caller, in
// `packages/runtime/src/http-dispatcher.ready.test.ts`; here we only pin that
// the refusal happens and is not silently a name.

import { describe, it, expect } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

/**
 * A registrable driver double.
 *
 * Annotated `IDataDriver` deliberately, rather than left as an inferred object
 * literal: `registerDriver` takes the real contract, so an un-annotated double
 * is checked only at the call site and silently drifts as the interface grows.
 * The annotation makes THIS declaration the thing that fails when a member is
 * added — which is how the first version of this fixture was found short of
 * `upsert` and `dropTable`.
 */
const driver = (name: string): IDataDriver => ({
  name,
  version: '1.0.0',
  supports: {},
  connect: async () => {},
  disconnect: async () => {},
  checkHealth: async () => true,
  find: async () => [],
  findOne: async () => null,
  create: async (_o, data) => ({ id: '1', ...data }),
  update: async (_o, id, data) => ({ id, ...data }),
  upsert: async (_o, data) => ({ id: '1', ...data }),
  delete: async () => true,
  count: async () => 0,
  bulkCreate: async () => [],
  bulkUpdate: async () => [],
  bulkDelete: async () => {},
  execute: async () => null,
  beginTransaction: async () => ({}),
  commit: async () => {},
  rollback: async () => {},
  syncSchema: async () => {},
  dropTable: async () => {},
});

function newEngine(): ObjectQL {
  return new ObjectQL({ logger: { debug() {}, info() {}, warn() {}, error() {} } } as any);
}

/**
 * Register a PLATFORM object under a name that is really on
 * `PLATFORM_PROVIDED_OBJECT_NAMES` — a name off that list is not evidence and
 * would make every reading here vacuous.
 */
function registerSys(
  engine: ObjectQL,
  name: string,
  extra: Record<string, unknown> = {},
): void {
  engine.registry.registerObject(
    { name, fields: { title: { type: 'text' } }, ...extra } as any,
    'platform-objects',
    undefined,
    'own',
  );
}

describe('ObjectQL.resolvePrimaryDatasource() — the #13408 criterion', () => {
  describe('reads the fact off where the platform system objects live', () => {
    it('names the datasource carrying sys_* in a single-datasource deployment', () => {
      const engine = newEngine();
      engine.registerDriver(driver('sqlite'), true);
      registerSys(engine, 'sys_user');
      registerSys(engine, 'sys_organization');

      const verdict = engine.resolvePrimaryDatasource();

      expect(verdict).toEqual({ resolved: true, datasource: 'sqlite', witnesses: 2 });
    });

    it('⛔ NOT the first-registered driver, and ⛔ NOT the one flagged default', () => {
      // The sharpest anti-heuristic pin the ruling asks for. `mongo` is
      // registered FIRST and `pg` is the flagged DEFAULT — so a "first
      // registered" heuristic answers `mongo` and a `getDefaultDriverName()`
      // shortcut answers `pg`. The system objects are routed to `mongo` by a
      // mapping rule, so the only answer read off WHERE THE DATA IS is `mongo`.
      const engine = newEngine();
      engine.registerDriver(driver('mongo'));
      engine.registerDriver(driver('pg'), true);
      engine.setDatasourceMapping([{ objectPattern: 'sys_*', datasource: 'mongo' }]);
      registerSys(engine, 'sys_user');

      // The two heuristics the ruling forbids, stated so the pin is falsifiable
      // rather than a coincidence of this fixture: both are LIVE and both
      // disagree with the verdict.
      expect(engine.getDefaultDriverName()).toBe('pg');

      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: true,
        datasource: 'mongo',
        witnesses: 1,
      });
    });

    it('a tenant/secondary datasource does not become primary by existing', () => {
      const engine = newEngine();
      engine.registerDriver(driver('pg'), true);
      engine.registerDriver(driver('tenant_mongo'));
      registerSys(engine, 'sys_user');
      // A tenant business object on the secondary — the #13408 shape.
      engine.registry.registerObject(
        { name: 'tenant_lead', datasource: 'tenant_mongo', fields: { n: { type: 'text' } } } as any,
        'tenant-pkg',
        undefined,
        'own',
      );

      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: true,
        datasource: 'pg',
        witnesses: 1,
      });
    });
  });

  describe('ADR-0057 §3.6 lifecycle separation is not a split', () => {
    it('an audit-class sys object on the telemetry datasource still leaves ONE primary', () => {
      // Without the carve-out this deployment would read as `system-objects-split`
      // and drain forever — for a configuration the platform recommends.
      const engine = newEngine();
      engine.registerDriver(driver('pg'), true);
      engine.registerDriver(driver('telemetry'));
      registerSys(engine, 'sys_user');
      registerSys(engine, 'sys_audit_log', { lifecycle: { class: 'audit' } });

      // Non-vacuity: the ledger object really IS routed away, so the carve-out
      // is doing work rather than describing a case that cannot arise.
      expect(engine.resolveEffectiveDatasource('sys_audit_log')).toBe('telemetry');

      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: true,
        datasource: 'pg',
        witnesses: 1,
      });
    });

    it('a `transient` sys object still votes — it stays on the primary by design', () => {
      const engine = newEngine();
      engine.registerDriver(driver('pg'), true);
      engine.registerDriver(driver('telemetry'));
      registerSys(engine, 'sys_session', { lifecycle: { class: 'transient' } });

      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: true,
        datasource: 'pg',
        witnesses: 1,
      });
    });
  });

  describe('refuses to answer rather than guessing', () => {
    it('no platform system object registered ⇒ no fact to read', () => {
      const engine = newEngine();
      engine.registerDriver(driver('sqlite'), true);
      engine.registry.registerObject(
        { name: 'lead', fields: { n: { type: 'text' } } } as any, 'app', undefined, 'own',
      );

      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: false,
        reason: 'no-system-objects-registered',
      });
    });

    it('system objects split across datasources ⇒ ambiguous, with the candidates named', () => {
      const engine = newEngine();
      engine.registerDriver(driver('pg'), true);
      engine.registerDriver(driver('mongo'));
      registerSys(engine, 'sys_user');
      registerSys(engine, 'sys_organization', { datasource: 'mongo' });

      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: false,
        reason: 'system-objects-split',
        candidates: ['mongo', 'pg'],
      });
    });

    it('a bound datasource with no registered driver ⇒ nothing probes it, so no name', () => {
      // The silent don't-drain the ruling forbids: `checkDriversHealth()` only
      // reports REGISTERED drivers, so an unregistered primary would be absent
      // from the unhealthy list and read as healthy.
      const engine = newEngine();
      engine.registerDriver(driver('pg'), true);
      registerSys(engine, 'sys_user', { datasource: 'never_connected' });

      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: false,
        reason: 'no-driver-registered',
        candidates: ['never_connected'],
      });
    });

    it('a registered system object bound nowhere at all ⇒ no answer can be true', () => {
      // ⚠️ STRUCTURAL close, not a live production state today: `registerDriver`
      // makes the FIRST driver the default (`isDefault || drivers.size === 1`),
      // so step 5 always answers once any driver exists, and this branch is
      // reachable only with none registered. It is pinned anyway because the
      // engine has no driver eviction YET — adding it is #13578's half of this
      // card — and an eviction that removes the default is exactly how a
      // registered system object stops being bound anywhere. When that lands,
      // this must already read as "cannot tell", not as a name.
      const engine = newEngine();
      registerSys(engine, 'sys_user');

      expect(engine.getDefaultDriverName()).toBeUndefined();
      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: false,
        reason: 'system-object-unbound',
      });
    });

    it('every unresolved verdict is structurally unusable as a name', () => {
      // The consequence contract: a caller cannot accidentally read a
      // datasource out of a refusal, whatever the reason.
      const engine = newEngine();
      engine.registerDriver(driver('sqlite'), true);
      const verdict = engine.resolvePrimaryDatasource();

      expect(verdict.resolved).toBe(false);
      expect((verdict as Record<string, unknown>).datasource).toBeUndefined();
    });
  });
});
