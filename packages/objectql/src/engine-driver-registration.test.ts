// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#4773: every showcase boot logged
// `WARN Driver already registered, skipping {"driverName":"com.objectstack.driver.sql"}`.
//
// The diagnosis: the standalone `default` datasource is registered twice, on
// two legs of ONE round trip, with the SAME object instance both times —
// `DatasourceConnectionService.attemptConnect()` registers the driver it built
// (isDefault: true), `DefaultDatasourcePlugin.init()` republishes that same
// instance as the `driver.<name>` kernel service, and `ObjectQLPlugin.start()`'s
// `driver.*` discovery loop bridges it back in (isDefault: false). Nothing is
// decided and nothing is discarded, so a `warn` on every boot was pure noise —
// and worse, it was indistinguishable from the case that DOES matter: two
// DIFFERENT drivers claiming one name, where "skipping" silently drops one of
// two configurations.
//
// These tests pin the split: identical re-entry is quiet, real divergence is
// loud. Deleting the split would make both cases warn again (the #4773 noise)
// or both cases quiet (a silently-adopted config, strictly worse).

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

type Record_ = { level: string; message: string; meta?: Record<string, unknown> };

/** Captures every record the engine logs, at every level. */
function makeCapturingLogger() {
  const records: Record_[] = [];
  const push = (level: string) => (message: string, meta?: Record<string, unknown>) => {
    records.push({ level, message, meta });
  };
  const logger: any = {
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    fatal: push('fatal'),
    child: () => logger,
  };
  return { logger, records };
}

/** Minimal IDataDriver stub — only identity/name/version matter here. */
function makeDriver(name: string, version = '1.0.0') {
  const driver: any = {
    name,
    version,
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r_1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async delete() { return true; },
    async count() { return 0; },
    async bulkCreate() { return []; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

const warnsAbout = (records: Record_[], driverName: string) =>
  records.filter((r) => r.level === 'warn' && r.meta?.driverName === driverName);

describe('ObjectQL.registerDriver — identical re-entry vs. real name collision (#4773)', () => {
  it('re-registering the SAME instance is quiet: debug, never warn', () => {
    const { logger, records } = makeCapturingLogger();
    const engine = new ObjectQL({ logger });
    const driver = makeDriver('com.objectstack.driver.sql');

    engine.registerDriver(driver, true);
    // The `driver.*` discovery loop's leg: same object, no default claim.
    engine.registerDriver(driver);

    expect(warnsAbout(records, 'com.objectstack.driver.sql')).toEqual([]);
    const debugs = records.filter((r) => r.level === 'debug' && r.meta?.driverName === 'com.objectstack.driver.sql');
    expect(debugs).toHaveLength(1);
    expect(debugs[0]!.message).toMatch(/same instance is a no-op/);
  });

  it('the quiet re-entry changes nothing: the first registration still stands', () => {
    const { logger } = makeCapturingLogger();
    const engine = new ObjectQL({ logger });
    const driver = makeDriver('com.objectstack.driver.sql');

    engine.registerDriver(driver, true);
    engine.registerDriver(driver);

    expect(engine.getDriverByName('com.objectstack.driver.sql')).toBe(driver);
    expect(engine.getDefaultDriverName()).toBe('com.objectstack.driver.sql');
  });

  it('a DIFFERENT instance under a held name stays LOUD and names which config survived', () => {
    const { logger, records } = makeCapturingLogger();
    const engine = new ObjectQL({ logger });
    const kept = makeDriver('com.objectstack.driver.sql', '1.0.0');
    const discarded = makeDriver('com.objectstack.driver.sql', '2.0.0');

    engine.registerDriver(kept, true);
    engine.registerDriver(discarded);

    const warns = warnsAbout(records, 'com.objectstack.driver.sql');
    expect(warns).toHaveLength(1);
    // The operator must be able to tell WHICH of the two configurations is in
    // force without reading the source — that is the whole cost of a collision.
    expect(warns[0]!.message).toMatch(/collision/i);
    expect(warns[0]!.message).toMatch(/KEEPING/);
    expect(warns[0]!.message).toMatch(/DISCARDING/);
    expect(warns[0]!.meta).toMatchObject({ keptVersion: '1.0.0', discardedVersion: '2.0.0' });
    // First-wins is unchanged behaviour — only the reporting got sharper.
    expect(engine.getDriverByName('com.objectstack.driver.sql')).toBe(kept);
  });

  it('a dropped `isDefault` request stays LOUD — the intent is silently lost otherwise', () => {
    const { logger, records } = makeCapturingLogger();
    const engine = new ObjectQL({ logger });
    const first = makeDriver('driver.a');
    const second = makeDriver('driver.b');

    engine.registerDriver(first, true);
    engine.registerDriver(second);
    // Same instance, but now asking for a role another driver already holds.
    engine.registerDriver(second, true);

    const warns = warnsAbout(records, 'driver.b');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toMatch(/IGNORED/);
    expect(warns[0]!.meta).toMatchObject({ currentDefault: 'driver.a' });
    expect(engine.getDefaultDriverName()).toBe('driver.a');
  });

  it('a same-instance re-entry that re-asserts an ALREADY-held default stays quiet', () => {
    const { logger, records } = makeCapturingLogger();
    const engine = new ObjectQL({ logger });
    const driver = makeDriver('com.objectstack.driver.sql');

    engine.registerDriver(driver, true);
    engine.registerDriver(driver, true);

    expect(warnsAbout(records, 'com.objectstack.driver.sql')).toEqual([]);
    expect(engine.getDefaultDriverName()).toBe('com.objectstack.driver.sql');
  });
});
