// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The auth mails reach `sendTemplate` through `withMailTenantCurrency`, which
 * adds the organization's default currency to a call that names none, so a
 * template's no-argument `{{ amount | currency }}` hole formats in it rather
 * than being refused for a default the organization has.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IEmailService, SendTemplateInput } from '@objectstack/spec/contracts';
import { withMailTenantCurrency } from './mail-tenant-currency.js';

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
