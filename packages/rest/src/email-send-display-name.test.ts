// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29891 — `POST /api/v1/email/send` answers 400 `VALIDATION_FAILED`, never
 * 500 `EMAIL_SEND_FAILED`, when a caller-supplied address (`to` / `cc` /
 * `bcc` / `replyTo`) carries a display name that is not a string.
 *
 * The refusal itself was already right (`formatCallerAddress`, #29152 / PR
 * #29250); what turned it into a 500 was the REJECTION ROW's writer
 * (`rawAddressText` inside `EmailService.recordRejectedMessage`), which
 * called `name.trim()` on the caller's raw value after the 400 was raised.
 * `email-send-door-bounds.test.ts` drives this door over a mail double, so it
 * never reaches that writer — this file drives it over the REAL
 * `EmailServicePlugin` (log provider) with `sys_email` persistence wired, the
 * stock showcase boot's shape, through the real `HonoHttpServer` transport.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import type { IEmailService } from '@objectstack/spec/contracts';
import { RestServer } from './rest-server';
import { EMAIL_SEND_CAPABILITY } from './email-routes';

const ADMIN = { userId: 'usr_admin', systemPermissions: ['setup.access', EMAIL_SEND_CAPABILITY] };

/** The slice of ObjectQL the plugin's `sys_email` persistence touches. */
function fakeEngine() {
  const rows: Array<{ object: string; row: any }> = [];
  return {
    rows,
    async insert(object: string, row: any) { rows.push({ object, row }); return { id: row.id }; },
    async update(object: string, data: any) {
      const target = rows.find((r) => r.object === object && r.row.id === data?.id);
      if (target) Object.assign(target.row, data);
      return { affected: target ? 1 : 0 };
    },
    async find() { return []; },
  };
}

async function bootEmail() {
  const engine = fakeEngine();
  const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: engine };
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
  };
  const plugin = new EmailServicePlugin({ provider: 'log', defaultFrom: 'no-reply@acme.example' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  for (const fn of hooks['kernel:ready'] ?? []) await fn();
  return { service: services.email as IEmailService, rows: engine.rows };
}

async function boot() {
  const { service, rows } = await bootEmail();
  const server = new HonoHttpServer(0);
  const rest = new RestServer(
    server as any,
    {} as any,
    { api: { requireAuth: false } } as any,
    undefined, // kernelManager
    undefined, // envRegistry
    undefined, // defaultEnvironmentIdProvider
    undefined, // authServiceProvider
    undefined, // objectQLProvider
    async () => service, // emailServiceProvider
  );
  (rest as any).resolveExecCtx = async () => ADMIN;
  rest.registerRoutes();
  server.installNotFoundSeam();
  const post = async (body: unknown) => {
    const res: Response = await server.getRawApp().fetch(new Request('http://local/api/v1/email/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: (await res.json()) as any };
  };
  return { post, rows };
}

const OK = 'ok@example.com';
const BASE = { subject: 'x', text: 'x' };

/** Every non-string display-name shape a JSON body can carry. */
const SHAPES: Array<[string, unknown]> = [
  ['a number', 42],
  ['an object', { x: 1 }],
  ['an array', ['Ada']],
  ['a boolean', true],
];

describe('POST /api/v1/email/send — a non-string recipient display name is the caller\'s 400 (#29891)', () => {
  for (const [what, name] of SHAPES) {
    for (const field of ['to', 'cc', 'bcc', 'replyTo'] as const) {
      it(`\`${field}\` with ${what} as the display name: 400 VALIDATION_FAILED naming the field, and a rejection row`, async () => {
        const { post, rows } = await boot();
        const recipient = { address: OK, name };
        const body = field === 'to' ? { ...BASE, to: recipient } : { ...BASE, to: 'someone@example.org', [field]: recipient };
        const out = await post(body);

        expect(out.status).toBe(400);
        expect(out.body.code).toBe('VALIDATION_FAILED');
        const what2 = field === 'replyTo' ? 'reply-to address' : 'recipient address';
        expect(out.body.error).toBe(`invalid ${what2} in \`${field}\`: the display name of ${OK} must be a string`);

        // The rejection is still recorded — the writer no longer throws — and
        // records the bare address (the non-string name is left out; the
        // `error` column names it).
        expect(rows).toHaveLength(1);
        const row = rows[0].row;
        expect(row.status).toBe('failed');
        expect(row.error).toBe(`rejected before delivery: VALIDATION_FAILED: ${out.body.error}`);
        const column = { to: 'to_addresses', cc: 'cc_addresses', bcc: 'bcc_addresses', replyTo: 'reply_to' }[field];
        expect(row[column]).toBe(OK);
      });
    }
  }

  it('a `to` LIST entry with an object display name: 400, the row lists both entries', async () => {
    const { post, rows } = await boot();
    const out = await post({ ...BASE, to: ['first@example.org', { address: OK, name: { x: 1 } }] });

    expect(out.status).toBe(400);
    expect(out.body).toEqual({
      code: 'VALIDATION_FAILED',
      error: `invalid recipient address in \`to\`: the display name of ${OK} must be a string`,
    });
    expect(rows[0].row.to_addresses).toBe(`first@example.org, ${OK}`);
  });

  it('a `null` display name is "no name": the send goes through (200), as an absent one does', async () => {
    const { post } = await boot();
    const out = await post({ ...BASE, to: { address: OK, name: null } });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('sent');
  });

  it('a string display name still sends (200) — the guard refuses only the non-string shapes', async () => {
    const { post } = await boot();
    const out = await post({ ...BASE, to: { address: OK, name: 'Ada' } });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('sent');
  });
});
