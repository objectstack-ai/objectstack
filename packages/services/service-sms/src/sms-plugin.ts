// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { ISmsTransport } from '@objectstack/spec/contracts';
import { SmsService, LogSmsTransport, maskPhoneNumber, normalizeSmsRecipient } from './sms-service.js';
import { makeSmsTransport, type SmsProviderTag } from './transports/index.js';

/**
 * Plugin configuration. Mirrors EmailServicePluginOptions: a directly
 * injected transport wins, then `provider` + credentials, then the
 * development `LogSmsTransport` fallback (no real send).
 */
export interface SmsServicePluginOptions {
  /** Pluggable delivery transport. Overrides `provider`/credentials. */
  transport?: ISmsTransport;
  /** Provider tag — `'log' | 'aliyun' | 'twilio'`. Default `'log'`. */
  provider?: SmsProviderTag;
  /** Provider-specific credentials/options (see transport option types). */
  providerOptions?: Record<string, unknown>;
  /** Retry attempts on transport throw. Default 0. */
  retries?: number;
}

/** Translate an `sms` settings-namespace snapshot into transport inputs. */
function providerFromSettings(values: Record<string, unknown>): {
  provider: SmsProviderTag;
  options: Record<string, unknown>;
  missing?: string;
} {
  const provider = String(values.provider ?? 'log') as SmsProviderTag;
  const str = (k: string): string | undefined => {
    const v = values[k];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
  };
  if (provider === 'aliyun') {
    const accessKeyId = str('aliyun_access_key_id');
    const accessKeySecret = str('aliyun_access_key_secret');
    const signName = str('aliyun_sign_name');
    if (!accessKeyId || !accessKeySecret || !signName) {
      return { provider, options: {}, missing: 'aliyun_access_key_id / aliyun_access_key_secret / aliyun_sign_name' };
    }
    return {
      provider,
      options: {
        accessKeyId,
        accessKeySecret,
        signName,
        ...(str('aliyun_template_code') ? { defaultTemplateCode: str('aliyun_template_code') } : {}),
      },
    };
  }
  if (provider === 'twilio') {
    const accountSid = str('twilio_account_sid');
    const authToken = str('twilio_auth_token');
    const from = str('twilio_from_number');
    const messagingServiceSid = str('twilio_messaging_service_sid');
    if (!accountSid || !authToken || (!from && !messagingServiceSid)) {
      return { provider, options: {}, missing: 'twilio_account_sid / twilio_auth_token / twilio_from_number (or messaging service SID)' };
    }
    return {
      provider,
      options: {
        accountSid,
        authToken,
        ...(from ? { from } : {}),
        ...(messagingServiceSid ? { messagingServiceSid } : {}),
      },
    };
  }
  return { provider: 'log', options: {} };
}

/**
 * SmsServicePlugin — registers the `sms` service (#2780).
 *
 * Lifecycle:
 *   - `init`: build transport (injected → provider+credentials →
 *     LogSmsTransport fallback); register the SmsService so dependents
 *     (auth OTP, the messaging `sms` channel) can resolve it.
 *   - `start` (kernel:ready): bind the `sms` settings namespace so the
 *     admin UI can live-swap the provider without a restart, and register
 *     the `sms/test` action. Env-locked keys (OS_SMS_*) still win at the
 *     settings-resolver level.
 *
 * Deliberately NO persistence objects: SMS bodies carry OTP codes — see the
 * ISmsService contract header.
 */
export class SmsServicePlugin implements Plugin {
  name = 'com.objectstack.service.sms';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['sms'];
  version = '1.0.0';
  type = 'standard' as const;

  private readonly options: SmsServicePluginOptions;
  private service?: SmsService;

  constructor(options: SmsServicePluginOptions = {}) {
    this.options = options;
  }

  private resolveInitialTransport(ctx: PluginContext): { transport: ISmsTransport; configured: boolean } {
    if (this.options.transport) return { transport: this.options.transport, configured: true };
    const provider = this.options.provider ?? 'log';
    if (provider === 'log') return { transport: new LogSmsTransport(ctx.logger), configured: false };
    try {
      return {
        transport: makeSmsTransport({ provider, options: this.options.providerOptions, logger: ctx.logger }),
        configured: true,
      };
    } catch (err: any) {
      // Incomplete constructor credentials must not take the kernel down —
      // fall back to the dev transport; the settings bind (kernel:ready)
      // can still swap in a working provider.
      ctx.logger.warn(
        `SmsServicePlugin: provider='${provider}' selected but transport build failed (${err?.message ?? err}) — falling back to LogSmsTransport.`,
      );
      return { transport: new LogSmsTransport(ctx.logger), configured: false };
    }
  }

  async init(ctx: PluginContext): Promise<void> {
    const { transport, configured } = this.resolveInitialTransport(ctx);
    if (!configured) {
      ctx.logger.info('SmsServicePlugin: no provider configured — using LogSmsTransport (SMS will NOT be sent)');
    } else {
      ctx.logger.info(`SmsServicePlugin: using '${this.options.provider ?? 'custom'}' provider`);
    }
    this.service = new SmsService({
      transport,
      configured,
      retries: this.options.retries,
      logger: ctx.logger,
    });
    ctx.registerService('sms', this.service);
    ctx.logger.info('SmsServicePlugin: sms service registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      if (!this.service) return;
      // A host-injected transport is authoritative — settings only manage
      // the provider-tag path.
      if (this.options.transport) return;
      try {
        const settings = ctx.getService<any>('settings');
        if (!settings || typeof settings.getNamespace !== 'function') return;

        const applySettings = async () => {
          try {
            const payload = await settings.getNamespace('sms');
            const values: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
              values[k] = v?.value;
            }
            this.applySmsSettings(values, ctx);
          } catch (err: any) {
            ctx.logger.warn('SmsServicePlugin: failed to apply sms settings: ' + (err?.message ?? err));
          }
        };
        await applySettings();
        if (typeof settings.subscribe === 'function') {
          settings.subscribe('sms', () => { void applySettings(); });
          ctx.logger.info('SmsServicePlugin: bound to settings:changed for namespace=sms');
        }

        // `sms/test` action — validate the (possibly unsaved) form values by
        // sending a real test message through a one-shot transport, mirroring
        // the `mail/test` handler in EmailServicePlugin.
        if (typeof settings.registerAction === 'function') {
          const svc = this.service;
          settings.registerAction('sms', 'test', async ({ values, payload, ctx: actionCtx }: any) => {
            const overrides = (payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object')
              ? payload.values
              : (payload ?? {});
            const merged: Record<string, unknown> = { ...(values ?? {}), ...overrides };
            const rawTo = (actionCtx?.body?.to as string | undefined) ?? (payload?.to as string | undefined);
            const to = rawTo ? normalizeSmsRecipient(rawTo) : undefined;
            if (!to) {
              return { ok: false, severity: 'error', message: 'Provide a valid "to" phone number (E.164 recommended).' };
            }

            const resolved = providerFromSettings(merged);
            if (resolved.missing) {
              return { ok: false, severity: 'error', message: `${resolved.provider}: missing ${resolved.missing}.` };
            }

            let target: SmsService = svc;
            if (resolved.provider !== 'log') {
              try {
                const transport = makeSmsTransport({ provider: resolved.provider, options: resolved.options, logger: ctx.logger });
                target = new SmsService({ transport, configured: true, logger: ctx.logger });
              } catch (err: any) {
                return { ok: false, severity: 'error', message: `Failed to build ${resolved.provider} transport: ${err?.message ?? String(err)}` };
              }
            }

            try {
              const result = await target.send({
                to,
                body: 'ObjectStack SMS test message.',
                templateParams: { content: 'ObjectStack SMS test message.' },
              });
              if (result.status === 'failed') {
                return { ok: false, severity: 'error', message: result.error ?? 'Send failed.' };
              }
              return {
                ok: true,
                severity: 'info',
                message: `Sent test SMS to ${maskPhoneNumber(to)} via ${resolved.provider} (id=${result.messageId ?? result.id}).`,
              };
            } catch (err: any) {
              return { ok: false, severity: 'error', message: err?.message ?? String(err) };
            }
          });
        }
      } catch {
        // settings service not registered — constructor opts remain authoritative.
      }
    });
  }

  /**
   * Translate the `sms` settings snapshot into a transport and hot-swap it
   * on the running SmsService. Incomplete credentials keep the previous
   * transport (with a warning) so a half-saved form can't break delivery.
   */
  private applySmsSettings(values: Record<string, unknown>, ctx: PluginContext): void {
    if (!this.service) return;
    const resolved = providerFromSettings(values);
    if (resolved.missing) {
      ctx.logger.warn(
        `SmsServicePlugin: provider='${resolved.provider}' selected but ${resolved.missing} is empty — transport NOT rebuilt.`,
      );
      return;
    }
    if (resolved.provider === 'log') {
      // Downgrade to the dev transport only when the operator explicitly
      // selected `log`; an unset namespace keeps the constructor opts.
      if (values.provider === 'log') {
        this.service.setTransport(new LogSmsTransport(ctx.logger), false);
        ctx.logger.info('SmsServicePlugin: sms settings applied (provider=log; SMS will NOT be sent).');
      }
      return;
    }
    try {
      const transport = makeSmsTransport({ provider: resolved.provider, options: resolved.options, logger: ctx.logger });
      this.service.setTransport(transport, true);
      ctx.logger.info(`SmsServicePlugin: transport rebuilt from settings (provider=${resolved.provider}).`);
    } catch (err: any) {
      ctx.logger.warn('SmsServicePlugin: failed to rebuild transport: ' + (err?.message ?? err));
    }
  }
}
