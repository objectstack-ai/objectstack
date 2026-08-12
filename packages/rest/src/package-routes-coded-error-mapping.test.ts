// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8016] The direct-mount package door answers a THROWN refusal with the
 * refusal's own status and code — not `500 INTERNAL_ERROR`.
 *
 * ## The defect these cases reproduce
 *
 * All four handlers in `package-routes.ts` ended in the same catch-all:
 *
 *     } catch (error) {
 *       sendError(res, 500, 'INTERNAL_ERROR', (error as Error).message);
 *     }
 *
 * status-blind and code-blind. `packageService.publish` / `.delete` and
 * `protocol.deletePackage` execute inside those blocks, and the metadata
 * protocol throws CODED, status-carrying refusals from that call path (`409
 * DESTRUCTIVE_CHANGE` is the established one). A caller who was refused was
 * told the platform had broken: the wrong class of answer, a retry that cannot
 * succeed, and the code — the one thing a client can branch on — dropped.
 *
 * It was a DISAGREEMENT, not just a bug: the dispatcher twin has always read
 * `.status` first. The agreement itself is pinned in
 * `packages/runtime/src/package-door-error-parity.test.ts`, which can see both
 * doors (`@objectstack/runtime` depends on `@objectstack/rest`; the reverse
 * import does not exist). This file pins the four SITES — that each one, on its
 * own, carries a refusal's status **and** its code (ADR-0112: one alone is not
 * an answer) and still answers 500 for a genuine fault.
 *
 * ## What reaches each catch
 *
 * Three of the four have a service call directly under the `try`, so a throwing
 * `PackageService` drives them. `GET /packages` is different BY DESIGN: both of
 * its data sources sit in their own inner `try { … } catch {}` (a missing
 * protocol or a failed database read degrades to the other source rather than
 * failing the request), so nothing below it reaches the outer catch. What does
 * is the gate: `refusePackageRequest` calls
 * `options.resolveExecutionContext(req)`, and a resolver that throws
 * SYNCHRONOUSLY throws before the `.catch(() => undefined)` is attached. That
 * is not a contrived lever — the composition wires it to the `RestServer`'s own
 * identity/RBAC resolution, which is exactly the kind of code that raises a
 * coded 401/403.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { resolveThrownHttpError } from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

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

const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };

/** A thrown error carrying whatever a producer declares on it. */
function thrown(message: string, carried: Record<string, unknown>): Error {
  return Object.assign(new Error(message), carried);
}

/**
 * One catch site, plus the seam that drives a throw INTO it and a witness that
 * the throw really travelled that way (the anti-vacuity half: a case that
 * silently never reached the seam would otherwise "pass" on a 500 it got for a
 * completely different reason).
 */
interface Site {
  name: string;
  run: (error: unknown) => Promise<{ captured: Captured; reached: () => boolean }>;
}

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

/**
 * Every assertion an answer from this door must satisfy, spelled once. The
 * rules are IMPORTED from `packages/spec` rather than restated, so a body that
 * parses here is one the wire contract accepts — including `code` being a
 * member of the closed ADR-0112 vocabulary.
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

describe('#8016 — a coded refusal keeps its status AND its code on every package route', () => {
  /**
   * Both spellings, because both are produced in this repo: `metadata-protocol`
   * throws `status`, `plugin-approvals`' lifecycle hooks and
   * `runtime`'s action execution throw `statusCode`. Reading one spelling is
   * how `/api/v1/data` answered 500 for a deliberate `409 RECORD_LOCKED` until
   * #7525 — the same defect one door over.
   */
  const REFUSALS: Array<{ name: string; error: unknown; status: number; code: string }> = [
    {
      name: 'a coded 4xx (`status`)',
      error: thrown('Package scope is required', { status: 400, code: 'TENANT_SCOPE_REQUIRED' }),
      status: 400,
      code: 'TENANT_SCOPE_REQUIRED',
    },
    {
      name: 'the established 409 (`status`)',
      error: thrown('Uninstalling drops 3 tables', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
      status: 409,
      code: 'DESTRUCTIVE_CHANGE',
    },
    {
      name: 'a coded 4xx spelled `statusCode`',
      error: thrown('Locked by a pending approval', { statusCode: 409, code: 'RECORD_LOCKED' }),
      status: 409,
      code: 'RECORD_LOCKED',
    },
  ];

  for (const site of SITES) {
    for (const refusal of REFUSALS) {
      it(`${site.name}: ${refusal.name}`, async () => {
        const { captured, reached } = await site.run(refusal.error);

        // Anti-vacuity: the throw really travelled through the seam under test.
        expect(reached(), 'the throwing seam was never called').toBe(true);

        const error = expectDeclaredEnvelope(captured);
        // ADR-0112 — both halves. A status without the code leaves the client
        // unable to branch; a code without the status leaves every proxy,
        // retry policy and log dashboard reading it as a server fault.
        expect(captured.status).toBe(refusal.status);
        expect(error.code).toBe(refusal.code);
        expect(error.message).toBe((refusal.error as Error).message);
      });
    }

    it(`${site.name}: an uncoded throw still answers 500 INTERNAL_ERROR`, async () => {
      const { captured, reached } = await site.run(new Error('kaboom'));

      expect(reached(), 'the throwing seam was never called').toBe(true);
      const error = expectDeclaredEnvelope(captured);
      // The default arm. Mapping everything and leaving nothing here would
      // trade one wrong answer for another and hide real faults.
      expect(captured.status).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.message).toBe('kaboom');
    });

    it(`${site.name}: an UNREGISTERED code does not get to name itself`, async () => {
      // ADR-0112's vocabulary is closed: `StandardErrorCode ∪ ERROR_CODE_LEDGER`.
      // A code outside it would fail `ApiErrorSchema` parse — a silent fourth
      // state on the wire — so the answer falls to the code the status derives.
      const { captured } = await site.run(
        thrown('a dialect nobody registered', { status: 409, code: 'PACKAGE_IS_HAUNTED' }),
      );

      const error = expectDeclaredEnvelope(captured);
      expect(captured.status).toBe(409);
      expect(error.code).toBe('RESOURCE_CONFLICT');
    });
  }
});

/**
 * The convergence half of the agreement pin (#8016).
 *
 * The literal cases above say what the answers ARE, which is what a reader
 * needs. They do not, on their own, keep the two doors together: a second
 * mapping written here could satisfy every literal above and still diverge
 * from the dispatcher on the next throw shape nobody thought to enumerate —
 * that is precisely how the divergence arose.
 *
 * So this door is pinned to the SHARED rule instead of to values:
 * `resolveThrownHttpError` (`@objectstack/types`) is asked the same question,
 * and its answer must be the one that went on the wire. The dispatcher twin is
 * pinned to the same function from the other side, in
 * `packages/runtime/src/package-door-error-parity.test.ts` — which is where the
 * two-door comparison has to be split, because neither door can see the other:
 * `registerPackageRoutes` is internal to `@objectstack/rest`, and `rest` cannot
 * import `runtime` at all (runtime depends on rest). Either door drifting off
 * the shared rule turns one of these two halves red.
 */
describe('#8016 — the wire answer IS the shared mapping, not a second copy of it', () => {
  const SHAPES: unknown[] = [
    thrown('coded 4xx', { status: 400, code: 'TENANT_SCOPE_REQUIRED' }),
    thrown('coded 409', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
    thrown('statusCode spelling', { statusCode: 403, code: 'PERMISSION_DENIED' }),
    thrown('a record-validation failure', { name: 'ValidationError', code: 'VALIDATION_FAILED', fields: [] }),
    thrown('an unregistered code', { status: 409, code: 'PACKAGE_IS_HAUNTED' }),
    thrown('a bare fault', {}),
  ];

  for (const site of SITES) {
    for (const shape of SHAPES) {
      it(`${site.name}: answers exactly what resolveThrownHttpError says for "${(shape as Error).message}"`, async () => {
        const expected = resolveThrownHttpError(shape);
        const { captured, reached } = await site.run(shape);

        expect(reached(), 'the throwing seam was never called').toBe(true);
        expect({ status: captured.status, code: captured.body?.error?.code })
          .toEqual({ status: expected.status, code: expected.code });
      });
    }
  }

  it('the shapes above really do produce different answers', () => {
    // Anti-vacuity for the comparison itself: two constants compared to each
    // other agree trivially. These do not collapse to one answer.
    const answers = SHAPES.map((s) => `${resolveThrownHttpError(s).status} ${resolveThrownHttpError(s).code}`);
    expect(new Set(answers).size).toBeGreaterThan(3);
    expect(answers).toContain('500 INTERNAL_ERROR');
  });
});

describe('#8016 — anti-vacuity: these routes answer normally when nothing throws', () => {
  // If the harness silently failed to drive a handler, every case above would
  // "pass" by asserting on a body no route produced. These prove the same mounts
  // serve real answers.
  it('POST /packages/publish returns 200 when publish succeeds', async () => {
    const captured = await drive(
      mount({ publish: async () => ({ success: true }) }),
      'POST',
      `${PKGS}/publish`,
      { body: { manifest: MANIFEST, metadata: { author: 'acme' } } },
    );
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
  });

  it('GET /packages/:id returns 404 RESOURCE_NOT_FOUND for an absent package', async () => {
    const captured = await drive(
      mount({ get: async () => undefined }),
      'GET',
      `${PKGS}/:id`,
      { params: { id: 'com.acme.nope' } },
    );
    expect(captured.status).toBe(404);
    expect(captured.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
  });
});
