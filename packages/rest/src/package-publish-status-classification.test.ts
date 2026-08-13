// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8131] `POST /api/v1/packages/publish` answers a driver fault as a 5xx,
 * and the caller's own errors as 4xx.
 *
 * ## The defect
 *
 * `packageService.publish` reported failure by RETURNING, so the handler
 * answered `sendError(res, 400, 'PACKAGE_PUBLISH_FAILED', result.error …)`.
 * Two things were wrong with that line and they are independent:
 *
 *  - **the status** — a driver fault answered `400`, a *client* error. The
 *    mirror of what #8016 fixed on the throw path (`a caller who was refused
 *    was told the platform had broken`): here the platform broke and the
 *    caller was told they had made a mistake. Every dashboard that buckets by
 *    status counted a server fault as a client one.
 *  - **the message** — `result.error` was `(error as Error).message`, the raw
 *    driver line, straight onto the wire.
 *
 * ## Why fixing the status did not fix the message
 *
 * The dispatch's load-bearing assumption was that once this path is a 5xx,
 * #8086's withhold covers it "with no new rule". Both halves of that are
 * measured false here, in sections 3 and 4, because it is the reason the fix
 * had to reach the producer:
 *
 *  - the withhold is applied by `sendThrownError`, which a RETURNED failure
 *    never reaches — `sendError` has no predicate in it at any status;
 *  - and `looksLikeInternalErrorLeak('no such table: sys_packages')` is
 *    **false** — the commonest real failure of the `INSERT INTO sys_packages`
 *    statement names no keyword the heuristic knows.
 *
 * So the producer now emits a stable sentence and no driver text at all
 * (`service-package/src/publish-driver-fault.test.ts` drives that with a real
 * SQLite engine). This file pins the door's half: the classification, and the
 * 4xx paths that must NOT move.
 *
 * ## What is deliberately NOT asserted
 *
 * That the body "no longer contains" a driver line, on its own. That passes on
 * a route that emits nothing at all, including one whose handler never ran.
 * Every case below asserts the POSITIVE shape — the exact status, the exact
 * code, the exact message — and the service-reached half where a stub can say
 * so.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import {
  INTERNAL_ERROR_MESSAGE,
  looksLikeInternalErrorLeak,
  resolveThrownHttpError,
  sendError,
} from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';
const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };
const BODY = { manifest: MANIFEST, metadata: { author: 'acme' } };

/**
 * The exact sentence the producer emits. Spelled here rather than imported:
 * `@objectstack/service-package` resolves through `exports` to `dist/`, so a
 * VALUE import of it would make this suite a verdict about a build artifact
 * (`check:test-source-alias`). A drift between the two spellings is caught by
 * the producer's own suite, which asserts the constant it exports.
 */
const DRIVER_FAULT_SENTENCE =
  'The package registry could not store this package. The failure was logged on the server; '
  + 'no package data was written.';

/** The driver lines the real engine produced for this statement, measured. */
const REAL_DRIVER_LINES = [
  'no such table: sys_packages',
  'NOT NULL constraint failed: sys_packages.tenant_ref',
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
// 1. A reported driver fault is a 5xx carrying the stable sentence
// ---------------------------------------------------------------------------

describe('[#8131] a returned driver fault answers 5xx, not 400', () => {
  it('status, code and message together — the classification AND the disclosure', async () => {
    const publish = vi.fn(async () => ({
      success: false, driverFault: { message: DRIVER_FAULT_SENTENCE },
    }));

    const captured = await drive(mount({ publish }), 'POST', `${PKGS}/publish`, { body: BODY });

    // The seam really ran — otherwise every assertion below is about a route
    // that refused before reaching `publish`, which is a different answer.
    expect(publish, 'publish was never called').toHaveBeenCalledTimes(1);

    const error = expectDeclaredEnvelope(captured);
    // ① the half that was mislabelled
    expect(captured.status).toBe(500);
    // ② the code is kept — it discloses nothing and says more than INTERNAL_ERROR
    expect(error.code).toBe('PACKAGE_PUBLISH_FAILED');
    // ③ the positive message shape, not "it changed"
    expect(error.message).toBe(DRIVER_FAULT_SENTENCE);
  });

  it('no driver line the real engine emits can reach the wire through this path', async () => {
    // Paired with the positive assertion above so it cannot pass vacuously:
    // the body is a real failure body with a real message, and these strings
    // are still absent from it.
    for (const line of REAL_DRIVER_LINES) {
      const captured = await drive(
        mount({ publish: async () => ({ success: false, driverFault: { message: DRIVER_FAULT_SENTENCE } }) }),
        'POST', `${PKGS}/publish`, { body: BODY },
      );
      expect(captured.body?.error?.message).toBe(DRIVER_FAULT_SENTENCE);
      expect(JSON.stringify(captured.body)).not.toContain(line);
      expect(JSON.stringify(captured.body)).not.toContain('sys_packages');
    }
  });

  it('a service that reports failure without saying why still answers 5xx', async () => {
    // The `??` arm. It is not a leniency alias: it is the answer for an
    // implementation that returns a bare `{ success: false }`, which the old
    // `error?: string` could not tell apart from a driver dump.
    const captured = await drive(
      mount({ publish: async () => ({ success: false }) }),
      'POST', `${PKGS}/publish`, { body: BODY },
    );
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(500);
    expect(error.code).toBe('PACKAGE_PUBLISH_FAILED');
    expect(error.message).toBe(`Failed to publish ${MANIFEST.id}.`);
  });

  it('a successful publish is untouched', async () => {
    const captured = await drive(
      mount({ publish: async () => ({ success: true }) }),
      'POST', `${PKGS}/publish`, { body: BODY },
    );
    expect(captured.status).toBe(200);
    expect(captured.body?.success).toBe(true);
    expect(captured.body?.data?.package).toEqual({ id: 'com.acme.crm', version: '1.0.0' });
  });
});

// ---------------------------------------------------------------------------
// 2. The caller's own errors are STILL 4xx — the over-block guard
// ---------------------------------------------------------------------------
//
// The ruling this card carries is that 4xx must not be swept. Without this
// section the change above is satisfied by "answer 500 for every publish
// failure", which would destroy the self-correcting messages #4277 exists for
// and re-break what #8016 fixed.

describe('[#8131] a genuine CALLER error on this route is still 4xx', () => {
  const CALLER_ERRORS: Array<{ name: string; body: any; status: number; code: string; message: string }> = [
    {
      name: 'no manifest/metadata at all',
      body: {},
      status: 400,
      code: 'MISSING_REQUIRED_FIELD',
      message: 'Missing required fields: manifest, metadata',
    },
    {
      name: 'a manifest with no id/version',
      body: { manifest: {}, metadata: {} },
      status: 400,
      code: 'PACKAGE_MANIFEST_INVALID',
      message: 'Invalid manifest: id and version are required',
    },
  ];

  for (const c of CALLER_ERRORS) {
    it(`${c.name}: ${c.status} ${c.code}, message intact`, async () => {
      const publish = vi.fn();
      const captured = await drive(mount({ publish }), 'POST', `${PKGS}/publish`, { body: c.body });

      // The refusal's other half: the service was never reached. A status
      // assertion alone would not notice a handler that published anyway.
      expect(publish, 'publish ran on a request that should have been refused').not.toHaveBeenCalled();

      const error = expectDeclaredEnvelope(captured);
      expect(captured.status).toBe(c.status);
      expect(error.code).toBe(c.code);
      // The self-correcting sentence survives verbatim — it names what to fix.
      expect(error.message).toBe(c.message);
    });
  }

  it('a REFUSAL thrown from below publish keeps its own status and code', async () => {
    // The producer re-throws a declared envelope rather than swallowing it, so
    // #8016's mapping answers. Before #8131 this arrived as
    // `{ success: false, error }` and came out as `400 PACKAGE_PUBLISH_FAILED`
    // — the producer's status AND code both lost.
    const refusal = Object.assign(new Error('Uninstalling drops 3 tables; pass force: true.'), {
      status: 409, code: 'DESTRUCTIVE_CHANGE',
    });
    const captured = await drive(
      mount({ publish: async () => { throw refusal; } }),
      'POST', `${PKGS}/publish`, { body: BODY },
    );
    const error = expectDeclaredEnvelope(captured);
    expect(captured.status).toBe(409);
    expect(error.code).toBe('DESTRUCTIVE_CHANGE');
    expect(error.message).toBe('Uninstalling drops 3 tables; pass force: true.');
  });

  it('the 4xx/5xx split is decided by the CHANNEL, not by the message', async () => {
    // The same sentence, once thrown with a declared 4xx and once returned as
    // a driver fault. If the door ever starts sniffing the text, this splits.
    const sentence = 'com.acme.crm@1.0.0 could not be written.';
    const thrown = await drive(
      mount({ publish: async () => { throw Object.assign(new Error(sentence), { status: 422, code: 'VALIDATION_ERROR' }); } }),
      'POST', `${PKGS}/publish`, { body: BODY },
    );
    expect(thrown.status).toBe(422);
    expect(thrown.body?.error?.message).toBe(sentence);

    const returned = await drive(
      mount({ publish: async () => ({ success: false, driverFault: { message: sentence } }) }),
      'POST', `${PKGS}/publish`, { body: BODY },
    );
    expect(returned.status).toBe(500);
    expect(returned.body?.error?.message).toBe(sentence);
  });
});

// ---------------------------------------------------------------------------
// 3. WHY the producer half was required: the withhold is unreachable here
// ---------------------------------------------------------------------------
//
// Recorded as executable fact rather than prose, because the dispatch assumed
// the opposite and the assumption is the kind that gets re-made.

describe('[#8131] the 5xx withhold does NOT cover a RETURNED failure', () => {
  it('sendError applies no leak predicate — at any status', async () => {
    // The withhold (#8086) lives in `sendThrownError`. `sendError` is the
    // envelope writer and deliberately carries no disclosure rule (its own
    // module note disclaims one). So reclassifying this path to 500 without
    // fixing the producer would have moved the driver line from a 400 to a
    // 500 and left it on the wire.
    const leak = 'SQLITE_ERROR: no such table: sys_packages';
    expect(looksLikeInternalErrorLeak(leak)).toBe(true);

    const captured: Captured = { status: 0, body: undefined };
    const res: any = {
      json(d: any) { captured.body = d; }, send() {},
      status(c: number) { captured.status = c; return res; }, header() { return res; },
    };
    sendError(res, 500, 'PACKAGE_PUBLISH_FAILED', leak);

    expect(captured.status).toBe(500);
    // Verbatim — no withhold ran. This is the measurement, not a wish.
    expect(captured.body?.error?.message).toBe(leak);
    expect(captured.body?.error?.message).not.toBe(INTERNAL_ERROR_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// 4. …and the heuristic would have missed it anyway
// ---------------------------------------------------------------------------

describe('[#8131] looksLikeInternalErrorLeak does not recognise this statement’s commonest failure', () => {
  it('`no such table: sys_packages` is measured FALSE', () => {
    // The same ceiling #8086 pinned for the Postgres phrasing, hit by SQLite
    // too: the message names no `sqlite_`, no `sqlstate`, no `constraint
    // failed`, and does not START with a statement keyword. So even routed
    // through `sendThrownError` at 500 it would have travelled whole.
    //
    // ⛔ Do not "fix" this by widening the predicate — that is a phrasing arms
    // race across every dialect, and #8136 rules it out explicitly. The cure
    // is the producer, which is where #8131 put it.
    expect(looksLikeInternalErrorLeak('no such table: sys_packages')).toBe(false);

    // Its sibling DOES trip, which is what makes the case above a real gap
    // rather than a claim that the predicate never works.
    expect(looksLikeInternalErrorLeak('NOT NULL constraint failed: sys_packages.tenant_ref')).toBe(true);
  });

  it('this case goes red the day the predicate learns the phrasing — that is the signal', () => {
    // Stated positively so the day it changes is visible, per #8086's ceiling
    // note. A reader arriving because this went red should delete it, not
    // repair it.
    expect(looksLikeInternalErrorLeak('no such table: sys_packages')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. The producer's declaration test agrees with the shared #8016 rule
// ---------------------------------------------------------------------------
//
// `service-package` asks "did this throw DECLARE an envelope?" with a local
// predicate rather than importing `resolveThrownHttpError`, because
// value-importing `@objectstack/types` there would make that package's unit
// pins a verdict about a build artifact (`check:test-source-alias`). The
// agreement is therefore asserted HERE, where `@objectstack/types` is already
// a value dependency — so the two cannot drift silently.

describe('[#8131] the producer re-throws exactly what the shared rule can map', () => {
  /**
   * `declaresHttpAnswer` keys on the STATUS channel — `.status` or
   * `.statusCode` — and deliberately not on `.code`. Asked here of the shared
   * rule with a sentinel `fallbackStatus` no producer declares: a resolved
   * status that is still the sentinel means nothing was declared.
   */
  const declaredStatus = (error: unknown) => resolveThrownHttpError(error, 0).status !== 0;

  const SHAPES: Array<{ name: string; error: unknown; rethrown: boolean }> = [
    { name: '.status', error: Object.assign(new Error('x'), { status: 409 }), rethrown: true },
    { name: '.statusCode', error: Object.assign(new Error('x'), { statusCode: 400 }), rethrown: true },
    { name: 'a declared 5xx', error: Object.assign(new Error('x'), { status: 503, code: 'SERVICE_UNAVAILABLE' }), rethrown: true },
    { name: 'bare Error', error: new Error('no such table: sys_packages'), rethrown: false },
    { name: 'a string throw', error: 'boom', rethrown: false },
    { name: 'null', error: null, rethrown: false },
  ];

  for (const s of SHAPES) {
    it(`${s.name}: re-thrown=${s.rethrown}, and the shared rule agrees a status was declared=${s.rethrown}`, () => {
      expect(declaredStatus(s.error)).toBe(s.rethrown);
    });
  }

  /**
   * ⛔ Why `.code` is excluded, asserted rather than argued.
   *
   * The shared rule keeps a producer's `.code` in `declaredCode` even when the
   * ledger does not know it — correct for the dispatcher door, which puts
   * unregistered codes on the wire by design. But a **driver** populates that
   * same field: `ERR_SQLITE_ERROR`, `42P01`, `ER_NO_SUCH_TABLE`. So
   * `declaredCode` cannot be a "this is a refusal" signal at the producer, and
   * the case below shows what accepting it would have cost — the raw driver
   * line, resolved to a 500 whose message the heuristic does not withhold.
   */
  it('a driver `code` reads as a declaredCode but must NOT make the producer re-throw', () => {
    const driverError = Object.assign(new Error('no such table: sys_packages'), {
      code: 'ERR_SQLITE_ERROR',
    });

    // The shared rule does record it…
    const resolved = resolveThrownHttpError(driverError, 0);
    expect(resolved.declaredCode).toBe('ERR_SQLITE_ERROR');
    // …while declaring NO status of its own, which is the signal that counts.
    expect(resolved.status).toBe(0);
    expect(declaredStatus(driverError)).toBe(false);

    // And had it been re-thrown, this is what the door would have answered:
    // a 500 whose message is the driver line verbatim, because the heuristic
    // does not recognise this phrasing.
    const asThrown = resolveThrownHttpError(driverError);
    expect(asThrown.status).toBe(500);
    expect(asThrown.code).toBe('INTERNAL_ERROR');
    expect(looksLikeInternalErrorLeak(asThrown.message)).toBe(false);
    expect(asThrown.message).toBe('no such table: sys_packages');
  });
});
