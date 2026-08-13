// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8086] The direct-mount package door withholds a LEAKY 5xx message.
 *
 * ## The gap this closes
 *
 * `packages/rest/src/package-routes.ts` writes every error through the shared
 * `sendError`, and neither it nor `sendError` applied any leak heuristic. Both
 * siblings on this surface already do:
 *
 *  - the dispatcher twin — `HttpDispatcher.error`
 *    (`packages/runtime/src/http-dispatcher.ts`) replaces the message with
 *    `INTERNAL_ERROR_MESSAGE` when `httpStatus >= 500 &&
 *    looksLikeInternalErrorLeak(message)` (#3867);
 *  - `rest-server.ts` — three call sites run the same predicate (#5437 /
 *    PR #5464), which closed exactly this class one seam over and never
 *    reached this registrar, because it does not go through
 *    `resolveErrorResponse` at all.
 *
 * So one door of `/api/v1/packages` withheld a leaky 5xx and the other did
 * not, on the same deployment — and this registrar is the one production
 * serves for the routes both declare (first-match-wins, see the module note in
 * `package-routes.ts`).
 *
 * This is option **B** of the three the card recorded, and the only one ruled:
 * apply the rule this surface already follows, at the door that was missed.
 * Option A (put it inside the shared `sendError`) is escalated and NOT taken —
 * that would make a disclosure rule a property of the envelope writer, which
 * its own module note disclaims, and it reaches 7+ route modules. Option C
 * (stop `metadata-protocol` interpolating driver text into client-facing
 * messages) is the real cure and is a separate card; this is the interim that
 * stops the bleeding.
 *
 * ## Reachability was MEASURED, not assumed
 *
 * The card was filed `Unverified`: grep proved the *filter was absent*, which
 * is a different claim from the *leak being reachable*. Section 1 settles it by
 * observation — a REAL `ObjectQL` engine, a REAL
 * `ObjectStackProtocolImplementation`, and a driver that fails every
 * `sys_metadata` access the way a missing table does, driven through the route
 * a client calls. The producer walked is `protocol.deletePackage`'s
 * `engine.find('sys_metadata', …)`, which sits OUTSIDE that method's per-item
 * `try`/`catch` and so propagates whole.
 *
 * Before this change that request answered, verbatim:
 *
 *     HTTP 500
 *     {"success":false,"error":{"code":"INTERNAL_ERROR",
 *      "message":"SQLITE_ERROR: no such table: sys_metadata"}}
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Deleting the two-line withhold in `sendThrownError` turns the section-1 and
 * section-2 leak cases RED — they assert the positive sanitized shape, so the
 * driver line reappears in the diff — and leaves every pass-through case
 * (section 3) and every 4xx case (section 4) GREEN, because the predicate is
 * what decides and neither of those trips it. That is the ordinary direction,
 * and it was confirmed by running it (quoted in the PR).
 *
 * ## What is deliberately NOT asserted
 *
 * That the message merely "changed", or that it "no longer contains the table
 * name". Both pass for any rewrite, including a worse one. Every case below
 * asserts the POSITIVE shape — `INTERNAL_ERROR_MESSAGE` — plus the full
 * ADR-0112 envelope (`code` AND `status`), because one alone is not an answer:
 * a status without the code leaves the client unable to branch, a code without
 * the status makes every proxy and retry policy read a refusal as a fault.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { INTERNAL_ERROR_MESSAGE, looksLikeInternalErrorLeak } from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';

/** The driver line a missing `sys_metadata` produces on each dialect. */
const SQLITE_NO_TABLE = 'SQLITE_ERROR: no such table: sys_metadata';
const PG_NO_RELATION = 'relation "sys_metadata" does not exist';

interface Captured {
  status: number;
  body: any;
}

/** A caller holding every capability these routes gate on. */
const CLEARS_THE_GATE = async () => ({
  userId: 'u_pkg',
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
});

function mount(svc: Record<string, unknown>, options: Record<string, unknown> = {}) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  } as any;
  registerPackageRoutes(server, () => svc as any, '/api/v1', {
    resolveExecutionContext: CLEARS_THE_GATE,
    ...options,
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
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await handler(
    { params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any,
    res,
  );
  return captured;
}

/**
 * Every assertion an answer from this door must satisfy, spelled once and
 * IMPORTED from `packages/spec` rather than restated — a body that parses here
 * is one the wire contract accepts, including `code` being a member of the
 * closed ADR-0112 vocabulary.
 */
function expectDeclaredEnvelope(captured: Captured): any {
  expect(BaseResponseSchema.safeParse(captured.body).success).toBe(true);
  expect(envelopeViolations(captured.body)).toEqual([]);
  expect(captured.body?.success).toBe(false);
  const parsed = ApiErrorSchema.safeParse(captured.body?.error);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
  return captured.body.error;
}

/** A thrown error carrying whatever a producer declares on it. */
function thrown(message: string, carried: Record<string, unknown>): Error {
  return Object.assign(new Error(message), carried);
}

// ---------------------------------------------------------------------------
// 1. The real producer, end to end — the card's "Unverified" half
// ---------------------------------------------------------------------------
//
// Nothing is hand-built here: the engine, the protocol and the driver text all
// come from shipping code, and the route is the one a client calls.
//
// `DELETE /api/v1/packages/:id` with no `?version=` routes to
// `protocol.deletePackage` (`package-routes.ts`, the `!version && typeof
// options.protocol?.deletePackage === 'function'` branch). That method's FIRST
// database touch is `this.engine.find('sys_metadata', { where })`, outside any
// `try` — its per-item `catch` only wraps the `deleteMetaItem` loop below it.
// So a driver failure on the overlay read propagates whole, out of the
// protocol, into this registrar's catch-all, and onto the wire.

function failingDriver(dbError: string) {
  const boom = () => { throw new Error(dbError); };
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

async function bootRealProtocol(dbError: string): Promise<any> {
  const engine = new ObjectQL();
  engine.registerDriver(failingDriver(dbError), true);
  await engine.init();
  return new ObjectStackProtocolImplementation(engine as any);
}

describe('[#8086] a real sys_metadata failure, walked in process through this door', () => {
  it('the premise guard: the protocol really does throw the driver line', async () => {
    // Anti-vacuity for the whole section. If `deletePackage` ever stops letting
    // the driver text out — option C, the real cure — this goes RED and the
    // cases below stop proving anything, instead of silently passing over a
    // path nothing can traverse.
    const protocol = await bootRealProtocol(SQLITE_NO_TABLE);

    await expect(
      protocol.deletePackage({ packageId: 'com.acme.crm', allTenants: true }),
    ).rejects.toThrow(SQLITE_NO_TABLE);
  }, 60_000);

  it('the driver line does not appear anywhere in the client body', async () => {
    const protocol = await bootRealProtocol(SQLITE_NO_TABLE);

    const captured = await drive(
      mount({ delete: async () => ({ success: true }) }, { protocol }),
      'DELETE',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );

    const error = expectDeclaredEnvelope(captured);
    // The POSITIVE shape, not "it changed": this is the same replacement
    // constant the dispatcher twin and `rest-server.ts` use.
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    // The full ADR-0112 envelope. Still a server fault on the wire — the
    // withhold touches the prose and nothing else.
    expect(captured.status).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');

    const wire = JSON.stringify(captured.body);
    expect(wire).not.toContain('SQLITE_ERROR');
    expect(wire).not.toContain('no such table');
    expect(wire).not.toContain('sys_metadata');
  }, 60_000);

  /**
   * [#8132] Was the residual; now the second green.
   *
   * This case was added by #8086 as a deliberately-red-in-future pin: the
   * shared predicate was a heuristic over the message and knew no Postgres
   * `relation … does not exist` phrasing, so that dialect's line still
   * travelled through this door while SQLite's was withheld — the same
   * condition, disclosed or not depending on which engine was underneath. It
   * asserted that gap positively so the day it closed would be visible.
   *
   * #8132 closed it in the predicate, where it belonged — so the assertion is
   * INVERTED here rather than deleted, and the pair above/below now proves the
   * property that actually matters: this door answers the same withheld
   * envelope for BOTH dialects of one failure.
   *
   * ⚠️ Still not the structural cure, and this comment is the reason the
   * pointer survives the flip. The predicate now recognises the two engines
   * this repo runs; it is a phrasing test, and a phrasing test can only ever
   * know the dialects someone has met. **Option C** — `metadata-protocol` not
   * interpolating driver text into client-facing messages at all — is the fix
   * whose correctness does not depend on that, and is tracked as #8136. The
   * anti-vacuity guard at the top of this describe block goes red when C
   * lands, which is the intended signal to revisit this whole section.
   */
  it('the Postgres phrasing of the same failure is withheld too, by the shared predicate', async () => {
    expect(looksLikeInternalErrorLeak(PG_NO_RELATION)).toBe(true);

    const protocol = await bootRealProtocol(PG_NO_RELATION);
    const captured = await drive(
      mount({ delete: async () => ({ success: true }) }, { protocol }),
      'DELETE',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.crm' } },
    );

    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
    // The same positive shape the SQLite case asserts, which is the point of
    // the flip: one door, one envelope, regardless of the engine underneath.
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);

    const wire = JSON.stringify(captured.body);
    expect(wire).not.toContain('does not exist');
    expect(wire).not.toContain('sys_metadata');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. Every catch site in this registrar, and the whole 5xx band
// ---------------------------------------------------------------------------
//
// The live half above proves the door. These prove it is the DOOR and not one
// route: all four handlers exit through the same `sendThrownError`, so each is
// driven separately rather than assumed to share the fix.
//
// `GET /packages` is different BY DESIGN: both of its data sources sit in their
// own inner `try { … } catch {}`, so nothing below reaches the outer catch.
// What does is the gate — `refusePackageRequest` calls
// `options.resolveExecutionContext(req)`, and a resolver that throws
// SYNCHRONOUSLY throws before the `.catch(() => undefined)` is attached.

interface Site {
  name: string;
  run: (error: unknown) => Promise<{ captured: Captured; reached: () => boolean }>;
}

const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };

const SITES: Site[] = [
  {
    name: 'POST /packages/publish — packageService.publish throws',
    run: async (error: unknown) => {
      const publish = vi.fn(async () => { throw error; });
      const captured = await drive(
        mount({ publish }),
        'POST',
        `${PKGS}/publish`,
        { body: { manifest: MANIFEST, metadata: { author: 'acme' } } },
      );
      return { captured, reached: () => publish.mock.calls.length === 1 };
    },
  },
  {
    name: 'GET /packages — the capability gate resolver throws',
    run: async (error: unknown) => {
      const resolveExecutionContext = vi.fn(() => { throw error; });
      const captured = await drive(
        mount({ list: async () => [] }, { resolveExecutionContext }),
        'GET',
        PKGS,
      );
      return { captured, reached: () => resolveExecutionContext.mock.calls.length === 1 };
    },
  },
  {
    name: 'GET /packages/:id — packageService.get throws',
    run: async (error: unknown) => {
      const get = vi.fn(async () => { throw error; });
      const captured = await drive(
        mount({ get }),
        'GET',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
      );
      return { captured, reached: () => get.mock.calls.length === 1 };
    },
  },
  {
    name: 'DELETE /packages/:id — packageService.delete throws',
    run: async (error: unknown) => {
      const del = vi.fn(async () => { throw error; });
      const captured = await drive(
        mount({ delete: del }),
        'DELETE',
        `${PKGS}/:id`,
        { params: { id: 'com.acme.crm' } },
      );
      return { captured, reached: () => del.mock.calls.length === 1 };
    },
  },
];

describe('[#8086] a leaky 5xx is withheld at every catch site, across the band', () => {
  /**
   * Deliberately spans the band and both `code` postures: an UNDECLARED fault
   * (the 500 arm, where the code derives from the status) and a DECLARED 5xx
   * carrying its own registered code. The code and status must survive in both
   * — the withhold is about the prose only, and #8016's mapping must not be
   * undone by it.
   */
  const LEAKS: Array<{ name: string; error: unknown; status: number; code: string }> = [
    {
      name: 'a bare driver throw (undeclared ⇒ 500 INTERNAL_ERROR)',
      error: new Error(SQLITE_NO_TABLE),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
    {
      // The producer #5437 named by line, copied verbatim — `status` ASSIGNED
      // to an already-constructed error rather than written as a `status:`
      // literal, which is the shape a grep does not find.
      name: 'the metadata-protocol overlay producer, verbatim',
      error: thrown(`Failed to delete customization overlay: ${SQLITE_NO_TABLE}`, { status: 500 }),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
    {
      name: 'a constraint dump naming physical columns',
      error: new Error('UNIQUE constraint failed: sys_metadata.name'),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
    {
      name: 'a bare statement prefix, the shape drivers put in front of their message',
      error: new Error('SELECT * FROM sys_packages WHERE id = ? — near "FROM": syntax error'),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
    {
      name: 'a DECLARED 503 with a registered code keeps both and loses only the prose',
      error: thrown('SQLSTATE 08006: connection failure to the metadata store', {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      }),
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    },
  ];

  for (const site of SITES) {
    for (const leak of LEAKS) {
      it(`${site.name}: ${leak.name}`, async () => {
        // Premise guard for the shaped half: these really are messages the
        // predicate calls leaks. A case that quietly stopped tripping it would
        // otherwise "pass" section 3's pass-through rule instead.
        expect(looksLikeInternalErrorLeak((leak.error as Error).message)).toBe(true);

        const { captured, reached } = await site.run(leak.error);
        expect(reached(), 'the throwing seam was never called').toBe(true);

        const error = expectDeclaredEnvelope(captured);
        expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
        expect(captured.status).toBe(leak.status);
        expect(error.code).toBe(leak.code);
        expect(JSON.stringify(captured.body)).not.toContain('sys_');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. The PREDICATE decides — not a blanket 5xx replacement
// ---------------------------------------------------------------------------
//
// Without this section the whole file is satisfied by `if (status >= 500)
// message = INTERNAL_ERROR_MESSAGE`, which is a different rule: it would delete
// every self-authored server-fault sentence this door has (`This deployment
// serves no marketplace publish surface…`-class prose, a 501's stated remedy),
// and it would silently diverge from the twin, whose whole point is that the
// two doors answer alike.

describe('[#8086] a 5xx that does NOT look like a leak passes through unchanged', () => {
  const PASS_THROUGH: Array<{ name: string; error: unknown; status: number; code: string }> = [
    {
      name: 'a plain undeclared fault from our own code',
      error: new Error('kaboom'),
      status: 500,
      code: 'INTERNAL_ERROR',
    },
    {
      name: "the atomic-batch refusal's stated remedy (501, declared code)",
      error: thrown(
        "Atomic batch on 'showcase_account' requires engine transaction support; this runtime cannot roll back.",
        { status: 501, code: 'NOT_IMPLEMENTED' },
      ),
      status: 501,
      code: 'NOT_IMPLEMENTED',
    },
    {
      name: 'a 503 whose prose names no internals',
      error: thrown('The marketplace registry is warming up; retry shortly.', {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      }),
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    },
  ];

  for (const site of SITES) {
    for (const shape of PASS_THROUGH) {
      it(`${site.name}: ${shape.name}`, async () => {
        expect(looksLikeInternalErrorLeak((shape.error as Error).message)).toBe(false);

        const { captured, reached } = await site.run(shape.error);
        expect(reached(), 'the throwing seam was never called').toBe(true);

        const error = expectDeclaredEnvelope(captured);
        expect(error.message).toBe((shape.error as Error).message);
        expect(error.message).not.toBe(INTERNAL_ERROR_MESSAGE);
        expect(captured.status).toBe(shape.status);
        expect(error.code).toBe(shape.code);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 4. The OVER-BLOCK guard: 4xx is untouched
// ---------------------------------------------------------------------------
//
// A 4xx refusal's message is caller-facing BY DESIGN — it is the self-correcting
// sentence #4277 exists for, and #5436's truncation deliberately preserves its
// head for the same reason. Sanitizing those would destroy the one thing that
// tells an author how to fix their request, and it would do it precisely where
// the message costs nothing to disclose (the caller supplied the input).
//
// The cases are chosen to TRIP the predicate on purpose: their prose contains
// the words the heuristic keys on. Only the status keeps them intact, which is
// exactly the half a "sanitize by message alone" implementation would lose.

describe('[#8086] a 4xx message is never withheld, even when it trips the predicate', () => {
  const FOUR_XX: Array<{ name: string; error: unknown; status: number; code: string }> = [
    {
      name: "the protocol's TENANT_SCOPE_REQUIRED refusal, wording that trips the predicate",
      error: thrown(
        "[tenant_scope_required] Refusing to uninstall 'com.acme.crm': foreign key rows in sys_metadata "
        + 'would be orphaned — pass organizationId to scope it, or allTenants: true to confirm.',
        { status: 400, code: 'TENANT_SCOPE_REQUIRED' },
      ),
      status: 400,
      code: 'TENANT_SCOPE_REQUIRED',
    },
    {
      name: 'the established 409 DESTRUCTIVE_CHANGE, naming the tables it would drop',
      error: thrown(
        'Uninstalling drops 3 tables; unique constraint on showcase_account would be lost. '
        + 'Pass force: true to confirm.',
        { status: 409, code: 'DESTRUCTIVE_CHANGE' },
      ),
      status: 409,
      code: 'DESTRUCTIVE_CHANGE',
    },
    {
      name: 'a 499 — the last client status, the bound from below',
      error: thrown('UNIQUE constraint failed: sys_packages.id', { status: 499 }),
      status: 499,
      // `HttpStatusErrorCodeMap` does not name 499, so the code falls to the
      // client-error bucket — `standardErrorCodeForHttpStatus`'s `< 500` arm.
      code: 'VALIDATION_ERROR',
    },
  ];

  for (const site of SITES) {
    for (const refusal of FOUR_XX) {
      it(`${site.name}: ${refusal.name}`, async () => {
        // These would every one of them be withheld if the rule read the
        // message alone — that is the point of choosing them.
        expect(looksLikeInternalErrorLeak((refusal.error as Error).message)).toBe(true);

        const { captured, reached } = await site.run(refusal.error);
        expect(reached(), 'the throwing seam was never called').toBe(true);

        const error = expectDeclaredEnvelope(captured);
        expect(error.message).toBe((refusal.error as Error).message);
        expect(captured.status).toBe(refusal.status);
        expect(error.code).toBe(refusal.code);
      });
    }
  }

  it('the bound itself, from both sides: 499 verbatim, 500 withheld', async () => {
    // An off-by-one here either starts withholding 4xx bodies or leaves 500
    // open — the two ways this fix can be wrong, pinned in one case.
    const message = 'UNIQUE constraint failed: sys_packages.id';
    for (const [status, expected] of [[499, message], [500, INTERNAL_ERROR_MESSAGE]] as const) {
      const { captured } = await SITES[0].run(thrown(message, { status }));
      expect(captured.status, `status ${status}`).toBe(status);
      expect(captured.body?.error?.message, `status ${status}`).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. #8016 must not regress
// ---------------------------------------------------------------------------
//
// This change rewrote the expression #8016 landed, so its half is re-pinned at
// the same seam rather than trusted: the coded refusal mapping is what makes a
// 4xx a 4xx here, and section 4 is only meaningful while it holds.

describe('[#8086] the #8016 coded mapping still answers (non-regression)', () => {
  it('a coded 409 keeps its status, its code AND its message', async () => {
    const { captured } = await SITES[3].run(
      thrown('Uninstalling drops 3 tables', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
    );
    expect(captured.status).toBe(409);
    expect(captured.body?.error?.code).toBe('DESTRUCTIVE_CHANGE');
    expect(captured.body?.error?.message).toBe('Uninstalling drops 3 tables');
  });

  it('structured `details` survive the withhold on a leaky 5xx', async () => {
    // The withhold is scoped to the MESSAGE. `details` carries `issues`/`fields`
    // the UI maps back to inputs; dropping it here would be a second, unruled
    // change riding along.
    const { captured } = await SITES[0].run(
      thrown(SQLITE_NO_TABLE, { status: 500, issues: [{ path: 'manifest.id', message: 'Required' }] }),
    );
    expect(captured.status).toBe(500);
    expect(captured.body?.error?.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(captured.body?.error?.details?.issues).toHaveLength(1);
  });
});
