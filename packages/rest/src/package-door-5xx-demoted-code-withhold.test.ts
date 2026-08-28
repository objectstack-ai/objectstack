// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12509] This package's two doors inherit ADR-0112's 5xx code scope from the
 * shared resolver — they do not each carry a copy of it.
 *
 * ## What was measured on the wire before the change
 *
 * `origin/main` @ `aef1b7e64`, through the REAL registrar rather than by
 * reading source:
 *
 * ```
 * POST /api/v1/packages/publish, packageService.publish throws
 *   { code: 'SQLITE_ERROR' }  → 500 {"error":{"code":"INTERNAL_ERROR",
 *        "message":"Internal server error","declaredCode":"SQLITE_ERROR"}}
 *   { code: '42P01' }         → 500 {…,"declaredCode":"42P01"}
 * ```
 *
 * The prose withhold (#8086) had already fired — `message` is the generic
 * sentence — and the driver's own dialect went out beside it, naming the
 * backend. Ruled 2026-08-27 (option D): a demoted code the fallback-to-500
 * picked up from an UNDECLARED producer is withheld with the prose; an
 * AUTHOR-DECLARED one survives.
 *
 * ## Why this door needs no edit, and why that is the point
 *
 * `sendThrownError` reads `demotedDeclaredCode(thrown)` and emits whatever it
 * answers. The ruling put the judgement inside that function, so this door
 * inherits it without a line changing here — and section 3 is what keeps that
 * true: it compares the wire against the shared function itself, so a door
 * that ever grew a rule of its own turns red. ⛔ Do not "fix" a red in
 * section 3 by teaching this door the condition; that is the per-door variant
 * the ruling declined.
 *
 * ## The flat `/data` door is measured, not assumed
 *
 * Section 4 drives a REAL `ObjectQL` and a driver that fails every access with
 * a coded fault through the real CRUD routes. That door answers its own fixed
 * sanitised 5xx bodies (`DATA_STORE_FAULT` / `UNCLASSIFIED_FAULT`) and never
 * reaches `thrownCodeFields` on that path, so it never emitted the shape and
 * nothing about it moves. Measured rather than inferred because "this door
 * cannot produce it" is exactly the kind of claim that rots: the section is
 * here so the day the classification changes, someone is told.
 *
 * ## Reverse verification
 *
 * Predicted before running: reverting the withhold in `demotedDeclaredCode`
 * turns sections 1 and 3's undeclared rows RED and leaves sections 2 and 4
 * GREEN (the author-declared rows and the flat door's fixed bodies are
 * satisfied by both implementations). Measured: see the PR body.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { ObjectQL } from '@objectstack/objectql';
import {
  resolveThrownHttpError,
  demotedDeclaredCode,
  INTERNAL_ERROR_MESSAGE,
} from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';
import { RestServer } from './rest-server.js';

const PKGS = '/api/v1/packages';

interface Captured {
  status: number;
  body: any;
}

/** A caller holding every capability these routes gate on. */
const CLEARS_THE_GATE = async () => ({
  userId: 'u_pkg',
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
});

function mount(svc: Record<string, unknown>) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {}, use: () => {}, listen: async () => {}, close: async () => {},
  } as any;
  registerPackageRoutes(server, () => svc as any, '/api/v1', {
    resolveExecutionContext: CLEARS_THE_GATE,
  } as any);
  return routes;
}

async function drive(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  req: Record<string, any> = {},
): Promise<Captured> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const captured: Captured = { status: 0, body: undefined };
  const res: any = {
    json(data: any) { captured.body = data; }, send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler({ params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any, res);
  return captured;
}

const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };

/**
 * The publish seam, with a witness that the throw really travelled through it
 * — an absence assertion on a request that never reached the service would
 * pass for a reason that has nothing to do with this rule.
 */
async function throughPackageDoor(error: unknown): Promise<Captured> {
  const publish = vi.fn(async () => { throw error; });
  const captured = await drive(mount({ publish }), 'POST', `${PKGS}/publish`, {
    body: { manifest: MANIFEST, metadata: { author: 'acme' } },
  });
  expect(publish.mock.calls.length, 'the throwing seam was never called').toBe(1);
  return captured;
}

/** Every assertion an answer from this door must satisfy, from the schemas themselves. */
function expectDeclaredEnvelope(captured: Captured): any {
  expect(BaseResponseSchema.safeParse(captured.body).success).toBe(true);
  expect(envelopeViolations(captured.body)).toEqual([]);
  expect(captured.body?.success).toBe(false);
  const parsed = ApiErrorSchema.safeParse(captured.body?.error);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
  return captured.body.error;
}

/** A producer's throw, carrying whatever it declares. */
function thrown(message: string, carried: Record<string, unknown>): Error {
  return Object.assign(new Error(message), carried);
}

// ---------------------------------------------------------------------------
// 1. The withhold, on the wire
// ---------------------------------------------------------------------------

describe('[#12509] the package door withholds an UNDECLARED 5xx spelling', () => {
  const WITHHELD: Array<{ name: string; error: unknown }> = [
    {
      name: 'a sqlite errno',
      error: thrown('SQLITE_ERROR: no such table: sys_metadata', { code: 'SQLITE_ERROR' }),
    },
    {
      name: 'a postgres errno',
      error: thrown('relation "sys_metadata" does not exist', { code: '42P01' }),
    },
    {
      name: 'an app spelling that declared no status — the ruling splits by provenance',
      error: thrown('the widget refused the write', { code: 'WIDGET_REFUSED_THE_WRITE' }),
    },
  ];

  for (const c of WITHHELD) {
    it(`${c.name}: 500 INTERNAL_ERROR with NO \`declaredCode\``, async () => {
      const captured = await throughPackageDoor(c.error);
      const error = expectDeclaredEnvelope(captured);

      // The positive shape first — an absence on a body that came back for
      // some other reason would pass vacuously.
      expect(captured.status).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect('declaredCode' in error).toBe(false);
      // And the spelling is not hiding anywhere else in the body.
      expect(JSON.stringify(captured.body)).not.toContain((c.error as any).code);
    });
  }

  it('the withheld prose is unchanged — this is the CODE channel only', async () => {
    const captured = await throughPackageDoor(
      thrown('SQLITE_ERROR: no such table: sys_metadata', { code: 'SQLITE_ERROR' }),
    );
    expect(captured.body.error.message).toBe(INTERNAL_ERROR_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// 2. The author channel survives — the half the ruling declined to withhold
// ---------------------------------------------------------------------------

describe('[#12509] an AUTHOR-DECLARED code still reaches the wire', () => {
  const SURVIVES: Array<{ name: string; error: unknown; status: number; code: string; declaredCode: string }> = [
    {
      name: 'a declared 503',
      error: thrown('the acme ledger service is down', { status: 503, code: 'ACME_LEDGER_OFFLINE' }),
      status: 503, code: 'SERVICE_UNAVAILABLE', declaredCode: 'ACME_LEDGER_OFFLINE',
    },
    {
      name: 'a declared 500 — declaring the fallback VALUE is still declaring',
      error: thrown('the importer gave up', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
      status: 500, code: 'INTERNAL_ERROR', declaredCode: 'ACME_IMPORT_ABORTED',
    },
    {
      name: 'a declared 501 spelled `statusCode`',
      error: thrown('this dialect emits no DDL', { statusCode: 501, code: 'ACME_NOT_BUILT' }),
      status: 501, code: 'NOT_IMPLEMENTED', declaredCode: 'ACME_NOT_BUILT',
    },
    {
      name: 'a declared 409 — below the sanitisation band entirely',
      error: thrown('invoices still open', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
      status: 409, code: 'RESOURCE_CONFLICT', declaredCode: 'CLOSE_PERIOD_LOCKED',
    },
  ];

  for (const c of SURVIVES) {
    it(c.name, async () => {
      const captured = await throughPackageDoor(c.error);
      const error = expectDeclaredEnvelope(captured);
      expect(captured.status).toBe(c.status);
      expect(error.code).toBe(c.code);
      expect(error.declaredCode).toBe(c.declaredCode);
    });
  }

  it('the rows above really do produce different answers', () => {
    const answers = SURVIVES.map((c) => `${c.status} ${c.code} ${c.declaredCode}`);
    expect(new Set(answers).size).toBe(SURVIVES.length);
  });
});

// ---------------------------------------------------------------------------
// 3. The wire IS the shared rule — this door adds nothing of its own
// ---------------------------------------------------------------------------

describe('[#12509] the door reads the shared rule, it does not restate it', () => {
  const SHAPES: unknown[] = [
    thrown('sqlite errno, undeclared', { code: 'SQLITE_ERROR' }),
    thrown('postgres errno, undeclared', { code: '42P01' }),
    thrown('app spelling, undeclared', { code: 'WIDGET_REFUSED_THE_WRITE' }),
    thrown('app spelling, declared 503', { status: 503, code: 'ACME_LEDGER_OFFLINE' }),
    thrown('app spelling, declared 500', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
    thrown('app spelling, declared 409', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
    thrown('registered code', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
    thrown('a bare fault', {}),
  ];

  for (const shape of SHAPES) {
    it(`"${(shape as Error).message}" answers what demotedDeclaredCode says`, async () => {
      const expected = demotedDeclaredCode(resolveThrownHttpError(shape));
      const captured = await throughPackageDoor(shape);
      expect(captured.body?.error?.declaredCode).toBe(expected);
    });
  }

  it('the shapes above do not all answer the same thing', () => {
    // Anti-vacuity for the comparison itself: if every shape now demoted to
    // `undefined`, each case above would compare `undefined` to `undefined`
    // and pass against a door that emits the channel never — which is option
    // B, the alternative the ruling declined.
    const answers = SHAPES.map((s) => demotedDeclaredCode(resolveThrownHttpError(s)));
    expect(answers.filter((a) => a !== undefined).length).toBeGreaterThan(2);
    expect(answers.filter((a) => a === undefined).length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// 4. The flat `/data` door: nothing to withhold, measured on a real driver
// ---------------------------------------------------------------------------

describe('[#12509] the flat `/data` door never carried the shape', () => {
  /** A driver that fails every access with a CODED fault, as a real driver does. */
  function codedFailingDriver(message: string, code: string) {
    const boom = () => { throw Object.assign(new Error(message), { code }); };
    const driver: any = {
      name: 'memory-broken', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async execute() { return null; },
      async find() { boom(); }, async findOne() { boom(); },
      async create() { boom(); }, async update() { boom(); }, async delete() { boom(); },
      async upsert() { boom(); }, async count() { boom(); },
      async bulkCreate() { boom(); }, async bulkUpdate() { boom(); }, async bulkDelete() { boom(); },
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

  /** The real CRUD routes over a real engine whose driver fails with `code`. */
  async function throughDataDoor(message: string, code: string, method: 'GET' | 'POST') {
    const engine = new ObjectQL();
    engine.registerDriver(codedFailingDriver(message, code), true);
    engine.registerApp({
      id: 'acme', name: 'Acme',
      objects: [{ name: 'leave_request', fields: { title: { type: 'text' } } }],
    } as any);

    const protocol: any = {
      getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
      getMetaTypes: vi.fn().mockResolvedValue([]),
      getMetaItems: vi.fn().mockResolvedValue([{ name: 'leave_request' }]),
      getMetaItem: vi.fn().mockResolvedValue({}),
      findData: vi.fn(async (r: any) => engine.find(r.object, {})),
      createData: vi.fn(async (r: any) => engine.insert(r.object, r.data)),
      updateData: vi.fn(async (r: any) => engine.update(r.object, { id: r.id, ...r.data })),
      deleteData: vi.fn(async (r: any) => engine.delete(r.object, { where: { id: r.id } })),
    };

    const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();

    const route = (rest as any).getRoutes().find(
      (r: any) => r.method === method && r.path === '/api/v1/data/:object',
    );
    expect(route, `${method} /api/v1/data/:object must be registered`).toBeTruthy();

    const res: any = {
      statusCode: 0, _body: undefined,
      status(c: number) { res.statusCode = c; return res; },
      json(b: any) { res._body = b; return res; },
      send() { return res; }, setHeader() { return res; }, header() { return res; },
      end() { return res; }, write() { return res; },
    };
    await route.handler(
      { method, path: '/api/v1/data/:object', headers: {}, query: {}, params: { object: 'leave_request' }, body: { title: 'x' } } as any,
      res,
    );
    return { status: res.statusCode, body: res._body };
  }

  const DIALECTS: Array<{ name: string; message: string; code: string; status: number; code_: string }> = [
    {
      name: 'a sqlite fault that names no object → the sanitised store-fault terminal',
      message: 'SQLITE_ERROR: database disk image is malformed', code: 'SQLITE_ERROR',
      status: 500, code_: 'DATABASE_ERROR',
    },
    {
      name: 'a postgres fault the classifier does not recognise → the unclassified terminal',
      message: 'canceling statement due to statement timeout', code: '57014',
      status: 500, code_: 'INTERNAL_ERROR',
    },
  ];

  for (const d of DIALECTS) {
    for (const method of ['GET', 'POST'] as const) {
      it(`${method}: ${d.name}`, async () => {
        const answer = await throughDataDoor(d.message, d.code, method);
        expect(answer.status).toBe(d.status);
        expect(answer.body?.code).toBe(d.code_);
        // The fixed body has no code channel to withhold — and the errno is
        // nowhere in it, which is the fact that matters to a caller.
        expect(answer.body).not.toHaveProperty('declaredCode');
        expect(JSON.stringify(answer.body)).not.toContain(d.code);
      }, 60_000);
    }
  }
});
