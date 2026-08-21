// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8992] Record-view auditing — ENFORCEMENT, not declaration.
 *
 * The failure mode this card can most easily ship is an "audit this object"
 * surface that parses and causes no row to be written. On an audit surface that
 * is worse than a missing feature: a compliance reviewer reads the declaration
 * as coverage. So every assertion below runs against a REAL {@link ObjectQL}
 * engine over a minimal stub driver — never a hand-mocked hook dispatcher.
 *
 * That choice is the point. The three pins the ruling cares about are all
 * properties of the ENGINE's behaviour, and a fake engine would let this file
 * assert them against its own mock of the thing under test:
 *
 *   - the per-object opt-in is enforced by a NARROW hook registration
 *     (`{ object: [...] }`), so "an object that is not opted in produces no
 *     row" has to be the engine's real dispatch declining to call us;
 *   - "record-detail views only" turns on the real shapes `find` and `findOne`
 *     leave on `ctx.result` and `ctx.input.ast.where`;
 *   - the row keeps the VIEW instant, which depends on the real engine's
 *     `created_at` strip and its system-context exemption (#4447).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { installReadAuditWriter, extractDetailReadId, type ReadAuditTimers } from './read-audit.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** A minimal in-memory driver — enough for find/findOne/insert on the engine. */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  /** Handles the shapes the engine actually produces: `{f: v}`, `{f:{$eq}}`, `$and`. */
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') {
        if (!(v as any[]).every((m) => matches(row, m))) return false;
        continue;
      }
      if (k === '$or') {
        if (!(v as any[]).some((m) => matches(row, m))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

const contactObject = {
  name: 'contact',
  label: 'Contact',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    full_name: { name: 'full_name', label: 'Name', type: 'text' as const },
    id_number: { name: 'id_number', label: 'ID number', type: 'text' as const },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
  },
};

/** A second object, deliberately NOT opted in. */
const invoiceObject = {
  ...contactObject,
  name: 'invoice',
  label: 'Invoice',
};

/** The ledger, declared with the columns the writer conditionally stamps. */
const auditLogObject = {
  name: 'sys_audit_log',
  label: 'Audit Log',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    created_at: { name: 'created_at', label: 'At', type: 'datetime' as const },
    action: { name: 'action', label: 'Action', type: 'text' as const },
    user_id: { name: 'user_id', label: 'User', type: 'text' as const },
    actor: { name: 'actor', label: 'Actor', type: 'text' as const },
    object_name: { name: 'object_name', label: 'Object', type: 'text' as const },
    record_id: { name: 'record_id', label: 'Record', type: 'text' as const },
    old_value: { name: 'old_value', label: 'Old', type: 'textarea' as const },
    new_value: { name: 'new_value', label: 'New', type: 'textarea' as const },
    tenant_id: { name: 'tenant_id', label: 'Tenant', type: 'text' as const },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
  },
};

/** A timer seam the tests drive by hand — no wall clock, no fake-timer globals. */
function makeManualTimers(): ReadAuditTimers & { run(): void; armed(): boolean } {
  let pending: (() => void) | null = null;
  return {
    set(fn) { pending = fn; return 1; },
    clear() { pending = null; },
    armed() { return pending !== null; },
    run() { const f = pending; pending = null; f?.(); },
  };
}

/** Owning package for the harness objects — `registerObject` requires one. */
const HARNESS_PACKAGE = 'com.objectstack.audit.test';

async function makeEngine() {
  const engine = new ObjectQL();
  const { driver } = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(contactObject as any, HARNESS_PACKAGE);
  engine.registry.registerObject(invoiceObject as any, HARNESS_PACKAGE);
  engine.registry.registerObject(auditLogObject as any, HARNESS_PACKAGE);
  return engine;
}

/** Every ledger row, oldest first. */
async function ledgerRows(engine: ObjectQL): Promise<any[]> {
  return (await engine.find('sys_audit_log', {})) as any[];
}

/**
 * The execution context an engine read carries.
 *
 * Named and typed rather than erased with `as any` at each call site: the
 * engine's options schemas are not `.strict()`, so an unknown key is silently
 * DROPPED rather than rejected, and `tsc` is the only channel that catches it
 * for an internal caller (#4674). plugin-audit's tsconfig does not exclude
 * its test files, so that channel is live over this one.
 */
type ReadContext = NonNullable<EngineQueryOptions['context']>;

/** An ordinary authenticated caller — a person, not the platform. */
const viewerCtx: ReadContext = { userId: 'u_alice', tenantId: 'org_a' };

describe('#8992 record-view auditing — the opt-in is enforced, not declared', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await makeEngine();
    await engine.insert(
      'contact',
      { id: 'c1', full_name: 'Wei Zhang', id_number: '310101199001010011', organization_id: 'org_a' },
      { context: { isSystem: true } },
    );
    await engine.insert(
      'invoice',
      { id: 'i1', full_name: 'INV-1', organization_id: 'org_a' },
      { context: { isSystem: true } },
    );
  });

  it('an OPTED-IN object produces a `read` row on a record-detail view', async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'] })!;
    expect(writer).not.toBeNull();

    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    await writer.flush();

    const rows = await ledgerRows(engine);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'read',
      user_id: 'u_alice',
      actor: 'u_alice',
      object_name: 'contact',
      record_id: 'c1',
    });
  });

  it('an object that is NOT opted in produces NO row — the engine never dispatches to us', async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'] })!;

    await engine.findOne('invoice', { where: { id: 'i1' }, context: viewerCtx });
    // Nothing was even buffered: the narrow `{ object: ['contact'] }` registration
    // is the enforcement, so a non-audited read costs no dispatch at all.
    expect(writer.pending()).toBe(0);
    await writer.flush();

    expect(await ledgerRows(engine)).toHaveLength(0);
  });

  it('an EMPTY opt-in installs nothing at all', async () => {
    expect(installReadAuditWriter(engine, { objects: [] })).toBeNull();

    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    expect(await ledgerRows(engine)).toHaveLength(0);
  });

  it('an object on the audit exclusion list is refused from the opt-in, loudly', async () => {
    const warnings: string[] = [];
    const writer = installReadAuditWriter(engine, {
      objects: ['contact', 'sys_audit_log', 'sys_session'],
      logger: { warn: (m: string) => warnings.push(m) },
    })!;

    expect(writer.auditedObjects).toEqual(['contact']);
    // Silence here would be the dead surface one layer down: a configuration
    // that names an object and gets no rows, with nothing saying why.
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('sys_audit_log');
    expect(warnings[0]).toContain('will NOT have its record views recorded');
  });
});

describe('#8992 the write is OFF the request path', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await makeEngine();
    await engine.insert('contact', { id: 'c1', full_name: 'Wei Zhang' }, { context: { isSystem: true } });
  });

  /**
   * The pin that makes the whole design honest. Reads vastly outnumber writes
   * and the RFI behind this card carries a 2s record-open budget, so the read
   * must return with the ledger INSERT still unmade. If this ever goes green
   * by finding the row already present, the batching has collapsed into a
   * synchronous write and the capability is taxing every record view.
   */
  it('the read resolves with the ledger row NOT yet written', async () => {
    const timers = makeManualTimers();
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers })!;

    const record = await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    expect(record).toMatchObject({ id: 'c1' });

    // The read is DONE. The view is buffered and the ledger is still empty.
    expect(writer.pending()).toBe(1);
    expect(await ledgerRows(engine)).toHaveLength(0);

    await writer.flush();
    expect(writer.pending()).toBe(0);
    expect(await ledgerRows(engine)).toHaveLength(1);
  });

  it('the flush timer is what drains a batch below the size threshold', async () => {
    const timers = makeManualTimers();
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers, maxBatchSize: 50 })!;

    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    expect(timers.armed()).toBe(true);
    expect(await ledgerRows(engine)).toHaveLength(0);

    timers.run();
    await writer.flush();
    expect(await ledgerRows(engine)).toHaveLength(1);
  });

  it('reaching maxBatchSize flushes without waiting for the timer', async () => {
    const timers = makeManualTimers();
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers, maxBatchSize: 3 })!;

    for (let i = 0; i < 3; i += 1) {
      await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    }
    // The size-triggered flush was started by the third enqueue; join it
    // without arming or running the timer, which is still unarmed.
    await writer.flush();
    expect(await ledgerRows(engine)).toHaveLength(3);
  });

  it('a ledger write failure never reaches the read, and reports once at `error`', async () => {
    const errors: string[] = [];
    const debugs: string[] = [];
    // Required by `ReadAuditLogger` (#9754/#10556) — and asserted unused below,
    // so the double pins that `error` is reached for FIRST and `warn` is only
    // the degrade path.
    const warns: string[] = [];
    const writer = installReadAuditWriter(engine, {
      objects: ['contact'],
      timers: makeManualTimers(),
      logger: {
        error: (m: string) => errors.push(m),
        warn: (m: string) => warns.push(m),
        debug: (m: string) => debugs.push(m),
      },
    })!;
    // Break the ledger AFTER install, so the probe has already run.
    (engine as any).insert = async () => { throw new Error('no such table: sys_audit_log'); };

    // The read still succeeds — an audit write must never turn a valid read
    // into an error.
    await expect(
      engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx }),
    ).resolves.toMatchObject({ id: 'c1' });
    await expect(writer.flush()).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Read-audit write FAILED');
    expect(errors[0]).toContain('who viewed this record');
  });
});

describe('#8992 record-detail views ONLY — the deferral of list auditing is real', () => {
  let engine: ObjectQL;
  let writer: ReturnType<typeof installReadAuditWriter>;

  beforeEach(async () => {
    engine = await makeEngine();
    await engine.insert('contact', { id: 'c1', full_name: 'A', organization_id: 'org_a' }, { context: { isSystem: true } });
    await engine.insert('contact', { id: 'c2', full_name: 'B', organization_id: 'org_a' }, { context: { isSystem: true } });
    writer = installReadAuditWriter(engine, { objects: ['contact'], timers: makeManualTimers() });
  });

  it('a LIST read produces no row, even one that returns a single record', async () => {
    const many = await engine.find('contact', { where: { organization_id: 'org_a' }, context: viewerCtx });
    expect(many).toHaveLength(2);
    const one = await engine.find('contact', { where: { id: 'c1' }, context: viewerCtx });
    expect(one).toHaveLength(1);

    await writer!.flush();
    // `find` is the deferred surface. A single-row list result is still a list
    // result — the deferral holds on result SHAPE, not on row count.
    expect(await ledgerRows(engine)).toHaveLength(0);
  });

  it('a findOne WITHOUT a primary-key pin produces no row', async () => {
    // "Give me a contact called A" is an internal lookup, not someone opening
    // a record — and the platform makes many of them.
    await engine.findOne('contact', { where: { full_name: 'A' }, context: viewerCtx });
    await writer!.flush();
    expect(await ledgerRows(engine)).toHaveLength(0);
  });

  it('a findOne that matched NOTHING produces no row', async () => {
    await engine.findOne('contact', { where: { id: 'nope' }, context: viewerCtx });
    await writer!.flush();
    expect(await ledgerRows(engine)).toHaveLength(0);
  });
});

describe('#8992 the predicate walk survives the middleware that rewrites it', () => {
  // The security middleware AND-composes its RLS predicates onto `ast.where`
  // before the driver runs, so the detector never sees the caller's own
  // spelling. These cases are that rewrite, unit-level.
  it('accepts an id pin AND-composed with a tenant wall', () => {
    expect(
      extractDetailReadId({ $and: [{ id: 'c1' }, { organization_id: 'org_a' }] }, { id: 'c1' }),
    ).toBe('c1');
  });

  it('accepts the explicit $eq spelling', () => {
    expect(extractDetailReadId({ id: { $eq: 'c1' } }, { id: 'c1' })).toBe('c1');
  });

  it('REFUSES an id under $or — the row may have matched the other arm', () => {
    expect(
      extractDetailReadId({ $or: [{ id: 'c1' }, { full_name: 'A' }] }, { id: 'c1' }),
    ).toBeNull();
  });

  it('REFUSES an id pin nested under $not', () => {
    expect(extractDetailReadId({ $not: { id: 'c1' } }, { id: 'c1' })).toBeNull();
  });

  it('REFUSES an array result — that is a list read', () => {
    expect(extractDetailReadId({ id: 'c1' }, [{ id: 'c1' }])).toBeNull();
    expect(extractDetailReadId({ id: 'c1' }, [])).toBeNull();
  });

  it('REFUSES a null result — nothing was viewed', () => {
    expect(extractDetailReadId({ id: 'c1' }, null)).toBeNull();
  });

  it('REFUSES an $in over ids — a two-record fetch is not a record-detail view', () => {
    expect(extractDetailReadId({ id: { $in: ['c1', 'c2'] } }, { id: 'c1' })).toBeNull();
  });
});

describe('#8992 who the row names — and who it deliberately does not', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await makeEngine();
    await engine.insert(
      'contact',
      { id: 'c1', full_name: 'Wei Zhang', organization_id: 'org_a' },
      { context: { isSystem: true } },
    );
  });

  it('a SYSTEM-elevated read produces no row — the declared boundary', async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers: makeManualTimers() })!;
    // `api.sudo()` is `{ ...ctx, isSystem: true }` — it KEEPS the caller's
    // userId, so without this check every formula recompute and roll-up would
    // land in the ledger as "alice viewed this record".
    await engine.findOne(
      'contact',
      { where: { id: 'c1' }, context: { ...viewerCtx, isSystem: true } },
    );
    await writer.flush();
    expect(await ledgerRows(engine)).toHaveLength(0);
  });

  it('a read with NO principal produces no row', async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers: makeManualTimers() })!;
    await engine.findOne('contact', { where: { id: 'c1' } });
    await writer.flush();
    expect(await ledgerRows(engine)).toHaveLength(0);
  });

  it('a service principal is attributable on `actor` with a null user_id', async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers: makeManualTimers() })!;
    await engine.findOne(
      'contact',
      { where: { id: 'c1' }, context: { actor: 'svc:export-worker', tenantId: 'org_a' } },
    );
    await writer.flush();

    const rows = await ledgerRows(engine);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('svc:export-worker');
    expect(rows[0].user_id ?? null).toBeNull();
  });

  it("the row is stamped with the RECORD's organization, not just the viewer's", async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers: makeManualTimers() })!;
    // #8287's ruling, carried onto the read row: stamped with the VIEWER's
    // active org, a row about an org_a record would land behind org_b's wall —
    // invisible to the one tenant admin it concerns.
    await engine.findOne(
      'contact',
      { where: { id: 'c1' }, context: { userId: 'u_bob', tenantId: 'org_b' } },
    );
    await writer.flush();

    const rows = await ledgerRows(engine);
    expect(rows[0].tenant_id).toBe('org_a');
    expect(rows[0].organization_id).toBe('org_a');
  });
});

describe('#8992 what the row must NOT contain, and when it says it happened', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = await makeEngine();
    await engine.insert(
      'contact',
      { id: 'c1', full_name: 'Wei Zhang', id_number: '310101199001010011' },
      { context: { isSystem: true } },
    );
  });

  /**
   * `afterFind` runs INSIDE the security middleware, before its field masking
   * (`security-plugin.ts` masks after `next()`), so `ctx.result` is pre-mask
   * plaintext. Copying values into the ledger would mint a plaintext copy of
   * exactly the data field-level security withholds — inside the one table
   * compliance staff get broad access to. This asserts the values are absent,
   * and asserts the sensitive value is nowhere in the serialized row at all.
   */
  it('records NO field values — the row is who/what/when, never the data', async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers: makeManualTimers() })!;
    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    await writer.flush();

    const rows = await ledgerRows(engine);
    expect(rows[0].old_value ?? null).toBeNull();
    expect(rows[0].new_value ?? null).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain('310101199001010011');
    expect(JSON.stringify(rows[0])).not.toContain('Wei Zhang');
  });

  /**
   * Batching moves the INSERT off the request path, which is exactly what makes
   * `created_at`'s `NOW()` default wrong here: it would stamp the whole batch
   * with the moment the buffer drained. The engine strips a client-supplied
   * `created_at` from ordinary writes (#4447) and exempts system-context writes
   * — the writer relies on that exemption, so this pins both halves.
   */
  it('records the VIEW instant, not the flush instant', async () => {
    const viewedAt = new Date('2026-08-18T09:15:00.000Z');
    const writer = installReadAuditWriter(engine, {
      objects: ['contact'],
      timers: makeManualTimers(),
      now: () => viewedAt,
    })!;

    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    // Drain much later than the view.
    await new Promise((r) => setTimeout(r, 25));
    await writer.flush();

    const rows = await ledgerRows(engine);
    const stored = new Date(rows[0].created_at as string).toISOString();
    expect(stored).toBe(viewedAt.toISOString());
  });

  it('two views of the same record are two rows — a view is an event, not a state', async () => {
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers: makeManualTimers() })!;
    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    await engine.findOne('contact', { where: { id: 'c1' }, context: { userId: 'u_bob' } });
    await writer.flush();

    const rows = await ledgerRows(engine);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.user_id).sort()).toEqual(['u_alice', 'u_bob']);
  });
});

describe('#8992 shutdown drains the tail', () => {
  it('stop() flushes what is buffered and disarms the timer', async () => {
    const engine = await makeEngine();
    await engine.insert('contact', { id: 'c1', full_name: 'A' }, { context: { isSystem: true } });
    const timers = makeManualTimers();
    const writer = installReadAuditWriter(engine, { objects: ['contact'], timers })!;

    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    expect(writer.pending()).toBe(1);

    await writer.stop();
    expect(timers.armed()).toBe(false);
    expect(await ledgerRows(engine)).toHaveLength(1);

    // After stop the writer is inert — a late read cannot resurrect the buffer.
    await engine.findOne('contact', { where: { id: 'c1' }, context: viewerCtx });
    expect(writer.pending()).toBe(0);
  });
});
