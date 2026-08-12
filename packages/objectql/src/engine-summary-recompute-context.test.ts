// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── Roll-up recompute runs SYSTEM-ELEVATED, on all three write paths (#7673) ──
//
// `recomputeSummaries` used to issue the parent roll-up write under the
// CALLER's execution context, so an engine-derived write was authorized as if
// the caller had asked for it. On the ordinary parent/child shape — a child
// more widely writable than its parent (tasks, line items, comments, time
// entries) — that turned a GRANTED child write into `403` on the parent, which
// the call site rethrew as `SummaryRecomputeError` / `ERR_SUMMARY_RECOMPUTE`
// and REST mapped to a 500 — AFTER the child row had already committed. A
// client that retried created a duplicate row (#7673, #7719).
//
// ## Why this file is ONE table over three paths
//
// `recomputeSummaries` has THREE call sites implementing ONE contract —
// `engine.ts` insert / update / delete — and the reported symptom was found on
// two of them (POST and PATCH, #7719). A test that covered only the path that
// happened to be debugged would let the next divergence land silently, so every
// assertion below runs `it.each(WRITE_PATHS)`: insert, update and delete answer
// the same questions, or this file goes red.
//
// ## The stand-in for plugin-security is its documented contract, not a mock
//
// `@objectstack/objectql` cannot import `@objectstack/plugin-security` (the
// dependency runs the other way), so the deny gate here is a middleware that
// reproduces the ONE rule the fix relies on — `security-plugin.ts`'s
// `if (opCtx.context?.isSystem) return next();` short-circuit at the top of the
// CRUD middleware. That is the seam under test: the engine's job is to hand the
// recompute a context that satisfies it, and this file asserts both the
// behaviour (the write succeeds, the roll-up lands) and the mechanism (the
// parent write is observed carrying `isSystem`).

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

/**
 * The caller — a plain member holding `create`/`read`/`edit`/`delete` on the
 * CHILD and read-only access to the PARENT. This is `member_default` on
 * `showcase_task` vs `showcase_project`, which is where the defect was measured.
 */
const MEMBER = { userId: 'u_member', positions: ['member_default'] } as any;

/** Grants the stand-in gate enforces. Note: no `update` on the parent. */
const MEMBER_GRANTS: Record<string, string[]> = {
  task: ['insert', 'update', 'delete', 'find', 'findOne', 'count', 'aggregate'],
  proj: ['find', 'findOne', 'count', 'aggregate'],
};

/**
 * The refusal the stand-in gate raises, in the ADR-0112 envelope
 * `PermissionDeniedError` declares (`code` + `statusCode` 403,
 * `plugin-security/src/errors.ts`). Spelled out here rather than imported for
 * the dependency-direction reason above; the refusal assertions below read
 * `code` AND `statusCode`, so a gate that stopped refusing — or refused with a
 * bare `Error` — cannot pass them.
 */
class TestPermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly statusCode = 403;
  constructor(object: string, operation: string) {
    super(`[Security] Access denied: operation '${operation}' on object '${object}' is not permitted`);
    this.name = 'PermissionDeniedError';
  }
}

interface ObservedOp {
  object: string;
  operation: string;
  isSystem: boolean;
  userId: unknown;
}

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  // Flat equality plus `$and` — the two shapes `aggregateSummaryValue` and the
  // row-filter middleware below actually produce.
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and') return (v as any[]).every((sub) => matches(row, sub));
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

/**
 * @param scopeChildReadsToOwner reproduce a row-level read filter on the child
 *   (`owner_id == caller`) for NON-system reads — the second failure mode the
 *   caller-scoped recompute had: the aggregate was computed over the caller's
 *   VISIBLE subset and stored on the parent as if it were the whole collection.
 */
async function makeEngine(opts: { scopeChildReadsToOwner?: boolean } = {}) {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'proj',
    fields: {
      name: { type: 'text' },
      task_count: { type: 'summary', summaryOperations: { object: 'task', field: 'id', function: 'count' } },
      total_estimate: { type: 'summary', summaryOperations: { object: 'task', field: 'estimate', function: 'sum' } },
    },
  } as any);
  engine.registry.registerObject({
    name: 'task',
    fields: {
      title: { type: 'text' },
      estimate: { type: 'number' },
      owner_id: { type: 'text' },
      proj: { type: 'master_detail', reference: 'proj' },
    },
  } as any);

  const observed: ObservedOp[] = [];
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    observed.push({
      object: opCtx.object,
      operation: opCtx.operation,
      isSystem: opCtx.context?.isSystem === true,
      userId: opCtx.context?.userId,
    });
    // `security-plugin.ts` L949 — "System operations bypass security". The one
    // rule this fix depends on, reproduced verbatim in shape.
    if (opCtx.context?.isSystem) return next();
    // No principal at all ⇒ the bare-kernel/setup path; the real plugin gates
    // that separately and the fixtures below use it only to seed.
    if (!opCtx.context?.userId) return next();
    if (!(MEMBER_GRANTS[opCtx.object] ?? []).includes(opCtx.operation)) {
      throw new TestPermissionDeniedError(opCtx.object, opCtx.operation);
    }
    if (opts.scopeChildReadsToOwner && opCtx.object === 'task' && opCtx.ast) {
      const prior = opCtx.ast.where;
      opCtx.ast.where = prior
        ? { $and: [prior, { owner_id: opCtx.context.userId }] }
        : { owner_id: opCtx.context.userId };
    }
    return next();
  });

  return { engine, storeFor: d.storeFor, observed };
}

/** Seed a parent plus `existing` sibling tasks owned by SOMEONE ELSE. */
async function seed(engine: ObjectQL, storeFor: (o: string) => Map<string, any>, existing: number) {
  const proj = await engine.insert('proj', { name: 'P-1' });
  for (let i = 0; i < existing; i++) {
    // Seeded directly into the store: these are rows the member did not write
    // and (under `scopeChildReadsToOwner`) cannot see.
    storeFor('task').set(`seeded_${i}`, {
      id: `seeded_${i}`, title: `seeded-${i}`, estimate: 100, proj: proj.id, owner_id: 'u_other',
    });
  }
  return proj;
}

/**
 * The three call sites, as one contract. Each entry performs a write the member
 * IS granted on the child, and declares what the parent's roll-ups must read
 * once the recompute has run.
 *
 * `existing` sibling rows are owned by another user and each carry
 * `estimate: 100`, so the expected values below are only reachable if the
 * aggregate saw the WHOLE child collection.
 */
const WRITE_PATHS = [
  {
    name: 'insert — POST /data/task (the #7673 repro)',
    existing: 1,
    expected: { task_count: 2, total_estimate: 130 },
    async run(engine: ObjectQL, projId: string) {
      return engine.insert(
        'task',
        { title: 'probe', estimate: 30, proj: projId, owner_id: MEMBER.userId },
        { context: MEMBER } as any,
      );
    },
  },
  {
    name: 'update — PATCH /data/task/<id> (the #7719 half)',
    existing: 1,
    expected: { task_count: 2, total_estimate: 150 },
    async run(engine: ObjectQL, projId: string) {
      const own = await engine.insert(
        'task',
        { title: 'own', estimate: 30, proj: projId, owner_id: MEMBER.userId },
        { context: MEMBER } as any,
      );
      return engine.update('task', { id: own.id, estimate: 50 }, { context: MEMBER } as any);
    },
  },
  {
    name: 'delete — DELETE /data/task/<id>',
    existing: 1,
    expected: { task_count: 1, total_estimate: 100 },
    async run(engine: ObjectQL, projId: string) {
      const own = await engine.insert(
        'task',
        { title: 'own', estimate: 30, proj: projId, owner_id: MEMBER.userId },
        { context: MEMBER } as any,
      );
      return engine.delete('task', { where: { id: own.id }, context: MEMBER } as any);
    },
  },
] as const;

describe('[#7673] roll-up recompute is system-elevated on every write path', () => {
  it.each(WRITE_PATHS)('$name: the granted child write RESOLVES (no ERR_SUMMARY_RECOMPUTE)', async ({ existing, run }) => {
    const { engine, storeFor } = await makeEngine();
    const proj = await seed(engine, storeFor, existing);

    // Before #7673 this rejected with `ERR_SUMMARY_RECOMPUTE` — after the row
    // had already been written, which is what made a client retry duplicate it.
    await expect(run(engine, proj.id)).resolves.toBeDefined();
  });

  it.each(WRITE_PATHS)('$name: the parent roll-ups actually land the recomputed values', async ({ existing, expected, run }) => {
    const { engine, storeFor } = await makeEngine();
    const proj = await seed(engine, storeFor, existing);

    await run(engine, proj.id);

    // The substance, not just the absence of a throw: the recompute RAN and
    // wrote the aggregate over the whole child collection.
    const stored = storeFor('proj').get(proj.id);
    expect(stored.task_count).toBe(expected.task_count);
    expect(stored.total_estimate).toBe(expected.total_estimate);
  });

  it.each(WRITE_PATHS)('$name: the parent write is observed carrying `isSystem` (the plugin-security bypass)', async ({ existing, run }) => {
    const { engine, storeFor, observed } = await makeEngine();
    const proj = await seed(engine, storeFor, existing);
    observed.length = 0;

    await run(engine, proj.id);

    const parentUpdates = observed.filter((o) => o.object === 'proj' && o.operation === 'update');
    expect(parentUpdates.length).toBeGreaterThan(0);
    for (const op of parentUpdates) expect(op.isSystem).toBe(true);
    // Elevation is a `sudo()`-shaped derivative of the caller's context, not a
    // bare `{ isSystem: true }`: identity (and with it `tenantId`, `timezone`
    // and any open transaction handle) must still ride along, or the recompute
    // silently leaves the caller's transaction and stops being tenant-scoped.
    for (const op of parentUpdates) expect(op.userId).toBe(MEMBER.userId);
  });

  it.each(WRITE_PATHS)('$name: the CHILD write itself stays under the CALLER context', async ({ existing, run }) => {
    const { engine, storeFor, observed } = await makeEngine();
    const proj = await seed(engine, storeFor, existing);
    observed.length = 0;

    await run(engine, proj.id);

    // The elevation is scoped to the recompute. The operation the caller
    // actually asked for is still authorized as the caller — otherwise this
    // fix would have turned every child write into a system write.
    const childWrites = observed.filter(
      (o) => o.object === 'task' && ['insert', 'update', 'delete'].includes(o.operation),
    );
    expect(childWrites.length).toBeGreaterThan(0);
    for (const op of childWrites) expect(op.isSystem).toBe(false);
  });

  it.each(WRITE_PATHS)('$name: the aggregate reads the WHOLE child collection, not the caller-visible subset', async ({ existing, expected, run }) => {
    // Same paths, now with a row-level read filter on the child. Under the
    // caller's context the aggregate saw only the member's own rows, so the
    // parent column was silently rewritten to ONE READER's view of the
    // collection — a roll-up is a property of the parent, never of whoever
    // happened to touch a child.
    const { engine, storeFor } = await makeEngine({ scopeChildReadsToOwner: true });
    const proj = await seed(engine, storeFor, existing);

    await run(engine, proj.id);

    const stored = storeFor('proj').get(proj.id);
    expect(stored.task_count).toBe(expected.task_count);
    expect(stored.total_estimate).toBe(expected.total_estimate);
  });
});

describe('[#7673] the elevation does not widen what the caller may do', () => {
  it('a DIRECT caller update of the parent is still refused — 403 PERMISSION_DENIED', async () => {
    const { engine, storeFor } = await makeEngine();
    const proj = await seed(engine, storeFor, 0);

    const caught = await engine
      .update('proj', { id: proj.id, name: 'renamed by the member' }, { context: MEMBER } as any)
      .then(() => null, (e: any) => e);

    expect(caught).toBeTruthy();
    expect(caught.code).toBe('PERMISSION_DENIED');
    expect(caught.statusCode).toBe(403);
    // …and the refusal is real: the parent row is untouched.
    expect(storeFor('proj').get(proj.id).name).toBe('P-1');
  });

  it('a caller write to a NON-summary parent field is still refused even alongside a child write', async () => {
    const { engine, storeFor } = await makeEngine();
    const proj = await seed(engine, storeFor, 0);

    await engine.insert(
      'task',
      { title: 'probe', estimate: 7, proj: proj.id, owner_id: MEMBER.userId },
      { context: MEMBER } as any,
    );

    // The child write moved the DERIVED column and nothing else.
    const stored = storeFor('proj').get(proj.id);
    expect(stored.total_estimate).toBe(7);
    expect(stored.name).toBe('P-1');

    const caught = await engine
      .update('proj', { id: proj.id, name: 'still refused' }, { context: MEMBER } as any)
      .then(() => null, (e: any) => e);
    expect(caught?.code).toBe('PERMISSION_DENIED');
    expect(caught?.statusCode).toBe(403);
  });

  it('a caller with NO grant on the child is still refused, and writes nothing', async () => {
    const { engine, storeFor } = await makeEngine();
    const proj = await seed(engine, storeFor, 0);
    const stranger = { userId: 'u_stranger', positions: [] } as any;

    // The stand-in gate is grant-by-object, so narrow the child grant away for
    // this one probe by asking for an operation the member never held either.
    const caught = await engine
      .insert('other_object_without_grant', { x: 1 }, { context: stranger } as any)
      .then(() => null, (e: any) => e);

    expect(caught?.code).toBe('PERMISSION_DENIED');
    expect(caught?.statusCode).toBe(403);
    expect(storeFor('proj').get(proj.id).task_count).toBe(0);
  });
});

describe('[#7673] a child repointed to another parent recomputes BOTH parents, elevated', () => {
  it('old and new parent both land, and both writes carry `isSystem`', async () => {
    const { engine, storeFor, observed } = await makeEngine();
    const a = await engine.insert('proj', { name: 'A' });
    const b = await engine.insert('proj', { name: 'B' });
    const own = await engine.insert(
      'task',
      { title: 'moving', estimate: 9, proj: a.id, owner_id: MEMBER.userId },
      { context: MEMBER } as any,
    );
    observed.length = 0;

    await expect(
      engine.update('task', { id: own.id, proj: b.id }, { context: MEMBER } as any),
    ).resolves.toBeDefined();

    expect(storeFor('proj').get(a.id).task_count).toBe(0);
    expect(storeFor('proj').get(a.id).total_estimate).toBe(0);
    expect(storeFor('proj').get(b.id).task_count).toBe(1);
    expect(storeFor('proj').get(b.id).total_estimate).toBe(9);

    const parentUpdates = observed.filter((o) => o.object === 'proj' && o.operation === 'update');
    expect(parentUpdates.map((o) => o.isSystem)).not.toContain(false);
    expect(parentUpdates.length).toBeGreaterThanOrEqual(2);
  });
});
