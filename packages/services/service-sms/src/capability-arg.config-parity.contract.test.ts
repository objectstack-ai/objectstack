// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The SMS configuration's two faces ↔ one set of `OS_SMS_*` credential
// variables: the config-parity contract for `resolveSmsCapabilityArg`, on the
// shape of `@objectstack/plugin-email`'s file of the same name.
//
// Mail's file holds `config.email`'s declared schema equal to the keys its
// resolver reads. What SMS has to hold equal is one step earlier: its
// credentials have TWO readers, and nothing tied them together.
//
//   - The settings face. `SettingsService` locks every `sms` namespace key to
//     its env override (`envKeyOf('sms', key)`, e.g. `OS_SMS_TWILIO_AUTH_TOKEN`),
//     and `SmsServicePlugin` reads the namespace at `kernel:ready`.
//   - The constructor face. `resolveSmsCapabilityArg` builds the plugin's
//     options at boot, for `os serve` and for `@objectstack/verify`'s
//     `bootStack` alike.
//
// The constructor face used to read no credential at all, and the plugin read
// only the namespace's own `provider`. So a configuration naming
// `provider: 'twilio'`, with the Twilio keys in the environment and no
// `OS_SMS_PROVIDER`, booted on `LogSmsTransport` with
// `isConfigured() === false` (measured through `bootStack`). Now the resolver
// reads the same variables, through the table the plugin reads the namespace
// through (`SMS_PROVIDER_SETTING_KEYS`). This file is what keeps the variables
// meaning one thing on both faces:
//
//   1. the table maps exactly the keys the `sms` manifest declares per provider;
//   2. the resolver reads each of them under the name `SettingsService` locks
//      it with, env over config per credential (the mail rule);
//   3. one environment builds one transport, through either face.
//
// Cross-package on purpose, as `sms-manifest-providers.contract.test.ts`
// beside it is: `@objectstack/service-settings` is a devDependency, test-only,
// so a list pinned in this package cannot be "fixed" by editing the other one.

import { describe, it, expect, vi } from 'vitest';
import { envKeyOf, SettingsService, smsSettingsManifest } from '@objectstack/service-settings';
import { resolveSmsCapabilityArg } from './capability-arg.js';
import { SmsServicePlugin, type SmsServicePluginOptions } from './sms-plugin.js';
import { LogSmsTransport, type SmsService } from './sms-service.js';
import {
  AliyunSmsTransport,
  SMS_PROVIDER_SETTING_KEYS,
  SMS_TRANSPORT_PROVIDERS,
  TwilioSmsTransport,
  type SmsDeliveringProvider,
} from './transports/index.js';

const DELIVERING = SMS_TRANSPORT_PROVIDERS.filter((p): p is SmsDeliveringProvider => p !== 'log');

const TRANSPORT_CLASS: Record<SmsDeliveringProvider, new (...args: any[]) => unknown> = {
  aliyun: AliyunSmsTransport,
  twilio: TwilioSmsTransport,
};

/**
 * The keys the `sms` manifest declares for `provider`, grouped by the
 * manifest's own `visible` expression — the form shows a key exactly when its
 * provider is selected, so that expression IS the manifest's grouping.
 */
function keysDeclaredFor(provider: string): string[] {
  const shownWhen = "${data.provider === '" + provider + "'}";
  return (smsSettingsManifest.specifiers as Array<Record<string, unknown>>)
    .filter((s) => typeof s.key === 'string' && s.visible === shownWhen)
    .map((s) => s.key as string)
    .sort();
}

/**
 * A complete credential environment for `provider`, named by
 * `SettingsService`'s own `envKeyOf` over the manifest's keys — never by this
 * package's table, so the resolver is measured against the other face.
 */
function envFor(provider: string): Record<string, string> {
  return Object.fromEntries(keysDeclaredFor(provider).map((key) => [envKeyOf('sms', key), `${key}-from-env`]));
}

/** A plugin context holding a settings service (or none) and a `kernel:ready` hook list. */
function contextWith(settings?: SettingsService) {
  const services = new Map<string, unknown>();
  if (settings) services.set('settings', settings);
  const readyHooks: Array<() => Promise<void> | void> = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    logger,
    registerService(name: string, svc: unknown) { services.set(name, svc); },
    getService(name: string) {
      if (!services.has(name)) throw new Error(`service not found: ${name}`);
      return services.get(name);
    },
    hook(event: string, fn: () => Promise<void> | void) {
      if (event === 'kernel:ready') readyHooks.push(fn);
    },
  } as any;
  return {
    ctx,
    sms: () => services.get('sms') as SmsService,
    fireReady: async () => { for (const fn of readyHooks) await fn(); },
  };
}

function settingsWith(env: Record<string, string>): SettingsService {
  const settings = new SettingsService({ env });
  settings.registerManifest(smsSettingsManifest);
  return settings;
}

/** The credential options the live transport was built with. */
function credentialsOf(svc: SmsService, provider: SmsDeliveringProvider): Record<string, unknown> {
  const built = (svc.options.transport as unknown as { options: Record<string, unknown> }).options;
  return Object.fromEntries(
    Object.values(SMS_PROVIDER_SETTING_KEYS[provider])
      .filter((option) => option in built)
      .map((option) => [option, built[option]]),
  );
}

describe('SMS_PROVIDER_SETTING_KEYS ↔ the sms settings manifest', () => {
  it('has one row per delivering provider', () => {
    expect(Object.keys(SMS_PROVIDER_SETTING_KEYS).sort()).toEqual([...DELIVERING].sort());
  });

  it.each(DELIVERING)('%s: maps exactly the keys the manifest declares for it', (provider) => {
    expect(keysDeclaredFor(provider).length).toBeGreaterThan(0);
    expect(Object.keys(SMS_PROVIDER_SETTING_KEYS[provider]).sort()).toEqual(keysDeclaredFor(provider));
  });

  it('pins the measured key set so a rename is a conscious edit', () => {
    expect(keysDeclaredFor('aliyun')).toEqual([
      'aliyun_access_key_id',
      'aliyun_access_key_secret',
      'aliyun_sign_name',
      'aliyun_template_code',
    ]);
    expect(keysDeclaredFor('twilio')).toEqual([
      'twilio_account_sid',
      'twilio_auth_token',
      'twilio_from_number',
      'twilio_messaging_service_sid',
    ]);
  });
});

describe('resolveSmsCapabilityArg reads each credential under the name SettingsService locks it with', () => {
  it.each(DELIVERING)('%s: every declared key, by its OS_SMS_* name, lands in providerOptions', (provider) => {
    for (const key of keysDeclaredFor(provider)) {
      const sentinel = `${key}-sentinel`;
      const { options } = resolveSmsCapabilityArg({ provider }, { [envKeyOf('sms', key)]: sentinel });
      expect(Object.values((options.providerOptions ?? {}) as Record<string, unknown>), `${provider}: ${key}`)
        .toEqual([sentinel]);
    }
  });

  it('merges env over config per credential, keeping the config-only options — the mail rule', () => {
    const { options } = resolveSmsCapabilityArg(
      {
        provider: 'twilio',
        providerOptions: { accountSid: 'AC-config', authToken: 'tok-config', baseUrl: 'http://twilio.mock' },
      },
      { OS_SMS_TWILIO_ACCOUNT_SID: 'AC-env' },
    );
    expect(options.providerOptions).toEqual({
      accountSid: 'AC-env',
      authToken: 'tok-config',
      baseUrl: 'http://twilio.mock',
    });
  });

  it("reads the selected provider's credentials only", () => {
    const env = { ...envFor('aliyun'), ...envFor('twilio') };
    const { options } = resolveSmsCapabilityArg({ provider: 'twilio' }, env);
    expect(Object.keys(options.providerOptions as Record<string, unknown>).sort())
      .toEqual(Object.values(SMS_PROVIDER_SETTING_KEYS.twilio).sort());
    expect(resolveSmsCapabilityArg({}, env).options).not.toHaveProperty('providerOptions');
  });

  it('does not refuse a configured provider with no credentials — the namespace can still carry them (control)', () => {
    expect(resolveSmsCapabilityArg({ provider: 'twilio' }, {}).options).toEqual({ provider: 'twilio' });
  });
});

describe('one OS_SMS_* environment builds one transport, through either face', () => {
  it.each(DELIVERING)(
    '%s: a configured provider with env credentials and no OS_SMS_PROVIDER delivers, from init on',
    async (provider) => {
      // The measured door: `bootStack` / `os serve` construct the plugin from
      // the resolver and mount a settings service over the same environment.
      // `isConfigured()` is read at init too, before the namespace is bound:
      // the settings leg alone would repair the reading at `kernel:ready`, so
      // only the init reading measures the constructor face.
      const env = envFor(provider);
      const face = contextWith(settingsWith(env));
      const plugin = new SmsServicePlugin(resolveSmsCapabilityArg({ provider }, env).options as SmsServicePluginOptions);
      await plugin.init(face.ctx);
      expect(face.sms().isConfigured()).toBe(true);
      expect(face.sms().options.transport).toBeInstanceOf(TRANSPORT_CLASS[provider]);

      await plugin.start(face.ctx);
      await face.fireReady();
      expect(face.sms().isConfigured()).toBe(true);
      expect(face.sms().options.transport).toBeInstanceOf(TRANSPORT_CLASS[provider]);
    },
  );

  it.each(DELIVERING)('%s: the constructor face and the settings face build the same credentials', async (provider) => {
    const env = envFor(provider);

    // Constructor face alone: no settings service is mounted at all.
    const viaConstructor = contextWith();
    await new SmsServicePlugin(resolveSmsCapabilityArg({ provider }, env).options as SmsServicePluginOptions)
      .init(viaConstructor.ctx);

    // Settings face alone: no constructor options; the namespace names the
    // provider through its own env lock and resolves the same variables.
    const viaSettings = contextWith(settingsWith({ ...env, OS_SMS_PROVIDER: provider }));
    const plugin = new SmsServicePlugin();
    await plugin.init(viaSettings.ctx);
    await plugin.start(viaSettings.ctx);
    await viaSettings.fireReady();

    for (const face of [viaConstructor, viaSettings]) {
      expect(face.sms().isConfigured()).toBe(true);
      expect(face.sms().options.transport).toBeInstanceOf(TRANSPORT_CLASS[provider]);
    }
    const built = credentialsOf(viaConstructor.sms(), provider);
    expect(Object.keys(built).length).toBe(keysDeclaredFor(provider).length);
    expect(credentialsOf(viaSettings.sms(), provider)).toEqual(built);
  });

  it('a configured provider with its credentials missing everywhere stays on the log transport (control)', async () => {
    const face = contextWith(settingsWith({}));
    const plugin = new SmsServicePlugin(resolveSmsCapabilityArg({ provider: 'twilio' }, {}).options as SmsServicePluginOptions);
    await plugin.init(face.ctx);
    await plugin.start(face.ctx);
    await face.fireReady();

    expect(face.sms().isConfigured()).toBe(false);
    expect(face.sms().options.transport).toBeInstanceOf(LogSmsTransport);
    expect(face.ctx.logger.warn).toHaveBeenCalled();
  });
});
