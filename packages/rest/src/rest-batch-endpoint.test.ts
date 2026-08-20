// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Cross-object transactional batch route (POST {basePath}/batch, issue #1604 /
// ADR-0034). Engine-level atomicity is covered in
// objectql/src/engine-ambient-transaction.test.ts; this suite is the
// REST-boundary contract ADR-0034 flagged as missing: request validation,
// per-op API-exposure enforcement, $ref resolution, and error surfacing.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

// ── helpers ──────────────────────────────────────────────────────────────────

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

/**
 * A fake ObjectQL whose `transaction(cb)` runs the callback and rethrows on
 * failure (mirroring commit-on-success / rollback-on-throw). `insert` returns a
 * freshly-minted id so `$ref` resolution and index-aligned results are testable.
 */
function makeQl(overrides: Partial<Record<'insert' | 'update' | 'delete', any>> = {}) {
  let seq = 0;
  const ql: any = {
    transaction: vi.fn(async (cb: any, ctx: any) => cb({ __trx: true, ctx })),
    insert: overrides.insert ?? vi.fn(async (_object: string, data: any) => ({ id: `id_${++seq}`, ...data })),
    // Both defaults open with the producer's own dispatch predicate rather than
    // a hand-mirrored `if` (#4434 / #5480). Until #9877 the gate could not read
    // either of them: a `??` default is a BinaryExpression, so `implOf` answered
    // null and these two doubles sat in NEITHER the pinned population nor the
    // baseline — absent, which reads as clean. The delete double in particular
    // is never driven by this suite, which is exactly the shape #4434 shipped.
    update: overrides.update ?? vi.fn(async (_object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return { ...data };
    }),
    delete: overrides.delete ?? vi.fn(async (_object: string, options: any) => {
      assertEngineDeleteDispatch(options);
      return { success: true, id: options?.where?.id };
    }),
  };
  return ql;
}

/**
 * A fake `createData` standing in for the protocol's create ingress (#3835):
 * the batch's create ops go through it rather than calling `ql.insert`, so the
 * #3043 static-`readonly` strip applies to a batch create exactly as it does to
 * `POST /data/:object`. Delegates to the same `ql.insert` the other ops use, so
 * assertions about what reached the engine still read off `ql.insert`.
 */
function makeCreateData(ql: any, opts: { readonlyFields?: string[] } = {}) {
  const readonlyFields = opts.readonlyFields ?? [];
  return vi.fn(async (request: any) => {
    const supplied = request?.data ?? {};
    const stripped: string[] = readonlyFields.filter((f) => f in supplied);
    const data = { ...supplied };
    for (const f of stripped) delete data[f];
    const record = await ql.insert(request.object, data, { context: request.context });
    return {
      object: request.object,
      id: record?.id,
      record,
      ...(stripped.length > 0
        ? { droppedFields: [{ object: request.object, fields: stripped, reason: 'readonly' }] }
        : {}),
    };
  });
}

/** Build a RestServer with an optional ObjectQL provider and object metadata. */
function buildServer(opts: { ql?: any; objects?: any[]; readonlyFields?: string[] } = {}) {
  const server = mockServer();
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue(opts.objects ?? []),
    createData: opts.ql
      ? makeCreateData(opts.ql, { readonlyFields: opts.readonlyFields ?? [] })
      : vi.fn(),
  };
  const objectQLProvider = opts.ql ? async () => opts.ql : undefined;
  const rest = new RestServer(
    server as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, // kernelManager, envRegistry, defaultEnvIdProvider, authServiceProvider
    objectQLProvider,                           // objectQLProvider (positional arg #8)
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r) => r.method === 'POST' && (r.metadata?.summary ?? '').startsWith('Cross-object'),
  );
  return { route, protocol };
}

/** POST a body at the cross-object batch route and return the mock response. */
async function post(route: any, body: any) {
  const res = mockRes();
  await route!.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  return res;
}

// ── registration ─────────────────────────────────────────────────────────────

describe('POST {basePath}/batch — cross-object transactional batch', () => {
  it('registers the route under the data/batch tags', () => {
    const { route } = buildServer({ ql: makeQl() });
    expect(route).toBeTruthy();
    expect(route!.metadata?.tags).toEqual(expect.arrayContaining(['data', 'batch']));
  });

  it('returns 501 with a NOT_IMPLEMENTED code when the runtime has no transactional ObjectQL', async () => {
    const { route } = buildServer({}); // no ql provider
    const res = await post(route, { operations: [{ object: 'account', data: {} }] });
    expect(res.statusCode).toBe(501);
    // Typed like every other 501 (#4067) so clients key on the code, not the prose.
    expect(res.body.code).toBe('NOT_IMPLEMENTED');
  });

  // ── happy path ───────────────────────────────────────────────────────────

  it('commits multiple ops in one transaction and returns index-aligned results', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, {
      operations: [
        { object: 'project', action: 'create', data: { name: 'Apollo' } },
        { object: 'task', action: 'create', data: { title: 'Kickoff' } },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(ql.transaction).toHaveBeenCalledTimes(1);
    expect(ql.insert).toHaveBeenCalledTimes(2);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toMatchObject({ id: 'id_1', name: 'Apollo' });
    expect(res.body.results[1]).toMatchObject({ id: 'id_2', title: 'Kickoff' });
  });

  it('resolves { $ref: <opIndex> } to an earlier create\'s id (master-detail)', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, {
      operations: [
        { object: 'project', action: 'create', data: { name: 'Apollo' } },
        { object: 'task', action: 'create', data: { title: 'Kickoff', project: { $ref: 0 } } },
      ],
    });
    expect(res.statusCode).toBe(200);
    // The child's FK was rewritten from { $ref: 0 } to the parent's generated id.
    const childData = ql.insert.mock.calls[1][1];
    expect(childData.project).toBe('id_1');
  });

  it('defaults a missing action to create', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, { operations: [{ object: 'account', data: { name: 'X' } }] });
    expect(res.statusCode).toBe(200);
    expect(ql.insert).toHaveBeenCalledTimes(1);
  });

  it('returns an empty result set for zero operations without opening a transaction', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, { operations: [] });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ results: [] });
    expect(ql.transaction).not.toHaveBeenCalled();
  });

  // ── atomicity / rollback surfacing ────────────────────────────────────────

  it('surfaces a failing op with its mapped status (atomic rollback, not partial success)', async () => {
    const insert = vi.fn()
      .mockResolvedValueOnce({ id: 'id_1', name: 'Apollo' })
      .mockRejectedValueOnce(Object.assign(new Error('bad'), { code: 'VALIDATION_FAILED', name: 'ValidationError' }));
    const ql = makeQl({ insert });
    const { route } = buildServer({ ql });
    const res = await post(route, {
      operations: [
        { object: 'project', action: 'create', data: { name: 'Apollo' } },
        { object: 'task', action: 'create', data: {} },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    // No success envelope is returned when the transaction threw.
    expect(res.body.results).toBeUndefined();
  });

  it('rejects an unresolvable $ref with 400 BATCH_UNRESOLVED_REF', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, {
      operations: [{ object: 'task', action: 'create', data: { project: { $ref: 5 } } }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BATCH_UNRESOLVED_REF');
  });

  // ── per-object API-exposure enforcement (ADR-0049) ────────────────────────

  it('blocks a write to an API-disabled object with 404 before opening a transaction', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql, objects: [{ name: 'secret', enable: { apiEnabled: false } }] });
    const res = await post(route, { operations: [{ object: 'secret', action: 'create', data: {} }] });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('OBJECT_API_DISABLED');
    expect(ql.transaction).not.toHaveBeenCalled();
  });

  it('blocks an operation absent from the apiMethods whitelist with 405', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql, objects: [{ name: 'ledger', enable: { apiMethods: ['read'] } }] });
    const res = await post(route, { operations: [{ object: 'ledger', action: 'create', data: {} }] });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(ql.transaction).not.toHaveBeenCalled();
  });

  it('allows an operation that IS in the apiMethods whitelist (with bulk)', async () => {
    // #3391: the cross-object batch is a bulk surface — the object must grant the
    // `bulk` primitive AND the child write (bulk ∧ create).
    const ql = makeQl();
    const { route } = buildServer({ ql, objects: [{ name: 'ledger', enable: { apiMethods: ['create', 'bulk'] } }] });
    const res = await post(route, { operations: [{ object: 'ledger', action: 'create', data: { amount: 1 } }] });
    expect(res.statusCode).toBe(200);
    expect(ql.transaction).toHaveBeenCalledTimes(1);
  });

  it('blocks a batch write when the object grants the child but not the bulk primitive (405, #3391)', async () => {
    // create is whitelisted but `bulk` is not → the batch/Many surface is closed.
    const ql = makeQl();
    const { route } = buildServer({ ql, objects: [{ name: 'ledger', enable: { apiMethods: ['create'] } }] });
    const res = await post(route, { operations: [{ object: 'ledger', action: 'create', data: { amount: 1 } }] });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    // the 405 body carries the EFFECTIVE operation set, not the raw whitelist
    expect(res.body.allowed).toContain('create');
    expect(res.body.allowed).not.toContain('bulk');
    expect(ql.transaction).not.toHaveBeenCalled();
  });

  it('blocks a batch write when the object grants bulk but not the child (405, #3391)', async () => {
    // bulk is present but the object cannot create → bulk ∧ create fails.
    const ql = makeQl();
    const { route } = buildServer({ ql, objects: [{ name: 'ledger', enable: { apiMethods: ['bulk', 'update'] } }] });
    const res = await post(route, { operations: [{ object: 'ledger', action: 'create', data: { amount: 1 } }] });
    expect(res.statusCode).toBe(405);
    expect(res.body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(ql.transaction).not.toHaveBeenCalled();
  });

  // ── write observability (#3794) ───────────────────────────────────────────
  //
  // The console's record form saves a master-detail record through THIS route,
  // so a `readonlyWhen`-locked field edited in that form was stripped by the
  // engine and the response said nothing — the user saw "updated successfully"
  // over a value that never changed. Every other write path already reports its
  // strips (#3431/#3455); this one now does too.

  it('surfaces engine-stripped fields as droppedFields tagged with the op index', async () => {
    const ql = makeQl({
      update: vi.fn(async (_object: string, data: any, opts: any) => {
        opts?.onFieldsDropped?.({ object: 'invoice', fields: ['tax_rate'], reason: 'readonly_when' });
        const { tax_rate: _stripped, ...kept } = data;
        return kept;
      }),
    });
    const { route } = buildServer({ ql });
    const res = await post(route, {
      operations: [
        { object: 'account', action: 'create', data: { name: 'Acme' } },
        { object: 'invoice', action: 'update', id: 'inv_1', data: { status: 'paid', tax_rate: 9 } },
      ],
    });
    expect(res.statusCode).toBe(200);
    // The batch still committed — a strip is legal semantics, not an error.
    expect(res.body.results).toHaveLength(2);
    expect(res.body.droppedFields).toEqual([
      { object: 'invoice', fields: ['tax_rate'], reason: 'readonly_when', index: 1 },
    ]);
  });

  it('omits droppedFields entirely when nothing was stripped', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, { operations: [{ object: 'account', data: { name: 'Acme' } }] });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty('droppedFields');
  });

  // ── create ingress parity (#3835) ─────────────────────────────────────────
  //
  // The engine's INSERT path is static-`readonly`-exempt by design (#3413), so
  // the #3043 strip that stops a non-system caller from seeding a read-only
  // column lives at the protocol's create ingress. This route used to call
  // `ql.insert` directly and skip it, so `readonly` meant two different things
  // depending on which create endpoint you used.

  it('routes create ops through the protocol create ingress, not ql.insert', async () => {
    const ql = makeQl();
    const { route, protocol } = buildServer({ ql });
    const res = await post(route, {
      operations: [{ object: 'account', action: 'create', data: { name: 'Acme' } }],
    });
    expect(res.statusCode).toBe(200);
    expect(protocol.createData).toHaveBeenCalledTimes(1);
    const request = protocol.createData.mock.calls[0][0];
    expect(request).toMatchObject({ object: 'account', data: { name: 'Acme' } });
    // The ingress must run INSIDE this transaction — same context the other ops
    // bind, or the create would commit independently of the rollback.
    expect(request.context).toMatchObject({ __trx: true });
  });

  it('strips a caller-forged readonly column on a batch create and reports it', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql, readonlyFields: ['approval_status'] });
    const res = await post(route, {
      operations: [
        { object: 'account', action: 'create', data: { name: 'Acme', approval_status: 'approved' } },
      ],
    });
    expect(res.statusCode).toBe(200);
    // Never reached the engine…
    expect(ql.insert).toHaveBeenCalledWith('account', { name: 'Acme' }, expect.anything());
    // …and the caller is told, tagged with the op that dropped it.
    expect(res.body.droppedFields).toEqual([
      { object: 'account', fields: ['approval_status'], reason: 'readonly', index: 0 },
    ]);
  });

  it('keeps $ref resolution working through the ingress', async () => {
    // `results` now holds the ingress's echoed record rather than the raw
    // engine return — a later op must still resolve `{ $ref: 0 }` to its id.
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, {
      operations: [
        { object: 'project', action: 'create', data: { name: 'Apollo' } },
        { object: 'task', action: 'create', data: { title: 'Kickoff', project: { $ref: 0 } } },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.results[0].id).toBe('id_1');
    expect(ql.insert).toHaveBeenLastCalledWith(
      'task', { title: 'Kickoff', project: 'id_1' }, expect.anything(),
    );
  });

  // ── request validation ────────────────────────────────────────────────────

  it('rejects a non-atomic request (this endpoint is always atomic)', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, { operations: [{ object: 'account', data: {} }], atomic: false });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BATCH_NOT_ATOMIC');
    expect(ql.transaction).not.toHaveBeenCalled();
  });

  it('rejects an update op with no id', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, { operations: [{ object: 'account', action: 'update', data: { name: 'X' } }] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(ql.transaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed operation (missing object) with 400', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, { operations: [{ action: 'create', data: {} }] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown action with 400', async () => {
    const ql = makeQl();
    const { route } = buildServer({ ql });
    const res = await post(route, { operations: [{ object: 'account', action: 'frobnicate', data: {} }] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
