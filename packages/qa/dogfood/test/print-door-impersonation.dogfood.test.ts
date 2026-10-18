// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The print door's impersonation refusal, judged against the REAL auth
// service on a real showcase boot.
//
// `POST /api/v1/print/records` (`@objectstack/service-print`'s door, which the
// showcase composes) refuses a print asked from an impersonation session:
// a printed PDF is rendered and archived as the session's user, and in an
// impersonation session that user is not the one asking. The door recognises
// such a session by the mark the auth service writes on it — better-auth's
// admin plugin sets `impersonatedBy` on the session it mints, which
// `@objectstack/plugin-auth` stores as `sys_session.impersonated_by` — read
// off the very session read that admitted the caller.
//
// The door's unit suite (`print-routes.test.ts`) hands the door a session that
// carries the mark, so it cannot notice the mark going away. This file is the
// supplier side: the session comes from the auth service as composed, so a
// better-auth or plugin-auth change that drops or renames the field turns the
// first pin red here instead of turning the refusal off in silence.
//
// The two pins, on the same admin:
//
//  - the admin's own session is NOT refused for impersonation: the print
//    reaches the service, which refuses it `SERVICE_UNAVAILABLE` / `503`
//    because this boot configures no print engine;
//  - the impersonation session the admin then starts is refused at the door:
//    `PERMISSION_DENIED` / `403`, saying the session is an impersonation.
//
// `/admin/` routes answer only with better-auth's admin plugin on, and
// `bootStack` exposes no auth-plugin override: `OS_SCIM_ENABLED` is the env
// knob that reaches it (SCIM forces the admin plugin on, ADR-0134), read when
// the auth manager is constructed, so it is set before the boot — the same
// switch `admin-platform-admin-standing.dogfood.test.ts` uses.
//
// Not eligible for the shared showcase project: it toggles `process.env`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const PRINT_ENV = ['OS_PRINT_CHROMIUM_PATH', 'OS_PRINT_BROWSER_ENDPOINT', 'OS_PRINT_CONSOLE_URL'];
const TARGET_EMAIL = 'print-impersonation.target@dogfood.test';

const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { value?: unknown })?.value ?? [])) as Array<Record<string, unknown>>;

interface DoorAnswer {
  status: number;
  code: unknown;
  message: unknown;
}

describe('the print door refuses an impersonation session, on the real auth service', () => {
  let stack: VerifyStack;
  let body: Record<string, string>;
  let targetUserId: string;
  const saved: Record<string, string | undefined> = {};

  async function print(token: string): Promise<DoorAnswer> {
    const res = await stack.apiAs(token, 'POST', '/print/records', body);
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown } };
    return { status: res.status, code: json.error?.code, message: json.error?.message };
  }

  beforeAll(async () => {
    saved.OS_SCIM_ENABLED = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    for (const k of PRINT_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    stack = await bootShowcase();
    const ql = await (stack.kernel as unknown as {
      getServiceAsync<T>(n: string): Promise<T>;
    }).getServiceAsync<{ find(o: string, q: unknown): Promise<unknown> }>('objectql');
    await stack.signUp(TARGET_EMAIL, 'Target-Pass-123');
    const [target] = rowsOf(await ql.find('sys_user', { where: { email: TARGET_EMAIL }, limit: 1, context: SYS }));
    targetUserId = String(target?.id);
    const [invoice] = rowsOf(await ql.find('showcase_invoice', { limit: 1, context: SYS }));
    body = {
      app: 'com.example.showcase',
      object: 'showcase_invoice',
      recordId: String(invoice?.id),
      page: 'showcase_invoice_document',
    };
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('the admin\'s own session reaches the service, and an impersonation session the admin starts is refused at the door', async () => {
    expect(targetUserId).not.toBe('undefined');
    const adminToken = await stack.signIn();

    // The admin, as themselves: not an impersonation, so the door hands the
    // print to the service, which has no engine on this boot.
    const own = await print(adminToken);
    expect([own.code, own.status], JSON.stringify(own)).toEqual(['SERVICE_UNAVAILABLE', 503]);

    const started = await stack.apiAs(adminToken, 'POST', '/auth/admin/impersonate-user', { userId: targetUserId });
    expect(started.status, 'the admin plugin did not start an impersonation — no reading below means anything').toBe(200);
    const session = ((await started.json()) as { session?: { token?: unknown } }).session;
    expect(typeof session?.token, 'the impersonation answer carried no session token').toBe('string');

    // The impersonation session: refused at the door, and the refusal says why,
    // so a 403 from anywhere else cannot stand in for this one.
    const impersonated = await print(String(session!.token));
    expect([impersonated.code, impersonated.status], JSON.stringify(impersonated)).toEqual(['PERMISSION_DENIED', 403]);
    expect(String(impersonated.message)).toMatch(/impersonation/);
  }, 120_000);
});
