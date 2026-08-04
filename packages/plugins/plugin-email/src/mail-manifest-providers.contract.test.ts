// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// The `mail` settings dropdown ↔ this package's transports (#5094).
//
// The acceptance criterion of #5094, made executable: **every provider an admin
// can select must be one this package can actually deliver through, and every
// provider this package can deliver through must be selectable.** Those are the
// two halves of one invariant, and both halves were broken at once —
// `sendgrid` / `ses` were offered by `mail.manifest.ts` with no transport
// behind them (the form validated, the save succeeded, no mail was ever sent),
// while `resend` had a working transport that the settings page never listed.
//
// This file is deliberately a CROSS-PACKAGE assertion rather than two mirrored
// literal lists: a literal pinned on each side can be "fixed" by editing the
// other literal, which is exactly how the two drifted apart in the first place.
// `@objectstack/service-settings` is therefore a devDependency here — test-only,
// no runtime edge — so the option list is compared against the real
// `makeTransport`, and adding a dropdown option without a transport (or a
// transport without a dropdown option) fails.

import { describe, it, expect } from 'vitest';
import { mailSettingsManifest, mailTestActionHandler } from '@objectstack/service-settings';
import {
  makeTransport,
  EMAIL_TRANSPORT_PROVIDERS,
  RETIRED_EMAIL_PROVIDERS,
  isEmailTransportProvider,
} from './transports/index.js';
import { LogTransport } from './email-service.js';
import { ResendTransport } from './transports/resend.js';
import { PostmarkTransport } from './transports/postmark.js';
import { SmtpTransport } from './transports/smtp.js';

/** The `provider` select's option values, read off the shipped manifest. */
function providerOptions(): string[] {
  const spec = (mailSettingsManifest.specifiers as Array<Record<string, any>>).find(
    (s) => s.key === 'provider',
  );
  expect(spec, 'mail manifest must declare a `provider` specifier').toBeDefined();
  return (spec!.options as Array<{ value: string }>).map((o) => o.value);
}

/** Minimal credentials that let each provider be built for real. */
const BUILD_ARGS: Record<string, Parameters<typeof makeTransport>[0]> = {
  log: { provider: 'log' },
  resend: { provider: 'resend', apiKey: 're_test_key' },
  postmark: { provider: 'postmark', apiKey: 'pm-test-key' },
  smtp: { provider: 'smtp', options: { host: 'smtp.example.test' } },
};

describe('mail settings dropdown ↔ email transports', () => {
  it('offers exactly the providers this package can deliver through', () => {
    // Set equality, both directions at once:
    //   ⊆ — no option without a transport (the #5087/#5094 defect shape);
    //   ⊇ — no transport the settings page hides (the `resend` gap).
    expect(new Set(providerOptions())).toEqual(new Set(EMAIL_TRANSPORT_PROVIDERS));
  });

  it('builds a real transport for every option the dropdown offers', () => {
    const built = providerOptions().map((provider) => {
      const args = BUILD_ARGS[provider];
      expect(args, `no build recipe for offered provider '${provider}'`).toBeDefined();
      return [provider, makeTransport(args)] as const;
    });

    // Not just "did not throw" — the right transport class for each tag.
    const byProvider = Object.fromEntries(built);
    expect(byProvider.smtp).toBeInstanceOf(SmtpTransport);
    expect(byProvider.resend).toBeInstanceOf(ResendTransport);
    expect(byProvider.postmark).toBeInstanceOf(PostmarkTransport);
    expect(byProvider.log).toBeInstanceOf(LogTransport);
  });

  it('still lists `smtp` as the default — the one provider that needs no SaaS account', () => {
    const spec = (mailSettingsManifest.specifiers as Array<Record<string, any>>).find(
      (s) => s.key === 'provider',
    );
    expect(spec!.default).toBe('smtp');
    expect(providerOptions()).toContain('smtp');
  });

  it('no longer offers sendgrid / ses — they are configured as SMTP', () => {
    const offered = providerOptions();
    for (const retired of Object.keys(RETIRED_EMAIL_PROVIDERS)) {
      expect(offered).not.toContain(retired);
      expect(isEmailTransportProvider(retired)).toBe(false);
    }
    // The dropdown does not simply drop them on the floor: the field
    // description tells an admin where SendGrid / SES went.
    const spec = (mailSettingsManifest.specifiers as Array<Record<string, any>>).find(
      (s) => s.key === 'provider',
    );
    expect(String(spec!.description)).toMatch(/smtp\.sendgrid\.net/);
    expect(String(spec!.description)).toMatch(/email-smtp\..*amazonaws\.com/);
  });

  it('refuses to build a retired provider, and says what to use instead', () => {
    expect(() => makeTransport({ provider: 'sendgrid' as never, apiKey: 'k' }))
      .toThrow(/smtp\.sendgrid\.net/);
    expect(() => makeTransport({ provider: 'ses' as never, apiKey: 'k' }))
      .toThrow(/email-smtp\.<region>\.amazonaws\.com/);
    // A typo'd / unknown value gets the supported list rather than silence.
    expect(() => makeTransport({ provider: 'mailgun' as never, apiKey: 'k' }))
      .toThrow(/log \/ resend \/ postmark \/ smtp/);
  });
});

describe('mail/test built-in fallback ↔ the same option list', () => {
  const base = { from_email: 'ops@example.test' };

  it('rejects a stored provider the dropdown no longer offers', async () => {
    for (const retired of Object.keys(RETIRED_EMAIL_PROVIDERS)) {
      const r = await mailTestActionHandler({
        values: { ...base, provider: retired, api_key: 'legacy-key' },
        namespace: 'mail',
        actionId: 'test',
        ctx: {} as never,
      });
      expect(r.ok).toBe(false);
      expect(r.severity).toBe('error');
      expect(r.message).toMatch(/NO mail is being sent/);
      // Consequence AND fix, per AGENTS.md — never a bare "unknown provider".
      expect(r.message).toMatch(/smtp/i);
    }
  });

  it('does not demand an API key for providers that take none', async () => {
    for (const provider of ['smtp', 'log']) {
      const r = await mailTestActionHandler({
        values: { ...base, provider, smtp_host: 'smtp.example.test' },
        namespace: 'mail',
        actionId: 'test',
        ctx: {} as never,
      });
      // ok:false either way — nothing can send without the plugin mounted —
      // but never "API key is required" for a provider that has no API.
      expect(r.message).not.toMatch(/API key is required/);
    }
  });

  it('still demands an API key for resend / postmark', async () => {
    for (const provider of ['resend', 'postmark']) {
      const r = await mailTestActionHandler({
        values: { ...base, provider },
        namespace: 'mail',
        actionId: 'test',
        ctx: {} as never,
      });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/API key is required/);
    }
  });
});
