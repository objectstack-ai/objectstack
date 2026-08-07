// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SmsService, LogSmsTransport, maskPhoneNumber, normalizeSmsRecipient } from './sms-service.js';
import {
  SmsDailyQuota,
  SMS_QUOTA_EXCEEDED_CODE,
  SMS_QUOTA_EXCEEDED_ERROR,
} from './sms-daily-quota.js';

const collectingLogger = () => {
  const lines: string[] = [];
  return {
    lines,
    info: (msg: string) => { lines.push(String(msg)); },
    warn: (msg: string) => { lines.push(String(msg)); },
  };
};

describe('normalizeSmsRecipient', () => {
  it('accepts E.164 and strips human separators', () => {
    expect(normalizeSmsRecipient('+8613800000000')).toBe('+8613800000000');
    expect(normalizeSmsRecipient('+1 (500) 555-0006')).toBe('+15005550006');
    expect(normalizeSmsRecipient('138 0000 0000')).toBe('13800000000');
  });
  it('rejects garbage', () => {
    expect(normalizeSmsRecipient('bob@example.com')).toBeUndefined();
    expect(normalizeSmsRecipient('123')).toBeUndefined();
    expect(normalizeSmsRecipient('')).toBeUndefined();
  });
});

describe('maskPhoneNumber', () => {
  it('keeps prefix + last two digits only', () => {
    const masked = maskPhoneNumber('+8613812345678');
    expect(masked.startsWith('+8613')).toBe(true);
    expect(masked.endsWith('78')).toBe(true);
    expect(masked).not.toContain('12345');
  });
});

describe('SmsService', () => {
  it('sends through the transport and reports the provider id', async () => {
    const send = vi.fn(async () => ({ messageId: 'prov_1' }));
    const svc = new SmsService({ transport: { send }, configured: true });
    const r = await svc.send({ to: '+15005550006', body: 'hello' });
    expect(r.status).toBe('sent');
    expect(r.messageId).toBe('prov_1');
    expect(send).toHaveBeenCalledWith({ to: '+15005550006', body: 'hello' });
  });

  it('throws on an invalid recipient BEFORE the transport is called', async () => {
    const send = vi.fn();
    const svc = new SmsService({ transport: { send }, configured: true });
    await expect(svc.send({ to: 'not-a-phone', body: 'x' })).rejects.toThrow(/VALIDATION_FAILED/);
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves status:failed (not a throw) on transport errors', async () => {
    const svc = new SmsService({
      transport: { async send() { throw new Error('provider down'); } },
      configured: true,
    });
    const r = await svc.send({ to: '+15005550006', body: 'x' });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('provider down');
  });

  it('retries on transport throw when retries > 0', async () => {
    let calls = 0;
    const svc = new SmsService({
      transport: { async send() { if (++calls < 2) throw new Error('flaky'); return { messageId: 'ok' }; } },
      configured: true,
      retries: 1,
    });
    const r = await svc.send({ to: '+15005550006', body: 'x' });
    expect(r.status).toBe('sent');
    expect(calls).toBe(2);
  });

  it('never logs the message body (OTP red line, #2780)', async () => {
    const logger = collectingLogger();
    const svc = new SmsService({
      transport: { async send() { return { messageId: 'prov_1' }; } },
      configured: true,
      logger,
    });
    await svc.send({ to: '+8613812345678', body: '123456 is your code' });
    // also exercise the failure path
    svc.setTransport({ async send() { throw new Error('down'); } }, true);
    await svc.send({ to: '+8613812345678', body: '654321 is your code' });
    for (const line of logger.lines) {
      expect(line).not.toContain('123456');
      expect(line).not.toContain('654321');
      expect(line).not.toContain('13812345678'); // full number masked too
    }
  });

  it('surfaces isConfigured / setTransport upgrades', async () => {
    const svc = new SmsService({ transport: new LogSmsTransport(), configured: false });
    expect(svc.isConfigured()).toBe(false);
    svc.setTransport({ async send() { return { messageId: 'x' }; } }, true);
    expect(svc.isConfigured()).toBe(true);
  });
});

describe('LogSmsTransport', () => {
  it('suppresses the body in production', async () => {
    const logger = collectingLogger();
    const transport = new LogSmsTransport(logger);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await transport.send({ to: '+8613812345678', body: 'SECRET-999999' });
    } finally {
      process.env.NODE_ENV = prev;
    }
    expect(logger.lines.join('\n')).not.toContain('SECRET-999999');
    expect(logger.lines.join('\n')).toContain('body suppressed');
  });

  it('prints the body outside production (local OTP testing)', async () => {
    const logger = collectingLogger();
    const transport = new LogSmsTransport(logger);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      await transport.send({ to: '+8613812345678', body: 'code 424242' });
    } finally {
      process.env.NODE_ENV = prev;
    }
    expect(logger.lines.join('\n')).toContain('code 424242');
  });
});

describe('SmsService — the daily cost ceiling is charged HERE (#2814)', () => {
  const NOON = Date.UTC(2026, 7, 6, 12, 0, 0);
  const quotaOf = (limit: number, logger?: { info: any; warn: any }) => {
    const q = new SmsDailyQuota({ now: () => NOON, ...(logger ? { logger } : {}) });
    q.setQuota(limit);
    return q;
  };

  it('refuses past the ceiling with the per-number guard’s code and no quota detail', async () => {
    const send = vi.fn(async () => ({ messageId: 'prov_1' }));
    const svc = new SmsService({ transport: { send }, configured: true, dailyQuota: quotaOf(2) });

    expect((await svc.send({ to: '+8613800000001', body: 'a' })).status).toBe('sent');
    expect((await svc.send({ to: '+8613800000002', body: 'b' })).status).toBe('sent');

    const refused = await svc.send({ to: '+8613800000003', body: 'c' });
    expect(refused.status).toBe('failed');
    expect(refused.error).toBe(SMS_QUOTA_EXCEEDED_ERROR);
    expect(refused.error).toContain(SMS_QUOTA_EXCEEDED_CODE);
    // "不泄露配额剩余细节" — the refusal carries no numbers at all.
    expect(refused.error).not.toMatch(/\d/);
    expect(send).toHaveBeenCalledTimes(2); // the transport was never reached
  });

  it('counts EVERY caller against one budget — OTP, invitation and notification alike', async () => {
    const send = vi.fn(async () => ({ messageId: 'p' }));
    const svc = new SmsService({ transport: { send }, configured: true, dailyQuota: quotaOf(2) });
    // Three different call shapes, one budget: the point of moving the gate
    // into the service instead of the auth endpoints.
    await svc.send({ to: '+8613800000001', body: 'otp 123456', templateParams: { code: '123456' } });
    await svc.send({ to: '+8613800000002', body: 'invite', templateParams: { content: 'invite' } });
    const third = await svc.send({ to: '+8613800000003', body: 'notify', templateParams: { content: 'notify' } });
    expect(third.status).toBe('failed');
    expect(third.error).toContain(SMS_QUOTA_EXCEEDED_CODE);
  });

  it('does not spend a unit on input the service rejects outright', async () => {
    const send = vi.fn(async () => ({ messageId: 'p' }));
    const quota = quotaOf(1);
    const svc = new SmsService({ transport: { send }, configured: true, dailyQuota: quota });
    await expect(svc.send({ to: 'not-a-phone', body: 'x' })).rejects.toThrow(/VALIDATION_FAILED/);
    // The malformed call cost nothing, so the one budgeted send still gets through.
    expect((await svc.send({ to: '+8613800000001', body: 'x' })).status).toBe('sent');
  });

  it('logs the refusal with a MASKED recipient and never the body', async () => {
    const logger = collectingLogger();
    const svc = new SmsService({
      transport: { send: async () => ({ messageId: 'p' }) },
      configured: true,
      logger,
      dailyQuota: quotaOf(1),
    });
    await svc.send({ to: '+8613812345678', body: 'code 424242' });
    await svc.send({ to: '+8613812345678', body: 'code 999999' });
    const out = logger.lines.join('\n');
    expect(out).toContain('daily quota exhausted');
    expect(out).not.toContain('424242');
    expect(out).not.toContain('999999');
    expect(out).not.toContain('+8613812345678');
  });

  it('is entirely absent when no quota is wired (pre-#2814 behaviour)', async () => {
    const send = vi.fn(async () => ({ messageId: 'p' }));
    const svc = new SmsService({ transport: { send }, configured: true });
    for (let i = 0; i < 20; i++) {
      expect((await svc.send({ to: '+8613800000001', body: 'x' })).status).toBe('sent');
    }
    expect(send).toHaveBeenCalledTimes(20);
  });
});
