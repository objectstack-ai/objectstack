// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#5087 — what `EmailServicePlugin` is constructed with on the
 * `os serve` path, and specifically what happens when SMTP is selected.
 *
 * `OS_EMAIL_PROVIDER=smtp` used to be unreachable: the plugin knew three
 * providers (`log`/`resend`/`postmark`), so `smtp` fell into the "no apiKey"
 * arm and was silently rewritten to `log`. The server then booted "fine",
 * every send was recorded in `sys_email` as sent, and nothing left the box.
 * These pin the opposite: a complete SMTP configuration reaches the plugin,
 * and an incomplete one fails the boot instead of degrading into a transport
 * that reports success.
 */

import { describe, it, expect } from 'vitest';
import { resolveEmailCapabilityArg } from './serve.js';

describe('resolveEmailCapabilityArg', () => {
  it('defaults to the log provider when nothing is configured', () => {
    const { options, warning } = resolveEmailCapabilityArg({}, {});
    expect(options).toMatchObject({ provider: 'log' });
    expect(options).not.toHaveProperty('providerOptions');
    expect(warning).toBeUndefined();
  });

  it('assembles the SMTP connection from OS_EMAIL_SMTP_*', () => {
    const { options, warning } = resolveEmailCapabilityArg({}, {
      OS_EMAIL_PROVIDER: 'smtp',
      OS_EMAIL_SMTP_HOST: ' smtp.exmail.qq.com ',
      OS_EMAIL_SMTP_PORT: '465',
      OS_EMAIL_SMTP_SECURE: 'true',
      OS_EMAIL_SMTP_USER: 'ops@example.cn',
      OS_EMAIL_SMTP_PASSWORD: 'sekrit',
      OS_EMAIL_FROM: 'Acme <no-reply@example.cn>',
    });
    expect(warning).toBeUndefined();
    expect(options).toMatchObject({
      provider: 'smtp',
      providerOptions: {
        host: 'smtp.exmail.qq.com',
        port: 465,
        secure: true,
        user: 'ops@example.cn',
        password: 'sekrit',
      },
      defaultFrom: { name: 'Acme', address: 'no-reply@example.cn' },
    });
  });

  it('reads OS_EMAIL_SMTP_SECURE=false as plain-connect', () => {
    const { options } = resolveEmailCapabilityArg({}, {
      OS_EMAIL_PROVIDER: 'smtp',
      OS_EMAIL_SMTP_HOST: 'smtp.x',
      OS_EMAIL_SMTP_SECURE: 'false',
    });
    expect((options.providerOptions as any).secure).toBe(false);
    expect(resolveEmailCapabilityArg({}, {
      OS_EMAIL_PROVIDER: 'smtp', OS_EMAIL_SMTP_HOST: 'smtp.x', OS_EMAIL_SMTP_SECURE: '0',
    }).options.providerOptions).toMatchObject({ secure: false });
  });

  it('layers env over config.email.options', () => {
    const { options } = resolveEmailCapabilityArg(
      { provider: 'smtp', options: { host: 'smtp.config', port: 25 } },
      { OS_EMAIL_SMTP_HOST: 'smtp.env' },
    );
    expect(options.providerOptions).toEqual({ host: 'smtp.env', port: 25 });
  });

  it('accepts an SMTP host declared only in config.email.options', () => {
    const { options } = resolveEmailCapabilityArg({ provider: 'smtp', options: { host: 'smtp.config' } }, {});
    expect(options).toMatchObject({ provider: 'smtp', providerOptions: { host: 'smtp.config' } });
  });

  it('THROWS on provider=smtp without a host — never a silent LogTransport', () => {
    expect(() => resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'smtp' }))
      .toThrow(/no SMTP host is configured/);
    expect(() => resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'smtp', OS_EMAIL_SMTP_PORT: '587' }))
      .toThrow(/OS_EMAIL_SMTP_HOST/);
  });

  it('does not apply the apiKey fallback to smtp', () => {
    // The `resend`/`postmark` arm degrades to `log` when the key is missing;
    // smtp must never reach it (it needs no apiKey at all).
    const { options, warning } = resolveEmailCapabilityArg({}, {
      OS_EMAIL_PROVIDER: 'smtp',
      OS_EMAIL_SMTP_HOST: 'smtp.x',
    });
    expect(options.provider).toBe('smtp');
    expect(warning).toBeUndefined();
  });

  it('keeps the pre-existing resend/postmark behaviour', () => {
    const withKey = resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'resend', OS_EMAIL_API_KEY: 're_x' });
    expect(withKey.options).toMatchObject({ provider: 'resend', apiKey: 're_x' });
    expect(withKey.warning).toBeUndefined();

    const noKey = resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'postmark' });
    expect(noKey.options.provider).toBe('log');
    expect(noKey.warning).toMatch(/no apiKey found/);
  });

  it('still derives the fallback from-address and template context', () => {
    const { options } = resolveEmailCapabilityArg({}, { OS_APP_NAME: 'Acme CRM' }, 'ignored');
    expect(options.defaultTemplateContext).toMatchObject({ appName: 'Acme CRM' });
    expect(options.defaultFrom).toEqual({ name: 'Acme CRM', address: 'no-reply@acme-crm.local' });
  });
});
