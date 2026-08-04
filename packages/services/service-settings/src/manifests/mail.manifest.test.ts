// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// The mail manifest's own guard rail (#5094).
//
// The cross-package half of the invariant — "every option has a transport, and
// every transport has an option" — is asserted against the real `makeTransport`
// in `packages/plugins/plugin-email/src/mail-manifest-providers.contract.test.ts`.
// What lives HERE is what an editor of this file needs to see fail in this
// file: the option list itself, and the form logic that hangs off it.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema } from '@objectstack/spec/system';
import { mailSettingsManifest, mailTestActionHandler } from './mail.manifest.js';
import { evaluateVisibility } from '../visibility-eval.js';

type Spec = Record<string, any>;
const specs = () => mailSettingsManifest.specifiers as unknown as Spec[];
const spec = (key: string) => specs().find((s) => s.key === key)!;
const group = (id: string) => specs().find((s) => s.type === 'group' && s.id === id)!;
const providerValues = () => (spec('provider').options as Array<{ value: string }>).map((o) => o.value);

describe('mailSettingsManifest', () => {
  it('parses against SettingsManifestSchema', () => {
    expect(() => SettingsManifestSchema.parse(mailSettingsManifest)).not.toThrow();
  });

  it('declares namespace=mail, scope=global, version=1', () => {
    const parsed = SettingsManifestSchema.parse(mailSettingsManifest);
    expect(parsed.namespace).toBe('mail');
    expect(parsed.scope).toBe('global');
    expect(parsed.version).toBe(1);
  });

  it('offers exactly the providers @objectstack/plugin-email can deliver through', () => {
    // Changing this list is a CONTRACT change, not a copy edit. Adding a value
    // means adding a `case` to `makeTransport` in @objectstack/plugin-email
    // (and a `BUILD_ARGS` entry in its contract test); without that, the option
    // saves cleanly and then delivers nothing, which is precisely #5087/#5094.
    expect(providerValues()).toEqual(['smtp', 'resend', 'postmark', 'log']);
    expect(spec('provider').default).toBe('smtp');
  });

  it('does not offer sendgrid / ses, and points them at SMTP instead', () => {
    expect(providerValues()).not.toContain('sendgrid');
    expect(providerValues()).not.toContain('ses');
    const description = String(spec('provider').description);
    expect(description).toMatch(/smtp\.sendgrid\.net/);
    expect(description).toMatch(/email-smtp\.<region>\.amazonaws\.com/);
  });

  it('labels the non-delivering option as non-delivering', () => {
    const log = (spec('provider').options as Array<{ value: string; label: string }>)
      .find((o) => o.value === 'log')!;
    // `log` is the one option that does not send. It is allowed on an admin
    // page only because it says so on the tin.
    expect(log.label).toMatch(/no real delivery/i);
  });

  it('shows the SMTP fields for exactly provider=smtp', () => {
    const smtpKeys = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_password'];
    for (const provider of providerValues()) {
      const shown = provider === 'smtp';
      expect(evaluateVisibility(group('smtp').visible, { provider })).toBe(shown);
      for (const key of smtpKeys) {
        expect(evaluateVisibility(spec(key).visible, { provider }), `${key} @ ${provider}`).toBe(shown);
      }
    }
  });

  it('requires the API key for exactly the providers that have an API', () => {
    // `api_key` is `required`, and SettingsService enforces `required` only
    // where the field is visible — so a visibility expression that is merely
    // "not smtp" makes saving provider=log impossible until an API key nothing
    // will ever read has been typed in.
    expect(spec('api_key').required).toBe(true);
    expect(spec('api_key').encrypted).toBe(true);
    for (const provider of providerValues()) {
      const needsKey = provider === 'resend' || provider === 'postmark';
      expect(evaluateVisibility(spec('api_key').visible, { provider }), `api_key @ ${provider}`)
        .toBe(needsKey);
      expect(evaluateVisibility(group('api_key').visible, { provider }), `api_key group @ ${provider}`)
        .toBe(needsKey);
    }
  });

  it('exposes a test action that POSTs to /api/settings/mail/test', () => {
    const test = specs().find((s) => s.type === 'action_button' && s.id === 'test');
    expect(test).toBeDefined();
    expect(test!.handler).toMatchObject({
      kind: 'http',
      method: 'POST',
      url: '/api/settings/mail/test',
    });
  });
});

describe('mailTestActionHandler (fallback — no email plugin mounted)', () => {
  const base = { from_email: 'ops@example.test' };

  it('never reports success — it cannot send anything', async () => {
    for (const provider of providerValues()) {
      const r = await mailTestActionHandler({
        values: { ...base, provider, smtp_host: 'smtp.example.test', api_key: 'k' },
        namespace: 'mail',
        actionId: 'test',
        ctx: {} as never,
      });
      expect(r.ok, `provider=${provider}`).toBe(false);
    }
  });

  it('requires a from address', async () => {
    const r = await mailTestActionHandler({ values: { provider: 'smtp' }, namespace: 'mail', actionId: 'test', ctx: {} as never });
    expect(r).toMatchObject({ ok: false, severity: 'error' });
    expect(r.message).toMatch(/from address/i);
  });

  it('requires an SMTP host for provider=smtp', async () => {
    const r = await mailTestActionHandler({ values: { ...base, provider: 'smtp' }, namespace: 'mail', actionId: 'test', ctx: {} as never });
    expect(r).toMatchObject({ ok: false, severity: 'error' });
    expect(r.message).toMatch(/SMTP host is required/);
  });

  it.each(['resend', 'postmark'])('requires an API key for provider=%s', async (provider) => {
    const r = await mailTestActionHandler({ values: { ...base, provider }, namespace: 'mail', actionId: 'test', ctx: {} as never });
    expect(r).toMatchObject({ ok: false, severity: 'error' });
    expect(r.message).toMatch(/API key is required/);
  });

  it('does not ask provider=log for an API key', async () => {
    const r = await mailTestActionHandler({ values: { ...base, provider: 'log' }, namespace: 'mail', actionId: 'test', ctx: {} as never });
    expect(r.message).not.toMatch(/API key is required/);
  });

  it.each(['sendgrid', 'ses'])(
    'refuses a stored provider=%s at error level, with the consequence and the fix',
    async (provider) => {
      // The value a workspace saved while the dropdown still offered it. This
      // handler cannot deliver anything anyway, but answering "the form is
      // well-formed" for a provider nothing can send through is the same lie
      // #5087 removed from this file.
      const r = await mailTestActionHandler({
        values: { ...base, provider, api_key: 'legacy-key' },
        namespace: 'mail',
        actionId: 'test',
        ctx: {} as never,
      });
      expect(r.ok).toBe(false);
      expect(r.severity).toBe('error');
      expect(r.message).toMatch(/NO mail is being sent/);
      expect(r.message).toMatch(/smtp\.sendgrid\.net|email-smtp/);
      expect(r.message).not.toMatch(/well-formed/);
    },
  );

  it('refuses an unknown provider value the same way', async () => {
    const r = await mailTestActionHandler({
      values: { ...base, provider: 'mailgun' },
      namespace: 'mail',
      actionId: 'test',
      ctx: {} as never,
    });
    expect(r).toMatchObject({ ok: false, severity: 'error' });
    expect(r.message).toMatch(/smtp \/ resend \/ postmark \/ log/);
  });
});
