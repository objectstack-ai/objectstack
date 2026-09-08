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
 * not, on the same deployment. (The read/delete twins this registrar carried
 * then are gone since #14503 — the dispatcher domain is their single
 * implementation — so every case below drives the one route left,
 * `POST /packages/publish`, for which this registrar is the only door.)
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
 * is a different claim from the *leak being reachable*. It was settled by
 * observation — a REAL `ObjectQL` engine, a REAL
 * `ObjectStackProtocolImplementation`, and a driver that fails every
 * `sys_metadata` access the way a missing table does, driven through the
 * registrar's then-mounted `DELETE /api/v1/packages/:id`. The producer walked
 * was `protocol.deletePackage`'s `engine.find('sys_metadata', …)`, which sits
 * OUTSIDE that method's per-item `try`/`catch` and so propagates whole. That
 * walk is no longer in this file: #14503 removed the delete route from this
 * registrar, and the producer-side fact it had come to pin after #8136 (the
 * protocol answers a declared 503 and quotes no driver text) is measured at
 * the producer in `packages/metadata-protocol/src/protocol.driver-text-disclosure.test.ts`
 * and at the surviving dispatcher door.
 *
 * Before the withhold landed that request answered, verbatim:
 *
 *     HTTP 500
 *     {"success":false,"error":{"code":"INTERNAL_ERROR",
 *      "message":"SQLITE_ERROR: no such table: sys_metadata"}}
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Deleting the two-line withhold in `sendThrownError` turns the section-1
 * leak cases RED — they assert the positive sanitized shape, so the driver
 * line reappears in the diff — and leaves every pass-through case (section 2)
 * and every 4xx case (section 3) GREEN, because the predicate is what decides
 * and neither of those trips it. That is the ordinary direction, and it was
 * confirmed by running it (quoted in the PR).
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
import { INTERNAL_ERROR_MESSAGE, looksLikeInternalErrorLeak } from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';

/** The driver line a missing `sys_metadata` produces on each dialect. */
const SQLITE_NO_TABLE = 'SQLITE_ERROR: no such table: sys_metadata';

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
// 1. Every catch site in this registrar, and the whole 5xx band
// ---------------------------------------------------------------------------
//
// Two seams reach this registrar's one catch site (#14503 removed the
// read/delete routes and, with them, their `get` / `delete` / registry
// producer seams): the `publish` producer, and the capability-gate resolver.
//
// ⚠️ The resolver entry is a TEST-ONLY INJECTION POINT. No production throw of
// any kind reaches this catch through that seam: `refusePackageRequest` calls
// `options.resolveExecutionContext(req)`, and only a resolver that throws
// SYNCHRONOUSLY throws before the `.catch(...)` is attached. What the site
// proves is how the door answers a synchronous gate throw — coverage of the
// catch site, never a claim about producers. The derivation is stated ONCE, in
// the `Seam census` block of `package-door-declared-code.test.ts` (stable
// anchors: #12537, #12647), and is deliberately NOT restated here. The case is
// KEPT: `reached()` keeps it from going vacuous, and its 5xx-withhold
// assertions still pin real door behaviour.

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
    name: 'POST /packages/publish — the capability gate resolver throws',
    run: async (error: unknown) => {
      const resolveExecutionContext = vi.fn(() => { throw error; });
      const captured = await drive(
        mount({ publish: async () => ({ success: true }) }, { resolveExecutionContext }),
        'POST',
        `${PKGS}/publish`,
        { body: { manifest: MANIFEST, metadata: { author: 'acme' } } },
      );
      return { captured, reached: () => resolveExecutionContext.mock.calls.length === 1 };
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
// 2. The PREDICATE decides — not a blanket 5xx replacement
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
// 3. The OVER-BLOCK guard: 4xx is untouched
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
// 4. #8016 must not regress
// ---------------------------------------------------------------------------
//
// This change rewrote the expression #8016 landed, so its half is re-pinned at
// the same seam rather than trusted: the coded refusal mapping is what makes a
// 4xx a 4xx here, and section 4 is only meaningful while it holds.

describe('[#8086] the #8016 coded mapping still answers (non-regression)', () => {
  it('a coded 409 keeps its status, its code AND its message', async () => {
    const { captured } = await SITES[0].run(
      thrown('Publishing would drop 3 tables', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
    );
    expect(captured.status).toBe(409);
    expect(captured.body?.error?.code).toBe('DESTRUCTIVE_CHANGE');
    expect(captured.body?.error?.message).toBe('Publishing would drop 3 tables');
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
