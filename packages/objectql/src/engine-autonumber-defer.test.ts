// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

/**
 * #1603 — autonumber generation is owned by ONE layer.
 *
 * When the driver advertises `supports.autonumber === true` (the SQL driver,
 * which has a persistent `_objectstack_sequences` table), the engine must NOT
 * pre-fill `autonumber` fields with its in-memory counter — it defers to the
 * driver so the persistent sequence is the single source of truth. When the
 * driver does NOT advertise it (memory / mongodb), the engine keeps its
 * in-memory fallback so nothing regresses.
 *
 * A `required` autonumber must pass insert-validation in BOTH cases (the value
 * is runtime-owned, assigned after validation in the native-driver case).
 */
vi.mock('./registry', () => {
  const instance: any = {
    getObject: vi.fn(),
    resolveObject: vi.fn((n: string) => instance.getObject(n)),
    registerObject: vi.fn(),
    getObjectOwner: vi.fn(),
    registerNamespace: vi.fn(),
    registerKind: vi.fn(),
    registerItem: vi.fn(),
    registerApp: vi.fn(),
    installPackage: vi.fn(),
    reset: vi.fn(),
    metadata: { get: vi.fn(() => new Map()) },
  };
  function SchemaRegistry() {
    return instance;
  }
  Object.assign(SchemaRegistry, instance);
  return {
    SchemaRegistry,
    computeFQN: (_ns: string | undefined, name: string) => name,
    parseFQN: (fqn: string) => ({ namespace: undefined, shortName: fqn }),
    RESERVED_NAMESPACES: new Set(['base', 'system']),
  };
});

function makeDriver(supportsAutonumber: boolean): IDataDriver & { created: any[] } {
  const created: any[] = [];
  const driver: any = {
    name: supportsAutonumber ? 'sql' : 'memory',
    supports: supportsAutonumber ? { autonumber: true } : {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    // seedAutonumber (fallback path) reads existing rows; none exist yet.
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(async (_obj: string, row: any) => {
      created.push(row);
      // Native driver assigns the autonumber itself (post-validation).
      return supportsAutonumber ? { id: 'r1', ...row, doc_no: 'D-0001' } : { id: 'r1', ...row };
    }),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  driver.created = created;
  return driver as any;
}

const DOC_SCHEMA = {
  name: 'doc',
  fields: {
    title: { type: 'text' },
    doc_no: { type: 'autonumber', required: true, format: 'D-{0000}' },
  },
};

describe('ObjectQL autonumber ownership (#1603)', () => {
  let engine: ObjectQL;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SchemaRegistry.getObject).mockReturnValue(DOC_SCHEMA as any);
    engine = new ObjectQL();
  });

  it('defers to a native-autonumber driver (does NOT pre-fill) and passes required-validation', async () => {
    const driver = makeDriver(true);
    engine.registerDriver(driver, true);
    await engine.init();

    const result = await engine.insert('doc', { title: 'Spec' });

    // Engine did NOT generate the value — the row handed to the driver has no doc_no.
    expect(driver.created).toHaveLength(1);
    expect(driver.created[0].doc_no).toBeUndefined();
    // Engine never scanned for a max via the fallback seed path.
    expect(driver.find).not.toHaveBeenCalled();
    // The driver's value comes back to the caller.
    expect(result.doc_no).toBe('D-0001');
  });

  it('falls back to engine generation for a driver without native autonumber', async () => {
    const driver = makeDriver(false);
    engine.registerDriver(driver, true);
    await engine.init();

    const result = await engine.insert('doc', { title: 'Spec' });

    // Engine pre-filled the value before calling the driver.
    expect(driver.created).toHaveLength(1);
    expect(driver.created[0].doc_no).toBe('D-0001');
    expect(result.doc_no).toBe('D-0001');
  });

  // The fallback path renders the SAME format tokens as the SQL driver
  // (shared @objectstack/spec renderer), so {field}/{date} grouping must match.
  it('fallback renders {field} tokens and counts independently per scope', async () => {
    const TASK_SCHEMA = {
      name: 'task',
      fields: {
        zone: { type: 'text' },
        task_no: { type: 'autonumber', format: '{zone}{000}' },
      },
    };
    vi.mocked(SchemaRegistry.getObject).mockReturnValue(TASK_SCHEMA as any);
    const driver = makeDriver(false);
    engine.registerDriver(driver, true);
    await engine.init();

    const a1 = await engine.insert('task', { zone: 'A' });
    const b1 = await engine.insert('task', { zone: 'B' });
    const a2 = await engine.insert('task', { zone: 'A' });

    expect(a1.task_no).toBe('A001');
    expect(b1.task_no).toBe('B001'); // a different scope restarts at 001
    expect(a2.task_no).toBe('A002');
  });

  it('fallback renders {YYYYMMDD} date tokens in the business timezone', async () => {
    const AUDIT_SCHEMA = {
      name: 'audit',
      fields: { audit_no: { type: 'autonumber', format: 'AD{YYYYMMDD}{0000}' } },
    };
    vi.mocked(SchemaRegistry.getObject).mockReturnValue(AUDIT_SCHEMA as any);
    const driver = makeDriver(false);
    engine.registerDriver(driver, true);
    await engine.init();

    const r = await engine.insert('audit', {}, { timezone: 'UTC' } as any);
    // Today's UTC day + a fresh per-day counter.
    expect(r.audit_no).toMatch(/^AD\d{8}0001$/);
  });

  it('fallback refuses to generate when an interpolated {field} is empty', async () => {
    const TASK_SCHEMA = {
      name: 'task',
      fields: {
        zone: { type: 'text' },
        task_no: { type: 'autonumber', format: '{zone}{000}' },
      },
    };
    vi.mocked(SchemaRegistry.getObject).mockReturnValue(TASK_SCHEMA as any);
    const driver = makeDriver(false);
    engine.registerDriver(driver, true);
    await engine.init();

    // zone left blank → the prefix collapses to '' and would mis-scope the
    // counter, so generation must throw rather than emit a wrong number.
    await expect(engine.insert('task', {})).rejects.toThrow(/zone/);
  });
});
