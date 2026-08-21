// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5979 — `seedAutonumber` must not answer a READ OUTAGE with "seed from 0".
 *
 * The engine's fallback autonumber path seeds its in-memory counter from
 * `MAX(existing)` in the store, then increments. That seeding read used to sit
 * behind a bare `} catch { return 0; }`: EVERY failure — connection drop,
 * timeout, permission denial, query error — was answered with the same `0` a
 * genuinely empty table produces.
 *
 * Those are opposite facts (ADR-0110 D3), and conflating them here is the
 * costly half of the #4728 / #4825 / #5108 family. Against a table that already
 * holds N rows, one flaky read restarts the sequence at 1 and issues autonumbers
 * that COLLIDE with existing ones. The insert SUCCEEDS, nothing is logged, and
 * the collision lands in a business identifier — a value written wrong, which no
 * retry and no restart repairs. The hazard was already named in the comment
 * directly above the read (#4371: "the catch below would have swallowed the
 * guard's rejection into 'seed from 0', i.e. duplicate autonumbers"); the read
 * was fixed there, the catch was not.
 *
 * The fix discriminates by error TYPE through the shared `isMissingTableError`
 * predicate (`@objectstack/metadata/errors`, #4825) — never a hand-rolled
 * `code === '42P01'` copy, which would be the second "which driver errors are
 * benign" vocabulary that module exists to retire:
 *
 *   - table never provisioned  → seed from 0 (there are genuinely no rows, so
 *     number 1 collides with nothing);
 *   - every other read failure → propagate, allocate NOTHING, write NOTHING.
 *
 * These tests drive a fake DRIVER (not a fake engine), so no engine write-verb
 * dispatch contract is involved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

vi.mock('./registry', async () => {
  // [#10551] The one shared factory — see `registry-module-mock.ts` for the
  // member set, the #9002 / #9154 lessons it carries, and why the async factory
  // form is what makes this import legal under `vi.mock` hoisting.
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

const DOC_SCHEMA = {
  name: 'doc',
  fields: {
    title: { type: 'text' },
    doc_no: { type: 'autonumber', required: true, format: 'D-{0000}' },
  },
};

/**
 * A driver whose seeding read (`find`) behaves as `findBehaviour` says, and
 * which records every row it was asked to create. `create` recording is the
 * load-bearing half: the defect's signature is a write that SUCCEEDS with a
 * colliding number, so "no row reached the driver" is what proves the fix.
 */
function makeDriver(findBehaviour: () => Promise<any[]>): IDataDriver & {
  created: any[];
} {
  const created: any[] = [];
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    // No native autonumber → the engine takes the fallback seeding path.
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    find: vi.fn(findBehaviour),
    findOne: vi.fn(),
    create: vi.fn(async (_obj: string, row: any) => {
      created.push(row);
      return { id: `r${created.length}`, ...row };
    }),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  };
  driver.created = created;
  return driver as any;
}

/** Driver-shaped errors that mean "the table was never provisioned". */
const MISSING_TABLE_ERRORS: Array<[string, () => unknown]> = [
  ['PostgreSQL 42P01 undefined_table', () => Object.assign(new Error('relation "doc" does not exist'), { code: '42P01' })],
  ['MySQL ER_NO_SUCH_TABLE', () => Object.assign(new Error("Table 'app.doc' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146 })],
  ['SQLite message-only', () => new Error('no such table: doc')],
];

/**
 * Driver-shaped errors that mean "the rows may well exist — I just could not
 * see them". Each is a real outage class the old bare catch answered with 0.
 */
const OUTAGE_ERRORS: Array<[string, () => unknown]> = [
  ['connection refused', () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
  ['statement timeout', () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })],
  ['permission denied', () => Object.assign(new Error('permission denied for table doc'), { code: '42501' })],
  ['connection terminated mid-query', () => Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' })],
];

describe('ObjectQL seedAutonumber — read outage must not restart the sequence (#5979)', () => {
  let engine: ObjectQL;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SchemaRegistry.getObject).mockReturnValue(DOC_SCHEMA as any);
    engine = new ObjectQL();
  });

  // ---------------------------------------------------------------- benign --

  describe('table not provisioned → seed from 0 (benign, unchanged)', () => {
    for (const [label, make] of MISSING_TABLE_ERRORS) {
      it(`seeds from 0 and issues number 1 — ${label}`, async () => {
        const driver = makeDriver(async () => {
          throw make();
        });
        engine.registerDriver(driver, true);
        await engine.init();

        const result = await engine.insert('doc', { title: 'First' });

        // There are genuinely no rows, so 1 collides with nothing.
        expect(result.doc_no).toBe('D-0001');
        expect(driver.created).toHaveLength(1);
        expect(driver.created[0].doc_no).toBe('D-0001');
      });
    }

    it('keeps counting in memory after a benign seed (second insert is 2)', async () => {
      const driver = makeDriver(async () => {
        throw Object.assign(new Error('no such table: doc'), {});
      });
      engine.registerDriver(driver, true);
      await engine.init();

      const a = await engine.insert('doc', { title: 'First' });
      const b = await engine.insert('doc', { title: 'Second' });

      expect(a.doc_no).toBe('D-0001');
      expect(b.doc_no).toBe('D-0002');
    });
  });

  // ---------------------------------------------------------------- outage --

  describe('read outage → propagate, allocate nothing, write nothing', () => {
    for (const [label, make] of OUTAGE_ERRORS) {
      it(`rethrows and writes NOTHING — ${label}`, async () => {
        const driver = makeDriver(async () => {
          throw make();
        });
        engine.registerDriver(driver, true);
        await engine.init();

        await expect(engine.insert('doc', { title: 'First' })).rejects.toThrow();

        // The whole point: no row reached the driver, so no autonumber was
        // issued from data the engine never read.
        expect(driver.create).not.toHaveBeenCalled();
        expect(driver.created).toHaveLength(0);
      });
    }

    it('propagates the ORIGINAL driver error, not a synthesized one', async () => {
      const original = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      });
      const driver = makeDriver(async () => {
        throw original;
      });
      engine.registerDriver(driver, true);
      await engine.init();

      // The caller needs the driver's own diagnosis to act on; swallowing it
      // into a generic failure would repeat the zero-signal half of the defect.
      await expect(engine.insert('doc', { title: 'First' })).rejects.toThrow(/ECONNREFUSED/);
    });

    /**
     * The defect's actual damage, pinned directly: a table already holding
     * D-0007 must never be handed D-0001 because one read failed.
     */
    it('does NOT restart at 1 against a table that already holds rows', async () => {
      let outage = true;
      const driver = makeDriver(async () => {
        if (outage) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' });
        return [{ id: 'r1', doc_no: 'D-0007' }];
      });
      engine.registerDriver(driver, true);
      await engine.init();

      // During the outage the write fails rather than forging a colliding number.
      await expect(engine.insert('doc', { title: 'During outage' })).rejects.toThrow();
      expect(driver.created).toHaveLength(0);

      // Once the store recovers, seeding reads the real max and continues from
      // it. This also proves the failed seed poisoned no in-memory counter —
      // had the outage cached a 0, this would come back D-0001.
      outage = false;
      const recovered = await engine.insert('doc', { title: 'After recovery' });
      expect(recovered.doc_no).toBe('D-0008');
    });
  });

  // ---------------------------------------------------------------- normal --

  describe('normal read path is unchanged', () => {
    it('seeds from the max of existing rows', async () => {
      const driver = makeDriver(async () => [
        { id: 'r1', doc_no: 'D-0003' },
        { id: 'r2', doc_no: 'D-0011' },
        { id: 'r3', doc_no: 'D-0007' },
      ]);
      engine.registerDriver(driver, true);
      await engine.init();

      const result = await engine.insert('doc', { title: 'Next' });

      expect(result.doc_no).toBe('D-0012');
    });

    it('seeds from 0 when the table exists and is genuinely empty', async () => {
      const driver = makeDriver(async () => []);
      engine.registerDriver(driver, true);
      await engine.init();

      const result = await engine.insert('doc', { title: 'First' });

      expect(result.doc_no).toBe('D-0001');
    });
  });
});
