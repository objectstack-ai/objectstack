// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { AliyunSmsTransport } from './aliyun.js';
import { TwilioSmsTransport } from './twilio.js';
import { makeSmsTransport, SMS_TRANSPORT_PROVIDERS, isSmsTransportProvider } from './index.js';
import { LogSmsTransport } from '../sms-service.js';

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  }) as any;

describe('AliyunSmsTransport', () => {
  const base = {
    accessKeyId: 'ak',
    accessKeySecret: 'secret',
    signName: '测试签名',
    defaultTemplateCode: 'SMS_123',
  };

  it('requires credentials + sign name', () => {
    expect(() => new AliyunSmsTransport({ ...base, accessKeyId: '' } as any)).toThrow(/accessKeyId/);
    expect(() => new AliyunSmsTransport({ ...base, signName: '' } as any)).toThrow(/signName/);
  });

  it('sends a signed SendSms request with template params', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ Code: 'OK', BizId: 'biz_1', RequestId: 'req_1' }));
    const t = new AliyunSmsTransport({ ...base, fetchImpl: fetchImpl as any });
    const r = await t.send({ to: '+8613800000000', body: 'ignored', templateParams: { code: '123456' } });
    expect(r.messageId).toBe('biz_1');

    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(String(url)).toContain('https://dysmsapi.aliyuncs.com/?');
    expect(String(url)).toContain('PhoneNumbers=%2B8613800000000');
    expect(String(url)).toContain('TemplateCode=SMS_123');
    expect(decodeURIComponent(String(url))).toContain('{"code":"123456"}');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toMatch(/^ACS3-HMAC-SHA256 Credential=ak,SignedHeaders=host;x-acs-action;/);
    expect(init.headers['x-acs-action']).toBe('SendSms');
    expect(init.headers['x-acs-version']).toBe('2017-05-25');
  });

  it('falls back to { content: body } for the default catch-all template', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ Code: 'OK', BizId: 'b' }));
    const t = new AliyunSmsTransport({ ...base, fetchImpl: fetchImpl as any });
    await t.send({ to: '13800000000', body: 'hello world' });
    expect(decodeURIComponent(String(fetchImpl.mock.calls[0][0]))).toContain('{"content":"hello world"}');
  });

  it('throws when no template code is available (Aliyun is template-only)', async () => {
    const t = new AliyunSmsTransport({ ...base, defaultTemplateCode: undefined, fetchImpl: vi.fn() as any });
    await expect(t.send({ to: '13800000000', body: 'x' })).rejects.toThrow(/template/);
  });

  it('maps a non-OK Code to a thrown error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ Code: 'isv.BUSINESS_LIMIT_CONTROL', Message: 'limit' }));
    const t = new AliyunSmsTransport({ ...base, fetchImpl: fetchImpl as any });
    await expect(t.send({ to: '13800000000', body: 'x' })).rejects.toThrow(/BUSINESS_LIMIT_CONTROL/);
  });
});

describe('TwilioSmsTransport', () => {
  const base = { accountSid: 'AC123', authToken: 'tok', from: '+15005550006' };

  it('requires credentials and a sender', () => {
    expect(() => new TwilioSmsTransport({ ...base, authToken: '' } as any)).toThrow(/accountSid and authToken/);
    expect(() => new TwilioSmsTransport({ accountSid: 'AC123', authToken: 'tok' } as any)).toThrow(/from/);
  });

  it('POSTs the Messages resource with Basic auth + form body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sid: 'SM1', status: 'queued' }, 201));
    const t = new TwilioSmsTransport({ ...base, fetchImpl: fetchImpl as any });
    const r = await t.send({ to: '+15005550009', body: 'hi there' });
    expect(r.messageId).toBe('SM1');

    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(String(url)).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    const form = new URLSearchParams(init.body);
    expect(form.get('To')).toBe('+15005550009');
    expect(form.get('Body')).toBe('hi there');
    expect(form.get('From')).toBe('+15005550006');
  });

  it('prefers MessagingServiceSid over From when configured', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sid: 'SM2' }, 201));
    const t = new TwilioSmsTransport({ accountSid: 'AC123', authToken: 'tok', messagingServiceSid: 'MG9', fetchImpl: fetchImpl as any });
    await t.send({ to: '+15005550009', body: 'x' });
    const form = new URLSearchParams((fetchImpl.mock.calls[0] as any[])[1].body);
    expect(form.get('MessagingServiceSid')).toBe('MG9');
    expect(form.get('From')).toBeNull();
  });

  it('maps an error response to a thrown error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 21211, message: 'invalid To' }, 400));
    const t = new TwilioSmsTransport({ ...base, fetchImpl: fetchImpl as any });
    await expect(t.send({ to: '+1', body: 'x' })).rejects.toThrow(/21211.*invalid To/);
  });
});

describe('makeSmsTransport', () => {
  it('builds by provider tag', () => {
    expect(makeSmsTransport({ provider: 'log' })).toBeInstanceOf(LogSmsTransport);
    expect(makeSmsTransport({ provider: 'aliyun', options: { accessKeyId: 'a', accessKeySecret: 'b', signName: 'c' } }))
      .toBeInstanceOf(AliyunSmsTransport);
    expect(makeSmsTransport({ provider: 'twilio', options: { accountSid: 'a', authToken: 'b', from: '+1' } }))
      .toBeInstanceOf(TwilioSmsTransport);
    expect(() => makeSmsTransport({ provider: 'nope' as any })).toThrow(/unknown provider/);
  });
});

// #5713 — the vocabulary the CLI's `sms` capability arm judges OS_SMS_PROVIDER
// against. It has to be *this* list and not a copy of it: two literals for one
// vocabulary is how the mail dropdown and the mail transports drifted (#5094).
describe('SMS_TRANSPORT_PROVIDERS / isSmsTransportProvider', () => {
  it('names exactly the tags makeSmsTransport can build', () => {
    expect([...SMS_TRANSPORT_PROVIDERS]).toEqual(['log', 'aliyun', 'twilio']);
    // Every member builds (given credentials) — none is an aspiration.
    const credentials: Record<string, Record<string, unknown>> = {
      log: {},
      aliyun: { accessKeyId: 'a', accessKeySecret: 'b', signName: 'c' },
      twilio: { accountSid: 'a', authToken: 'b', from: '+1' },
    };
    for (const provider of SMS_TRANSPORT_PROVIDERS) {
      expect(() => makeSmsTransport({ provider, options: credentials[provider] }), provider).not.toThrow();
    }
  });

  it('narrows a provider string, rejecting the typo that used to reach makeSmsTransport', () => {
    for (const provider of SMS_TRANSPORT_PROVIDERS) expect(isSmsTransportProvider(provider)).toBe(true);
    // `twilo` is the specimen from #5713: a plausible misspelling of a real
    // provider, which used to pass the boot path untouched, throw inside
    // makeSmsTransport, get caught, and become LogSmsTransport.
    expect(isSmsTransportProvider('twilo')).toBe(false);
    expect(() => makeSmsTransport({ provider: 'twilo' as any })).toThrow(/unknown provider 'twilo'/);
    // Non-strings and near-misses are rejected too — the guard is what stands
    // between an operator's env value and an `as SmsProviderTag` cast.
    for (const bad of ['', 'LOG', 'sms', undefined, null, 42, {}]) {
      expect(isSmsTransportProvider(bad), String(bad)).toBe(false);
    }
  });
});
