// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import {
  EmailService,
  LogTransport,
  formatAddress,
  normalizeMessage,
  rowToNormalized,
  type EmailPersistence,
} from './email-service.js';

describe('formatAddress', () => {
  it('passes through bare addresses', () => {
    expect(formatAddress('alice@example.com')).toBe('alice@example.com');
  });
  it('quotes display names with reserved chars', () => {
    expect(formatAddress({ name: 'Alice, CEO', address: 'a@b.com' })).toBe('"Alice, CEO" <a@b.com>');
  });
  it('does not quote simple display names', () => {
    expect(formatAddress({ name: 'Alice', address: 'a@b.com' })).toBe('Alice <a@b.com>');
  });
  it('rejects malformed addresses', () => {
    expect(() => formatAddress('not-an-email')).toThrow(/Invalid email address/);
    expect(() => formatAddress({ address: '' })).toThrow(/Invalid email address/);
  });
});

describe('normalizeMessage', () => {
  it('requires subject', () => {
    expect(() => normalizeMessage({ to: 'a@b.com', text: 'hi', subject: '' } as any, 'no@reply.com'))
      .toThrow(/subject is required/);
  });
  it('requires text or html', () => {
    expect(() => normalizeMessage({ to: 'a@b.com', subject: 'Hi' } as any, 'no@reply.com'))
      .toThrow(/text or html/);
  });
  it('requires at least one recipient', () => {
    expect(() => normalizeMessage({ to: [] as any, subject: 'Hi', text: 'x' }, 'no@reply.com'))
      .toThrow(/recipient/);
  });
  it('requires from when no defaultFrom', () => {
    expect(() => normalizeMessage({ to: 'a@b.com', subject: 'Hi', text: 'x' }))
      .toThrow(/from address required/);
  });
  it('canonicalizes recipients and applies defaultFrom', () => {
    const msg = normalizeMessage(
      { to: ['a@b.com', { name: 'B', address: 'b@c.com' }], subject: 'Hi', text: 'x' },
      { name: 'No Reply', address: 'no@reply.com' },
    );
    expect(msg.to).toEqual(['a@b.com', 'B <b@c.com>']);
    expect(msg.from).toBe('No Reply <no@reply.com>');
  });
});

describe('normalizeMessage — a malformed CALLER address is the caller\'s VALIDATION_FAILED', () => {
  const FROM = 'no-reply@example.test';
  const base = { subject: 'Hi', text: 'x' };
  const refusal = (input: Record<string, unknown>) => {
    try {
      normalizeMessage({ ...base, ...input } as any, FROM);
    } catch (err) {
      return String((err as Error).message);
    }
    throw new Error('expected normalizeMessage to refuse the input');
  };

  it.each([
    ['a malformed `to`', { to: 'not-an-email' }, 'invalid recipient address in `to`: not-an-email'],
    ['an empty `to` string', { to: '' }, 'invalid recipient address in `to`: (empty)'],
    ['one bad member of a `to` list', { to: ['a@b.com', 'nope'] }, 'invalid recipient address in `to`: nope'],
    ['an object `to` with a bad address', { to: { name: 'A', address: 'a@localhost' } }, 'invalid recipient address in `to`: a@localhost'],
    ['a malformed `cc`', { to: 'a@b.com', cc: 'bad cc' }, 'invalid recipient address in `cc`: bad cc'],
    ['a malformed `bcc`', { to: 'a@b.com', bcc: ['c@d.com', 'x@'] }, 'invalid recipient address in `bcc`: x@'],
    ['a malformed `replyTo`', { to: 'a@b.com', replyTo: 'reply' }, 'invalid reply-to address in `replyTo`: reply'],
    [
      'a non-string display name',
      { to: 'a@b.com', cc: { name: 5, address: 'c@d.com' } },
      'invalid recipient address in `cc`: the display name of c@d.com must be a string',
    ],
  ])('%s is refused VALIDATION_FAILED, naming the field', (_label, input, reason) => {
    expect(refusal(input)).toBe(`VALIDATION_FAILED: ${reason}`);
  });

  it('a malformed CONFIGURED sender is NOT a VALIDATION_FAILED — it is the server\'s fault, not the caller\'s', () => {
    let message = '';
    try {
      normalizeMessage({ to: 'a@b.com', ...base }, { name: 'ObjectOS Local', address: 'noreply@localhost' });
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).toBe('Invalid email address: noreply@localhost');
    expect(message.startsWith('VALIDATION_FAILED')).toBe(false);
  });

  it('well-formed caller addresses in every field still normalize', () => {
    const msg = normalizeMessage(
      { ...base, to: ['a@b.com'], cc: 'c@d.com', bcc: { name: 'B', address: 'b@c.com' }, replyTo: 'r@s.com' },
      FROM,
    );
    expect(msg).toMatchObject({ to: ['a@b.com'], cc: ['c@d.com'], bcc: ['B <b@c.com>'], replyTo: 'r@s.com' });
  });

  it('EmailService.send rejects the same way, delivers nothing, and still records the rejection row', async () => {
    const rows: Array<Record<string, any>> = [];
    const persistence: EmailPersistence = {
      async insert(row) { rows.push({ ...row }); return { id: row.id }; },
      async update() { /* no-op */ },
    };
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const svc = new EmailService({ transport, defaultFrom: FROM, persistence });

    await expect(svc.send({ to: ['a@b.com', 'nope'], ...base }))
      .rejects.toThrow(/^VALIDATION_FAILED: invalid recipient address in `to`: nope$/);
    expect(transport.send).not.toHaveBeenCalled();
    // Unchanged by the reclassification: a pre-delivery refusal is still an
    // audit row at `failed`, never a re-deliverable `queued` one.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', attempt_count: 0 });
    expect(String(rows[0].error)).toContain('invalid recipient address in `to`: nope');
  });
});

describe('normalizeMessage — a non-string subject / text / html is the caller\'s VALIDATION_FAILED', () => {
  const FROM = 'no-reply@example.test';
  const refusal = (input: Record<string, unknown>) => {
    try {
      normalizeMessage({ to: 'a@b.com', ...input } as any, FROM);
    } catch (err) {
      return String((err as Error).message);
    }
    throw new Error('expected normalizeMessage to refuse the input');
  };

  it.each([
    ['`html` as a number', { subject: 'x', html: 123 }, 'html'],
    ['`text` as an object', { subject: 'x', text: { a: 1 } }, 'text'],
    ['`subject` as an object', { subject: { a: 1 }, html: 'hello' }, 'subject'],
    ['`subject` as a number', { subject: 42, text: 'hello' }, 'subject'],
    ['`html` as an array beside a string `text`', { subject: 'x', text: 'ok', html: ['<p>'] }, 'html'],
    ['`text` as a falsy non-string (0) beside a string `html`', { subject: 'x', html: 'ok', text: 0 }, 'text'],
  ])('%s is refused VALIDATION_FAILED, naming the field', (_label, input, field) => {
    const message = refusal(input);
    expect(message.startsWith('VALIDATION_FAILED: ')).toBe(true);
    expect(message.slice('VALIDATION_FAILED: '.length).startsWith(`\`${field}\` `)).toBe(true);
  });

  // An object whose own `toString` is not callable makes `String()` THROW, so
  // the rejection row's writer must not coerce it — else a TypeError replaces
  // the caller's VALIDATION_FAILED and no row is written.
  it.each([
    ['an object whose toString is not callable', { toString: 1 }],
    ['an array holding such an object', [{ toString: 1 }]],
  ])('`subject` as %s: send() rejects VALIDATION_FAILED naming `subject`, and the rejection row is written', async (_label, subject) => {
    const rows: Array<Record<string, any>> = [];
    const persistence: EmailPersistence = {
      async insert(row) { rows.push({ ...row }); return { id: row.id }; },
      async update() { /* no-op */ },
    };
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const svc = new EmailService({ transport, defaultFrom: FROM, persistence });

    await expect(svc.send({ to: 'a@b.com', subject, html: 'hello' } as any)).rejects.toThrow(/^VALIDATION_FAILED: `subject` /);
    expect(transport.send).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', attempt_count: 0, subject: '(none)' });
  });

  it('EmailService.send refuses before any transport call, and still records the rejection row', async () => {
    const rows: Array<Record<string, any>> = [];
    const persistence: EmailPersistence = {
      async insert(row) { rows.push({ ...row }); return { id: row.id }; },
      async update() { /* no-op */ },
    };
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const svc = new EmailService({ transport, defaultFrom: FROM, persistence });

    await expect(svc.send({ to: 'a@b.com', subject: 'x', html: 123 } as any)).rejects.toThrow(/^VALIDATION_FAILED: `html` /);
    expect(transport.send).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', attempt_count: 0 });
    expect(rows[0]).not.toHaveProperty('body_html');
  });

  // CONTROL — what was legal stays legal: absence (`undefined` / `null`) is
  // judged by the presence checks exactly as before, never as a wrong type.
  it('string fields still normalize, and a null or absent body beside a string one is still accepted', () => {
    expect(normalizeMessage({ to: 'a@b.com', subject: ' Hi ', text: 't', html: '<p>h</p>' }, FROM))
      .toMatchObject({ subject: 'Hi', text: 't', html: '<p>h</p>' });
    expect(() => normalizeMessage({ to: 'a@b.com', subject: 'Hi', html: '<p>h</p>', text: null } as any, FROM))
      .not.toThrow();
    expect(() => normalizeMessage({ to: 'a@b.com', subject: 'Hi', text: 't', html: null } as any, FROM))
      .not.toThrow();
    expect(() => normalizeMessage({ to: 'a@b.com', subject: 'Hi', text: 't' }, FROM)).not.toThrow();
  });

  it('an absent subject or body is still the presence refusal, not a type refusal', () => {
    expect(refusal({ subject: null, text: 'x' })).toBe('VALIDATION_FAILED: subject is required');
    expect(refusal({ subject: 'x', text: null, html: null })).toBe('VALIDATION_FAILED: at least one of text or html is required');
    expect(refusal({ subject: 'x', text: '', html: '' })).toBe('VALIDATION_FAILED: at least one of text or html is required');
  });
});

describe('LogTransport', () => {
  it('returns a synthetic Message-ID and logs', async () => {
    const logger = { info: vi.fn() };
    const t = new LogTransport(logger);
    const res = await t.send({ to: ['a@b.com'], from: 'x@y.com', subject: 'Hi', text: 'hello' });
    expect(res.messageId).toMatch(/^<dev-/);
    expect(logger.info).toHaveBeenCalledWith('[LogTransport] would send email', expect.objectContaining({
      subject: 'Hi', to: ['a@b.com'],
    }));
  });
});

describe('EmailService.isConfigured — does mail sent through it get delivered', () => {
  const live = () => ({ send: vi.fn(async () => ({ messageId: '<m@x>' })) });

  it('answers false while the transport is the LogTransport', () => {
    const svc = new EmailService({ transport: new LogTransport(), defaultFrom: 'no@reply.com' });
    expect(svc.isConfigured()).toBe(false);
  });

  it('answers true for a live (non-log) transport', () => {
    const svc = new EmailService({ transport: live(), defaultFrom: 'no@reply.com' });
    expect(svc.isConfigured()).toBe(true);
  });

  it('follows a runtime transport swap in both directions', () => {
    const svc = new EmailService({ transport: new LogTransport(), defaultFrom: 'no@reply.com' });
    expect(svc.isConfigured()).toBe(false);
    svc.setTransport(live());
    expect(svc.isConfigured()).toBe(true);
    svc.setTransport(new LogTransport());
    expect(svc.isConfigured()).toBe(false);
  });
});

describe('EmailService.getDefaultFrom — the configured sender the REST send door bounds `from` to', () => {
  it('answers the constructor sender, follows setDefaultFrom, and is undefined when none is configured', () => {
    const svc = new EmailService({ transport: new LogTransport(), defaultFrom: 'no@reply.com' });
    expect(svc.getDefaultFrom()).toBe('no@reply.com');
    svc.setDefaultFrom({ name: 'Ops', address: 'ops@reply.com' });
    expect(svc.getDefaultFrom()).toEqual({ name: 'Ops', address: 'ops@reply.com' });
    svc.setDefaultFrom(undefined);
    expect(svc.getDefaultFrom()).toBeUndefined();
  });
});

describe('EmailService', () => {
  function makePersistence() {
    const rows = new Map<string, Record<string, any>>();
    const p: EmailPersistence = {
      async insert(row) { rows.set(row.id, { ...row }); return { id: row.id }; },
      async update(id, patch) {
        const cur = rows.get(id);
        if (cur) rows.set(id, { ...cur, ...patch });
      },
    };
    return { p, rows };
  }

  it('sends successfully, persists queued+sent rows', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m1@x>' })) };
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence: p });
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'hello', relatedObject: 'lead', relatedId: 'L1' });
    expect(res.status).toBe('sent');
    expect(res.messageId).toBe('<m1@x>');
    expect(transport.send).toHaveBeenCalledTimes(1);
    const row = rows.get(res.id);
    expect(row).toMatchObject({
      status: 'sent',
      message_id: '<m1@x>',
      from_address: 'no@reply.com',
      to_addresses: 'a@b.com',
      related_object: 'lead',
      related_id: 'L1',
      attempt_count: 1,
    });
    expect(typeof row?.sent_at).toBe('string');
  });

  it('marks failed when transport throws past retry budget', async () => {
    const transport = { send: vi.fn(async () => { throw new Error('smtp 421'); }) };
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence: p, retries: 1 });
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });
    expect(transport.send).toHaveBeenCalledTimes(2); // 1 + 1 retry
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/smtp 421/);
    expect(rows.get(res.id)).toMatchObject({ status: 'failed', attempt_count: 2 });
  });

  it('works without persistence', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com' });
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });
    expect(res.status).toBe('sent');
    expect(res.id).toMatch(/[0-9a-f-]{30,}/);
  });

  it('propagates validation errors instead of marking failed', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com' });
    await expect(svc.send({ to: 'a@b.com', subject: '', text: 'x' })).rejects.toThrow(/subject is required/);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('tolerates persistence failures and still delivers', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const persistence: EmailPersistence = {
      insert: vi.fn(async () => { throw new Error('db down'); }),
      update: vi.fn(async () => { throw new Error('db down'); }),
    };
    const warn = vi.fn();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence,
      logger: { info: vi.fn(), warn },
    });
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });
    expect(res.status).toBe('sent');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('persist failed'), expect.any(Object));
  });

  it('sends nothing when the caller requires the log row and it cannot be written', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const failing: EmailPersistence = {
      insert: vi.fn(async () => { throw new Error('db down'); }),
      update: vi.fn(async () => {}),
    };
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence: failing, logger: { info: vi.fn(), warn: vi.fn() } });
    await expect(svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x', requireLogRow: true })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
    });
    const none = new EmailService({ transport, defaultFrom: 'no@reply.com' });
    await expect(none.send({ to: 'a@b.com', subject: 'Hi', text: 'x', requireLogRow: true })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(transport.send).not.toHaveBeenCalled();

    const { p, rows } = makePersistence();
    const logged = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence: p });
    const res = await logged.send({ to: 'a@b.com', subject: 'Hi', text: 'x', requireLogRow: true });
    expect(res.status).toBe('sent');
    expect(rows.get(res.id)).toMatchObject({ status: 'sent' });
  });

  it('delivers a row the service did not write from the configured sender, with no sender header of its own', async () => {
    const sent: any[] = [];
    const transport = { send: vi.fn(async (m: any) => { sent.push(m); return { messageId: '<m@x>' }; }) };
    const { p, rows } = makePersistence();
    rows.set('r1', { id: 'r1', status: 'queued' });
    const svc = new EmailService({ transport, defaultFrom: { name: 'Acme', address: 'noreply@acme.test' }, persistence: p });
    const res = await svc.deliverPersistedRow(
      {
        id: 'r1',
        status: 'queued',
        from_address: 'ceo@acme.test',
        to_addresses: 'pat@example.test',
        subject: 'Hi',
        body_text: 'x',
        headers_json: JSON.stringify({ Sender: 'ceo@acme.test', 'X-Campaign': 'q4' }),
      },
      { asConfiguredSender: true },
    );
    expect(res.status).toBe('sent');
    expect(sent[0].from).toBe('Acme <noreply@acme.test>');
    expect(sent[0].headers).toEqual({ 'X-Campaign': 'q4' });

    const unconfigured = new EmailService({ transport, persistence: p });
    rows.set('r2', { id: 'r2', status: 'queued' });
    const failed = await unconfigured.deliverPersistedRow(
      { id: 'r2', status: 'queued', from_address: 'ceo@acme.test', to_addresses: 'pat@example.test', subject: 'Hi', body_text: 'x' },
      { asConfiguredSender: true },
    );
    expect(failed.status).toBe('failed');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  // ── Outbox-drain support (sys_email afterInsert) ───────────────────
  it('marks its own row managed during send() so the drain hook skips it', async () => {
    // The persistence.insert callback fires at exactly the moment the
    // afterInsert drain hook would fire — assert the row is flagged managed
    // there, and unflagged once send() resolves.
    let managedAtInsert: boolean | undefined;
    let managedDuringDelivery: boolean | undefined;
    let insertedId: string | undefined;
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    let svc!: EmailService;
    const persistence: EmailPersistence = {
      async insert(row) {
        insertedId = String(row.id);
        managedAtInsert = svc.isServiceManaged(insertedId);
        return { id: row.id };
      },
      async update(id) {
        // The `sent` finalize runs INSIDE send(), i.e. while this row is still
        // send()'s to deliver — the window the managed flag exists to protect
        // must NOT shrink. (Inherited from the #5169 test this file used to
        // carry on the insert-assigned-id path; that path is now a contract
        // violation, so the fact is pinned here, on the compliant one.)
        managedDuringDelivery = svc.isServiceManaged(String(id));
      },
    };
    svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence });
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });
    expect(res.status).toBe('sent');
    expect(managedAtInsert).toBe(true);                 // hook would skip it
    expect(managedDuringDelivery).toBe(true);           // window kept through finalize
    expect(svc.isServiceManaged(insertedId!)).toBe(false); // cleared after send
  });

  // ── EmailPersistence.insert id contract (#5523) ────────────────────
  //
  // Re-judged from #5169's "releases an insert-ASSIGNED row id" test. That test
  // pinned the *leak fix* on a capability — `insert` answering with an id of its
  // own — that is now a contract violation, so the leak has no source left to
  // fix. Same scenario, opposite verdict: rejected, by name, before delivery.
  it('rejects an insert that returns a DIFFERENT id, naming the contract, before delivering', async () => {
    // The double-send this closes: the sys_email afterInsert drain hook asks
    // `isServiceManaged(hookCtx.result.id)` — the INSERTED row's id. A
    // persistence that re-keys the row hands the hook an id send() never
    // reserved, the hook reads the row as an app-inserted outbox entry and
    // delivers it, and send() delivers it again down its own path.
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const update = vi.fn(async () => { /* noop */ });
    const persistence: EmailPersistence = {
      // Ignores the minted id and hands back a DB primary key of its own.
      async insert() { return { id: 'db-pk-7' }; },
      update,
    };
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence });

    await expect(svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' }))
      .rejects.toThrow(/EmailPersistence\.insert must return the row's own id/);

    // Names the value actually returned, so the operator can find the
    // implementation that returned it.
    await expect(svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' }))
      .rejects.toThrow(/'db-pk-7'/);

    // BEFORE delivery — not "double-send, then complain". This is the whole
    // point of where the check sits: nothing was sent, nothing was finalized.
    expect(transport.send).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    // And the throw does not leak the reservation — the `finally` still runs.
    expect(svc.isServiceManaged('db-pk-7')).toBe(false);
  });

  it('accepts the bare-string confirmation form when it names the row id', async () => {
    // `insert` may answer `row.id` instead of `{ id: row.id }` — same
    // confirmation, and it must not be mistaken for a substitution.
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const persistence: EmailPersistence = {
      async insert(row) { return String(row.id); },
      async update() { /* noop */ },
    };
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence });

    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });

    expect(res.status).toBe('sent');
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(svc.isServiceManaged(res.id)).toBe(false);
  });

  it('rejects a bare-string confirmation that names a different id', async () => {
    // The string form is the same contract, not a loophole around it.
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const persistence: EmailPersistence = {
      async insert() { return 'db-pk-8'; },
      async update() { /* noop */ },
    };
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence });

    await expect(svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' }))
      .rejects.toThrow(/EmailPersistence\.insert must return the row's own id/);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('treats a confirmation that names NO id as confirming the row it inserted', async () => {
    // Only reachable from an untyped JS implementation (the declared return
    // type requires an id). There is no id to disagree with, and the drain hook
    // reads the id off the inserted ROW — the minted one — so no double-send is
    // reachable this way. The check judges the VALUE, not its presence, and an
    // insert that silently returned nothing must not stop the mail.
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const persistence = {
      async insert() { /* returns undefined */ },
      async update() { /* noop */ },
    } as unknown as EmailPersistence;
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence });

    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });

    expect(res.status).toBe('sent');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('still rides out an insert that THROWS — an operational failure, not a contract violation', async () => {
    // The two must stay distinguishable: a failing insert keeps its non-fatal
    // warning path (mail goes inline), while a *renaming* insert is fatal. If
    // the contract check ever moved inside the insert's catch, this test would
    // still pass and the rejection test above would go green for the wrong
    // reason — hence both, side by side.
    const transport = { send: vi.fn(async () => ({ messageId: '<m@x>' })) };
    const warn = vi.fn();
    const persistence: EmailPersistence = {
      async insert() { throw new Error('db down'); },
      async update() { /* noop */ },
    };
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence,
      logger: { info: vi.fn(), warn },
    });

    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });

    expect(res.status).toBe('sent');
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('persist failed'), expect.any(Object));
  });

  it('deliverPersistedRow delivers an existing row WITHOUT inserting a new one', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<drained@x>' })) };
    const { p, rows } = makePersistence();
    const insertSpy = vi.spyOn(p, 'insert');
    const svc = new EmailService({ transport, persistence: p });
    // Simulate an app-inserted outbox row.
    const row = {
      id: 'row-1', status: 'queued', from_address: 'no@reply.com',
      to_addresses: 'a@b.com, c@d.com', subject: 'Drain me', body_text: 'hello',
    };
    rows.set(row.id, { ...row });
    const res = await svc.deliverPersistedRow(row);
    expect(res).toMatchObject({ id: 'row-1', status: 'sent', messageId: '<drained@x>' });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['a@b.com', 'c@d.com'], from: 'no@reply.com', subject: 'Drain me', text: 'hello',
    }));
    expect(insertSpy).not.toHaveBeenCalled();           // never inserts a 2nd row
    expect(rows.get('row-1')).toMatchObject({ status: 'sent', message_id: '<drained@x>' });
  });

  it('deliverPersistedRow marks the row failed when it lacks a body', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<x>' })) };
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport, persistence: p });
    rows.set('row-2', { id: 'row-2', status: 'queued', from_address: 'a@b.com', to_addresses: 'c@d.com', subject: 'No body' });
    const res = await svc.deliverPersistedRow({ id: 'row-2', from_address: 'a@b.com', to_addresses: 'c@d.com', subject: 'No body' });
    expect(res.status).toBe('failed');
    expect(transport.send).not.toHaveBeenCalled();
    expect(rows.get('row-2')).toMatchObject({ status: 'failed' });
  });
});

describe('rowToNormalized', () => {
  it('reconstructs a message from persisted columns', () => {
    const msg = rowToNormalized({
      to_addresses: 'a@b.com, "B" <b@c.com>', from_address: 'no@reply.com',
      subject: 'Hi', body_text: 'text', body_html: '<p>html</p>',
      cc_addresses: 'cc@x.com', bcc_addresses: 'bcc@x.com', reply_to: 'r@x.com',
    });
    expect(msg).toEqual({
      to: ['a@b.com', '"B" <b@c.com>'], from: 'no@reply.com', subject: 'Hi',
      text: 'text', html: '<p>html</p>', cc: ['cc@x.com'], bcc: ['bcc@x.com'], replyTo: 'r@x.com',
    });
  });
  it('throws on missing to/from/subject/body', () => {
    expect(() => rowToNormalized({ from_address: 'a@b.com', subject: 'x', body_text: 'y' })).toThrow(/to_addresses/);
    expect(() => rowToNormalized({ to_addresses: 'a@b.com', subject: 'x', body_text: 'y' })).toThrow(/from_address/);
    expect(() => rowToNormalized({ to_addresses: 'a@b.com', from_address: 'c@d.com', body_text: 'y' })).toThrow(/subject/);
    expect(() => rowToNormalized({ to_addresses: 'a@b.com', from_address: 'c@d.com', subject: 'x' })).toThrow(/body/);
  });
});

// ── Commit b706af987 — sys_email organization stamping ──────────────────────
// The writer runs under a constant SYSTEM context, so the ONLY organization a
// row can carry is the one the input carries: `SendEmailInput.organizationId`
// is stamped onto `sys_email.organization_id` verbatim (pass-through), and its
// absence writes nothing — never refused, never resolved, never fabricated
// (a wrong organization is silently authoritative to every org-filtered
// report/export, which is worse than a null).
describe('sys_email organization stamping (#11741)', () => {
  function makePersistence() {
    const rows = new Map<string, Record<string, any>>();
    const p: EmailPersistence = {
      async insert(row) { rows.set(row.id, { ...row }); return { id: row.id }; },
      async update(id, patch) {
        const cur = rows.get(id);
        if (cur) rows.set(id, { ...cur, ...patch });
      },
    };
    return { p, rows };
  }

  it("send() stamps input.organizationId onto the row's organization_id (identity pin)", async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m1@x>' })) };
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence: p });
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x', organizationId: 'org_apex' });
    expect(res.status).toBe('sent');
    const row = rows.get(res.id);
    expect(row?.organization_id).toBe('org_apex');
    // The stamp survives the terminal update (sent_at/status patch does not
    // rewrite it).
    expect(row?.status).toBe('sent');
  });

  it('over-denial control: an org-less send writes NO organization_id and is not refused', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m2@x>' })) };
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence: p });
    const res = await svc.send({ to: 'a@b.com', subject: 'Hi', text: 'x' });
    expect(res.status).toBe('sent');
    expect(rows.get(res.id)).not.toHaveProperty('organization_id');
  });
});

describe('an attachment\'s content is a string or a Buffer', () => {
  const BASE = { to: 'a@b.com', subject: 'Hi', text: 'x' };
  const FILE_REF = 'attachment-fixture/never-read.txt';
  const URL_REF = 'http://127.0.0.1:9/never-fetched';

  /** Every refused shape an in-process caller can pass, with the kind the refusal names. */
  const REFUSED: Array<[string, unknown, RegExp]> = [
    ['an object', [{ filename: 'a', content: { a: 1 } }], /^VALIDATION_FAILED: `attachments\[0\]\.content` must be a string or a Buffer, not an object$/],
    ['a `{ path }` object', [{ filename: 'a', content: { path: FILE_REF } }], /`attachments\[0\]\.content` must be a string or a Buffer, not an object$/],
    ['an `{ href }` object', [{ filename: 'a', content: { href: URL_REF } }], /`attachments\[0\]\.content` must be a string or a Buffer, not an object$/],
    ['a stream', [{ filename: 'a', content: Readable.from(['x']) }], /`attachments\[0\]\.content` must be a string or a Buffer, not a stream$/],
    ['a typed array', [{ filename: 'a', content: new Uint8Array([1, 2]) }], /`attachments\[0\]\.content` must be a string or a Buffer, not a typed array$/],
    ['an ArrayBuffer', [{ filename: 'a', content: new ArrayBuffer(2) }], /`attachments\[0\]\.content` must be a string or a Buffer, not an ArrayBuffer$/],
    ['a number', [{ filename: 'a', content: 42 }], /`attachments\[0\]\.content` must be a string or a Buffer, not a number$/],
    ['`null` content', [{ filename: 'a', content: null }], /`attachments\[0\]\.content` must be a string or a Buffer, not null$/],
    ['absent content', [{ filename: 'a' }], /`attachments\[0\]\.content` must be a string or a Buffer, not undefined$/],
    ['a second attachment', [{ filename: 'a', content: 'ok' }, { filename: 'b', content: { path: FILE_REF } }], /`attachments\[1\]\.content` must be/],
    ['a non-array `attachments`', { filename: 'a', content: 'x' }, /^VALIDATION_FAILED: `attachments` must be an array, not an object$/],
    ['a string `attachments`', 'a.txt', /^VALIDATION_FAILED: `attachments` must be an array, not a string$/],
    ['a `null` element', [null], /^VALIDATION_FAILED: `attachments\[0\]` must be a plain object, not null$/],
    ['a class-instance element', [new (class Att { filename = 'a'; content = 'x'; })()], /^VALIDATION_FAILED: `attachments\[0\]` must be a plain object, not a class instance$/],
  ];

  for (const [what, attachments, refusal] of REFUSED) {
    it(`normalizeMessage refuses ${what}, naming the position and the kind and never the value`, () => {
      let thrown: unknown;
      try { normalizeMessage({ ...BASE, attachments } as any, 'no@reply.com'); } catch (err) { thrown = err; }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toMatch(refusal);
      expect(message).not.toContain(FILE_REF);
      expect(message).not.toContain(URL_REF);
    });
  }

  it('accepts a string, a Buffer, an empty list and an absent or null `attachments`', () => {
    const png = Buffer.from([0x89, 0x50]);
    const msg = normalizeMessage({
      ...BASE,
      attachments: [{ filename: 't.txt', content: 'hi' }, { filename: 'p.png', content: png, cid: 'p' }],
    }, 'no@reply.com');
    expect(msg.attachments).toHaveLength(2);
    expect(msg.attachments![1]!.content).toBe(png);
    expect(normalizeMessage({ ...BASE, attachments: [] }, 'no@reply.com').attachments).toBeUndefined();
    expect(normalizeMessage({ ...BASE }, 'no@reply.com').attachments).toBeUndefined();
    expect(normalizeMessage({ ...BASE, attachments: null } as any, 'no@reply.com').attachments).toBeUndefined();
  });

  for (const persist of [true, false]) {
    it(`send (persistence ${persist ? 'on' : 'off'}) refuses before a non-SMTP transport is called and writes no queued row`, async () => {
      const transport = { send: vi.fn(async () => ({ messageId: '<never@x>' })) };
      const rows: Array<Record<string, any>> = [];
      const persistence: EmailPersistence = {
        async insert(row) { rows.push({ ...row }); return { id: row.id }; },
        async update() { /* noop */ },
      };
      const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', ...(persist ? { persistence } : {}) });

      for (const content of [{ path: FILE_REF }, Readable.from(['x']), new Uint8Array([1])]) {
        await expect(svc.send({ ...BASE, attachments: [{ filename: 'a', content: content as never }] }))
          .rejects.toThrow(/^VALIDATION_FAILED: `attachments\[0\]\.content` must be a string or a Buffer/);
      }

      expect(transport.send).not.toHaveBeenCalled();
      expect(rows.filter((r) => r.status === 'queued')).toEqual([]);
      if (persist) expect(rows.map((r) => r.status)).toEqual(['failed', 'failed', 'failed']);
    });
  }
});
