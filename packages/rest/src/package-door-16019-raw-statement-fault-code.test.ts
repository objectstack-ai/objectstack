// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16019] `POST /api/v1/packages/publish` — the wire `code` a raw-exec driver
 * fault answers moved, and this file pins the flip at the door.
 *
 * ## Scope, narrowed by #14503
 *
 * This file arrived pinning BOTH published REST package doors. `DELETE
 * /api/v1/packages/:id` is no longer one of them: #14503 ruled the dispatcher's
 * `/packages` domain the single implementation of the package read and delete
 * routes, so `registerPackageRoutes` mounts `POST /packages/publish` and
 * nothing else and never calls `PackageService.delete`. The two `DELETE` cases
 * are removed rather than re-pointed — the surviving door
 * (`packages/runtime/src/domains/packages.ts`) uninstalls through
 * `protocol.deletePackage` and the registry, never through
 * `PackageService.delete`, so no delete-door subject for THIS producer is left
 * in this package to pin. The producer-side half is untouched and still pinned
 * where the catch lives: `service-package`'s `delete-driver-fault.test.ts`
 * (`[#16019]` block).
 *
 * ## The flip
 *
 * `PackageService.publish` (`service-package/src/index.ts`) wraps
 * `objectql.execute(...)` in a catch whose branch ② re-throws any error that
 * `declaresHttpAnswer` — a numeric `status` or `statusCode` — and whose branch
 * ③ swallows everything else as a driver fault, returning `{ success: false }`
 * for the door's `sendError` to answer `500 PACKAGE_PUBLISH_FAILED`.
 *
 * Before #16019 a raw-exec driver fault carried no `status` (knex's error
 * object: `code: 'SQLITE_ERROR'`, message `STATEMENT - DIAGNOSTIC`) → branch
 * ③. Since #16019 `SqlDriver.execute()` declares it — `code: DATABASE_ERROR`,
 * `status: 500`, a composed message, the dialect error under a non-enumerable
 * `cause` — → branch ② re-throws it → this door's catch-all `sendThrownError`
 * → `500 DATABASE_ERROR`, the composed sentence as the message (it trips no
 * phrasing heuristic, so it is not replaced by `INTERNAL_ERROR_MESSAGE`; it
 * carries no dialect word to withhold). Same status band, no disclosure
 * either way; the ledgered `code` on the published door moves.
 *
 * The catch's own half — that the declared fault propagates UNCHANGED and the
 * undeclared ancestor still takes branch ③ — is pinned where the catch lives,
 * in `service-package`'s `publish-driver-fault.test.ts` and
 * `delete-driver-fault.test.ts` (`[#16019]` blocks, identity-asserted). This
 * file takes the re-thrown object from there and pins what the DOOR answers,
 * with a `PackageService` double that throws it — the shape every
 * `packageService.publish throws` case in `package-door-5xx-message-sanitization.test.ts`
 * uses — so `@objectstack/service-package` is not imported into this package's
 * test layer (it is not in `rest`'s unaliased-import ledger).
 *
 * ⛔ Not a re-judgement of either catch: `declaresHttpAnswer`'s docblock
 * already says a declared 5xx is re-thrown too. The contract review of PR
 * #16650 required the consequence to be NAMED and PINNED, nothing else.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { INTERNAL_ERROR_MESSAGE, looksLikeInternalErrorLeak } from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PKGS = '/api/v1/packages';
const MANIFEST = { id: 'com.acme.crm', version: '1.0.0' };

/** A caller holding every capability these routes gate on. */
const CLEARS_THE_GATE = async () => ({
  userId: 'u_pkg',
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
});

interface Captured {
  status: number;
  body: any;
}

function mount(svc: Record<string, unknown>) {
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

/** The wire contract, imported rather than restated. */
function expectDeclaredEnvelope(captured: Captured): any {
  expect(BaseResponseSchema.safeParse(captured.body).success).toBe(true);
  expect(envelopeViolations(captured.body)).toEqual([]);
  expect(captured.body?.success).toBe(false);
  const parsed = ApiErrorSchema.safeParse(captured.body?.error);
  expect(parsed.error?.issues ?? []).toEqual([]);
  expect(parsed.success).toBe(true);
  return captured.body.error;
}

const DIALECT_LINE = 'insert into `sys_packages` (`id`, …) values (…) - no such table: sys_packages';
const COMPOSED =
  'The database refused to run a raw statement. The driver could not attribute the failure ' +
  'to any part of the request, so no verdict about the statement is claimed here. The ' +
  "backend's own diagnostic and the statement were written to the server log for an " +
  'operator to read.';

/** What `SqlDriver.execute()` raises since #16019, and what the service's branch ② re-throws. */
function rawStatementFault(): Error {
  const err = Object.assign(new Error(COMPOSED), { code: 'DATABASE_ERROR', status: 500 });
  Object.defineProperty(err, 'cause', {
    value: Object.assign(new Error(DIALECT_LINE), { code: 'SQLITE_ERROR' }),
    enumerable: false, writable: true, configurable: true,
  });
  return err;
}

async function publishWith(svc: Record<string, unknown>): Promise<Captured> {
  return drive(mount(svc), 'POST', `${PKGS}/publish`, {
    body: { manifest: MANIFEST, metadata: { author: 'acme' } },
  });
}

describe('[#16019] a raw-exec driver fault under sys_packages answers the producer\'s code on the publish door', () => {
  // The control that makes the assertions below about the DECLARATION and not
  // about the heuristic: the composed sentence trips nothing.
  it('the composed sentence is not a phrase the door\'s withhold heuristic knows', () => {
    expect(looksLikeInternalErrorLeak(COMPOSED)).toBe(false);
    expect(looksLikeInternalErrorLeak(DIALECT_LINE)).toBe(true);
  });

  it('POST /packages/publish — AFTER #16019: the re-thrown declared fault → 500 DATABASE_ERROR, composed sentence, no dialect word', async () => {
    const publish = vi.fn(async () => { throw rawStatementFault(); });
    const captured = await publishWith({ publish });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(captured.status).toBe(500);
    const error = expectDeclaredEnvelope(captured);
    expect(error.code).toBe('DATABASE_ERROR');
    expect(error.code).not.toBe('PACKAGE_PUBLISH_FAILED');
    expect(error.message).toBe(COMPOSED);
    expect(JSON.stringify(captured.body)).not.toMatch(/sys_packages|no such table|insert into/i);
  });

  it('POST /packages/publish — BEFORE #16019: the swallowed driver fault → 500 PACKAGE_PUBLISH_FAILED (the control, still what an undeclared fault answers)', async () => {
    // Branch ③'s return shape, verbatim from the service.
    const publish = vi.fn(async () => ({ success: false, driverFault: { message: 'The package was not persisted.' } }));
    const captured = await publishWith({ publish });

    expect(captured.status).toBe(500);
    const error = expectDeclaredEnvelope(captured);
    expect(error.code).toBe('PACKAGE_PUBLISH_FAILED');
  });

  it('the withhold is untouched: a DECLARED fault whose message DOES carry dialect text is still replaced at this door', async () => {
    // Beside the flip, the invariant #8086 pinned: `sendThrownError` withholds
    // a leaky 5xx message whatever the code — so a producer that declared but
    // let dialect text into its message would still not disclose it here.
    const leaky = Object.assign(new Error(DIALECT_LINE), { code: 'DATABASE_ERROR', status: 500 });
    const publish = vi.fn(async () => { throw leaky; });
    const captured = await publishWith({ publish });

    expect(captured.status).toBe(500);
    const error = expectDeclaredEnvelope(captured);
    expect(error.code).toBe('DATABASE_ERROR');
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
  });
});
