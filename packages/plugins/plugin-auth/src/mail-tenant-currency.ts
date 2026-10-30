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
 * names none. A call that names one keeps it, and an empty read adds nothing.
 *
 * [#27710] A FAILED read adds nothing either, but it is not a read that found
 * no default: it learned nothing. When the render then refuses for want of a
 * default, the mail fails with a transient error, never `TEMPLATE_INVALID`
 * and its "set localization.currency" remedy, which the organization may not
 * need ({@link refusalAfterCurrencyReadFault}).
 */

import { resolveLocalizationContext } from '@objectstack/core';
import type { IEmailService, SendTemplateInput } from '@objectstack/spec/contracts';

/**
 * Answers the default currency of an organization, or of the deployment when
 * none is named: `undefined` when the read succeeded and found none. REJECTS
 * when the read itself failed.
 */
export type MailTenantCurrencyResolver = (organizationId: string | undefined) => Promise<string | undefined>;

/**
 * The resolver the plugin wires: `resolveLocalizationContext`, the read a
 * request resolves `ExecutionContext.currency` with, over the services as they
 * stand at send time. Rejects when that read says it failed (`readFailed`).
 */
export function localizationMailCurrencyResolver(
  services: () => { ql: unknown; settings: unknown },
): MailTenantCurrencyResolver {
  return async (organizationId) => {
    const { ql, settings } = services();
    const localization = await resolveLocalizationContext({ ql, settings, organizationId });
    if (localization.readFailed) {
      const of = organizationId ? ` of organization '${organizationId}'` : '';
      throw new Error(`the localization settings${of} could not be read`);
    }
    return localization.currency;
  };
}

/**
 * The ISO 4217 code for "no currency" (`XXX`): the stand-in default
 * {@link refusalAfterCurrencyReadFault} renders with to ask whether a default
 * would cure a refusal. Never sent: the trial only renders.
 */
const NO_CURRENCY_PROBE = 'XXX';

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The error a `sendTemplate` call that followed a failed currency read
 * (`readFault`) throws, given the error it threw (`err`).
 *
 * - Not `TEMPLATE_INVALID`: `err` as it stands.
 * - `TEMPLATE_INVALID`: the template is rendered once more WITHOUT sending,
 *   with {@link NO_CURRENCY_PROBE} as the default. If that still refuses
 *   `TEMPLATE_INVALID`, a default cannot cure the template (an `@path` value
 *   that is not a code), and that refusal stands. If it renders, or the
 *   service has no `renderTemplate`, or the trial fails some other way, the
 *   missing default is the refusal, and the mail fails with a transient error
 *   that names the read and carries no `TEMPLATE_*` code: sending it again
 *   once the read succeeds can work.
 */
async function refusalAfterCurrencyReadFault(
  email: IEmailService,
  input: SendTemplateInput,
  err: unknown,
  readFault: string,
): Promise<unknown> {
  if (!/\bTEMPLATE_INVALID\b/.test(messageOf(err))) return err;
  if (typeof email.renderTemplate === 'function') {
    try {
      await email.renderTemplate({
        template: input.template,
        data: input.data,
        locale: input.locale,
        timezone: input.timezone,
        currency: NO_CURRENCY_PROBE,
      });
    } catch (standing) {
      if (/\bTEMPLATE_INVALID\b/.test(messageOf(standing))) return standing;
    }
  }
  return new Error(
    `the mail '${input.template}' was not rendered: the organization's default currency could not be read ` +
      `(${readFault}); it can be sent once that read succeeds`,
  );
}

async function sendWithTenantCurrency(
  email: IEmailService,
  input: SendTemplateInput,
  resolve: MailTenantCurrencyResolver,
): ReturnType<IEmailService['sendTemplate']> {
  if (input.currency !== undefined) return email.sendTemplate(input);
  let currency: string | undefined;
  let readFault: string | undefined;
  try {
    currency = await resolve(input.organizationId);
  } catch (err) {
    readFault = messageOf(err);
  }
  if (readFault === undefined) {
    return email.sendTemplate(typeof currency === 'string' && currency !== '' ? { ...input, currency } : input);
  }
  try {
    return await email.sendTemplate(input);
  } catch (err) {
    throw await refusalAfterCurrencyReadFault(email, input, err, readFault);
  }
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
        return async (input: SendTemplateInput) => sendWithTenantCurrency(target, input, resolve);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
