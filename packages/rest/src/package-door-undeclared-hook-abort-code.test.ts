// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27672] `POST /api/v1/packages/publish` answers a sandboxed hook's
 * undeclared abort with `HOOK_ABORTED`, the code `/api/v1/data` has answered
 * since #27597, instead of the `VALIDATION_ERROR` its 400 derives.
 *
 * This door does not answer from the `/data` classification: `sendThrownError`
 * (`package-routes.ts`) takes the status from it and the CODE from
 * `resolveThrownHttpError` (`@objectstack/types`). The resolver now answers
 * `UNDECLARED_HOOK_REFUSAL_CODE` for a sandboxed refusal that declared no code,
 * so this door reads the one rule rather than a copy of it. §2 is the control:
 * a code the body declared is kept, and a plain 400 with no code still derives
 * `VALIDATION_ERROR`.
 */

import { describe, it, expect } from 'vitest';
import { ApiErrorSchema } from '@objectstack/spec/api';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { UNDECLARED_HOOK_REFUSAL_CODE } from '@objectstack/types';
import { registerPackageRoutes } from './package-routes.js';

const PUBLISH = 'POST:/api/v1/packages/publish';
const BODY = { manifest: { id: 'com.acme.crm', version: '1.0.0' }, metadata: {} };

/** The shape `runtime/src/sandbox/quickjs-runner.ts` throws for a body's own `throw`. */
function sandboxRefusal(businessMessage: string, extra: Record<string, unknown> = {}) {
  const err: any = new Error(`hook 'guard' threw: Error: ${businessMessage}`);
  err.name = 'SandboxError';
  err.innerMessage = businessMessage;
  return Object.assign(err, extra);
}

async function publishRejectingWith(error: unknown): Promise<{ status: number; body: any }> {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: () => {},
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: () => {}, delete: () => {}, patch: () => {}, use: () => {},
    listen: async () => {}, close: async () => {},
  } as any;
  const svc = { publish: async () => { throw error; } };
  registerPackageRoutes(server, () => svc as any, '/api/v1', {
    resolveExecutionContext: async () => ({
      userId: 'u_pkg',
      systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    }),
  } as any);
  const captured = { status: 0, body: undefined as any };
  const res: any = {
    json(data: any) { captured.body = data; },
    send() {},
    status(code: number) { captured.status = code; return res; },
    header() { return res; },
  };
  await routes.get(PUBLISH)!(
    { params: {}, query: {}, headers: {}, method: 'POST', path: '/api/v1/packages/publish', body: BODY } as any,
    res,
  );
  return captured;
}

describe('[#27672] §1 an undeclared hook abort answers HOOK_ABORTED at package publish', () => {
  it('400, the hook\'s own sentence, and the code /data answers', async () => {
    const { status, body } = await publishRejectingWith(sandboxRefusal('Publishing is frozen.'));
    expect(status).toBe(400);
    expect(body.error.code).toBe('HOOK_ABORTED');
    expect(body.error.code).toBe(UNDECLARED_HOOK_REFUSAL_CODE);
    expect(body.error.message).toBe('Publishing is frozen.');
    // The body declared no code, so none is reported as declared.
    expect(body.error).not.toHaveProperty('declaredCode');
    expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
  });

  it('a 4xx status the body declared without a code keeps the status', async () => {
    const { status, body } = await publishRejectingWith(sandboxRefusal('Frozen.', { status: 422 }));
    expect(status).toBe(422);
    expect(body.error.code).toBe('HOOK_ABORTED');
  });
});

describe('[#27672] §2 CONTROLS — a declared code is kept; nothing is invented elsewhere', () => {
  it('a registered code the body declared is its own code', async () => {
    const { status, body } = await publishRejectingWith(sandboxRefusal('Locked.', { code: 'RECORD_LOCKED', status: 409 }));
    expect(status).toBe(409);
    expect(body.error.code).toBe('RECORD_LOCKED');
  });

  it('an unregistered code the body declared rides declaredCode beside the derived code', async () => {
    const { body } = await publishRejectingWith(sandboxRefusal('Over the limit.', { code: 'CREDIT_LIMIT', status: 400 }));
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.declaredCode).toBe('CREDIT_LIMIT');
  });

  it('a non-sandbox producer that declared a 400 and no code still derives VALIDATION_ERROR', async () => {
    const { status, body } = await publishRejectingWith(Object.assign(new Error('Manifest is invalid.'), { status: 400 }));
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
