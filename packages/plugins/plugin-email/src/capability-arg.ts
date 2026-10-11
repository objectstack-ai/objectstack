// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `EmailServicePlugin` is constructed with on a served boot: the
 * deployment's mail configuration (`config.email`, `OS_EMAIL_*`, `OS_APP_NAME`),
 * read into the plugin's options — and refused when no transport this package
 * ships can deliver through it.
 *
 * ## Why this lives here, and not in `@objectstack/cli` or `@objectstack/core`
 *
 * It was written in `os serve`'s command body (`@objectstack/cli`), which read
 * the provider vocabulary from this package "rather than restated here"
 * (#5132): the reader has to refuse exactly the configurations `makeTransport`
 * cannot build. For one configuration, `@objectstack/verify`'s `bootStack`
 * composes what `serve` composes (#22301, ruling A) — the email provider
 * included, built from the same configuration — and the handle cannot import
 * the CLI (`@objectstack/cli` depends on `@objectstack/verify`). The rule for
 * which token gets which argument moved to `@objectstack/core`
 * (`resolveCapabilityArgument`), but `@objectstack/core` cannot import this
 * package either (this package depends on it). So the reader lives beside the
 * vocabulary it refuses against, and `resolveCapabilityArgument` reads it off
 * this module — the module every boot already loads to construct
 * `EmailServicePlugin`. `@objectstack/cli` re-exports both names from here.
 * ⛔ Never a second copy beside a reader.
 */

import {
  emailProviderRequiresApiKey,
  isEmailTransportProvider,
  unsupportedProviderFix,
} from './transports/index.js';

/**
 * Constructor options for `EmailServicePlugin`.
 *
 * There is no `warning` channel here any more (#5132). It carried exactly one
 * message — "provider=resend but no apiKey, falling back to LogTransport" —
 * and that fallback is now a throw, because a mail configuration that cannot
 * deliver has no "degraded but still fine" reading: it is a server that
 * accepts every send and delivers nothing.
 */
export interface EmailCapabilityArg {
  options: Record<string, unknown>;
}

/**
 * The ONE truth table this file reads its `OS_EMAIL_*_ENABLED` booleans with
 * (#5447).
 *
 * Extracted rather than restated: `OS_EMAIL_QUEUE_ENABLED` carried this list
 * inline, and a second boolean flag written a second way is how one env var
 * ends up accepting `on` while its neighbour does not — the operator-visible
 * half of the "two literals describing one vocabulary" trap that split the
 * settings dropdown from the transports (#5094).
 *
 * Tri-state on purpose: `undefined` means the variable is unset and the caller
 * must fall through to config, which is what keeps an absent flag from
 * silently reading as `false` and overriding a config that said `true`.
 * An empty string is a SET variable and resolves to `false`, matching the
 * behaviour `OS_EMAIL_QUEUE_ENABLED` already had.
 */
function envBooleanFlag(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/**
 * The deployment's product name: `OS_APP_NAME` > `config.email.appName` >
 * `config.email.defaultTemplateContext.appName` > top-level `config.appName` >
 * `'ObjectStack'` (the chain {@link resolveEmailCapabilityArg} documents).
 *
 * ONE resolver for every boot-time consumer of the name, so they cannot
 * disagree: the email capability's template context, and the `appName`
 * AuthPlugin receives (the auth emails' `{{appName}}` and the TOTP issuer an
 * authenticator app lists the account under). AuthPlugin used to be built
 * without it, so `OS_APP_NAME` never reached auth: its emails, whose own
 * `appName` outranks the template context, said 'ObjectStack'.
 */
export function resolveDeploymentAppName(
  cfgEmail: Record<string, any> = {},
  env: NodeJS.ProcessEnv = process.env,
  configAppName?: string,
): string {
  return env.OS_APP_NAME || cfgEmail.appName || cfgEmail.defaultTemplateContext?.appName
    || configAppName || 'ObjectStack';
}

/**
 * Resolve what `EmailServicePlugin` is constructed with, from `config.email`
 * plus `OS_EMAIL_*` env (env wins, so an operator can override per environment).
 *
 * SMTP (#5087, ADR-0012) is configured through `OS_EMAIL_SMTP_HOST` / `_PORT` /
 * `_SECURE` / `_USER` / `_PASSWORD` — the `OS_{DOMAIN}_{FEATURE}_{QUALIFIER}`
 * shape of Prime Directive #9, grouped with the email vars rather than the bare
 * third-party `SMTP_*` names — layered over `config.email.options`.
 *
 * **Every provider that cannot deliver throws** — `smtp` with no host, and
 * (since #5132) `resend`/`postmark` with no API key, or a provider tag outside
 * `EMAIL_TRANSPORT_PROVIDERS` altogether. The capability loop turns that into a
 * loud failure — a hard boot error when the app declared `requires: ['email']`,
 * otherwise a `console.error` and no email service — which is the point: the
 * alternative (quietly substituting the LogTransport, as this function's
 * `resend`/`postmark` arm used to do for a missing API key) hands the operator a
 * server that accepts every send, records it in `sys_email` as sent, and
 * delivers nothing — the exact declared-but-not-delivered gap #5087 closed
 * inside the plugin, left behind one layer up.
 *
 * Refusing is only defensible because "this environment does not send mail" has
 * a way to say itself: `OS_EMAIL_PROVIDER=log` (the default). An operator who
 * names a delivery provider has declared an intent, and the honest answer to an
 * intent we cannot honour is a failure, not a substitute transport.
 *
 * The provider vocabulary and the "needs an API key" question are both read
 * from `@objectstack/plugin-email` — the package that has to materialise the
 * transport — rather than restated here. Two literals describing one vocabulary
 * is how the settings dropdown and the transports drifted apart (#5094).
 *
 * `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) switches
 * delivery from inline to the durable `sys_job_queue` path (#5160). It reuses
 * `OS_EMAIL_RETRIES` as its attempt budget rather than adding a second retry
 * knob — see `EmailServicePlugin.makeQueueDelivery`.
 *
 * `OS_EMAIL_PERSIST_ENABLED=false` (or `config.email.persist: false`) stops
 * every delivery attempt being written to `sys_email` (#5447). The plugin
 * option has been live since the plugin had one — it builds no
 * `EmailPersistence` when `persist === false` — but nothing carried the
 * declared `config.email.persist` here, so a PII-sensitive deployment that
 * switched persistence off in `objectstack.config.ts` type-checked, parsed,
 * read "Persist to sys_email (default true)" in the generated reference, and
 * went on writing every message body to the database. Resolution order is this
 * function's own, per setting: env > `config.email.persist` > the plugin
 * default (persist ON) — so a config and an env that say nothing leave the
 * option absent and the plugin's default untouched.
 *
 * The template context's `appName` follows the same env-wins rule as every
 * other setting here (#5448): `OS_APP_NAME` > `config.email.appName` >
 * `config.email.defaultTemplateContext.appName` > top-level `config.appName` >
 * `'ObjectStack'`. It used to be the file's one exception — the whole
 * `defaultTemplateContext` was spread OVER the resolved value, so a config that
 * spelled `defaultTemplateContext: { appName: … }` made `OS_APP_NAME` inert and
 * the per-environment override an operator has for a repo-pinned config did
 * nothing, silently, in the mail body AND in the `no-reply@<slug>.local`
 * fallback sender derived from it. Every OTHER key of `defaultTemplateContext`
 * is unchanged: it has no env or dedicated-config carrier, so the author's
 * context is still spread through wholesale.
 */
export function resolveEmailCapabilityArg(
  cfgEmail: Record<string, any> = {},
  env: NodeJS.ProcessEnv = process.env,
  configAppName?: string,
): EmailCapabilityArg {
  const provider = String(env.OS_EMAIL_PROVIDER || cfgEmail.provider || 'log').toLowerCase();
  const apiKey = env.OS_EMAIL_API_KEY || cfgEmail.apiKey;

  // OS_EMAIL_FROM supports either "addr@x" or "Name <addr@x>".
  let defaultFrom = cfgEmail.defaultFrom;
  if (env.OS_EMAIL_FROM) {
    const m = env.OS_EMAIL_FROM.match(/^\s*(?:"?([^"<]*?)"?\s*<\s*([^>]+)\s*>|(\S+))\s*$/);
    if (m) {
      const name = (m[1] ?? '').trim();
      const address = (m[2] ?? m[3] ?? '').trim();
      if (address) defaultFrom = name ? { name, address } : { address };
    }
  }
  const retries = env.OS_EMAIL_RETRIES ? Number(env.OS_EMAIL_RETRIES) : cfgEmail.retries;
  // `OS_EMAIL_QUEUE_ENABLED` — a boolean feature flag, so `_ENABLED` and
  // default-off (Prime Directive #9; a bare `OS_EMAIL_QUEUE` would read as a
  // config value, e.g. a queue name). Whether the declaration can be HONOURED
  // is not knowable here — no kernel exists yet — so the plugin asserts it on
  // `kernel:ready`, where the service registry has settled, and fails the boot
  // there if no durable queue showed up.
  const queueDelivery = envBooleanFlag(env.OS_EMAIL_QUEUE_ENABLED) ?? cfgEmail.queueDelivery;
  // `OS_EMAIL_PERSIST_ENABLED` — the carrier `config.email.persist` never had
  // (#5447). `_ENABLED` is Prime Directive #9's boolean-flag shape; unlike the
  // queue flag it is default-ON rather than default-off, because it does not
  // enable a new capability — it is the off switch for one that has always
  // been on, and a deployment that says nothing must keep its `sys_email`
  // audit trail. Absent from BOTH sources means the key is left out of the
  // constructor options entirely, so the plugin's own default decides.
  const persist = envBooleanFlag(env.OS_EMAIL_PERSIST_ENABLED) ?? cfgEmail.persist;
  // `appName` is resolved AFTER the context spread, not before it (#5448).
  // The other keys of `defaultTemplateContext` are still spread wholesale and
  // are the only source for themselves; `appName` alone has dedicated carriers
  // above it, and this file's stated contract — "env overrides per setting" —
  // has to hold for it like it does for apiKey / defaultFrom / retries /
  // queueDelivery / persist / SMTP. Spreading the context over the resolved
  // value inverted exactly that one key: an author who wrote
  // `defaultTemplateContext: { appName: 'Acme Dev' }` made `OS_APP_NAME`
  // silently inert, so the one lever an operator has for a repo-pinned config
  // deployed to several environments did nothing — and since the fallback
  // sender is slugged from this value, the wrong name reached the envelope as
  // well as the body.
  //
  // `defaultTemplateContext.appName` stays IN the chain rather than losing to
  // the two dedicated sources and vanishing: dropping it would demote every
  // config that spells only the context form straight to 'ObjectStack',
  // trading one silently wrong value for a worse one. Order: env >
  // `config.email.appName` > `config.email.defaultTemplateContext.appName` >
  // top-level `config.appName` > 'ObjectStack'.
  const cfgTemplateContext = cfgEmail.defaultTemplateContext || {};
  const defaultTemplateContext = {
    ...cfgTemplateContext,
    appName: resolveDeploymentAppName(cfgEmail, env, configAppName),
  };
  // Provide a sensible fallback `from` so templates can render even before
  // operators configure SMTP/SaaS. The log transport simply prints to stdout;
  // the address never leaves the box.
  if (!defaultFrom) {
    const slug = String(defaultTemplateContext.appName || 'objectstack')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'objectstack';
    defaultFrom = { name: defaultTemplateContext.appName, address: `no-reply@${slug}.local` };
  }

  const smtpEnv: Record<string, unknown> = {};
  const smtpHost = env.OS_EMAIL_SMTP_HOST?.trim();
  if (smtpHost) smtpEnv.host = smtpHost;
  if (env.OS_EMAIL_SMTP_PORT) smtpEnv.port = Number(env.OS_EMAIL_SMTP_PORT);
  if (env.OS_EMAIL_SMTP_SECURE != null) {
    const raw = String(env.OS_EMAIL_SMTP_SECURE).trim().toLowerCase();
    smtpEnv.secure = raw !== 'false' && raw !== '0';
  }
  if (env.OS_EMAIL_SMTP_USER) smtpEnv.user = env.OS_EMAIL_SMTP_USER;
  if (env.OS_EMAIL_SMTP_PASSWORD) smtpEnv.password = env.OS_EMAIL_SMTP_PASSWORD;
  const providerOptions = { ...(cfgEmail.options ?? {}), ...smtpEnv };

  const options: Record<string, unknown> = {
    provider,
    ...(apiKey ? { apiKey } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
    defaultFrom,
    ...(retries != null && !Number.isNaN(retries) ? { retries } : {}),
    ...(queueDelivery != null ? { queueDelivery: !!queueDelivery } : {}),
    ...(persist != null ? { persist: !!persist } : {}),
    defaultTemplateContext,
  };

  if (!isEmailTransportProvider(provider)) {
    throw new Error(
      `provider='${provider}' is not a transport this server can deliver through, so no mail would go out — `
      + `${unsupportedProviderFix(provider)} `
      + 'On this boot path the provider is OS_EMAIL_PROVIDER or config.email.provider; set '
      + 'OS_EMAIL_PROVIDER=log if this environment is not meant to send mail.',
    );
  }
  if (provider === 'smtp' && !providerOptions.host) {
    throw new Error(
      "provider='smtp' selects SMTP delivery but no SMTP host is configured — set OS_EMAIL_SMTP_HOST "
      + '(plus OS_EMAIL_SMTP_PORT / _SECURE / _USER / _PASSWORD) or config.email.options.host, '
      + 'or choose another provider.',
    );
  }
  if (emailProviderRequiresApiKey(provider) && !apiKey) {
    throw new Error(
      `provider='${provider}' selects ${provider} delivery but no API key is configured, so every send would `
      + 'be recorded in sys_email as sent and nothing would leave the box — set OS_EMAIL_API_KEY '
      + '(or config.email.apiKey), or set OS_EMAIL_PROVIDER=log if this environment is not meant to send mail.',
    );
  }
  return { options };
}
