// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Email Service Configuration Protocol
 *
 * Operator-facing configuration that selects the outbound email
 * transport for the EmailServicePlugin. Provider is a `provider` tag
 * + provider-specific settings; concrete `IEmailTransport`
 * implementations live in `@objectstack/plugin-email/transports/*`.
 *
 * Resolution order in `resolveEmailCapabilityArg` (`@objectstack/plugin-email`,
 * the one reader; `objectstack serve` and `bootStack` both construct the email
 * provider through it):
 *   1. `config.email.*` from objectstack.config.ts — the NON-SECRET members
 *      only. A config file is compiled into the published artifact, so the
 *      stack definition carries {@link StackEmailConfigSchema}: every member
 *      below except `apiKey`, with `options` narrowed to host / port / secure /
 *      user / messageStream. `apiKey` and the SMTP `options.password` are
 *      refused there by name; they are environment-only.
 *   2. `OS_EMAIL_*` environment variables (override per setting) — the only
 *      carrier of `OS_EMAIL_API_KEY` and `OS_EMAIL_SMTP_PASSWORD`
 *   3. Default → provider='log' (LogTransport, no real send)
 *
 * `appName` is the one key whose env layer is not `OS_EMAIL_*` — it is
 * `OS_APP_NAME`, because the same product name names the whole deployment,
 * not just its mail.
 *
 * Every key here is one `resolveEmailCapabilityArg` reads (the single reader
 * of `config.email`); the schema is the operator-facing contract for that
 * function, so a key the runtime honours and this object omits is a type
 * error on a config that boots fine — the declared ≠ implemented gap of
 * #5104 (provider='smtp') and #5307 (queueDelivery / appName /
 * defaultTemplateContext), both times with the spec on the lagging side.
 *
 * SMTP delivery is built in (ADR-0012): select it with provider='smtp'
 * and supply the connection through `options` (host / port / secure /
 * user / password) or the matching OS_EMAIL_SMTP_HOST / _PORT /
 * _SECURE / _USER / _PASSWORD environment variables. From a config file the
 * password always arrives through OS_EMAIL_SMTP_PASSWORD, which the reader
 * layers over the host / port / secure / user the file carries.
 */

/**
 * Outbound transport selector.
 *
 * - `log`     — LogTransport (development / CI; prints, no real delivery).
 * - `resend`  — Resend HTTPS API (https://resend.com). Requires `apiKey`.
 * - `postmark`— Postmark HTTPS API (https://postmarkapp.com). Requires `apiKey`.
 * - `smtp`    — any SMTP relay, self-hosted or managed. Shipped inside
 *               `@objectstack/plugin-email` as `SmtpTransport` (ADR-0012);
 *               its `nodemailer` dependency is a lazy import, so a
 *               deployment that never selects `smtp` never loads it.
 *               Connection settings live in `options` — see
 *               {@link EmailServiceConfigSchema}.
 *
 * This list is the operator-facing half of one vocabulary: the other half is
 * `EMAIL_TRANSPORT_PROVIDERS` in `@objectstack/plugin-email`, the array
 * `makeTransport` switches on. A cross-package contract test in that package
 * holds the two equal in both directions, because a value declared here with
 * no transport behind it advertises a provider no deployment can deliver
 * through — the declared-but-not-delivered defect of #5087 / #5094 — and a
 * transport missing from here is a capability authors are told they cannot
 * have.
 *
 * `sendgrid` and `ses` are deliberately NOT members: no HTTP-API transport for
 * either was ever implemented. Both publish an SMTP endpoint, so both are
 * configured as provider='smtp' — for SES, host `email-smtp.REGION.amazonaws.com`
 * with SES SMTP credentials (generated in the SES console; they are not AWS
 * access keys).
 */
export const EmailProviderSchema = lazySchema(() => z.enum(['log', 'resend', 'postmark', 'smtp']));
export type EmailProvider = z.input<typeof EmailProviderSchema>;

export const EmailAddressConfigSchema = lazySchema(() => z.object({
  name: z.string().optional().describe('Display name (e.g. "Acme CRM")'),
  address: z.string().email().describe('RFC-5322 address'),
}));
export type EmailAddressConfig = z.input<typeof EmailAddressConfigSchema>;

export const EmailServiceConfigSchema = lazySchema(() => z.object({
  /**
   * Transport provider. Defaults to `'log'` so unconfigured deployments
   * still boot — but mail will not actually be delivered.
   */
  provider: EmailProviderSchema.default('log')
    .describe('Transport to deliver through (OS_EMAIL_PROVIDER env). Default log — boots, sends nothing'),

  /**
   * API key for the selected provider (`resend` / `postmark`). Read
   * from `OS_EMAIL_API_KEY` env var when omitted. Ignored for `log`.
   */
  apiKey: z.string().optional().describe('Provider API key (or OS_EMAIL_API_KEY env)'),

  /**
   * Default `From` address used when a `send()` call omits `from`.
   * Required for any non-`log` provider; without it every send fails
   * VALIDATION_FAILED. `OS_EMAIL_FROM` env (`name <addr>` syntax)
   * supplies this when config is omitted.
   */
  defaultFrom: EmailAddressConfigSchema.optional(),

  /** Number of retry attempts on transport failure. Default 0. */
  retries: z.number().int().min(0).max(10).optional().describe('Retry attempts on transport throw'),

  /**
   * Persist each delivery attempt to `sys_email`. Default true; set
   * false for high-volume or PII-sensitive deployments that route
   * audit through their own pipeline.
   */
  persist: z.boolean().optional().describe('Persist to sys_email (default true)'),

  /**
   * Deliver through the durable `sys_job_queue` path instead of inline
   * (#5160). Default false — `send()` calls the transport in-process and
   * returns when it has answered.
   *
   * When true, `send()` persists the `sys_email` row, publishes an
   * `email.send.async` job referencing it and returns `status: 'queued'`
   * immediately; a worker delivers that row and finalizes it in place, so a
   * delivery survives a restart. `OS_EMAIL_QUEUE_ENABLED` overrides this per
   * environment (`1`/`true`/`yes`/`on` ⇒ on, anything else ⇒ off).
   *
   * Two things it does NOT do. It adds no second retry knob: `retries`
   * becomes the queue's attempt budget (`retries + 1` attempts, exponential
   * backoff, then DLQ) instead of driving an in-process loop. And it is not
   * a preference — declaring it here is a deployment declaration, so a boot
   * with no durable `queue` service (or with `persist: false`, which leaves
   * a queued job no row to deliver) FAILS on `kernel:ready` rather than
   * silently delivering inline. The Settings → Mail toggle is the opposite
   * trade: it degrades to inline and says so, because one save must not stop
   * the mail.
   */
  queueDelivery: z.boolean().optional()
    .describe(
      'Deliver through the durable sys_job_queue instead of inline (or OS_EMAIL_QUEUE_ENABLED env). '
      + 'Default false. Reuses `retries` as the queue attempt budget; requires a queue service '
      + 'and sys_email persistence, else the boot fails',
    ),

  /**
   * Provider-specific extras. Free-form object the selected transport
   * consumes; the keys each provider reads are:
   *
   * - `smtp` — `host` (required), `port`, `secure`, `user`, `password`.
   *   Each mirrors one environment variable, and env wins:
   *   `OS_EMAIL_SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD`.
   *   Booting provider='smtp' with no host resolved from either source is
   *   a hard error, never a silent fall back to `log`.
   * - `postmark` — `messageStream`.
   * - `log` / `resend` — nothing.
   */
  options: z.record(z.string(), z.unknown()).optional()
    .describe(
      'Provider-specific extras. smtp: host (required) / port / secure / user / password, '
      + 'mirroring OS_EMAIL_SMTP_HOST / _PORT / _SECURE / _USER / _PASSWORD. postmark: messageStream',
    ),

  /**
   * Product name templates render as `{{appName}}`, and the one piece of
   * template context this schema names explicitly because the runtime also
   * derives a *from-address* out of it.
   *
   * Resolved on a five-rung chain: `OS_APP_NAME` env → this key →
   * `defaultTemplateContext.appName` → the top-level `appName` of
   * `objectstack.config.ts` → `'ObjectStack'`. The resolved value is then
   * written into `defaultTemplateContext` as `appName`, so templates read one
   * answer whichever rung supplied it.
   *
   * This key and `defaultTemplateContext: { appName: … }` are therefore NOT
   * interchangeable — this one is the higher rung, and both lose to the env
   * var. That ordering was settled by #5448 (implemented in PR #5498): before
   * it, the whole context was spread OVER the resolved value, which made
   * `OS_APP_NAME` inert for any config that spelled the context form — the one
   * per-environment lever over a repo-pinned config, silently doing nothing.
   *
   * When no `defaultFrom` resolves from any source, the resolved app name
   * also becomes the placeholder sender — `Acme CRM` ⇒
   * `Acme CRM <no-reply@acme-crm.local>` — which only ever leaves the box
   * through a real transport, so configure `defaultFrom` before selecting
   * one.
   */
  appName: z.string().optional()
    .describe(
      // No `{{…}}` in this string: the docs generator escapes a doubled brace
      // into MDX as `` `{{x}` `` plus a stray `}` (three such sites already on
      // main — filed as #5452), so the name is spelled without them.
      'Product name templates interpolate as the appName variable — OS_APP_NAME env wins, then '
      + 'this, then defaultTemplateContext.appName, then the top-level config appName, then '
      + '"ObjectStack". Also seeds the placeholder no-reply sender when no defaultFrom is configured',
    ),

  /**
   * Render context merged into every `sendTemplate()` call, under the
   * per-call `data`. Free-form on purpose: the CLI passes this object
   * through to `EmailServicePlugin` as written — `appName` excepted, see
   * below — and the template engine resolves whatever names a template
   * happens to reference, so there is no closed vocabulary here to declare —
   * put the values your own templates interpolate (support address, brand
   * URL, footer text …).
   *
   * One key is not passed through as written: `appName`. It is always
   * present in the delivered context, and its value comes from the chain on
   * the `appName` key above — `OS_APP_NAME` → `appName` → this map's
   * `appName` → the top-level config `appName` → `'ObjectStack'`. So writing
   * it here still works (it is the third rung, and a config that spells only
   * this form keeps its name), but the env var and the dedicated key both
   * override it.
   *
   * It used to be the other way round: the resolver computed the value and
   * then spread this whole map OVER it, which made `OS_APP_NAME` inert and
   * broke the header's "env overrides per setting" on exactly one key.
   * #5448 settled that the env must win (implemented in PR #5498), and the
   * exception is gone. Every OTHER key here has no env or dedicated-config
   * carrier, so it remains the only source for itself and reaches templates
   * verbatim.
   */
  defaultTemplateContext: z.record(z.string(), z.unknown()).optional()
    .describe(
      'Free-form render context merged into every sendTemplate() call, under the per-call data. '
      + 'Passed through unchanged except appName, which is resolved by its own chain — '
      + 'OS_APP_NAME and the appName key both override the value written here',
    ),
}));
export type EmailServiceConfig = z.input<typeof EmailServiceConfigSchema>;
/** Post-parse shape of {@link EmailServiceConfig} — defaults applied, transforms run (ADR-0122). */
export type EmailServiceConfigParsed = z.infer<typeof EmailServiceConfigSchema>;

/**
 * The one prescription for a provider API key written into a stack definition,
 * shared by the two places an author can write one (`email.apiKey`, and
 * `email.options.apiKey`, which `makeTransport` spreads over the key for
 * resend / postmark).
 */
const STACK_EMAIL_API_KEY_PRESCRIPTION =
  'Not authorable here. A provider API key is a credential, and a stack definition is compiled into the '
  + 'published artifact — set OS_EMAIL_API_KEY in the deployment environment instead (required for provider '
  + 'resend / postmark).';

/**
 * `email.options` of a stack definition — the NON-SECRET provider extras.
 *
 * {@link EmailServiceConfigSchema}'s `options` is a free-form record whose
 * TSDoc names the keys each transport reads: smtp `host` / `port` / `secure` /
 * `user` / `password`, postmark `messageStream`. A stack definition is what
 * `objectstack build` compiles into the artifact, and artifacts are published,
 * so this block declares those keys minus the credential: the SMTP `password`
 * (and an `apiKey`, which `makeTransport` would spread over the real one) is
 * refused by name with its environment variable. The reader layers
 * `OS_EMAIL_SMTP_*` over this block per key, so a file that carries host and
 * user and an environment that carries `OS_EMAIL_SMTP_PASSWORD` compose into
 * one working SMTP connection.
 *
 * Strict, unlike the record it narrows: a key no transport documents (raw
 * `transportOptions`, `timeout`, `endpoint`) is refused rather than shipped
 * into an artifact unexamined — `transportOptions` in particular is the SMTP
 * escape hatch that can carry credentials of its own.
 */
export const StackEmailProviderOptionsSchema = lazySchema(() => strictObject(
  {
    surface: 'the stack `email.options` block',
    history:
      'This block is strict from birth — a stack definition carried no `email` key before it, so an unknown '
      + 'key here was never accepted.',
    guidance: {
      password:
        'Not authorable here. The SMTP password is a credential, and a stack definition is compiled into the '
        + 'published artifact — set OS_EMAIL_SMTP_PASSWORD in the deployment environment instead; it is layered '
        + 'over the host / port / secure / user this block carries.',
      apiKey: STACK_EMAIL_API_KEY_PRESCRIPTION,
    },
  },
  {
    host: z.string().optional()
      .describe('SMTP server hostname (OS_EMAIL_SMTP_HOST env wins). Required for provider smtp unless the env supplies it'),
    port: z.number().int().optional()
      .describe('SMTP port (OS_EMAIL_SMTP_PORT env wins). Default 587; 465 selects implicit TLS'),
    secure: z.boolean().optional()
      .describe('Require TLS (OS_EMAIL_SMTP_SECURE env wins). Default true'),
    user: z.string().optional()
      .describe('SMTP AUTH username (OS_EMAIL_SMTP_USER env wins). Its password is environment-only: OS_EMAIL_SMTP_PASSWORD'),
    messageStream: z.string().optional()
      .describe('Postmark message stream. Default outbound'),
  },
));
export type StackEmailProviderOptions = z.input<typeof StackEmailProviderOptionsSchema>;
/** Post-parse shape of {@link StackEmailProviderOptions} — defaults applied, transforms run (ADR-0122). */
export type StackEmailProviderOptionsParsed = z.infer<typeof StackEmailProviderOptionsSchema>;

/**
 * `email` of a stack definition — what `objectstack.config.ts` may carry of
 * {@link EmailServiceConfigSchema}.
 *
 * DERIVED, not transcribed: every member of that schema except the credential
 * `apiKey`, with `options` narrowed to {@link StackEmailProviderOptionsSchema}.
 * A key added to the operator contract therefore arrives here the day it
 * lands; a secret one has to be omitted here on purpose, in this expression.
 *
 * Why the credentials stop at this door: the stack definition is what
 * `objectstack build` compiles into the artifact, and artifacts are published
 * (the marketplace ingest stores them). So a credential is refused BY NAME,
 * with the environment variable that carries it, rather than as a bare unknown
 * key — the same answer the stack gives `storage`. Everything else the reader
 * reads (`resolveEmailCapabilityArg` in `@objectstack/plugin-email`, which
 * `objectstack serve` and `bootStack` both construct the email provider
 * through) is authorable here, and `OS_EMAIL_*` still overrides it per key.
 */
export const StackEmailConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'the stack `email` block',
    history:
      'This block is strict from birth — a stack definition carried no `email` key before it, so an unknown '
      + 'key here was never accepted.',
    aliases: { from: 'defaultFrom' },
    guidance: { apiKey: STACK_EMAIL_API_KEY_PRESCRIPTION },
  },
  {
    ...EmailServiceConfigSchema.omit({ apiKey: true, options: true }).shape,
    options: StackEmailProviderOptionsSchema.optional()
      .describe(
        'Provider-specific extras, non-secret members only. smtp: host / port / secure / user, mirroring '
        + 'OS_EMAIL_SMTP_HOST / _PORT / _SECURE / _USER (the password is OS_EMAIL_SMTP_PASSWORD only). '
        + 'postmark: messageStream',
      ),
  },
));
export type StackEmailConfig = z.input<typeof StackEmailConfigSchema>;
/** Post-parse shape of {@link StackEmailConfig} — defaults applied, transforms run (ADR-0122). */
export type StackEmailConfigParsed = z.infer<typeof StackEmailConfigSchema>;
