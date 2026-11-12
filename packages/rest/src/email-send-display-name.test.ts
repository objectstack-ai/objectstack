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
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import type { IEmailService } from '@objectstack/spec/contracts';
import { RestServer } from './rest-server';
import { EMAIL_SEND_CAPABILITY } from './email-routes';

const ADMIN = { userId: 'usr_admin', systemPermissions: ['setup.access', EMAIL_SEND_CAPABILITY] };

/**
 * The slice of ObjectQL the plugin's `sys_email` persistence touches. `update`
 * routes through `assertEngineUpdateDispatch`, so the double cannot accept a
 * dispatch the real engine would refuse.
 */
function fakeEngine() {
  const rows: Array<{ object: string; row: any }> = [];
  return {
    rows,
    async insert(object: string, row: any) { rows.push({ object, row }); return { id: row.id }; },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (dispatch.kind !== 'by-id') throw new Error(`unexpected update dispatch: ${dispatch.kind}`);
      const target = rows.find((r) => r.object === object && r.row.id === dispatch.id);
      if (target) Object.assign(target.row, data);
      return { affected: target ? 1 : 0 };
    },
    /** Equality on every `where` key; the boot sweep and the queue worker read through it. */
    async find(object: string, query?: { where?: Record<string, unknown> }) {
      const where = query?.where ?? {};
      return rows
        .filter((r) => r.object === object && Object.entries(where).every(([k, v]) => r.row[k] === v))
        .map((r) => ({ ...r.row }));
    },
  };
}

/** A durable-looking queue double: it records publishes and keeps each subscriber to run by hand. */
function fakeQueue() {
  const published: Array<{ queue: string; data: any }> = [];
  const handlers: Record<string, (msg: any) => Promise<void>> = {};
  return {
    published,
    handlers,
    async publish(queue: string, data: any) { published.push({ queue, data }); return `msg-${published.length}`; },
    async subscribe(queue: string, handler: (msg: any) => Promise<void>) { handlers[queue] = handler; },
    async unsubscribe() { /* noop */ },
  };
}

interface EmailBootOptions {
  /** A transport double in place of the `log` provider. */
  transport?: { send: (...args: any[]) => Promise<{ messageId: string }> };
  /** `false` ⇒ no `sys_email` persistence. */
  persist?: boolean;
  /** Queue delivery on, over this queue double. */
  queue?: ReturnType<typeof fakeQueue>;
}

async function bootEmail(opts: EmailBootOptions = {}) {
  const engine = fakeEngine();
  const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: engine };
  if (opts.queue) services.queue = opts.queue;
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
  const plugin = new EmailServicePlugin({
    ...(opts.transport ? { transport: opts.transport } : { provider: 'log' as const }),
    defaultFrom: 'no-reply@acme.example',
    ...(opts.persist === false ? { persist: false } : {}),
    ...(opts.queue ? { queueDelivery: true } : {}),
  });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  for (const fn of hooks['kernel:ready'] ?? []) await fn();
  return { service: services.email as IEmailService, rows: engine.rows };
}

async function boot(opts: EmailBootOptions = {}) {
  const { service, rows } = await bootEmail(opts);
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

describe('POST /api/v1/email/send — a non-string subject / text / html is the caller\'s 400, refused before the transport', () => {
  const NON_STRING: Array<[string, Record<string, unknown>, 'subject' | 'text' | 'html']> = [
    ['`html: 123`', { subject: 'x', html: 123 }, 'html'],
    ['`text: {a:1}`', { subject: 'x', text: { a: 1 } }, 'text'],
    ['`subject: {a:1}`', { subject: { a: 1 }, html: 'hello' }, 'subject'],
  ];

  for (const [what, fields, field] of NON_STRING) {
    it(`${what}: 400 VALIDATION_FAILED naming \`${field}\`, and a failed rejection row`, async () => {
      const { post, rows } = await boot();
      const out = await post({ to: OK, ...fields });

      expect(out.status).toBe(400);
      expect(out.body.code).toBe('VALIDATION_FAILED');
      expect(String(out.body.error).startsWith(`\`${field}\` `)).toBe(true);
      // Refused before delivery: the one row is the rejection record, never a
      // delivery attempt at `sent` / `failed` from the transport.
      expect(rows).toHaveLength(1);
      expect(rows[0].row).toMatchObject({ status: 'failed', attempt_count: 0 });
      expect(String(rows[0].row.error).startsWith('rejected before delivery: VALIDATION_FAILED: ')).toBe(true);
    });
  }

  // `String()` THROWS on an object whose own `toString` is not callable; the
  // rejection row's writer must not coerce it, or the refusal becomes a 500
  // `EMAIL_SEND_FAILED` with no row.
  for (const [what, subject] of [
    ['`subject: {toString: 1}`', { toString: 1 }],
    ['`subject: [{toString: 1}]`', [{ toString: 1 }]],
  ] as Array<[string, unknown]>) {
    it(`${what}: 400 VALIDATION_FAILED naming \`subject\`, and a failed rejection row`, async () => {
      const { post, rows } = await boot();
      const out = await post({ to: OK, subject, html: 'hello' });

      expect(out.status).toBe(400);
      expect(out.body.code).toBe('VALIDATION_FAILED');
      expect(String(out.body.error).startsWith('`subject` ')).toBe(true);
      expect(rows).toHaveLength(1);
      expect(rows[0].row).toMatchObject({ status: 'failed', attempt_count: 0 });
    });
  }

  it('CONTROL — a string subject and body still send (200 sent)', async () => {
    const { post } = await boot();
    const out = await post({ to: OK, subject: 'x', html: '<p>hello</p>', text: 'hello' });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('sent');
  });

  it('CONTROL — a `null` text beside a string html still sends, as an absent one does', async () => {
    const { post } = await boot();
    const out = await post({ to: OK, subject: 'x', html: '<p>hello</p>', text: null });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('sent');
  });
});

describe('POST /api/v1/email/send — an attachment\'s content is a string or a Buffer', () => {
  // Fixtures name no real file and no real host: the door must refuse before
  // anything could read them.
  const FILE_REF = 'attachment-fixture/never-read.txt';
  const URL_REF = 'http://127.0.0.1:9/never-fetched';

  /** Every refused shape a JSON body can carry, as `[what, attachments]`. */
  const REFUSED: Array<[string, unknown]> = [
    ['an object as content', [{ filename: 'a.txt', content: { a: 1 } }]],
    ['a `{ path }` object as content', [{ filename: 'a.txt', content: { path: FILE_REF } }]],
    ['an `{ href }` object as content', [{ filename: 'a.txt', content: { href: URL_REF } }]],
    ['a stream, as a JSON body carries one, as content', [{ filename: 'a.txt', content: { readable: true, _readableState: {} } }]],
    ['a typed array, as a JSON body carries one, as content', [{ filename: 'a.bin', content: JSON.parse(JSON.stringify(new Uint8Array([1, 2]))) }]],
    ['a Buffer\'s JSON form as content', [{ filename: 'a.bin', content: JSON.parse(JSON.stringify(Buffer.from('hi'))) }]],
    ['`null` content', [{ filename: 'a.txt', content: null }]],
    ['no content', [{ filename: 'a.txt' }]],
    ['a second attachment with an object as content', [{ filename: 'ok.txt', content: 'ok' }, { filename: 'b.txt', content: { path: FILE_REF } }]],
    ['a non-array `attachments` (an object)', { filename: 'a.txt', content: 'x' }],
    ['a non-array `attachments` (a string)', 'a.txt'],
    ['a `null` element', [null]],
  ];

  const MODES: Array<[string, () => EmailBootOptions]> = [
    ['persistence on', () => ({})],
    ['persistence off', () => ({ persist: false })],
    ['queue delivery on', () => ({ queue: fakeQueue() })],
  ];

  for (const [mode, options] of MODES) {
    for (const [what, attachments] of REFUSED) {
      it(`${mode} — ${what}: 400 VALIDATION_FAILED, the transport is never called, and no queued row`, async () => {
        const transport = { send: vi.fn(async () => ({ messageId: '<never@x>' })) };
        const opts = options();
        const { post, rows } = await boot({ ...opts, transport });
        const out = await post({ to: OK, subject: 'x', text: 'x', attachments });

        expect(out.status).toBe(400);
        expect(out.body.code).toBe('VALIDATION_FAILED');
        expect(String(out.body.error)).toMatch(/^`attachments(\[\d+\](\.content)?)?` must be /);
        // The refusal names the position and the kind, never the value.
        expect(String(out.body.error)).not.toContain(FILE_REF);
        expect(String(out.body.error)).not.toContain(URL_REF);
        expect(transport.send).not.toHaveBeenCalled();
        expect(rows.filter((r) => r.row.status === 'queued')).toEqual([]);
        expect(opts.queue?.published ?? []).toEqual([]);
      });
    }
  }

  it('names the index of the attachment it refuses', async () => {
    const { post } = await boot({ transport: { send: vi.fn(async () => ({ messageId: '<m@x>' })) } });
    const out = await post({
      to: OK, subject: 'x', text: 'x',
      attachments: [{ filename: 'ok.txt', content: 'ok' }, { filename: 'b.txt', content: { a: 1 } }],
    });

    expect(out.status).toBe(400);
    expect(String(out.body.error).startsWith('`attachments[1].content` must be a string or a Buffer, not ')).toBe(true);
  });

  it('CONTROL — a string attachment with a `cid` still sends (persistence on and off)', async () => {
    for (const opts of [{}, { persist: false }] as EmailBootOptions[]) {
      const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
      const { post } = await boot({ ...opts, transport });
      const out = await post({
        to: OK, subject: 'x', html: '<img src="cid:logo">',
        attachments: [{ filename: 'logo.txt', content: 'logo', cid: 'logo' }],
      });

      expect(out.status).toBe(200);
      expect(out.body.status).toBe('sent');
      expect(transport.send).toHaveBeenCalledTimes(1);
      expect((transport.send.mock.calls[0] as any[])[0].attachments).toEqual([
        { filename: 'logo.txt', content: 'logo', cid: 'logo' },
      ]);
    }
  });

  it('CONTROL — queue delivery on: a string attachment is queued, and the queued row is rebuilt and sent', async () => {
    const queue = fakeQueue();
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const { post, rows } = await boot({ transport, queue });
    const out = await post({
      to: OK, subject: 'x', html: '<img src="cid:logo">',
      attachments: [{ filename: 'logo.txt', content: 'logo', cid: 'logo' }],
    });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('queued');
    expect(transport.send).not.toHaveBeenCalled();
    expect(queue.published).toHaveLength(1);
    const job = queue.published[0]!;

    await queue.handlers[job.queue]!({ data: job.data, attempts: 1 });

    expect(transport.send).toHaveBeenCalledTimes(1);
    const [delivered] = transport.send.mock.calls[0] as any[];
    expect(delivered.attachments).toHaveLength(1);
    expect(delivered.attachments[0]).toMatchObject({ filename: 'logo.txt', cid: 'logo' });
    expect(String(delivered.attachments[0].content)).toBe('logo');
    expect(rows.find((r) => r.row.id === out.body.id)?.row.status).toBe('sent');
  });
});
