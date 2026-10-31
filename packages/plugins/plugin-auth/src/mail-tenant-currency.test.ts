// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The auth mails reach `sendTemplate` through `withMailTenantCurrency`, which
 * adds the organization's default currency to a call that names none, so a
 * template's no-argument `{{ amount | currency }}` hole formats in it rather
 * than being refused for a default the organization has.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IEmailService, SendTemplateInput } from '@objectstack/spec/contracts';
import { localizationMailCurrencyResolver, withMailTenantCurrency } from './mail-tenant-currency.js';

function emailDouble() {
  const sendTemplate = vi.fn(async (_input: SendTemplateInput) => ({ id: 'mail_1', status: 'sent' as const }));
  const send = vi.fn(async () => ({ id: 'mail_2', status: 'sent' as const }));
  return { sendTemplate, send, service: { send, sendTemplate } as unknown as IEmailService };
}

describe('withMailTenantCurrency', () => {
  it('adds the named organization\'s default to a call that names none', async () => {
    const email = emailDouble();
    const reads: Array<string | undefined> = [];
    const wired = withMailTenantCurrency(email.service, async (org) => { reads.push(org); return org === 'org_cn' ? 'CNY' : undefined; });
    await wired.sendTemplate({ template: 'auth.invitation', to: 'a@x.com', organizationId: 'org_cn' });
    expect(reads).toEqual(['org_cn']);
    expect(email.sendTemplate).toHaveBeenCalledWith({ template: 'auth.invitation', to: 'a@x.com', organizationId: 'org_cn', currency: 'CNY' });
  });

  it('identity mail, which names no organization, reads the deployment-wide default', async () => {
    const email = emailDouble();
    const reads: Array<string | undefined> = [];
    const wired = withMailTenantCurrency(email.service, async (org) => { reads.push(org); return 'EUR'; });
    await wired.sendTemplate({ template: 'auth.verify_email', to: 'a@x.com', identityMail: true });
    expect(reads).toEqual([undefined]);
    expect(email.sendTemplate.mock.calls[0]![0]).toMatchObject({ currency: 'EUR' });
  });

  it('a call that names a currency keeps it, and the default is not read', async () => {
    const email = emailDouble();
    const resolve = vi.fn(async () => 'CNY');
    await withMailTenantCurrency(email.service, resolve).sendTemplate({ template: 't', to: 'a@x.com', currency: 'JPY' });
    expect(resolve).not.toHaveBeenCalled();
    expect(email.sendTemplate.mock.calls[0]![0]).toMatchObject({ currency: 'JPY' });
  });

  it.each([
    ['no default', async () => undefined],
    ['a failed read', async () => { throw new Error('settings unavailable'); }],
  ])('with %s it adds no `currency` key, and the render then refuses such a hole', async (_label, resolve) => {
    const email = emailDouble();
    await withMailTenantCurrency(email.service, resolve).sendTemplate({ template: 't', to: 'a@x.com' });
    expect(email.sendTemplate.mock.calls[0]![0]).not.toHaveProperty('currency');
  });

  it('every other member is the service\'s own', async () => {
    const email = emailDouble();
    await withMailTenantCurrency(email.service, async () => 'CNY').send({ to: 'a@x.com' } as never);
    expect(email.send).toHaveBeenCalledWith({ to: 'a@x.com' });
  });
});

// [#27710] A read that FAILED learned nothing, so the refusal it causes is not
// the organization's missing default: the mail fails with a transient error
// that names the read, never `TEMPLATE_INVALID` and its remedy. A read that
// succeeded and found no default keeps the render's refusal, as before.
describe('withMailTenantCurrency: a failed read is not "no default"', () => {
  const REFUSAL =
    'TEMPLATE_INVALID: email template auth.invitation (locale=en-US): the hole {{ amount | currency }} has no currency argument and the organization has no default currency; set localization.currency, or write currency:EUR';
  const PATH_REFUSAL =
    "TEMPLATE_INVALID: email template auth.invitation (locale=en-US): the hole {{ amount | currency:@deal.code }} reads 'dollars' at deal.code, which is not an ISO 4217 code";

  /**
   * The render the real `email` service does. `missing-currency`: a
   * no-argument hole needs a `currency`. `path-value`: an `@path` hole refuses
   * whatever the default. `both`: the missing default first, then the `@path`.
   */
  function renderingMail(opts: { refuses?: 'missing-currency' | 'path-value' | 'both' | 'not-found'; noRender?: boolean } = {}) {
    const renders: any[] = [];
    let sent = 0;
    const render = (input: any) => {
      renders.push(input);
      if (opts.refuses === 'not-found') throw new Error('TEMPLATE_NOT_FOUND: email template auth.invitation');
      const needsDefault = opts.refuses === 'missing-currency' || opts.refuses === 'both';
      if (needsDefault && !input.currency) throw new Error(REFUSAL);
      if (opts.refuses === 'path-value' || opts.refuses === 'both') throw new Error(PATH_REFUSAL);
      return { subject: 's', html: '<p>x</p>', text: `${input.currency ?? ''}` };
    };
    const service: Record<string, unknown> = {
      async send() { return { id: 'mail_2', status: 'sent' as const }; },
      async sendTemplate(input: SendTemplateInput) { render(input); sent += 1; return { id: 'mail_1', status: 'sent' as const }; },
    };
    if (!opts.noRender) service.renderTemplate = async (input: unknown) => render(input);
    return { renders, sent: () => sent, service: service as unknown as IEmailService };
  }

  const failedRead = async (): Promise<string | undefined> => { throw new Error("the localization settings of organization 'org_cn' could not be read"); };
  const INPUT: SendTemplateInput = { template: 'auth.invitation', to: 'a@x.com', organizationId: 'org_cn', data: { amount: 12 } };

  it('a failed read whose only refusal is the missing default fails transient: the read named, no TEMPLATE_ code, nothing sent', async () => {
    const mail = renderingMail({ refuses: 'missing-currency' });
    const error = await withMailTenantCurrency(mail.service, failedRead).sendTemplate(INPUT).then(() => undefined, (e: Error) => e);
    expect(error?.message).toBe(
      "the mail 'auth.invitation' was not rendered: the organization's default currency could not be read " +
        "(the localization settings of organization 'org_cn' could not be read); it can be sent once that read succeeds",
    );
    expect(error?.message).not.toMatch(/TEMPLATE_/);
    // The send, then ONE trial render with the "no currency" code, never sent.
    expect(mail.renders).toHaveLength(2);
    expect(mail.renders[0]).not.toHaveProperty('currency');
    expect(mail.renders[1]).toMatchObject({ template: 'auth.invitation', data: { amount: 12 }, currency: 'XXX' });
    expect(mail.sent()).toBe(0);
  });

  it('a service with no renderTemplate cannot tell the causes apart: the read fault is transient', async () => {
    const mail = renderingMail({ refuses: 'missing-currency', noRender: true });
    const error = await withMailTenantCurrency(mail.service, failedRead).sendTemplate(INPUT).then(() => undefined, (e: Error) => e);
    expect(error?.message).toMatch(/default currency could not be read/);
    expect(error?.message).not.toMatch(/TEMPLATE_/);
  });

  it.each([
    ['a refusal no default cures', 'path-value' as const],
    ['the missing default AND a refusal no default cures', 'both' as const],
  ])('a failed read leaves %s as it stands: that refusal, nothing sent', async (_label, refuses) => {
    const mail = renderingMail({ refuses });
    await expect(withMailTenantCurrency(mail.service, failedRead).sendTemplate(INPUT)).rejects.toThrow(PATH_REFUSAL);
    expect(mail.sent()).toBe(0);
  });

  it('a failed read leaves every other failure as it was: TEMPLATE_NOT_FOUND, with no trial render', async () => {
    const mail = renderingMail({ refuses: 'not-found' });
    await expect(withMailTenantCurrency(mail.service, failedRead).sendTemplate(INPUT)).rejects.toThrow(/^TEMPLATE_NOT_FOUND: /);
    expect(mail.renders).toHaveLength(1);
  });

  it('a failed read does not stop a template that needs no default: it is sent', async () => {
    const mail = renderingMail();
    await expect(withMailTenantCurrency(mail.service, failedRead).sendTemplate(INPUT)).resolves.toMatchObject({ status: 'sent' });
    expect(mail.sent()).toBe(1);
  });

  it('a read that SUCCEEDS and finds no default keeps the render\'s refusal and its remedy, with no trial render', async () => {
    const mail = renderingMail({ refuses: 'missing-currency' });
    await expect(withMailTenantCurrency(mail.service, async () => undefined).sendTemplate(INPUT)).rejects.toThrow(REFUSAL);
    expect(mail.renders).toHaveLength(1);
  });
});

// [#27710] The resolver the plugin wires, over the real
// `resolveLocalizationContext`: both legs a read can fail on (#27257's
// `sys_setting` read, #27733's `sys_organization` probe) reach the mail as a
// transient failure; a read that found no default reaches it as the refusal.
describe('localizationMailCurrencyResolver: the plugin\'s read, end to end', () => {
  const REFUSAL = 'TEMPLATE_INVALID: email template auth.invitation (locale=en-US): the hole {{ amount | currency }} has no currency argument and the organization has no default currency; set localization.currency, or write currency:EUR';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** An engine: `fail` names the object whose read throws (an outage, not a missing table); `sys_setting` answers `rows`. */
  function engine(opts: { fail?: 'sys_setting' | 'sys_organization' }, rows: Array<Record<string, unknown>> = []) {
    const reads: string[] = [];
    return {
      reads,
      async find(object: string, o: any) {
        reads.push(object);
        if (object === opts.fail) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
        if (object === 'sys_organization') return [{ id: 'org_cn' }].slice(0, o?.limit ?? 1);
        if (object !== 'sys_setting') return [];
        const where = o?.where ?? {};
        const matched = rows.filter((r) =>
          Object.entries(where).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
            return r[k] === v;
          }),
        );
        // Hold the caller's bound, after the filter and by presence.
        return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
      },
    };
  }

  function mail() {
    const renders: any[] = [];
    const render = (input: any) => {
      renders.push(input);
      if (!input.currency) throw new Error(REFUSAL);
      return { subject: 's', html: '<p>x</p>', text: input.currency };
    };
    return {
      renders,
      service: {
        async send() { return { id: 'mail_2', status: 'sent' as const }; },
        async sendTemplate(input: SendTemplateInput) { render(input); return { id: 'mail_1', status: 'sent' as const }; },
        async renderTemplate(input: unknown) { return render(input); },
      } as unknown as IEmailService,
    };
  }

  it('a failed `sys_setting` read reaches the mail as the transient failure', async () => {
    const ql = engine({ fail: 'sys_setting' });
    const m = mail();
    const wired = withMailTenantCurrency(m.service, localizationMailCurrencyResolver(() => ({ ql, settings: undefined })));
    const error = await wired.sendTemplate({ template: 'auth.invitation', to: 'a@x.com', organizationId: 'org_cn' }).then(() => undefined, (e: Error) => e);
    expect(error?.message).toMatch(/default currency could not be read \(the localization settings of organization 'org_cn' could not be read\)/);
    expect(error?.message).not.toMatch(/TEMPLATE_/);
  });

  it('a failed `sys_organization` probe (identity mail, no organization named) reaches it the same way', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = engine({ fail: 'sys_organization' });
    const m = mail();
    const wired = withMailTenantCurrency(m.service, localizationMailCurrencyResolver(() => ({ ql, settings: undefined })));
    const error = await wired.sendTemplate({ template: 'auth.verify_email', to: 'a@x.com', identityMail: true }).then(() => undefined, (e: Error) => e);
    expect(ql.reads).toEqual(['sys_organization']);
    expect(error?.message).toMatch(/default currency could not be read \(the localization settings could not be read\)/);
    expect(error?.message).not.toMatch(/TEMPLATE_/);
  });

  it('a read that succeeds and finds no default reaches it as the refusal, unchanged', async () => {
    const ql = engine({});
    const m = mail();
    const wired = withMailTenantCurrency(m.service, localizationMailCurrencyResolver(() => ({ ql, settings: undefined })));
    await expect(wired.sendTemplate({ template: 'auth.invitation', to: 'a@x.com', organizationId: 'org_cn' })).rejects.toThrow(REFUSAL);
    expect(m.renders).toHaveLength(1);
  });

  it('a read that finds the default formats in it', async () => {
    const ql = engine({}, [{ namespace: 'localization', key: 'currency', scope: 'tenant', organization_id: 'org_cn', value: 'CNY' }]);
    const m = mail();
    const wired = withMailTenantCurrency(m.service, localizationMailCurrencyResolver(() => ({ ql, settings: undefined })));
    await expect(wired.sendTemplate({ template: 'auth.invitation', to: 'a@x.com', organizationId: 'org_cn' })).resolves.toMatchObject({ status: 'sent' });
    expect(m.renders[0].currency).toBe('CNY');
  });
});
