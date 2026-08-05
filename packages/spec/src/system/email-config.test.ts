// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `EmailProviderSchema` ↔ what a deployment can actually deliver through (#5104).
//
// The enum used to stop at `log` / `resend` / `postmark` while its own TSDoc
// told authors that "self-hosted SMTP is intentionally NOT shipped in
// plugin-email". #5087 shipped `SmtpTransport`, `OS_EMAIL_PROVIDER=smtp` and
// the `OS_EMAIL_SMTP_*` variables — so an author annotating
// `objectstack.config.ts` with `EmailServiceConfig` got a type error for a
// provider the runtime had been serving since. Declared ≠ implemented, with
// the spec on the *lagging* side.
//
// These assertions are RUNTIME `safeParse` checks on purpose. `packages/spec`
// excludes `**/*.test.ts` from its `tsconfig.json`, so `tsc --noEmit` never
// reads this file (#5286) and any `Assert< Equal< … > >`-style type-level
// witness written here would be a phantom check that passes because nothing
// type-checks it. What the enum *accepts* is observable at runtime; that is
// what we pin.
//
// The set equality below is deliberately a literal. It is the spec-side half
// of a two-sided pin: `spec-provider-parity.contract.test.ts` in
// `@objectstack/plugin-email` compares this same enum against
// `EMAIL_TRANSPORT_PROVIDERS`, the array `makeTransport` switches on. Adding a
// provider therefore has to be a conscious edit on both sides — a literal here
// alone could be "fixed" by editing the other literal, which is exactly how the
// settings dropdown and the transports drifted apart in #5094.

import { describe, it, expect } from 'vitest';
import { EmailProviderSchema, EmailServiceConfigSchema } from './email-config.zod';

/**
 * Every provider tag `@objectstack/plugin-email` can materialise today,
 * measured on `main`: `EMAIL_TRANSPORT_PROVIDERS` in
 * `packages/plugins/plugin-email/src/transports/index.ts`.
 */
const DELIVERABLE_PROVIDERS = ['log', 'resend', 'postmark', 'smtp'] as const;

/**
 * Tags the mail settings page once offered with no transport behind them
 * (#5094). `makeTransport` and the CLI's `resolveEmailCapabilityArg` both
 * throw on these and point at `provider='smtp'` instead, so the spec must not
 * declare them — that would be the same declared ≠ implemented defect this
 * file exists to close, pointing the other way.
 */
const REFUSED_PROVIDERS = ['sendgrid', 'ses', 'mailgun'] as const;

describe('EmailProviderSchema', () => {
  it('accepts exactly the providers plugin-email can deliver through', () => {
    const accepted = DELIVERABLE_PROVIDERS.filter(
      (p) => EmailProviderSchema.safeParse(p).success,
    );
    expect(accepted).toEqual([...DELIVERABLE_PROVIDERS]);
  });

  it('accepts smtp — shipped by plugin-email since #5087 (ADR-0012)', () => {
    // The single assertion #5104 is about: green after the enum gained
    // 'smtp', red on any revert of it.
    expect(EmailProviderSchema.safeParse('smtp').success).toBe(true);
  });

  it('rejects provider tags no transport implements', () => {
    for (const provider of REFUSED_PROVIDERS) {
      expect(EmailProviderSchema.safeParse(provider).success, provider).toBe(false);
    }
  });
});

describe('EmailServiceConfigSchema', () => {
  it('type-checks a config for every deliverable provider', () => {
    for (const provider of DELIVERABLE_PROVIDERS) {
      const parsed = EmailServiceConfigSchema.safeParse({ provider });
      expect(parsed.success, provider).toBe(true);
      if (parsed.success) expect(parsed.data.provider).toBe(provider);
    }
  });

  it('carries the SMTP connection on `options`, mirroring OS_EMAIL_SMTP_*', () => {
    const parsed = EmailServiceConfigSchema.safeParse({
      provider: 'smtp',
      defaultFrom: { name: 'Acme', address: 'no-reply@acme.test' },
      options: {
        host: 'smtp.exmail.qq.com',
        port: 465,
        secure: true,
        user: 'ops@acme.test',
        password: 'sekrit',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.options).toMatchObject({ host: 'smtp.exmail.qq.com', port: 465 });
    }
  });

  it('refuses a config naming a provider that cannot deliver', () => {
    for (const provider of REFUSED_PROVIDERS) {
      expect(EmailServiceConfigSchema.safeParse({ provider }).success, provider).toBe(false);
    }
  });

  it('still defaults to log so an unconfigured deployment boots', () => {
    const parsed = EmailServiceConfigSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.provider).toBe('log');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #5307 — the same defect as #5104, on three other keys.
//
// `resolveEmailCapabilityArg` reads `queueDelivery` / `appName` /
// `defaultTemplateContext` off `config.email` and has done since #5160 and
// before; the schema declared none of them. An author annotating
// `objectstack.config.ts` with `EmailServiceConfig` got a type error for a
// value the runtime honours.
//
// HOW THESE ASSERT, AND WHY NOT `success`. This object strips unknown keys, so
// `safeParse({ queueDelivery: true }).success` was already `true` before the
// fix — the key was simply thrown away. `success` is therefore a phantom
// check here: the fact under test is that the key is a real AUTHORING SURFACE,
// which on a strip object is observable as "it SURVIVES the parse". Every
// assertion below reads `parsed.data`, so each one is green after the
// declaration and red on a revert of it.
// ─────────────────────────────────────────────────────────────────────────────
describe('EmailServiceConfigSchema — keys the CLI reads (#5307)', () => {
  it('carries queueDelivery through the parse, not into the bin', () => {
    for (const queueDelivery of [true, false]) {
      const parsed = EmailServiceConfigSchema.safeParse({ queueDelivery });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.queueDelivery, String(queueDelivery)).toBe(queueDelivery);
    }
  });

  it('types queueDelivery as the boolean flag the CLI resolves it to', () => {
    // `OS_EMAIL_QUEUE_ENABLED` is parsed into a boolean before it reaches the
    // plugin, and the config half must not be the one place a string arrives.
    expect(EmailServiceConfigSchema.safeParse({ queueDelivery: 'true' }).success).toBe(false);
  });

  it('carries appName through the parse', () => {
    const parsed = EmailServiceConfigSchema.safeParse({ appName: 'Acme CRM' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.appName).toBe('Acme CRM');
  });

  it('carries defaultTemplateContext through the parse, values untouched', () => {
    // Free-form by design: the CLI spreads this object into the plugin's
    // render context unchanged, so declaring a closed vocabulary here would
    // invent a constraint the reader does not have.
    const context = { supportEmail: 'help@acme.test', year: 2026, brand: { url: 'https://acme.test' } };
    const parsed = EmailServiceConfigSchema.safeParse({ defaultTemplateContext: context });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.defaultTemplateContext).toEqual(context);
  });

  it('accepts the three together with the keys that were already declared', () => {
    const parsed = EmailServiceConfigSchema.safeParse({
      provider: 'smtp',
      options: { host: 'smtp.acme.test' },
      retries: 3,
      queueDelivery: true,
      appName: 'Acme CRM',
      defaultTemplateContext: { supportEmail: 'help@acme.test' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        queueDelivery: true,
        appName: 'Acme CRM',
        defaultTemplateContext: { supportEmail: 'help@acme.test' },
      });
    }
  });

  it('leaves all three absent when unwritten — no defaults invented', () => {
    // The runtime's defaults (inline delivery, appName 'ObjectStack') are
    // resolved in `resolveEmailCapabilityArg` against env and the top-level
    // config. A `.default()` here would fabricate a second answer that wins
    // over neither and confuses both.
    const parsed = EmailServiceConfigSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('queueDelivery');
      expect(parsed.data).not.toHaveProperty('appName');
      expect(parsed.data).not.toHaveProperty('defaultTemplateContext');
    }
  });
});
