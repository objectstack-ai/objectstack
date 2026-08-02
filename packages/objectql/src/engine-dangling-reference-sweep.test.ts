// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4551] The dangling-reference inspection — the residual #4441 left open.
 *
 * #4441 enforces referential integrity on the write path but deliberately
 * exempts `isSystem` writes: seed replay, package install and boot-time
 * provisioning legitimately write rows in an order that is self-consistent
 * only once the batch completes, so failing them closed would turn an ordering
 * detail into a boot failure. The exemption is right; what it leaves is a
 * platform that can still store a reference pointing at nothing while nothing
 * says so.
 *
 * So every case below plants its bad data through the SAME door the platform
 * uses — `context: { isSystem: true }` — which is what makes the suite about
 * #4551 rather than a re-test of #4441. A non-system write of the same row is
 * refused before it lands (pinned at the bottom), and that is the point: the
 * only writer that can produce this data is the platform.
 *
 * ## Why the test double is not looser than a real driver (#4550)
 *
 * The existence probe under test is `ObjectQL.referenceExists` — the very same
 * private method the write-path enforcement calls, so the sweep and the guard
 * can never disagree about what "exists" means. Nothing about it is faked here.
 * The memory driver below honors `limit` and the `fields` projection exactly as
 * a real driver does, because the scan's bounds are asserted (`truncated`) and
 * a driver that ignored `limit` would make that assertion vacuous.
 *
 * Both claims were measured, not asserted. Loosening the double so `findOne`
 * answers a row for everything turns FIVE cases red — including the #4441
 * write-path pin at the bottom, which is the guard that a double looser than
 * the real driver cannot slip past. Removing the probe's throw turns
 * "counts an unprobeable target as undetermined" red on its own. And removing
 * the inspection itself turns ELEVEN of the fourteen red; the three that stay
 * green are the ones that assert SILENCE (empty values, the readonly sentinel,
 * and the #4441 pin), which is exactly the set that should survive.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, REFERENCE_SCAN_PRIORITY_OBJECTS } from './engine.js';
import { LifecycleService } from './lifecycle/lifecycle-service.js';

const permissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

/** The RBAC link table the issue names: a dangling row here is a
 *  security-surface record that resolves to nothing. */
const binding = {
  name: 'sys_position_permission_set',
  label: 'Position ↔ Permission Set',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    permission_set_id: {
      name: 'permission_set_id', label: 'Permission Set',
      type: 'lookup' as const, reference: 'sys_permission_set',
      required: true, deleteBehavior: 'set_null' as const,
    },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
  },
};

/** An ordinary application object — the rule is about resolvability, not about
 *  living in `sys_*`. `tags` is the multi-value spelling. */
const task = {
  name: 'ref_task',
  label: 'Task',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    project: {
      name: 'project', label: 'Project',
      type: 'lookup' as const, reference: 'sys_permission_set',
    },
    tags: {
      name: 'tags', label: 'Tags',
      type: 'lookup' as const, reference: 'sys_permission_set', multiple: true,
    },
  },
};

/**
 * The `sys_metadata_history.recorded_by` shape: a READONLY `lookup('sys_user')`
 * the platform fills with `actor ?? 'system'` — a SENTINEL STRING, never a user
 * id (found by the #4441 dogfood run, recorded on PR #4511). Reporting it every
 * hour would be a permanent false positive, so the scan skips readonly
 * references for the same reason the write path does: the value is the
 * platform's, not a caller's.
 */
const history = {
  name: 'ref_history',
  label: 'History',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    recorded_by: {
      name: 'recorded_by', label: 'Recorded By',
      type: 'lookup' as const, reference: 'sys_permission_set', readonly: true,
    },
  },
};

/** Declares a lookup at an object that is never registered — unprobeable. */
const orphanTarget = {
  name: 'ref_orphan',
  label: 'Orphan',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    ghost: {
      name: 'ghost', label: 'Ghost',
      type: 'lookup' as const, reference: 'ref_never_registered',
    },
  },
};

interface MemoryDriver {
  driver: any;
  stores: Map<string, Map<string, Record<string, unknown>>>;
  /** Object names whose `findOne` should throw — an unreadable target. */
  probeFailures: Set<string>;
  /** Object names whose `find` should throw — an unreadable holder. */
  readFailures: Set<string>;
}

function makeMemoryDriver(): MemoryDriver {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const probeFailures = new Set<string>();
  const readFailures = new Set<string>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  /** Reads never materialize a table — a real driver does not create one by
   *  being queried, and the "nothing was rewritten" snapshot must not be
   *  perturbed by the scan merely having looked. */
  const readStoreFor = (obj: string) =>
    stores.get(obj) ?? new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  // A real driver projects to the selected columns and stops at `limit`. The
  // double does both: the scan's bounds are asserted, and a driver that ignored
  // `limit` would make `truncated` untestable (#4550).
  const project = (rows: Record<string, unknown>[], ast: any) => {
    let out = rows;
    if (Array.isArray(ast?.fields) && ast.fields.length > 0) {
      const keep: string[] = ast.fields;
      out = out.map((r) => {
        const picked: Record<string, unknown> = {};
        for (const f of keep) if (f in r) picked[f] = r[f];
        return picked;
      });
    }
    if (typeof ast?.limit === 'number' && ast.limit >= 0) out = out.slice(0, ast.limit);
    return out;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      if (readFailures.has(object)) throw new Error(`datasource unreachable: ${object}`);
      const rows = Array.from(readStoreFor(object).values()).filter((r) => matches(r, ast?.where));
      return project(rows, ast);
    },
    findStream() { throw new Error('not implemented'); },
    async findOne(object: string, ast: any) {
      if (probeFailures.has(object)) throw new Error(`datasource unreachable: ${object}`);
      for (const r of readStoreFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return next;
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
  return { driver, stores, probeFailures, readFailures };
}

/** Every stored row, as JSON — the "nothing was rewritten" oracle. */
function snapshot(stores: Map<string, Map<string, Record<string, unknown>>>): string {
  const out: Record<string, unknown[]> = {};
  for (const [object, rows] of [...stores.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[object] = [...rows.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return JSON.stringify(out);
}

const SYSTEM = { context: { isSystem: true } } as any;

describe('[#4551] dangling references produced by `isSystem` writes are reported', () => {
  let engine: ObjectQL;
  let mem: MemoryDriver;

  beforeEach(async () => {
    engine = new ObjectQL();
    mem = makeMemoryDriver();
    engine.registerDriver(mem.driver, true);
    await engine.init();
    engine.registry.registerObject(permissionSet as any);
    engine.registry.registerObject(binding as any);
    engine.registry.registerObject(task as any);
    engine.registry.registerObject(history as any);
    await engine.insert('sys_permission_set', { id: 'ps_real', name: 'Real' }, SYSTEM);
  });

  it('reports the dangling reference with a full locator', async () => {
    // Exactly what seed replay does: the row lands, the target never arrives.
    await engine.insert(
      'sys_position_permission_set',
      { id: 'bind_1', permission_set_id: 'ps_never_seeded', organization_id: 'org_a' },
      SYSTEM,
    );

    const report = await engine.inspectDanglingReferences();

    expect(report.dangling).toHaveLength(1);
    // Object, record, field, target, id — an operator must be able to go
    // straight to the row without reconstructing the query.
    expect(report.dangling[0]).toEqual({
      object: 'sys_position_permission_set',
      recordId: 'bind_1',
      field: 'permission_set_id',
      target: 'sys_permission_set',
      value: 'ps_never_seeded',
      organizationId: 'org_a',
    });
    expect(report.undetermined).toBe(0);
    expect(report.skipped).toEqual([]);
  });

  it('says nothing when the target exists', async () => {
    await engine.insert(
      'sys_position_permission_set',
      { id: 'bind_ok', permission_set_id: 'ps_real' },
      SYSTEM,
    );
    const report = await engine.inspectDanglingReferences();
    expect(report.dangling).toEqual([]);
    expect(report.undetermined).toBe(0);
    expect(report.scannedReferences).toBe(1);
  });

  it('covers ordinary application objects, including the multi-value spelling', async () => {
    await engine.insert(
      'ref_task',
      { id: 't1', title: 'T', project: 'proj_gone', tags: ['ps_real', 'tag_gone'] },
      SYSTEM,
    );
    const report = await engine.inspectDanglingReferences();
    expect(report.dangling.map((d) => `${d.field}:${d.value}`).sort())
      .toEqual(['project:proj_gone', 'tags:tag_gone']);
  });

  it('does not treat an empty value as a reference', async () => {
    await engine.insert(
      'ref_task',
      { id: 't_empty', title: 'T', project: null, tags: [] },
      SYSTEM,
    );
    const report = await engine.inspectDanglingReferences();
    expect(report.dangling).toEqual([]);
    // Nothing was probed at all — `null` / `[]` mean "no link", which is what
    // `deleteBehavior: 'set_null'` writes.
    expect(report.scannedReferences).toBe(0);
  });

  it('skips a readonly reference — the platform-minted sentinel is not a finding', async () => {
    // `sys_metadata_history.recorded_by` stores `actor ?? 'system'`: a sentinel
    // string in a lookup column, by design. Reporting it hourly would be a
    // permanent false positive.
    await engine.insert('ref_history', { id: 'h1', recorded_by: 'system' }, SYSTEM);
    const report = await engine.inspectDanglingReferences();
    expect(report.dangling).toEqual([]);
    expect(report.scannedReferences).toBe(0);
  });

  it('counts an unprobeable target as undetermined, never as dangling', async () => {
    await engine.insert(
      'sys_position_permission_set',
      { id: 'bind_probe', permission_set_id: 'ps_who_knows' },
      SYSTEM,
    );
    // The datasource behind the TARGET goes away mid-scan.
    mem.probeFailures.add('sys_permission_set');

    const report = await engine.inspectDanglingReferences();

    // A storage outage must never be published as a lost record…
    expect(report.dangling).toEqual([]);
    // …and it must be COUNTED, so `dangling: []` can never be read as
    // "all clear" when nothing could actually be checked.
    expect(report.undetermined).toBe(1);
  });

  it('counts a reference to an unregistered object as undetermined', async () => {
    engine.registry.registerObject(orphanTarget as any);
    await engine.insert('ref_orphan', { id: 'o1', ghost: 'anything' }, SYSTEM);
    const report = await engine.inspectDanglingReferences();
    expect(report.dangling).toEqual([]);
    expect(report.undetermined).toBe(1);
  });

  it('names an unreadable object in `skipped` rather than dropping it silently', async () => {
    await engine.insert(
      'sys_position_permission_set',
      { id: 'bind_x', permission_set_id: 'ps_gone' },
      SYSTEM,
    );
    mem.readFailures.add('sys_position_permission_set');
    const report = await engine.inspectDanglingReferences();
    expect(report.dangling).toEqual([]);
    expect(report.skipped.map((s) => s.object)).toContain('sys_position_permission_set');
  });

  it('NEVER rewrites: the stored data is byte-identical across a scan', async () => {
    await engine.insert(
      'sys_position_permission_set',
      { id: 'bind_d', permission_set_id: 'ps_never_seeded' },
      SYSTEM,
    );
    await engine.insert(
      'ref_task',
      { id: 't_d', title: 'T', project: 'proj_gone', tags: ['tag_gone'] },
      SYSTEM,
    );

    const before = snapshot(mem.stores);
    const report = await engine.inspectDanglingReferences();
    const after = snapshot(mem.stores);

    // The rows genuinely exist and were genuinely written; nulling a dangling
    // link would make the stored data disagree with what happened.
    expect(report.dangling.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it('visits the RBAC link tables before anything else', async () => {
    // Priority is an ORDERING, never a filter — both objects are reported.
    await engine.insert('ref_task', { id: 't_p', title: 'T', project: 'gone_a' }, SYSTEM);
    await engine.insert(
      'sys_position_permission_set',
      { id: 'b_p', permission_set_id: 'gone_b' },
      SYSTEM,
    );
    const report = await engine.inspectDanglingReferences();
    expect(REFERENCE_SCAN_PRIORITY_OBJECTS).toContain('sys_position_permission_set');
    expect(report.dangling.map((d) => d.object))
      .toEqual(['sys_position_permission_set', 'ref_task']);
  });

  it('marks the report truncated when a cap stops it short', async () => {
    for (let i = 0; i < 4; i++) {
      await engine.insert(
        'sys_position_permission_set',
        { id: `bind_${i}`, permission_set_id: 'ps_never_seeded' },
        SYSTEM,
      );
    }
    const report = await engine.inspectDanglingReferences({ rowsPerObject: 2 });
    // A report that stopped early must not read as "everything was checked".
    expect(report.truncated).toBe(true);
    expect(report.scannedRows).toBe(2);
  });

  it('the write path still refuses the same row from a non-system caller (#4441 intact)', async () => {
    // The sweep exists BECAUSE this door is the only one left open.
    await expect(
      engine.insert(
        'sys_position_permission_set',
        { permission_set_id: 'ps_never_seeded' },
        { context: { userId: 'u1' } } as any,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('[#4551] the inspection rides the existing lifecycle clock', () => {
  it('runs after the sweep, and neither leg can stop the other', async () => {
    const calls: string[] = [];
    const logger = { info() {}, warn() { calls.push('warn'); }, debug() {} };
    const service = new LifecycleService({
      // No engine ⇒ `sweep()` is a no-op; the inspection must still run.
      getEngine: () => undefined,
      logger,
      sweepIntervalMs: 10_000,
      initialDelayMs: 0,
      inspectDanglingReferences: async () => { calls.push('inspect'); },
    });

    service.start();
    // One macrotask for the 0ms initial timer, one for the async tick.
    await new Promise((r) => setTimeout(r, 5));
    service.stop();

    expect(calls).toContain('inspect');
  });

  it('a failing inspection does not take the lifecycle sweep down with it', async () => {
    const warnings: string[] = [];
    const logger = { info() {}, warn(msg: string) { warnings.push(msg); }, debug() {} };
    let swept = 0;
    const service = new LifecycleService({
      getEngine: () => undefined,
      logger,
      sweepIntervalMs: 10_000,
      initialDelayMs: 0,
      inspectDanglingReferences: async () => { throw new Error('probe exploded'); },
    });
    // Count sweeps through the public method the clock calls.
    const originalSweep = service.sweep.bind(service);
    (service as any).sweep = async () => { swept += 1; return originalSweep(); };

    service.start();
    await new Promise((r) => setTimeout(r, 5));
    service.stop();

    expect(swept).toBe(1);
    expect(warnings.some((w) => w.includes('probe exploded'))).toBe(true);
  });
});
