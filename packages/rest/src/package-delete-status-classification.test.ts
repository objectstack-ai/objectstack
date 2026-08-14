// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8275] `DELETE /api/v1/packages/:id` answers a driver fault as a 5xx, and
 * the caller's own errors as 4xx.
 *
 * ## The defect
 *
 * `packageService.delete` reported failure by RETURNING, so the handler
 * answered `sendError(res, 400, 'PACKAGE_DELETE_FAILED', …)`. The statement
 * that failed is `DELETE FROM sys_packages WHERE id = ? [AND version = ?]`, so
 * a missing table, a lock timeout or a foreign-key restriction — a SERVER
 * fault — was answered as a client error: it invited the caller to fix a
 * request that was never the problem, and it hid a real fault from every
 * dashboard that buckets by status. The mirror of what #8016 fixed on the
 * throw path and #8131 fixed for `publish`, on the sibling route.
 *
 * ## What is DIFFERENT from the `publish` half, measured rather than inherited
 *
 * #8131 found that reclassifying `publish` was not enough on its own, because
 * the returned failure was carrying `(error as Error).message` and the 5xx
 * withhold (#8086) lives in `sendThrownError`, which a returned failure never
 * reaches. The first half of that measurement holds here — §4 re-measures it
 * on this route rather than assuming it — but the CONCLUSION does not carry
 * over: this door builds its sentence from the request's own `:id` and
 * `?version=`, and the producer returns a bare flag with no message channel at
 * all. No driver text has ever reached a caller on this path, so there is
 * nothing to withhold and no producer-side message to add. This card is a
 * status-classification defect only.
 *
 * §4 pins that property where it can actually break: the door does not read a
 * message off the producer's result, so a producer that grows one cannot put
 * it on the wire through here.
 *
 * ## What is deliberately NOT asserted
 *
 * That a body "no longer contains" driver text, on its own — that passes on a
 * route that emits nothing at all, including one whose handler never ran.
 * Every case below asserts the POSITIVE shape (exact status, exact code, exact
 * message) and, where a stub can say so, that the service was really reached.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { looksLikeInternalErrorLeak } from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';
const PKG_ID = 'com.acme.crm';

/** The driver lines the real engine produced for this statement, measured. */
const REAL_DRIVER_LINES = [
  'no such table: sys_packages',
  'FOREIGN KEY constraint failed',
];

interface Captured { status: number; body: any }

const CLEARS_THE_GATE = async () => ({
  userId: 'u_pkg',
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
});

function mount(svc: Record<string, unknown>, options: Record<string, unknown> = {}) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: () => {}, delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
    patch: () => {}, use: () => {}, listen: async () => {}, close: async () => {},
  } as any;
  registerPackageRoutes(server, () => svc as any, '/api/v1', {
    resolveExecutionContext: CLEARS_THE_GATE, ...options,
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
    json(d: any) { captured.body = d; }, send() {},
    status(c: number) { captured.status = c; return res; }, header() { return res; },
  };
  await handler({ params: {}, query: {}, body: undefined, headers: {}, method, path, ...req } as any, res);
  return captured;
}

/** The declared envelope, imported from `packages/spec` rather than restated. */
function expectDeclaredEnvelope(captured: Captured): any {
  expect(BaseResponseSchema.safeParse(captured.body).success).toBe(true);
  expect(envelopeViolations(captured.body)).toEqual([]);
  expect(captured.body?.success).toBe(false);
  const parsed = ApiErrorSchema.safeParse(captured.body?.error);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
  return captured.body.error;
}

// ---------------------------------------------------------------------------
// 1. A reported driver fault is a 5xx
// ---------------------------------------------------------------------------

describe('[#8275] a returned delete failure answers 5xx, not 400', () => {
  const SHAPES: Array<{ name: string; query: Record<string, any>; message: string }> = [
    {
      name: 'a version-scoped delete',
      query: { version: '1.0.0' },
      message: `Failed to delete ${PKG_ID}@1.0.0.`,
    },
    {
      name: 'an unversioned delete with no protocol composed',
      query: {},
      message: `Failed to delete ${PKG_ID}.`,
    },
  ];

  for (const shape of SHAPES) {
    it(`${shape.name}: status AND code together (ADR-0112)`, async () => {
      const del = vi.fn(async () => ({ success: false }));

      const captured = await drive(
        mount({ delete: del }), 'DELETE', `${PKGS}/:id`,
        { params: { id: PKG_ID }, query: shape.query },
      );

      // The seam really ran — otherwise every assertion below is about a route
      // that refused before reaching `delete`, which is a different answer.
      expect(del, 'packageService.delete was never called').toHaveBeenCalledTimes(1);

      const error = expectDeclaredEnvelope(captured);
      // ① the half that was mislabelled
      expect(captured.status).toBe(500);
      // ② the code is kept — it discloses nothing and says more than
      // INTERNAL_ERROR. `envelopeViolations` imposes no code/status agreement,
      // so a registered code on a 5xx is conformant.
      expect(error.code).toBe('PACKAGE_DELETE_FAILED');
      // ③ the positive message shape, not merely "it changed"
      expect(error.message).toBe(shape.message);
    });
  }

  it('a successful delete is untouched', async () => {
    const captured = await drive(
      mount({ delete: async () => ({ success: true }) }), 'DELETE', `${PKGS}/:id`,
      { params: { id: PKG_ID }, query: { version: '1.0.0' } },
    );
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
    expect(captured.body?.data?.message).toBe(`Deleted ${PKG_ID}@1.0.0`);
  });
});

// ---------------------------------------------------------------------------
// 2. The caller's own errors are STILL 4xx — the over-block guard
// ---------------------------------------------------------------------------
//
// The ruling this card carries is that 4xx must not be swept. Without this
// section the change above is satisfied by "answer 500 for every delete
// failure", which would destroy the self-correcting messages #4277 exists for
// and re-break what #8016 fixed.

describe('[#8275] a genuine CALLER error on this route is still 4xx', () => {
  it('a REFUSAL thrown from below `delete` keeps its own status and code', async () => {
    // The producer re-throws a declared envelope rather than swallowing it, so
    // #8016's mapping answers. Before this change the swallow turned it into
    // `{ success: false }` and the door answered `400 PACKAGE_DELETE_FAILED` —
    // the producer's status AND code both lost.
    const refusal = Object.assign(new Error('Uninstalling drops 3 tables; pass force: true.'), {
      status: 409, code: 'DESTRUCTIVE_CHANGE',
    });
    const captured = await drive(
      mount({ delete: async () => { throw refusal; } }), 'DELETE', `${PKGS}/:id`,
      { params: { id: PKG_ID }, query: { version: '1.0.0' } },
    );
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(409);
    expect(error.code).toBe('DESTRUCTIVE_CHANGE');
    // The self-correcting sentence survives verbatim — it names the remedy.
    expect(error.message).toBe('Uninstalling drops 3 tables; pass force: true.');
  });

  it('the `statusCode` spelling of a declared 4xx is answered too', async () => {
    const refusal = Object.assign(new Error('[tenant_scope_required] pass organizationId.'), {
      statusCode: 400,
    });
    const captured = await drive(
      mount({ delete: async () => { throw refusal; } }), 'DELETE', `${PKGS}/:id`,
      { params: { id: PKG_ID }, query: { version: '1.0.0' } },
    );
    expect(captured.status).toBe(400);
    expect(captured.body?.error?.message).toBe('[tenant_scope_required] pass organizationId.');
  });

  it('a full uninstall that leaves items behind is STILL 400 PACKAGE_DELETE_PARTIAL', async () => {
    // A DECLARED refusal on this route, and a different outcome from the one
    // reclassified above: per-item failures are reported by the protocol, not
    // by a broken statement. It must not be swept into the 5xx arm.
    const captured = await drive(
      mount({ delete: async () => ({ success: true }) }, {
        protocol: {
          deletePackage: async () => ({
            success: false, deletedCount: 1, failedCount: 2,
            failed: [{ type: 'object', name: 'invoice', error: 'in use' }],
            cleanups: [],
          }),
        },
      }),
      'DELETE', `${PKGS}/:id`, { params: { id: PKG_ID } },
    );
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(400);
    expect(error.code).toBe('PACKAGE_DELETE_PARTIAL');
    expect(error.details?.failed).toEqual([{ type: 'object', name: 'invoice', error: 'in use' }]);
  });

  it('a self-contradictory request is refused 400 before `delete` is reached', async () => {
    const del = vi.fn(async () => ({ success: false }));
    const captured = await drive(
      mount({ delete: del }), 'DELETE', `${PKGS}/:id`,
      { params: { id: PKG_ID }, query: { version: ['1.0.0', '2.0.0'] } },
    );
    // The refusal's other half: the service was never reached. A status
    // assertion alone would not notice a handler that deleted anyway.
    expect(del, 'delete ran on a request that should have been refused').not.toHaveBeenCalled();
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('the 4xx/5xx split is decided by the CHANNEL, not by the message', async () => {
    // The same package, failing the same way, once THROWN with a declared 4xx
    // and once RETURNED. If the door ever starts sniffing text instead of
    // reading the channel, this splits.
    const sentence = `${PKG_ID}@1.0.0 could not be removed.`;
    const thrown = await drive(
      mount({ delete: async () => { throw Object.assign(new Error(sentence), { status: 422, code: 'VALIDATION_ERROR' }); } }),
      'DELETE', `${PKGS}/:id`, { params: { id: PKG_ID }, query: { version: '1.0.0' } },
    );
    expect(thrown.status).toBe(422);
    expect(thrown.body?.error?.message).toBe(sentence);

    const returned = await drive(
      mount({ delete: async () => ({ success: false }) }),
      'DELETE', `${PKGS}/:id`, { params: { id: PKG_ID }, query: { version: '1.0.0' } },
    );
    expect(returned.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 3. A declared 5xx from below is still the PRODUCER's answer
// ---------------------------------------------------------------------------

describe('[#8275] a declared 5xx is not re-labelled by this route', () => {
  it('a 503 SERVICE_UNAVAILABLE keeps its status and code', async () => {
    // The re-throw is a test of DECLARATION, not of the status band. Answering
    // this as `500 PACKAGE_DELETE_FAILED` would lose a code a client can
    // branch on and a status that means something different (retry later).
    const captured = await drive(
      mount({ delete: async () => { throw Object.assign(new Error('The registry is warming up.'), { status: 503, code: 'SERVICE_UNAVAILABLE' }); } }),
      'DELETE', `${PKGS}/:id`, { params: { id: PKG_ID }, query: { version: '1.0.0' } },
    );
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(503);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// 4. Why NO producer-side message was added here
// ---------------------------------------------------------------------------
//
// Recorded as executable fact rather than prose, because the shape of the
// `publish` fix makes "mirror it exactly" the obvious next edit, and on this
// route that edit would OPEN the channel it closed there.

describe('[#8275] the door writes its own sentence and reads none from the producer', () => {
  it('a producer that grows a message cannot put it on the wire through here', async () => {
    // The structural pin. `sendError` applies no leak predicate at any status
    // (#8086's withhold lives in `sendThrownError`, which a RETURNED failure
    // never reaches), so anything the door chose to echo from the producer
    // would travel unfiltered. It echoes nothing: the sentence is built from
    // the request's own `:id` and `?version=`.
    const leak = 'no such table: sys_packages';
    // The predicate would recognise this line — and is never asked on this
    // path. That is the measurement, not a wish.
    expect(looksLikeInternalErrorLeak(leak)).toBe(true);

    const captured = await drive(
      mount({ delete: async () => ({ success: false, driverFault: { message: leak }, error: leak }) }),
      'DELETE', `${PKGS}/:id`, { params: { id: PKG_ID }, query: { version: '1.0.0' } },
    );

    expect(captured.status).toBe(500);
    expect(captured.body?.error?.message).toBe(`Failed to delete ${PKG_ID}@1.0.0.`);
    for (const line of REAL_DRIVER_LINES) {
      expect(JSON.stringify(captured.body)).not.toContain(line);
    }
    expect(JSON.stringify(captured.body)).not.toContain('sys_packages');
  });

  it('the sentence echoes the request and nothing else', async () => {
    // Two different requests, two different sentences, both derived only from
    // what the caller sent — so the message channel is the request itself.
    const first = await drive(
      mount({ delete: async () => ({ success: false }) }),
      'DELETE', `${PKGS}/:id`, { params: { id: 'com.other.app' }, query: { version: '9.9.9' } },
    );
    expect(first.body?.error?.message).toBe('Failed to delete com.other.app@9.9.9.');

    const second = await drive(
      mount({ delete: async () => ({ success: false }) }),
      'DELETE', `${PKGS}/:id`, { params: { id: PKG_ID }, query: {} },
    );
    expect(second.body?.error?.message).toBe(`Failed to delete ${PKG_ID}.`);
  });
});
