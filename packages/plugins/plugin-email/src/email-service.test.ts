// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  EmailService,
  LogTransport,
  formatAddress,
  normalizeMessage,
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
});
