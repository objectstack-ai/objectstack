// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
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

// ── #11741 — sys_email organization stamping ────────────────────────────────
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
