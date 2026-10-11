// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A `defineStack`-built `email` / `sms` / `appName` reaches the providers
// `objectstack serve` constructs — and the SMS provider vocabulary the stack
// declares is the one the transports can build.
//
// The stack definition used to refuse all three keys while the mail and SMS
// readers read them, so the configuration arm of both readers was reachable
// only from a config `defineStack` did not build. The stack now admits their
// non-secret members (credentials stay environment-only); this file proves the
// admitted shape is the one the readers read, by driving the call `serve` makes
// for every capability provider — `resolveCapabilityArgument`
// (`@objectstack/core`) with the provider module — on a stack `defineStack`
// returned. That `serve` makes exactly that call with `stack: config` and
// `env: process.env`, and builds AuthPlugin's name from
// `resolveDeploymentAppName(config.email, process.env, config.appName)`, is
// pinned by the source scan in `serve-auth-app-name.contract.test.ts`; the two
// files together are the reading from authored stack to constructed provider.
//
// The second half is a CROSS-PACKAGE vocabulary assertion, for the reason
// `@objectstack/plugin-email`'s `spec-provider-parity.contract.test.ts` gives
// for mail: `SmsProviderSchema` (the authoring contract) and
// `SMS_TRANSPORT_PROVIDERS` (the array `makeSmsTransport` switches on) are two
// literals describing one vocabulary, and two literals left alone drift. It
// lives here because this package depends on both `@objectstack/spec` and
// `@objectstack/service-sms`; the SMS package's own tests read no spec value.
// This package's `tsconfig.json` includes `src`, tests and all, so the
// compile-time half below is real.

import { describe, it, expect } from 'vitest';
import { resolveCapabilityArgument } from '@objectstack/core';
import { defineStack } from '@objectstack/spec';
import { SmsProviderSchema, type SmsProvider } from '@objectstack/spec/system';
import * as pluginEmail from '@objectstack/plugin-email';
import * as serviceSms from '@objectstack/service-sms';
import { SMS_TRANSPORT_PROVIDERS, type SmsProviderTag } from '@objectstack/service-sms';

const manifest = {
  id: 'com.example.mailer',
  name: 'mailer',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'mailer',
};

/** The argument `serve`'s capability loop constructs the provider with, for this stack and environment. */
function argumentFor(token: 'email' | 'sms', stack: unknown, env: NodeJS.ProcessEnv): Record<string, any> {
  return resolveCapabilityArgument(token, {
    stack,
    packageRoot: '/app',
    providerModule: token === 'email' ? pluginEmail : serviceSms,
    env,
  }).argument as Record<string, any>;
}

describe('a defineStack-built email / sms / appName reaches the providers serve constructs', () => {
  it('email { provider, defaultFrom, options } reaches the email provider, with the env-only password layered over', () => {
    const stack = defineStack({
      manifest,
      appName: 'Acme',
      email: {
        provider: 'smtp',
        defaultFrom: { name: 'Acme', address: 'no-reply@acme.example' },
        persist: false,
        options: { host: 'smtp.acme.example', user: 'mailer' },
      },
    });
    const argument = argumentFor('email', stack, { OS_EMAIL_SMTP_PASSWORD: 'from-the-environment' });

    expect(argument.provider).toBe('smtp');
    expect(argument.defaultFrom).toEqual({ name: 'Acme', address: 'no-reply@acme.example' });
    expect(argument.persist).toBe(false);
    // The file carries host and user; the credential the stack refuses arrives
    // from the environment and composes with them into one SMTP connection.
    expect(argument.providerOptions).toEqual({ host: 'smtp.acme.example', user: 'mailer', password: 'from-the-environment' });
    // The top-level appName is the reader's configured bottom rung.
    expect(argument.defaultTemplateContext.appName).toBe('Acme');
    // …and AuthPlugin's name, by the call serve makes for it.
    expect(pluginEmail.resolveDeploymentAppName(stack.email ?? {}, {}, stack.appName)).toBe('Acme');
  });

  it('sms { provider, retries } reaches the SMS provider', () => {
    const stack = defineStack({ manifest, sms: { provider: 'twilio', retries: 3 } });
    expect(argumentFor('sms', stack, {})).toEqual({ provider: 'twilio', retries: 3 });
  });

  it('OS_EMAIL_* / OS_SMS_PROVIDER still override the stack per key', () => {
    const stack = defineStack({ manifest, email: { provider: 'log', retries: 1 }, sms: { provider: 'log' } });
    const email = argumentFor('email', stack, { OS_EMAIL_PROVIDER: 'smtp', OS_EMAIL_SMTP_HOST: 'relay.example', OS_EMAIL_RETRIES: '4' });
    expect(email.provider).toBe('smtp');
    expect(email.retries).toBe(4);
    expect(argumentFor('sms', stack, { OS_SMS_PROVIDER: 'aliyun' }).provider).toBe('aliyun');
  });

  it('CONTROL — env-only configuration is unchanged: a stack with no block builds what the reader builds from no config', () => {
    const stack = defineStack({ manifest });
    const env = {
      OS_EMAIL_PROVIDER: 'resend',
      OS_EMAIL_API_KEY: 're_from_env',
      OS_EMAIL_FROM: 'Ops <ops@acme.example>',
      OS_APP_NAME: 'Env Name',
      OS_SMS_PROVIDER: 'aliyun',
    };
    const email = argumentFor('email', stack, env);
    expect(email).toEqual(pluginEmail.resolveEmailCapabilityArg({}, env).options);
    expect(email.provider).toBe('resend');
    expect(email.apiKey).toBe('re_from_env');
    expect(email.defaultTemplateContext.appName).toBe('Env Name');
    expect(argumentFor('sms', stack, env)).toEqual(serviceSms.resolveSmsCapabilityArg({}, env).options);
    expect(argumentFor('sms', stack, env)).toEqual({ provider: 'aliyun' });
  });
});

/**
 * Compile-time halves of the vocabulary invariant: each union must be
 * assignable to the other, so a member added on one side only makes `true`
 * unassignable — a type error in this package's `typecheck`.
 */
type SpecAssignableToTransport = SmsProvider extends SmsProviderTag ? true : never;
type TransportAssignableToSpec = SmsProviderTag extends SmsProvider ? true : never;
const MUTUALLY_ASSIGNABLE: [SpecAssignableToTransport, TransportAssignableToSpec] = [true, true];

describe('SmsProviderSchema ↔ SMS_TRANSPORT_PROVIDERS', () => {
  it('declares exactly the providers the SMS transports can build, both directions', () => {
    expect(MUTUALLY_ASSIGNABLE).toEqual([true, true]);
    const declared = [...SmsProviderSchema.options].sort();
    const buildable = [...SMS_TRANSPORT_PROVIDERS].sort();
    expect(declared.filter((p) => !buildable.includes(p as SmsProviderTag))).toEqual([]);
    expect(buildable.filter((p) => !declared.includes(p))).toEqual([]);
    // Anti-vacuity: two empty lists would agree.
    expect(buildable.length).toBeGreaterThan(1);
  });
});
