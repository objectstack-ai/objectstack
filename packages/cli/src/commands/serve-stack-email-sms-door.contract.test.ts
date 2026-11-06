// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A `defineStack`-built `email` / `sms` / `appName` reaches the providers
// `objectstack serve` constructs.
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
// `push` is the push service configuration whole (`PushServiceConfigSchema`),
// read only when the stack declares `requires: ['push']` (the token is not on
// the always-on slate): the direct transport reaches `PushServicePlugin`, and
// the relay — what an absent key reads as — is refused before the kernel
// boots, as is an inline secret a compiled artifact may still carry.
//
// `sms` carries `retries` alone: the stack refuses `sms.provider` by name,
// because the delivering SMS transport is built by the `sms` settings
// namespace from its own provider setting (`OS_SMS_PROVIDER`), so the provider
// below always comes from the environment.

import { describe, it, expect } from 'vitest';
import { resolveCapabilityArgument } from '@objectstack/core';
import { defineStack } from '@objectstack/spec';
import * as pluginEmail from '@objectstack/plugin-email';
import * as serviceSms from '@objectstack/service-sms';
import * as servicePush from '@objectstack/service-push';

const manifest = {
  id: 'com.example.mailer',
  name: 'mailer',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'mailer',
};

/** The argument `serve`'s capability loop constructs the provider with, for this stack and environment. */
function argumentFor(token: 'email' | 'sms' | 'push', stack: unknown, env: NodeJS.ProcessEnv): Record<string, any> {
  return resolveCapabilityArgument(token, {
    stack,
    packageRoot: '/app',
    providerModule: token === 'email' ? pluginEmail : token === 'sms' ? serviceSms : servicePush,
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

  it('sms { retries } reaches the SMS provider, beside the provider OS_SMS_PROVIDER names', () => {
    const stack = defineStack({ manifest, sms: { retries: 3 } });
    expect(argumentFor('sms', stack, {})).toEqual({ provider: 'log', retries: 3 });
    expect(argumentFor('sms', stack, { OS_SMS_PROVIDER: 'twilio' })).toEqual({ provider: 'twilio', retries: 3 });
  });

  it('OS_EMAIL_* still override the stack per key', () => {
    const stack = defineStack({ manifest, email: { provider: 'log', retries: 1 } });
    const email = argumentFor('email', stack, { OS_EMAIL_PROVIDER: 'smtp', OS_EMAIL_SMTP_HOST: 'relay.example', OS_EMAIL_RETRIES: '4' });
    expect(email.provider).toBe('smtp');
    expect(email.retries).toBe(4);
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

describe("a defineStack-built push block reaches the PushServicePlugin serve constructs for requires: ['push']", () => {
  const apns = { teamId: 'ABCDE12345', keyId: 'KEY1234567', topic: 'com.example.app', environment: 'production' as const };

  it('the push token keys PushServicePlugin in the table serve resolves requires through, and is not appended to every app', async () => {
    const { CAPABILITY_PROVIDERS, resolveServedCapabilities } = await import('@objectstack/core');
    expect(CAPABILITY_PROVIDERS.push).toMatchObject({ pkg: '@objectstack/service-push', export: 'PushServicePlugin' });
    expect(resolveServedCapabilities(['push']).tokens).toContain('push');
    expect(resolveServedCapabilities([]).tokens).not.toContain('push');
  });

  it('a direct block reaches the plugin, and the plugin built from it registers the push service', async () => {
    const stack = defineStack({
      manifest,
      requires: ['push'],
      push: { transport: 'direct', apns: { ...apns, credentialRef: 'APNS_SIGNING_KEY' } },
    });
    const argument = argumentFor('push', stack, {});
    expect(argument).toEqual({ config: { transport: 'direct', apns: { ...apns, credentialRef: 'APNS_SIGNING_KEY' } } });

    const services = new Map<string, unknown>();
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    await new servicePush.PushServicePlugin(argument).init({ registerService: (n: string, v: unknown) => services.set(n, v), logger } as never);
    expect((services.get('push') as { vendors(): string[] }).vendors()).toEqual(['apns']);
  });

  it.each([
    ['no push key', {}],
    ['push: {}', { push: {} }],
    ["push: { transport: 'relay' }", { push: { transport: 'relay' as const } }],
  ])('%s reaches the plugin as the relay; under OS_CLOUD_URL=off it is refused at boot, naming the air gap and the direct transport', (_name, extra) => {
    const stack = defineStack({ manifest, requires: ['push'], ...extra });
    const boot = () => argumentFor('push', stack, {});
    const saved = process.env.OS_CLOUD_URL;
    try {
      delete process.env.OS_CLOUD_URL;
      expect(boot()).toEqual({ config: { transport: 'relay' } });
      process.env.OS_CLOUD_URL = 'off';
      expect(boot).toThrow(servicePush.PUSH_RELAY_AIR_GAPPED_MESSAGE);
      expect(boot).toThrow(/declared it has no control plane/);
      expect(boot).toThrow(/transport: 'direct'/);
    } finally {
      if (saved === undefined) delete process.env.OS_CLOUD_URL;
      else process.env.OS_CLOUD_URL = saved;
    }
  });

  it('an inline secret in a configuration defineStack never built is refused at boot, by name, value not echoed', () => {
    // A compiled artifact or a plain object reaches the boot without the
    // authoring door, so the boot judges the key again.
    const raw = { manifest, requires: ['push'], push: { transport: 'direct', fcm: { projectId: 'p', credentialRef: 'FCM', serviceAccount: '{"private_key":"SECRET-VALUE"}' } } };
    const boot = () => argumentFor('push', raw, {});
    expect(boot).toThrow(/push\.fcm: Unrecognized key/);
    expect(boot).toThrow(/`credentialRef`/);
    expect(boot).not.toThrow(/SECRET-VALUE/);
  });
});
