// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * framework#5087 / #5132 — what `EmailServicePlugin` is constructed with on the
 * `os serve` path, and what happens when the configuration cannot deliver.
 *
 * `OS_EMAIL_PROVIDER=smtp` used to be unreachable: the plugin knew three
 * providers (`log`/`resend`/`postmark`), so `smtp` fell into the "no apiKey"
 * arm and was silently rewritten to `log`. The server then booted "fine",
 * every send was recorded in `sys_email` as sent, and nothing left the box.
 * #5087 closed that for `smtp`; the same arm went on doing it to `resend` /
 * `postmark` until #5132.
 *
 * These pin the invariant in one piece: a complete configuration reaches the
 * plugin unchanged, and an incomplete one throws — for every provider, not
 * just SMTP. The counterpart the throw depends on is pinned too: an operator
 * who does not want mail sent says so with `OS_EMAIL_PROVIDER=log`, and that
 * still boots.
 */

import { describe, it, expect } from 'vitest';
import { resolveEmailCapabilityArg } from './serve.js';

describe('resolveEmailCapabilityArg', () => {
  it('defaults to the log provider when nothing is configured', () => {
    const { options } = resolveEmailCapabilityArg({}, {});
    expect(options).toMatchObject({ provider: 'log' });
    expect(options).not.toHaveProperty('providerOptions');
  });

  it('boots on an EXPLICIT provider=log — the way to say "this environment does not send mail"', () => {
    // The premise of every throw below: refusing an undeliverable provider is
    // only fair because "no mail from here" has its own spelling. If this ever
    // stops booting, the errors elsewhere in this file stop being actionable.
    expect(() => resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'log' })).not.toThrow();
    expect(resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'log' }).options)
      .toMatchObject({ provider: 'log' });
    // …including from objectstack.config.ts, and with no API key anywhere.
    expect(resolveEmailCapabilityArg({ provider: 'log' }, {}).options).toMatchObject({ provider: 'log' });
  });

  it('assembles the SMTP connection from OS_EMAIL_SMTP_*', () => {
    const { options } = resolveEmailCapabilityArg({}, {
      OS_EMAIL_PROVIDER: 'smtp',
      OS_EMAIL_SMTP_HOST: ' smtp.exmail.qq.com ',
      OS_EMAIL_SMTP_PORT: '465',
      OS_EMAIL_SMTP_SECURE: 'true',
      OS_EMAIL_SMTP_USER: 'ops@example.cn',
      OS_EMAIL_SMTP_PASSWORD: 'sekrit',
      OS_EMAIL_FROM: 'Acme <no-reply@example.cn>',
    });
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

  it('never demands an apiKey from smtp — it has no API to key', () => {
    const { options } = resolveEmailCapabilityArg({}, {
      OS_EMAIL_PROVIDER: 'smtp',
      OS_EMAIL_SMTP_HOST: 'smtp.x',
    });
    expect(options.provider).toBe('smtp');
    expect(options).not.toHaveProperty('apiKey');
  });

  it('passes a complete resend/postmark configuration through untouched', () => {
    const resend = resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'resend', OS_EMAIL_API_KEY: 're_x' });
    expect(resend.options).toMatchObject({ provider: 'resend', apiKey: 're_x' });

    // The key may equally come from objectstack.config.ts.
    const postmark = resolveEmailCapabilityArg({ provider: 'postmark', apiKey: 'pm_x' }, {});
    expect(postmark.options).toMatchObject({ provider: 'postmark', apiKey: 'pm_x' });
  });

  it('THROWS on resend/postmark without an apiKey — no silent LogTransport (#5132)', () => {
    // This case used to return `{ provider: 'log' }` plus a warning: the server
    // booted, `sys_email` filled with rows marked sent, and no mail was ever
    // delivered. It is now the same refusal the neighbouring `smtp` arm makes.
    for (const provider of ['resend', 'postmark']) {
      const boot = () => resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: provider });
      expect(boot, provider).toThrow(new RegExp(`provider='${provider}'`));
      // Consequence AND fix in the one message (AGENTS.md degradation-log-level).
      expect(boot, provider).toThrow(/sys_email as sent and nothing would leave the box/);
      expect(boot, provider).toThrow(/OS_EMAIL_API_KEY/);
      expect(boot, provider).toThrow(/OS_EMAIL_PROVIDER=log/);
      // …and never the old silent rewrite.
      expect(boot, provider).not.toThrow(/Falling back to LogTransport/);
    }
    // config.email.provider is the same declaration by another channel.
    expect(() => resolveEmailCapabilityArg({ provider: 'resend' }, {})).toThrow(/OS_EMAIL_API_KEY/);
  });

  it('THROWS on a provider tag no transport can deliver, carrying the migration', () => {
    // A stored/typo'd tag used to take the same silent `log` path when no key
    // was set. `sendgrid` / `ses` get the SMTP migration from plugin-email
    // (#5094), anything else gets the supported list — one vocabulary, not a
    // second literal maintained here.
    expect(() => resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'sendgrid' }))
      .toThrow(/smtp\.sendgrid\.net/);
    expect(() => resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'ses', OS_EMAIL_API_KEY: 'k' }))
      .toThrow(/email-smtp\.<region>\.amazonaws\.com/);
    expect(() => resolveEmailCapabilityArg({}, { OS_EMAIL_PROVIDER: 'mailgun' }))
      .toThrow(/log \/ resend \/ postmark \/ smtp/);
  });

  // ── durable queue delivery (#5160) ───────────────────────────────────────

  it('leaves queueDelivery unset when nothing declares it', () => {
    // Absent, not `false`: the plugin's boot gate fires on an explicit `true`,
    // and an option nobody wrote should not appear in what it is constructed
    // with at all.
    expect(resolveEmailCapabilityArg({}, {})).not.toHaveProperty('options.queueDelivery');
  });

  it('reads OS_EMAIL_QUEUE_ENABLED as the boolean feature flag it is', () => {
    // `_ENABLED` + default-off is the Prime Directive #9 shape for a boolean
    // flag; a bare `OS_EMAIL_QUEUE` would read as a config value (a queue
    // name), which is the naming trap that rule exists to close.
    for (const on of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(resolveEmailCapabilityArg({}, { OS_EMAIL_QUEUE_ENABLED: on }).options.queueDelivery, on)
        .toBe(true);
    }
    for (const off of ['0', 'false', 'no', '']) {
      expect(resolveEmailCapabilityArg({}, { OS_EMAIL_QUEUE_ENABLED: off }).options.queueDelivery, off)
        .toBe(false);
    }
  });

  it('accepts the same declaration from objectstack.config.ts, with env winning', () => {
    expect(resolveEmailCapabilityArg({ queueDelivery: true }, {}).options.queueDelivery).toBe(true);
    expect(
      resolveEmailCapabilityArg({ queueDelivery: true }, { OS_EMAIL_QUEUE_ENABLED: 'false' })
        .options.queueDelivery,
    ).toBe(false);
  });

  it('does not decide here whether the declaration can be honoured', () => {
    // No kernel exists at this point, so no service registry can be read. The
    // plugin asserts a durable queue on `kernel:ready` — reading a registry
    // that is still filling and recording the verdict is the failure mode
    // AGENTS.md names. All this function does is carry the declaration.
    expect(() => resolveEmailCapabilityArg({}, {
      OS_EMAIL_QUEUE_ENABLED: 'true', OS_EMAIL_PROVIDER: 'log',
    })).not.toThrow();
  });

  it('does not add a second retry knob for the queue', () => {
    // One "retry" concept, one config. `OS_EMAIL_RETRIES` drives the inline
    // loop or becomes the queue's attempt budget — never both, so the two
    // layers cannot multiply into 5x5 connections.
    const { options } = resolveEmailCapabilityArg({}, {
      OS_EMAIL_QUEUE_ENABLED: 'true', OS_EMAIL_RETRIES: '4',
    });
    expect(options).toMatchObject({ queueDelivery: true, retries: 4 });
    expect(Object.keys(options).filter((k) => /retr|attempt/i.test(k))).toEqual(['retries']);
  });

  it('still derives the fallback from-address and template context', () => {
    const { options } = resolveEmailCapabilityArg({}, { OS_APP_NAME: 'Acme CRM' }, 'ignored');
    expect(options.defaultTemplateContext).toMatchObject({ appName: 'Acme CRM' });
    expect(options.defaultFrom).toEqual({ name: 'Acme CRM', address: 'no-reply@acme-crm.local' });
  });
});
