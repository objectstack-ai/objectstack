// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The auth mails' tenant default currency.
 *
 * A mail template's `{{ amount | currency }}` hole with no argument formats in
 * the organization's default currency (`localization.currency`), which the
 * caller of `sendTemplate` hands over as `currency`; with none the render
 * refuses the hole (`TEMPLATE_INVALID`). The auth mails
 * (verification, password reset, invitations, magic link, notices) are sent
 * from six call sites, so the default is added once, here, on the email
 * service the plugin wires into the AuthManager, rather than at each site: a
 * call that names no `currency` gets the default of the organization it names
 * (`organizationId`), or the deployment-wide setting for identity mail, which
 * names none. A call that names one keeps it, and a failed or empty read adds
 * nothing.
 */

import type { IEmailService, SendTemplateInput } from '@objectstack/spec/contracts';

/** Answers the default currency of an organization, or of the deployment when none is named. */
export type MailTenantCurrencyResolver = (organizationId: string | undefined) => Promise<string | undefined>;

async function withCurrency(input: SendTemplateInput, resolve: MailTenantCurrencyResolver): Promise<SendTemplateInput> {
  if (input.currency !== undefined) return input;
  let currency: string | undefined;
  try {
    currency = await resolve(input.organizationId);
  } catch {
    currency = undefined;
  }
  return typeof currency === 'string' && currency !== '' ? { ...input, currency } : input;
}

/**
 * The email service, with the tenant default currency added to every
 * `sendTemplate` call that carries none. Every other member is the service's
 * own.
 */
export function withMailTenantCurrency(email: IEmailService, resolve: MailTenantCurrencyResolver): IEmailService {
  return new Proxy(email, {
    get(target, prop) {
      if (prop === 'sendTemplate') {
        return async (input: SendTemplateInput) => target.sendTemplate(await withCurrency(input, resolve));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
