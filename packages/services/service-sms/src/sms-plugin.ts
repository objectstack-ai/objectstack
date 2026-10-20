// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine, ISmsTransport } from '@objectstack/spec/contracts';
import { createLazyCounterStore, type CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';
import { SmsService, LogSmsTransport, maskPhoneNumber, normalizeSmsRecipient } from './sms-service.js';
import { SmsDailyQuota } from './sms-daily-quota.js';
import { makeSmsTransport, smsProviderOptionsFrom, type SmsProviderTag } from './transports/index.js';

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

/**
 * Translate an `sms` settings-namespace snapshot into transport inputs. The
 * setting-key → transport-option mapping is `SMS_PROVIDER_SETTING_KEYS`, the
 * table `resolveSmsCapabilityArg` reads the same `OS_SMS_*` variables through.
 */
function providerFromSettings(values: Record<string, unknown>): {
  provider: SmsProviderTag;
  options: Record<string, unknown>;
  missing?: string;
} {
  const provider = String(values.provider ?? 'log') as SmsProviderTag;
  if (provider === 'aliyun') {
    const options = smsProviderOptionsFrom(provider, (key) => values[key]);
    if (!options.accessKeyId || !options.accessKeySecret || !options.signName) {
      return { provider, options: {}, missing: 'aliyun_access_key_id / aliyun_access_key_secret / aliyun_sign_name' };
    }
    return { provider, options };
  }
  if (provider === 'twilio') {
    const options = smsProviderOptionsFrom(provider, (key) => values[key]);
    if (!options.accountSid || !options.authToken || (!options.from && !options.messagingServiceSid)) {
      return { provider, options: {}, missing: 'twilio_account_sid / twilio_auth_token / twilio_from_number (or messaging service SID)' };
    }
    return { provider, options };
  }
  return { provider: 'log', options: {} };
}

/** The identity object an `sms/test` press reads the caller's own number from. */
const ACCOUNT_OBJECT = 'sys_user';

/**
 * The system opt-in for the one `sys_user` read below: resolving who the
 * caller is must not depend on the caller holding read permission on the
 * identity table.
 */
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * Who an `sms/test` press sends to: the `to` the request names, else the
 * signed-in admin's own number (`sys_user.phone_number`, the column the
 * messaging `sms` channel delivers to).
 *
 * The served form has no recipient input — a settings manifest cannot declare
 * a value an action posts without storing it — so the console's request
 * carries no `to`, and this button used to refuse every press by asking for a
 * "to" field the page does not have. The person who pressed it is the one
 * recipient who can confirm the delivery.
 *
 * The read is pinned to the CALLER's own row — `where.id` is the request's own
 * `userId`, never a value the body names — and projects `phone_number` alone;
 * the success message masks it. A user carries a number only where phone
 * sign-in is enabled, so the refusal for a caller without one says exactly
 * that, and that nothing was sent. A read that fails is reported as a failed
 * read, never as "you have no number".
 */
async function resolveSmsTestRecipient(
  payload: unknown,
  userId: unknown,
  getEngine: () => IDataEngine | undefined,
): Promise<{ to: string } | { refusal: string }> {
  const named = payload && typeof payload === 'object' ? (payload as { to?: unknown }).to : undefined;
  if (typeof named === 'string' && named.trim() !== '') {
    const to = normalizeSmsRecipient(named);
    return to ? { to } : { refusal: 'Provide a valid "to" phone number (E.164 recommended).' };
  }
  if (typeof userId !== 'string' || userId === '') {
    return {
      refusal: 'No recipient — nothing was sent. This call names no "to" number and carries no signed-in '
        + 'user whose own number the test could go to; pass "to" in the request body.',
    };
  }
  const engine = getEngine();
  if (!engine) {
    return {
      refusal: 'No data engine is available to read your account\'s phone number — nothing was sent. '
        + 'Pass "to" in the request body to name a recipient.',
    };
  }
  let row: Record<string, unknown> | null;
  try {
    row = await engine.findOne(
      ACCOUNT_OBJECT,
      { where: { id: userId }, fields: ['phone_number'] },
      { context: SYSTEM_CTX },
    );
  } catch (err: any) {
    return {
      refusal: `Could not read your account's phone number to send the test SMS to (${err?.message ?? String(err)}) `
        + '— nothing was sent. Pass "to" in the request body to name a recipient.',
    };
  }
  const raw = row?.phone_number;
  const to = typeof raw === 'string' ? normalizeSmsRecipient(raw) : undefined;
  if (!to) {
    return {
      refusal: 'Your account has no phone number, and the test SMS is sent to the signed-in admin\'s own number '
        + '— nothing was sent. A number is on an account only where phone sign-in is enabled; otherwise pass '
        + '"to" in the request body.',
    };
  }
  return { to };
}

/** The data engine, looked up when an action runs — `objectql`, else `data`. */
function resolveDataEngine(ctx: PluginContext): IDataEngine | undefined {
  try { return ctx.getService<IDataEngine>('objectql') ?? undefined; } catch { /* fall through */ }
  try { return ctx.getService<IDataEngine>('data') ?? undefined; } catch { return undefined; }
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
  /**
   * Order-if-present on the settings service (ADR-0116, #10250).
   *
   * `start()` registers a `kernel:ready` hook that reads the `sms` namespace —
   * provider credentials AND the daily cost ceiling. `SettingsServicePlugin`
   * binds its data engine from ITS `kernel:ready` hook, registered in ITS
   * `start()`, so the plugin that starts first registers the earlier hook and
   * the earlier hook runs first. Start order is the topological order over this
   * declaration (`resolvePluginOrder`, used for BOTH phases in
   * `ObjectKernel.bootstrap`), so declaring the edge is what puts the bind
   * ahead of the read.
   *
   * `sms` is the entry this card was filed about: it was added at index 6 of
   * `PLATFORM_ALWAYS_ON_CAPABILITIES`, one past the `slice(0, 6)` prefix that
   * was pinned there at the time, so before this declaration its correct
   * position relative to `settings` was held by nothing at all. In the window
   * `getNamespace('sms')` answers from the manifest defaults — a `log` provider
   * that reports every OTP "sent" and a default cost ceiling — while the
   * operator's saved credentials sit unread in `sys_setting`.
   *
   * That slice is retired (#11046): the slate pin states the rule instead —
   * every always-on entry that is not a bind target (`queue`/`job`/`cache`/
   * `settings`) is mounted after all of them — so `sms` is now held BY the pin
   * rather than sitting one past it, and so is whatever is added next. That
   * covers slate ORDER only; this declaration is still what orders the plugins,
   * and the pin test named below is what keeps it honest.
   *
   * SOFT, not hard: a kernel with no settings service must still boot this
   * plugin (the transport is buildable from options alone). ADR-0049 —
   * declared is enforced: `serve-settings-ordering.pin.test.ts` boots a kernel
   * with the readers registered BEFORE settings and proves the order moves.
   */
  optionalDependencies = ['com.objectstack.service.settings'];
  version = '1.0.0';
  type = 'standard' as const;

  private readonly options: SmsServicePluginOptions;
  private service?: SmsService;
  private dailyQuota?: SmsDailyQuota;

  constructor(options: SmsServicePluginOptions = {}) {
    this.options = options;
  }

  /**
   * Build the daily cost gate (#2814) over the kernel `cache` service.
   *
   * `resolveCache` is copied in shape from `AuthPlugin.init()` on purpose, for
   * the two reasons stated there: the `cache` service is registered ASYNC (so
   * `getService` throws for it and `getServiceAsync` is the only accessor that
   * works), and resolution has to happen when a counter is CONSUMED rather than
   * at init, or a deployment that registers its cache after this plugin freezes
   * a "no shared store" answer for the life of the process (#4772). The
   * degraded case is announced by `createLazyCounterStore` itself, named for
   * this subject.
   */
  private buildDailyQuota(ctx: PluginContext): SmsDailyQuota {
    const resolveCache = async (): Promise<CounterStore | undefined> => {
      let cache: any;
      try {
        cache = await (ctx as { getServiceAsync?: (n: string) => Promise<unknown> })
          .getServiceAsync?.('cache');
      } catch {
        return undefined;
      }
      if (cache && typeof cache.get === 'function' && typeof cache.set === 'function') return cache;
      return undefined;
    };
    return new SmsDailyQuota({
      resolveStore: createLazyCounterStore({
        resolveCache,
        logger: ctx.logger,
        logPrefix: '[sms]',
        subject: 'daily SMS send quota',
        degradedImpact:
          'The ceiling is still enforced, but PER NODE: an N-node deployment can spend up to N× the ' +
          'configured number of PAID SMS per day, which is exactly the total-cost hole this gate exists to close',
      }),
      logger: ctx.logger,
    });
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
    this.dailyQuota = this.buildDailyQuota(ctx);
    this.service = new SmsService({
      transport,
      configured,
      retries: this.options.retries,
      logger: ctx.logger,
      dailyQuota: this.dailyQuota,
    });
    ctx.registerService('sms', this.service);
    ctx.logger.info('SmsServicePlugin: sms service registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      if (!this.service) return;
      try {
        const settings = ctx.getService<any>('settings');
        if (!settings || typeof settings.getNamespace !== 'function') return;

        const applySettings = async () => {
          try {
            const payload = await settings.getNamespace('sms');
            const values: Record<string, unknown> = {};
            const sources: Record<string, string> = {};
            for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
              values[k] = v?.value;
              if (v?.source) sources[k] = String(v.source);
            }
            // #2814 — the daily cost ceiling binds for EVERY composition,
            // including a host-injected transport: "how much may this
            // deployment spend today" is an operator policy about the
            // deployment, not a property of whichever transport delivers.
            // Read by VALUE, never by `ResolvedSettingValue.source` — an
            // env-locked `OS_SMS_DAILY_QUOTA` and an admin-saved row are the
            // same instruction to this reader (#5536).
            this.dailyQuota?.setQuota(values.daily_quota);
            // A host-injected transport, by contrast, IS authoritative — the
            // settings form only manages the provider-tag path.
            if (!this.options.transport) this.applySmsSettings(values, sources, ctx);
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
        // the `mail/test` handler in EmailServicePlugin. Still skipped when the
        // host injected its own transport: the form's provider fields describe
        // nothing that composition uses, so testing them would be theatre.
        //
        // The recipient is the request's `to`, else the signed-in admin's own
        // number — see `resolveSmsTestRecipient`.
        if (!this.options.transport && typeof settings.registerAction === 'function') {
          const svc = this.service;
          settings.registerAction('sms', 'test', async ({ values, payload, ctx: actionCtx }: any) => {
            const overrides = (payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object')
              ? payload.values
              : (payload ?? {});
            const merged: Record<string, unknown> = { ...(values ?? {}), ...overrides };
            const recipient = await resolveSmsTestRecipient(payload, actionCtx?.userId, () => resolveDataEngine(ctx));
            if ('refusal' in recipient) {
              return { ok: false, severity: 'error', message: recipient.refusal };
            }
            const { to } = recipient;

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
            // A LogSmsTransport "send" is not a delivery — say so instead of
            // reporting a success it never had (the mail/test rule). Reachable
            // from the served form now that the recipient defaults to the
            // admin's own number, and `log` is this namespace's default.
            if (target === svc && svc.options.transport instanceof LogSmsTransport) {
              return {
                ok: false,
                severity: 'warning',
                message: 'No SMS delivery transport is active (provider: None — log only), so the test SMS was NOT sent. '
                  + 'Pick a provider, fill in its credentials and save before testing.',
              };
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
   *
   * Which provider: one the namespace NAMES — an operator's save, or an
   * `OS_SMS_PROVIDER` env lock — wins, as it always has. The manifest default
   * names nothing (`source: 'default'` is not a decision anyone made, the
   * criterion the `log` branch below states), so then the deployment's
   * configured provider — this plugin's constructor `provider` — stands, and
   * the namespace is read for that provider's credentials (`OS_SMS_TWILIO_*`
   * env locks included). Before this, a configured `twilio` / `aliyun` whose
   * credentials lived only in the namespace never got a delivering transport.
   * Its credentials from the namespace overlay the constructor's
   * `providerOptions` key by key, so a constructor-only option (a test
   * `baseUrl`, an `endpoint`) survives the rebuild. When the namespace holds
   * no complete set, a transport the constructor's own credentials built at
   * init stays, silently; with none, the warning below says so.
   */
  private applySmsSettings(
    values: Record<string, unknown>,
    sources: Record<string, string>,
    ctx: PluginContext,
  ): void {
    if (!this.service) return;
    const named = (sources.provider ?? 'default') !== 'default';
    const configuredProvider = !named && this.options.provider !== undefined && this.options.provider !== 'log'
      ? this.options.provider
      : undefined;
    const resolved = providerFromSettings(configuredProvider ? { ...values, provider: configuredProvider } : values);
    if (resolved.missing) {
      if (configuredProvider && this.service.isConfigured()) return;
      ctx.logger.warn(
        `SmsServicePlugin: provider='${resolved.provider}' selected but ${resolved.missing} is empty — transport NOT rebuilt.`,
      );
      return;
    }
    if (resolved.provider === 'log') {
      // [#5536] Downgrade to the dev transport only when an operator (or an
      // env override) actually AUTHORED the `log` selection —
      // `values.provider === 'log'` alone cannot tell that apart from the
      // manifest default, which resolves to `'log'` on every boot whether or
      // not anyone ever opened the settings page. Same criterion, same
      // reason as EmailServicePlugin: the manifest default
      // (`source: 'default'`) is not a decision anyone made, and treating it
      // as one would let a settings page nobody opened silently switch off
      // the transport the deployment declared via constructor options. A
      // missing `source` (a non-conforming snapshot) reads as 'default': the
      // conservative side keeps the deployment's declared transport
      // delivering.
      if (values.provider === 'log' && (sources.provider ?? 'default') !== 'default') {
        this.service.setTransport(new LogSmsTransport(ctx.logger), false);
        ctx.logger.info('SmsServicePlugin: sms settings applied (provider=log; SMS will NOT be sent).');
      }
      return;
    }
    try {
      const options = configuredProvider ? { ...this.options.providerOptions, ...resolved.options } : resolved.options;
      const transport = makeSmsTransport({ provider: resolved.provider, options, logger: ctx.logger });
      this.service.setTransport(transport, true);
      ctx.logger.info(`SmsServicePlugin: transport rebuilt from settings (provider=${resolved.provider}).`);
    } catch (err: any) {
      ctx.logger.warn('SmsServicePlugin: failed to rebuild transport: ' + (err?.message ?? err));
    }
  }
}
