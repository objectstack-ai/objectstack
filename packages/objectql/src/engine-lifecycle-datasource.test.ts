// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0057 §3.6 (P3) — lifecycle-class datasource separation.
 *
 * When a datasource named 'telemetry' is registered, objects whose
 * `lifecycle.class` is telemetry / event / audit route to it — so
 * platform-generated growth can never again pollute the business DB. The
 * routing is opt-in by the datasource's existence: without it, resolution is
 * exactly what it was before. `transient` and `record` classes always stay on
 * their normal resolution (transient objects are user-session data, and some
 * are accessed outside the engine — splitting their storage would split
 * their brain).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function stubDriver(name: string) {
  return {
    name,
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find() {
      return [];
    },
    async findOne() {
      return null;
    },
    async create(_o: string, d: Record<string, unknown>) {
      return d;
    },
    async update() {
      return {};
    },
    async upsert() {
      return {};
    },
    async delete() {
      return true;
    },
    async count() {
      return 0;
    },
    async bulkCreate() {
      return [];
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {},
    async beginTransaction() {
      return {};
    },
    async commit() {},
    async rollback() {},
  } as any;
}

const OBJECTS = [
  { name: 'biz_account', fields: {} },
  { name: 'probe_activity', lifecycle: { class: 'telemetry', retention: { maxAge: '14d' } }, fields: {} },
  { name: 'probe_bus_event', lifecycle: { class: 'event', ttl: { field: 'created_at', expireAfter: '6h' } }, fields: {} },
  { name: 'probe_ledger', lifecycle: { class: 'audit', retention: { maxAge: '90d' } }, fields: {} },
  { name: 'probe_receipt', lifecycle: { class: 'transient', ttl: { field: 'created_at', expireAfter: '7d' } }, fields: {} },
];

describe('lifecycle-class datasource separation (ADR-0057 §3.6)', () => {
  let engine: ObjectQL;
  let primary: any;

  beforeEach(async () => {
    engine = new ObjectQL();
    primary = stubDriver('memory');
    engine.registerDriver(primary, true);
    await engine.init();
    for (const o of OBJECTS) engine.registry.registerObject(o);
  });

  it('without a telemetry datasource, every object resolves exactly as before', () => {
    for (const o of OBJECTS) {
      expect(engine.getDriverForObject(o.name)).toBe(primary);
    }
  });

  it('with a telemetry datasource, telemetry/event/audit route to it — record/transient stay put', () => {
    const telemetry = stubDriver(ObjectQL.LIFECYCLE_DATASOURCE);
    engine.registerDriver(telemetry);

    expect(engine.getDriverForObject('probe_activity')).toBe(telemetry);
    expect(engine.getDriverForObject('probe_bus_event')).toBe(telemetry);
    expect(engine.getDriverForObject('probe_ledger')).toBe(telemetry);

    expect(engine.getDriverForObject('biz_account')).toBe(primary);
    expect(engine.getDriverForObject('probe_receipt')).toBe(primary);
  });

  it("an object's explicit datasource still wins over lifecycle routing", () => {
    const telemetry = stubDriver(ObjectQL.LIFECYCLE_DATASOURCE);
    const special = stubDriver('special');
    engine.registerDriver(telemetry);
    engine.registerDriver(special);
    engine.registry.registerObject({
      name: 'probe_pinned',
      datasource: 'special',
      lifecycle: { class: 'telemetry', retention: { maxAge: '14d' } },
      fields: {},
    } as any);

    expect(engine.getDriverForObject('probe_pinned')).toBe(special);
  });
});
