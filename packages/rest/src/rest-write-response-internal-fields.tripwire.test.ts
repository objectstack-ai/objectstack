// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8497 — THE TRIPWIRE, REST HALF: no response body an HTTP caller receives
// from a write carries an `internal: true` value.
//
// ## The property, and why it needed a second guard
//
// #7823 shipped `protocol.write-response-internal-fields.tripwire.test.ts`,
// which walks the protocol class's prototype for `*Data` faces. That guard is
// strong and is NOT replaced here — its runtime enumeration and its `leakyData`
// negative control stay exactly as they are. What it cannot do is see a write
// mouth that is not ON that class, and this server owns one: the cross-object
// transactional batch (`POST /batch`) reaches `ql.update` DIRECTLY, by a
// deliberate #3835-era choice, and pushes the returned row into `results`.
// The shared strip is applied there today — nothing leaks — but a prototype
// walk over another package's class is structurally incapable of proving it,
// and equally incapable of noticing the NEXT direct mouth.
//
// So the guarded property is stated at the boundary where it is actually true:
//
//     no response body an external caller receives from a write carries an
//     `internal: true` value
//
// …rather than "every `*Data` face on one class". Those two were the same set
// on the day the first tripwire was written; `POST /batch` is the standing
// proof they are not the same set by construction.
//
// ## How the enumeration catches a NEW route
//
// The route list is NOT hand-written. It is read off `RestServer.getRoutes()`
// at runtime — the same enumeration `rest-route-ledger.conformance.test.ts`
// audits this package's surface with. Every write-method route must carry a
// DISPOSITION below; a write route with no disposition FAILS the suite with
// instructions, so a new write surface cannot ship unexamined. Three
// dispositions, and the distinction between them is the whole point:
//
//   - `driven`         — a recipe below drives the route against a fixture
//                        whose stored rows carry a flagged sentinel, and the
//                        suite deep-scans the response body. MEASURED.
//   - `protocol-ingress` — the route's write goes through a protocol `*Data`
//                        face, so the strip is held by the #7823 tripwire.
//                        A reviewed claim about the code, recorded so it is
//                        visible and can be re-checked.
//   - `no-record-echo` — the body carries no record of a user data object
//                        (metadata items, receipts, verdicts, per-row import
//                        results, sharing grants). Reviewed claim.
//
// ⚠️ Only `driven` is a measurement. The other two are declarations, and they
// are here so that adding a write route forces an explicit decision rather
// than silently widening the surface — which is exactly the failure this file
// exists to prevent. When in doubt, DRIVE it.
//
// ## What each recipe proves
//
// The driver stores a flagged column on every row holding SENTINEL — the real
// shape of `sys_api_key.key` / `sys_session.token`, a stored secret the caller
// never sent. The engine's READ path strips it (unchanged by #7823); the
// engine's WRITE results carry it whole (that is #7823's whole point), so every
// write body below is one un-run strip away from leaking. Each driven route is
// scanned:
//
//   - SENTINEL anywhere in the response  → a mouth skipped the helper → RED
//   - CONTROL missing where a record was promised → the probe went blind → RED
//     (falsifiability: an exposure refusal or a 501 would otherwise satisfy
//     "no sentinel" with an empty body)
//
// Reverse-verified at authoring time, both halves, against the real code:
// deleting the strip from the `POST /batch` update arm turned this suite RED on
// exactly that route, and adding a SECOND unstripped direct `ql.insert` mouth
// to the batch create arm turned it RED again — then `git hash-object` proved
// the restored files byte-identical to their committed state.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { omitInternalFieldsFromWriteResponse } from '@objectstack/core';
import { RestServer } from './rest-server.js';

/** The value that must NEVER appear in any write response. */
const SENTINEL = 'INTERNAL-SENTINEL-8497-NEVER-SERIALIZED';
/** The value that MUST appear wherever a record was promised (falsifiability). */
const CONTROL = 'CONTROL-VALUE-8497-RECORD-FLOWED';

/** The flagged column every stored row carries — the caller never sends it. */
const SECRET_FIELD = 'vault_secret';

const VAULT = {
  name: 'vault',
  label: 'Vault',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' },
    [SECRET_FIELD]: { name: SECRET_FIELD, label: 'Secret', type: 'text', internal: true },
  },
  // `clone` so the clone route is reachable; no `api`/`bulk` narrowing so the
  // ADR-0049 exposure gate resolves unrestricted and every bulk route is
  // reachable. A refusal here would show up as a BLIND probe (no CONTROL), not
  // as a false pass.
  enable: { clone: true, bulk: true },
};

/**
 * In-memory driver that stamps the flagged column on every stored row, the way
 * a hook or the platform mints `sys_api_key.key`. Copy-on-read, `RETURNING *`
 * write semantics — the same shape `rest-write-response-formula.test.ts` uses.
 */
function memoryDriver() {
  const rows = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (o: string) => {
    let t = rows.get(o);
    if (!t) { t = new Map(); rows.set(o, t); }
    return t;
  };
  let seq = 0;
  const matches = (row: Record<string, unknown>, where: unknown) => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
      if (k.startsWith('$')) continue;
      const want = (v && typeof v === 'object' && '$eq' in (v as Record<string, unknown>))
        ? (v as Record<string, unknown>).$eq
        : v;
      if ((row[k] ?? null) !== (want ?? null)) return false;
    }
    return true;
  };
  const driver = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: { where?: unknown }) {
      return Array.from(table(object).values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: { where?: unknown }) {
      for (const r of table(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      seq += 1;
      const id = (data.id as string) ?? `r_${seq}`;
      // The stored secret the caller never sent — present on every row.
      const row = { ...data, id, [SECRET_FIELD]: SENTINEL };
      table(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const t = table(object);
      const cur = t.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id, [SECRET_FIELD]: SENTINEL };
      t.set(id, next);
      return { ...next };
    },
    async delete(object: string, id: string) { return table(object).delete(id); },
    async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
    async count(object: string, ast: { where?: unknown }) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, list: Record<string, unknown>[]) {
      const out = [];
      for (const r of list) out.push(await this.create(object, r));
      return out;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

function createMockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  res.header = vi.fn(() => res);
  res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
  return res;
}

/**
 * A REAL engine, a REAL protocol, and the REAL registered routes. Nothing about
 * the write path is hand-built here: the point is to measure what an HTTP
 * caller receives, so every layer between the driver and `res.json` must be the
 * shipped one. `objectQLProvider` (positional arg #8) is what makes
 * `POST /batch` — the direct-`ql.update` mouth this file exists for — reachable
 * rather than answering 501.
 */
async function bootRest() {
  const engine = new ObjectQL();
  engine.registerDriver(memoryDriver() as never, true);
  await engine.init();
  engine.registry.registerObject(VAULT as never, 'tripwire-8497');
  const protocol = new ObjectStackProtocolImplementation(engine as never);
  const rest = new RestServer(
    createMockServer() as never,
    protocol as never,
    { api: { requireAuth: false } } as never,
    undefined, undefined, undefined, undefined,
    (async () => engine) as never,
  );
  (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
    async () => ({ userId: 'u1' });
  rest.registerRoutes();
  return { rest, engine };
}

type Booted = Awaited<ReturnType<typeof bootRest>>;

async function call(booted: Booted, method: string, path: string, req: Record<string, unknown>) {
  const route = (booted.rest.getRoutes() as Array<{
    method: string; path: string; handler: (rq: unknown, rs: unknown) => Promise<void>;
  }>).find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`${method} ${path} route not registered`);
  const res = makeRes();
  await route.handler({ method, params: {}, query: {}, body: {}, headers: {}, ...req }, res);
  return res as unknown as { statusCode: number; body: unknown };
}

/** Seed one stored row (secret included, by the driver) and return its id. */
async function seed(booted: Booted, id = 'row-1') {
  await (booted.engine as unknown as {
    insert: (o: string, d: unknown) => Promise<unknown>;
  }).insert('vault', { id, name: CONTROL });
  return id;
}

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

type Disposition =
  /** Driven below and scanned. `expectRecord`: the body promises a record. */
  | { kind: 'driven'; expectRecord: boolean; invoke: (b: Booted) => Promise<{ body: unknown }> }
  /** Writes through a protocol `*Data` face — held by the #7823 tripwire. */
  | { kind: 'protocol-ingress'; why: string }
  /** Body carries no record of a user data object. */
  | { kind: 'no-record-echo'; why: string };

const D = '/api/v1/data';

const DISPOSITIONS: Record<string, Disposition> = {
  // ── DRIVEN: the data plane, where a user-object record rides the body ─────
  [`POST ${D}/:object`]: {
    kind: 'driven', expectRecord: true,
    invoke: (b) => call(b, 'POST', `${D}/:object`, {
      params: { object: 'vault' }, body: { name: CONTROL },
    }),
  },
  [`PATCH ${D}/:object/:id`]: {
    kind: 'driven', expectRecord: true,
    invoke: async (b) => call(b, 'PATCH', `${D}/:object/:id`, {
      params: { object: 'vault', id: await seed(b) }, body: { name: CONTROL },
    }),
  },
  [`POST ${D}/:object/:id/clone`]: {
    kind: 'driven', expectRecord: true,
    invoke: async (b) => call(b, 'POST', `${D}/:object/:id/clone`, {
      params: { object: 'vault', id: await seed(b) }, body: {},
    }),
  },
  [`POST ${D}/:object/createMany`]: {
    kind: 'driven', expectRecord: true,
    // Body IS the records array on this route.
    invoke: (b) => call(b, 'POST', `${D}/:object/createMany`, {
      params: { object: 'vault' }, body: [{ name: CONTROL }, { name: 'second' }],
    }),
  },
  [`POST ${D}/:object/updateMany`]: {
    kind: 'driven', expectRecord: true,
    invoke: async (b) => call(b, 'POST', `${D}/:object/updateMany`, {
      params: { object: 'vault' },
      body: { records: [{ id: await seed(b), data: { name: CONTROL } }] },
    }),
  },
  [`POST ${D}/:object/batch`]: {
    kind: 'driven', expectRecord: true,
    invoke: (b) => call(b, 'POST', `${D}/:object/batch`, {
      params: { object: 'vault' },
      body: { operation: 'create', records: [{ data: { name: CONTROL } }], options: {} },
    }),
  },
  // ⭐ THE MOUTH THIS FILE EXISTS FOR: cross-object batch, whose update arm
  //    calls `ql.update` DIRECTLY (not through a protocol `*Data` face) and
  //    pushes the returned row into `results`.
  'POST /api/v1/batch': {
    kind: 'driven', expectRecord: true,
    invoke: async (b) => {
      const id = await seed(b);
      return call(b, 'POST', '/api/v1/batch', {
        body: {
          operations: [
            { object: 'vault', action: 'create', data: { name: CONTROL } },
            { object: 'vault', action: 'update', id, data: { name: CONTROL } },
          ],
        },
      });
    },
  },
  // Receipts, driven anyway: a future receipt that starts echoing the row is
  // caught the day it does.
  [`DELETE ${D}/:object/:id`]: {
    kind: 'driven', expectRecord: false,
    invoke: async (b) => call(b, 'DELETE', `${D}/:object/:id`, {
      params: { object: 'vault', id: await seed(b) },
    }),
  },
  [`POST ${D}/:object/deleteMany`]: {
    kind: 'driven', expectRecord: false,
    invoke: async (b) => call(b, 'POST', `${D}/:object/deleteMany`, {
      params: { object: 'vault' }, body: { ids: [await seed(b)] },
    }),
  },
  // A READ over POST. Driven because it is the one place the engine's read-path
  // strip is asserted from this boundary: if that strip ever regressed, the
  // write-side result would be indistinguishable from a read-side one.
  [`POST ${D}/:object/query`]: {
    kind: 'driven', expectRecord: true,
    invoke: async (b) => {
      await seed(b);
      return call(b, 'POST', `${D}/:object/query`, { params: { object: 'vault' }, body: {} });
    },
  },

  // ── PROTOCOL INGRESS: the write runs through a `*Data` face ───────────────
  'POST /api/v1/forms/:slug/submit': {
    kind: 'protocol-ingress',
    why: 'Public form submit calls `p.createData(...)` and 201s its result — the '
      + 'same ingress `POST /data/:object` uses, stripped there.',
  },

  // ── NO RECORD ECHO: no user-object record in the body ─────────────────────
  // Metadata plane: bodies carry metadata ITEMS. `internal: true` is a field
  // flag on a data object's field, and a metadata item is not a data record.
  'POST /api/v1/meta/_migrate-stored': { kind: 'no-record-echo', why: 'Metadata plane: migration receipt.' },
  'PUT /api/v1/meta/:type/:name': { kind: 'no-record-echo', why: 'Metadata plane: metadata item, not a data record.' },
  'DELETE /api/v1/meta/:type/:name': { kind: 'no-record-echo', why: 'Metadata plane: delete receipt.' },
  'POST /api/v1/meta/:type/:name/publish': { kind: 'no-record-echo', why: 'Metadata plane: publish receipt.' },
  'POST /api/v1/meta/:type/:name/rollback': { kind: 'no-record-echo', why: 'Metadata plane: rollback receipt.' },
  'PUT /api/v1/meta/:type/:section/:name': { kind: 'no-record-echo', why: 'Metadata plane: compound metadata section.' },

  'POST /api/v1/email/send': { kind: 'no-record-echo', why: 'Send receipt (message id / status), no object row.' },

  // Sharing: the bodies are SHARE GRANTS on the sharing surface, not rows of
  // the `:object` in the path — `svc.grant(...)`'s return, 201'd verbatim.
  [`POST ${D}/:object/:id/shares`]: { kind: 'no-record-echo', why: 'Sharing service grant row, not a row of `:object`.' },
  [`DELETE ${D}/:object/:id/shares/:shareId`]: { kind: 'no-record-echo', why: 'Revoke receipt.' },
  'POST /api/v1/sharing/rules': { kind: 'no-record-echo', why: 'Sharing RULE (metadata), not a data record.' },
  'DELETE /api/v1/sharing/rules/:idOrName': { kind: 'no-record-echo', why: 'Rule delete receipt.' },
  'POST /api/v1/sharing/rules/:idOrName/evaluate': { kind: 'no-record-echo', why: 'Evaluation verdict (ids/counts).' },

  'POST /api/v1/reports': { kind: 'no-record-echo', why: 'Report definition (metadata).' },
  'DELETE /api/v1/reports/:id': { kind: 'no-record-echo', why: 'Delete receipt.' },
  'POST /api/v1/reports/:id/run': { kind: 'no-record-echo', why: 'Aggregated report result set, not a write response.' },
  'POST /api/v1/reports/:id/schedule': { kind: 'no-record-echo', why: 'Schedule definition (metadata).' },
  'DELETE /api/v1/reports/schedules/:scheduleId': { kind: 'no-record-echo', why: 'Delete receipt.' },

  // Approvals: every arm answers the approval REQUEST/step state machine.
  'POST /api/v1/approvals/requests/:id/approve': { kind: 'no-record-echo', why: 'Approval request state, not the target row.' },
  'POST /api/v1/approvals/requests/:id/reject': { kind: 'no-record-echo', why: 'Approval request state.' },
  'POST /api/v1/approvals/requests/:id/recall': { kind: 'no-record-echo', why: 'Approval request state.' },
  'POST /api/v1/approvals/requests/:id/revise': { kind: 'no-record-echo', why: 'Approval request state.' },
  'POST /api/v1/approvals/requests/:id/resubmit': { kind: 'no-record-echo', why: 'Approval request state.' },
  'POST /api/v1/approvals/requests/:id/reassign': { kind: 'no-record-echo', why: 'Approval request state.' },
  'POST /api/v1/approvals/requests/:id/remind': { kind: 'no-record-echo', why: 'Reminder receipt.' },
  'POST /api/v1/approvals/requests/:id/request-info': { kind: 'no-record-echo', why: 'Approval request state.' },
  'POST /api/v1/approvals/requests/:id/comment': { kind: 'no-record-echo', why: 'Approval comment row.' },

  'POST /api/v1/analytics/dataset/query': { kind: 'no-record-echo', why: 'A READ (aggregated dataset) over POST.' },

  'POST /api/v1/security/suggested-bindings/:id/confirm': { kind: 'no-record-echo', why: 'Binding receipt.' },
  'POST /api/v1/security/suggested-bindings/:id/dismiss': { kind: 'no-record-echo', why: 'Dismissal receipt.' },
  'POST /api/v1/security/explain': { kind: 'no-record-echo', why: 'Permission explanation verdict.' },

  // Import: per-row RECEIPTS (row number, action, id, warnings/errors) plus
  // counts — measured, the written row is never spread into a result.
  [`POST ${D}/:object/import`]: { kind: 'no-record-echo', why: 'Import summary: counts + per-row receipts, never the written row.' },
  [`POST ${D}/:object/import/jobs`]: { kind: 'no-record-echo', why: 'Job handle (id/status).' },
  [`POST ${D}/import/jobs/:jobId/cancel`]: { kind: 'no-record-echo', why: 'Job state receipt.' },
  [`POST ${D}/import/jobs/:jobId/undo`]: { kind: 'no-record-echo', why: 'Undo summary (counts).' },
};

const keyOf = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe('#8497 tripwire: no REST write response carries an `internal: true` value', () => {
  it('the enumeration is real: it sees the direct-engine mouth this guard exists for', async () => {
    const { rest } = await bootRest();
    const writes = (rest.getRoutes() as Array<{ method: string; path: string }>)
      .filter((r) => WRITE_METHODS.includes(r.method))
      .map(keyOf);
    expect(writes).toEqual(expect.arrayContaining([
      'POST /api/v1/batch',        // the cross-object direct `ql.update` mouth
      `POST ${D}/:object`,
      `PATCH ${D}/:object/:id`,
    ]));
    // A surface this small would mean the boot registered almost nothing and
    // every "no sentinel" below would be vacuous.
    expect(writes.length).toBeGreaterThan(20);
  }, 60_000);

  it('every write route has a disposition — a NEW write surface must register here', async () => {
    const { rest } = await bootRest();
    const writes = (rest.getRoutes() as Array<{ method: string; path: string }>)
      .filter((r) => WRITE_METHODS.includes(r.method))
      .map(keyOf);
    const missing = writes.filter((k) => !(k in DISPOSITIONS));
    expect(
      missing,
      `New REST write route(s) with no #8497 disposition: ${missing.join(', ')}. `
      + 'Every route that answers an external caller with a write response owes '
      + 'the `internal: true` guarantee (#7728/#7823). If the body can carry a '
      + 'record of a user data object, route it through '
      + '`omitInternalFieldsFromWriteResponse` (@objectstack/core) and add a '
      + '`driven` recipe here. If it cannot, say so with a `no-record-echo` / '
      + '`protocol-ingress` disposition and a reason — an explicit decision, '
      + 'never silence.',
    ).toEqual([]);
    // …and no dead entries for routes that no longer exist.
    const stale = Object.keys(DISPOSITIONS).filter((k) => !writes.includes(k));
    expect(stale, `Dispositions for write routes that no longer exist: ${stale.join(', ')}`).toEqual([]);
  }, 60_000);

  for (const [key, disposition] of Object.entries(DISPOSITIONS)) {
    if (disposition.kind !== 'driven') continue;
    it(`${key}: response never carries the internal sentinel${disposition.expectRecord ? ', and really returned a record' : ''}`, async () => {
      const booted = await bootRest();
      const res = await disposition.invoke(booted);
      const wire = JSON.stringify(res.body ?? null);
      expect(wire.includes(SENTINEL), `${key} leaked an internal field: ${wire}`).toBe(false);
      if (disposition.expectRecord) {
        expect(
          wire.includes(CONTROL),
          `${key} returned no record at all — the probe is blind (refusal? 501?): ${wire}`,
        ).toBe(true);
      }
    }, 60_000);
  }

  it('the fixture is honest: the stored row really does carry the flagged value', async () => {
    // Without this, every "no sentinel" above could be true because the secret
    // was never stored — the blindness that makes a guard worthless.
    const booted = await bootRest();
    const id = await seed(booted);
    const raw = await (booted.engine as unknown as {
      update: (o: string, d: unknown, opt: unknown) => Promise<Record<string, unknown>>;
    }).update('vault', { name: CONTROL }, { where: { id } });
    // The engine's WRITE result is whole — that is exactly what #7823 chose,
    // and exactly why every mouth above must strip.
    expect(raw[SECRET_FIELD]).toBe(SENTINEL);
  }, 60_000);

  it('NEGATIVE CONTROL: the machinery goes red on a direct engine mouth that skips the helper', async () => {
    // A future author adds a second direct `ql.*` write mouth beside the batch
    // arm and forgets the strip. Reproduce that mouth here — same engine, same
    // object, same response shape — and prove both halves without touching the
    // shipped server.
    const booted = await bootRest();
    const id = await seed(booted);
    const leakyMouth = async () => {
      const updated = await (booted.engine as unknown as {
        update: (o: string, d: unknown, opt: unknown) => Promise<Record<string, unknown>>;
      }).update('vault', { name: CONTROL }, { where: { id } });
      return { results: [updated] }; // straight into the response body
    };

    const leaked = await leakyMouth();
    expect(JSON.stringify(leaked).includes(SENTINEL)).toBe(true); // half 1: the scan bites

    // half 2: the shared helper is exactly what closes it.
    omitInternalFieldsFromWriteResponse(VAULT, leaked.results);
    expect(JSON.stringify(leaked).includes(SENTINEL)).toBe(false);
    expect(JSON.stringify(leaked).includes(CONTROL)).toBe(true); // …and the record survives
  }, 60_000);
});
