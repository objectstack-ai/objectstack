// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The upload-link doors' refusal relay (`relayUploadLinkRefusal`): which
 * thrown refusals it answers, and with which `code`.
 *
 *  - **The code is closed.** ADR-0112 and the #9106 ruling make `error.code` a
 *    closed vocabulary at every door. A refusal whose spelling is registered
 *    keeps it; one whose spelling is not answers the code its status derives,
 *    with the spelling beside it as `declaredCode` — the answer the commit
 *    door's `relayAttachFailure` gives in the same file.
 *  - **The status is declared.** `resolveThrownHttpError`'s `declaredStatus`
 *    reads `status`, then `statusCode`, then the validation shape, which
 *    declares `400`. Each limb is driven here.
 *
 * Both doors (the page's `GET` and the upload's `PUT`) answer through the
 * relay; the unregistered-code arm is driven on both.
 *
 * ⛔ Nothing asserts `toThrow()`: the claim is the envelope's `code` and
 * status (ADR-0112).
 */

import { describe, it, expect } from 'vitest';
import { ErrorCode, standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import type { IHttpRequest, RouteHandler } from '@objectstack/spec/contracts';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageFamily } from './storage-routes.js';
import type { UploadLinkDoor } from './record-file-access.js';

const BASE = '/api/v1/storage';
const LINK_PATH = `${BASE}/upload-links/:token`;

/** A producer's own spelling that no ledger registers. */
const UNREGISTERED = 'CLAIM_DESK_SAYS_NO';

interface Answer {
  status: number;
  body: any;
}

/** The two doors, mounted over a link door whose every call throws `thrown`. */
function doorsThrowing(thrown: unknown) {
  const routes = new Map<string, RouteHandler>();
  const http = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  const door: UploadLinkDoor = {
    inspectUploadLink: async () => { throw thrown; },
    consumeUploadLink: async () => { throw thrown; },
  };
  registerStorageFamily(
    http as any,
    {} as any,
    new StorageMetadataStore(null),
    { basePath: BASE, resolveSession: async () => ({ userId: 'u_owner' }) } as any,
    undefined,
    undefined,
    () => door,
  );

  return async (method: 'GET' | 'PUT'): Promise<Answer> => {
    const handler = routes.get(`${method}:${LINK_PATH}`);
    if (!handler) throw new Error(`fixture: no handler for ${method} ${LINK_PATH}`);
    const answer: Answer = { status: 200, body: undefined };
    const res: any = {
      json(data: any) { answer.body = data; return res; },
      send(data: unknown) { answer.body = data; return res; },
      status(code: number) { answer.status = code; return res; },
      header() { return res; },
    };
    await handler(
      {
        params: { token: 'link.secret' },
        query: {},
        headers: { 'content-type': 'application/pdf', 'x-file-name': 'scan.pdf' },
        method,
        path: LINK_PATH,
        rawBody: async () => Buffer.from('bytes'),
      } as unknown as IHttpRequest,
      res,
    );
    return answer;
  };
}

const refusal = (fields: Record<string, unknown>): Error => Object.assign(new Error(String(fields.message ?? 'refused')), fields);

describe('upload-link refusal relay · the code is the closed vocabulary\'s', () => {
  for (const method of ['GET', 'PUT'] as const) {
    it(`${method}: a 4xx refusal spelling an unregistered code answers a registered one, the spelling beside it as declaredCode`, async () => {
      expect(ErrorCode.safeParse(UNREGISTERED).success).toBe(false);
      const answer = await doorsThrowing(refusal({ code: UNREGISTERED, status: 409, message: 'The claim desk refused it' }))(method);

      expect(answer.status).toBe(409);
      expect(answer.body.error.code).toBe(standardErrorCodeForHttpStatus(409));
      expect(ErrorCode.safeParse(answer.body.error.code).success).toBe(true);
      expect(answer.body.error.declaredCode).toBe(UNREGISTERED);
    });
  }

  it('a 503 relays only as spelled SERVICE_UNAVAILABLE: an unregistered spelling stays the route\'s 500, though its status derives that code', async () => {
    expect(standardErrorCodeForHttpStatus(503)).toBe('SERVICE_UNAVAILABLE');
    const unregistered = await doorsThrowing(refusal({ code: UNREGISTERED, status: 503, message: 'desk down' }))('PUT');
    expect(unregistered.status).toBe(500);

    const outage = await doorsThrowing(refusal({ code: 'SERVICE_UNAVAILABLE', status: 503, message: 'try later' }))('PUT');
    expect(outage.status).toBe(503);
    expect(outage.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('a registered spelling is answered verbatim, with no declaredCode', async () => {
    const answer = await doorsThrowing(refusal({ code: 'PERMISSION_DENIED', status: 403, message: 'You cannot edit that record.' }))('PUT');

    expect(answer.status).toBe(403);
    expect(answer.body.error.code).toBe('PERMISSION_DENIED');
    expect(answer.body.error).not.toHaveProperty('declaredCode');
  });
});

describe('upload-link refusal relay · the declared status, over all three limbs', () => {
  it('`statusCode` (a lifecycle hook\'s spelling): the record lock answers 409 RECORD_LOCKED', async () => {
    const answer = await doorsThrowing(
      refusal({ code: 'RECORD_LOCKED', statusCode: 409, message: 'RECORD_LOCKED: Claim is locked while an approval is in progress' }),
    )('PUT');

    expect(answer.status).toBe(409);
    expect(answer.body.error.code).toBe('RECORD_LOCKED');
  });

  it('the validation shape, which carries no status, answers 400 VALIDATION_FAILED', async () => {
    const thrown = refusal({
      name: 'ValidationError',
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'invoices', code: 'invalid_value', message: 'Not an accepted file' }],
      message: 'Validation failed',
    });
    expect(thrown).not.toHaveProperty('status');
    expect(thrown).not.toHaveProperty('statusCode');
    const answer = await doorsThrowing(thrown)('PUT');

    expect(answer.status).toBe(400);
    expect(answer.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a throw declaring no status is the route\'s 500, not a relayed refusal (control)', async () => {
    const answer = await doorsThrowing(refusal({ code: 'PERMISSION_DENIED', message: 'no status' }))('PUT');

    expect(answer.status).toBe(500);
  });
});
