// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
  IEmailTransport,
  EmailAddress,
} from '@objectstack/spec/contracts';
import { SysEmail, SysEmailTemplate } from '@objectstack/platform-objects/audit';
import { EmailService, LogTransport, type EmailPersistence, type TemplateLoader, type EmailTemplateRow } from './email-service.js';
import { makeTransport } from './transports/index.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';
import type { EmailTemplateDefinition as EmailTemplate } from '@objectstack/spec/system';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * Plugin configuration.
 */
export interface EmailServicePluginOptions {
  /**
   * Pluggable delivery transport. When omitted the plugin builds one
   * from `provider`/`apiKey`; if both omitted, falls back to
   * `LogTransport` (no real send).
   */
  transport?: IEmailTransport;
  /** Provider tag — `'log' | 'resend' | 'postmark'`. Default `'log'`. */
  provider?: 'log' | 'resend' | 'postmark';
  /** API key for resend/postmark. */
  apiKey?: string;
  /** Provider-specific extra options (e.g. Postmark messageStream). */
  providerOptions?: Record<string, unknown>;
  /** Default `From` address applied when `input.from` is omitted. */
  defaultFrom?: EmailAddress;
  /** Persist each attempt to sys_email. Default true when ObjectQL engine present. */
  persist?: boolean;
  /** Retry attempts on transport throw. Default 0. */
  retries?: number;
  /** Default template render context (merged into every sendTemplate call). */
  defaultTemplateContext?: Record<string, unknown>;
  /** Seed built-in auth templates into sys_email_template on startup. Default true. */
  seedTemplates?: boolean;
  /** Additional templates seeded alongside the built-ins. */
  templates?: EmailTemplate[];
}

/**
 * EmailServicePlugin — registers the `email` service.
 *
 * Lifecycle:
 *   - `init`: register sys_email + sys_email_template via manifest;
 *     build transport (config → provider+apiKey → LogTransport fallback);
 *     register a transport-only EmailService so dependents can resolve it.
 *   - `start` (kernel:ready): wire ObjectQL-backed sys_email persistence
 *     + sys_email_template TemplateLoader; seed built-in auth templates
 *     (upsert by `(name, locale)`).
 */
export class EmailServicePlugin implements Plugin {
  name = 'com.objectstack.service.email';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['email'];
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: EmailServicePluginOptions;
  private service?: EmailService;

  constructor(options: EmailServicePluginOptions = {}) {
    this.options = options;
  }

  private resolveTransport(ctx: PluginContext): IEmailTransport {
    if (this.options.transport) return this.options.transport;
    const provider = this.options.provider ?? 'log';
    if (provider === 'log') return new LogTransport(ctx.logger);
    return makeTransport({
      provider,
      apiKey: this.options.apiKey,
      options: this.options.providerOptions,
      logger: ctx.logger,
    });
  }

  async init(ctx: PluginContext): Promise<void> {
    // Register sys_email + sys_email_template via manifest service.
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service.email',
      name: 'Email Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      defaultDatasource: 'cloud',
      namespace: 'sys',
      objects: [SysEmail, SysEmailTemplate],
    });

    const transport = this.resolveTransport(ctx);
    if (!this.options.transport && (this.options.provider ?? 'log') === 'log') {
      ctx.logger.info(
        'EmailServicePlugin: no transport configured — using LogTransport (mail will NOT be sent)',
      );
    } else {
      ctx.logger.info(
        `EmailServicePlugin: using '${this.options.provider ?? 'log'}' provider`,
      );
    }

    // Persistence + templateLoader are wired in `start` once the
    // ObjectQL engine is available; here we register the service
    // synchronously so dependents can resolve it.
    this.service = new EmailService({
      transport,
      defaultFrom: this.options.defaultFrom,
      retries: this.options.retries,
      defaultTemplateContext: this.options.defaultTemplateContext,
      logger: ctx.logger,
    });
    ctx.registerService('email', this.service);
    ctx.logger.info('EmailServicePlugin: email service registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      let engine: IDataEngine | null = null;
      try { engine = ctx.getService<IDataEngine>('objectql'); }
      catch { try { engine = ctx.getService<IDataEngine>('data'); } catch { /* ignore */ } }
      if (!engine || !this.service) return;

      // ── Bind to the `mail` settings namespace (Phase 1) ──────────────
      // Allows the admin UI to live-update SMTP/provider/from-address
      // without restarting the process. Env-locked fields still win at
      // the resolver level, so config-via-env keeps its precedence.
      try {
        const settings = ctx.getService<any>('settings');
        if (settings && typeof settings.createClient === 'function') {
          const applySettings = async () => {
            try {
              const payload = await settings.getNamespace('mail');
              const values: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
                values[k] = v?.value;
              }
              this.applyMailSettings(values, ctx);
            } catch (err: any) {
              ctx.logger.warn('EmailServicePlugin: failed to apply mail settings: ' + (err?.message ?? err));
            }
          };
          await applySettings();
          // Subscribe to namespace changes; rebuild on every update.
          if (typeof settings.subscribe === 'function') {
            settings.subscribe('mail', () => {
              void applySettings();
            });
            ctx.logger.info('EmailServicePlugin: bound to settings:changed for namespace=mail');
          }

          // Register the `mail/test` action handler so saving + sending
          // a test email actually exercises the live transport.
          //
          // The handler accepts both the persisted snapshot (`values`)
          // and the (possibly unsaved) form state posted as
          // `payload.values`, with overrides winning. When the merged
          // provider/api_key differ from what the live `svc` is bound
          // to, a one-shot temporary `EmailService` is built so the
          // operator can validate edits before hitting "Save".
          if (typeof settings.registerAction === 'function') {
            const svc = this.service;
            settings.registerAction('mail', 'test', async ({ values, payload, ctx: actionCtx }: any) => {
              const overrides = extractOverrides(payload);
              const merged: Record<string, unknown> = { ...(values ?? {}), ...overrides };
              const to = (actionCtx?.body?.to as string | undefined)
                ?? (payload?.to as string | undefined)
                ?? (merged.from_email as string | undefined);
              if (!to) {
                return { ok: false, severity: 'error', message: 'Provide a "to" address (or set from_email).' };
              }

              // Build a temporary service from the merged values when
              // the form differs from the live svc — covers the
              // "edited but not saved" path.
              let target: EmailService = svc;
              let tempDescription = '';
              const provider = String(merged.provider ?? 'smtp');
              const apiKey = typeof merged.api_key === 'string' ? merged.api_key : undefined;
              if (provider !== 'smtp' && provider !== 'log') {
                if (!apiKey) {
                  return { ok: false, severity: 'error', message: `${provider}: api_key is required.` };
                }
                try {
                  const transport = makeTransport({
                    provider: provider as 'resend' | 'postmark',
                    apiKey,
                    logger: ctx.logger,
                  });
                  target = new EmailService({
                    transport,
                    defaultFrom: merged.from_email
                      ? {
                          address: String(merged.from_email),
                          name: merged.from_name ? String(merged.from_name) : undefined,
                        }
                      : undefined,
                    logger: ctx.logger,
                  });
                  tempDescription = ` via ${provider}`;
                } catch (err: any) {
                  return { ok: false, severity: 'error', message: `Failed to build ${provider} transport: ${err?.message ?? String(err)}` };
                }
              }

              try {
                const result = await target.send({
                  to,
                  from: merged.from_email ? {
                    address: String(merged.from_email),
                    name: merged.from_name ? String(merged.from_name) : undefined,
                  } : undefined,
                  subject: 'ObjectStack mail test',
                  text: 'This is a test email from the ObjectStack settings page.',
                });
                if (result.status === 'failed') {
                  return { ok: false, severity: 'error', message: result.error ?? 'Send failed.' };
                }
                return {
                  ok: true,
                  severity: 'info',
                  message: `Sent test email to ${to}${tempDescription} (id=${result.id}).`,
                };
              } catch (err: any) {
                return { ok: false, severity: 'error', message: err?.message ?? String(err) };
              }
            });
          }
        }
      } catch {
        // settings service not registered — env/constructor opts remain authoritative.
      }

      const persistence: EmailPersistence | undefined = this.options.persist === false
        ? undefined
        : {
          async insert(row) {
            const created = await (engine as any).insert('sys_email', row, {
              context: SYSTEM_CTX,
            });
            return created?.id ? { id: String(created.id) } : { id: String(row.id) };
          },
          async update(id, patch) {
            await (engine as any).update('sys_email', { id, ...patch }, {
              context: SYSTEM_CTX,
            });
          },
        };

      const templateLoader: TemplateLoader = {
        async load(name, locale) {
          const where: Record<string, unknown> = { name };
          if (locale) where.locale = locale;
          const rows = await (engine as any).find('sys_email_template', {
            where,
            limit: 1,
            context: SYSTEM_CTX,
          });
          const row = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0];
          return (row as EmailTemplateRow) || null;
        },
      };

      // Mutate the existing service instance so consumers that already
      // captured a reference (e.g. AuthManager) see the upgrade.
      if (persistence) this.service.setPersistence(persistence);
      this.service.setTemplateLoader(templateLoader);
      ctx.logger.info('EmailServicePlugin: sys_email persistence + template loader enabled');

      // ── sys_email OUTBOX DRAIN (afterInsert) ─────────────────────────
      // Apps that can only `api.write` (e.g. sandboxed action bodies, which
      // expose no `api.email`) cannot reach the email service directly — the
      // only thing they CAN do is INSERT a sys_email row. Treat such a row,
      // inserted as `status:'queued'` with no `message_id`, as an outbox
      // entry: deliver it through the live transport, then finalize the SAME
      // row in place (`sent`/`failed`). Without this, those rows sat at
      // `queued` forever (declared-but-never-delivered).
      //
      // Rows that the service's own `send()` inserts are marked managed (see
      // EmailService.isServiceManaged) and skipped here, so they are
      // delivered exactly once by `send()` — never double-sent by the hook.
      if (persistence && typeof (engine as any).registerHook === 'function') {
        const svc = this.service;
        const DRAIN_PKG = 'com.objectstack.service.email.drain';
        if (typeof (engine as any).unregisterHooksByPackage === 'function') {
          (engine as any).unregisterHooksByPackage(DRAIN_PKG);
        }
        (engine as any).registerHook(
          'afterInsert',
          async (hookCtx: any) => {
            try {
              if (hookCtx?.object !== 'sys_email') return;
              const row = hookCtx?.result;
              if (!row || typeof row !== 'object') return;
              if (row.status !== 'queued' || row.message_id) return;
              const rowId = row.id != null ? String(row.id) : '';
              if (!rowId || svc.isServiceManaged(rowId)) return;
              // Defer past the current insert op: transport.send is network
              // I/O and must not run inside the insert's transaction, and the
              // row must be committed before we update it. Re-read under
              // system context to get the full row + re-check it is still an
              // undelivered queued entry (idempotent against concurrent drains).
              setTimeout(() => {
                void (async () => {
                  try {
                    const rows = await (engine as any).find('sys_email', {
                      where: { id: rowId },
                      limit: 1,
                      context: SYSTEM_CTX,
                    });
                    const fresh = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0];
                    const target = fresh ?? row;
                    if (target.status !== 'queued' || target.message_id) return;
                    await svc.deliverPersistedRow(target);
                  } catch (err: any) {
                    ctx.logger.warn(`EmailServicePlugin: outbox drain failed for ${rowId}: ${err?.message ?? err}`);
                  }
                })();
              }, 0);
            } catch (err: any) {
              ctx.logger.warn(`EmailServicePlugin: outbox drain hook error: ${err?.message ?? err}`);
            }
          },
          { packageId: DRAIN_PKG },
        );
        ctx.logger.info('EmailServicePlugin: sys_email outbox drain hook installed');
      }

      // Bind 'email.send.async' queue subscriber for durable, retry-on-failure delivery.
      // Producers: `queue.publish('email.send.async', sendInput, { maxAttempts: 5, backoff: {...} })`
      // The queue handles retry / DLQ via sys_job_queue.
      try {
        const queue: any = ctx.getService<any>('queue');
        if (queue && typeof queue.subscribe === 'function' && this.service) {
          const svc = this.service;
          await queue.subscribe('email.send.async', async (msg: any) => {
            const result = await svc.send(msg.data);
            if (result.status === 'failed') {
              // Force the queue to retry / DLQ by throwing
              throw new Error(result.error ?? 'email send failed');
            }
          });
          ctx.logger.info('EmailServicePlugin: subscribed to email.send.async queue');
        }
      } catch (err) {
        ctx.logger.warn('EmailServicePlugin: email.send.async subscription failed', err as any);
      }

      // Seed built-in + user-provided templates (upsert by name+locale).
      if (this.options.seedTemplates !== false) {
        const all = [
          ...BUILTIN_AUTH_TEMPLATES,
          ...(this.options.templates ?? []),
        ];
        for (const tpl of all) {
          try { await this.upsertTemplate(engine!, tpl); }
          catch (err: any) {
            ctx.logger.warn(`EmailServicePlugin: seed template failed: ${tpl.name} ${tpl.locale}`, err?.message || err);
          }
        }
        ctx.logger.info(`EmailServicePlugin: seeded ${all.length} template row(s)`);
      }
    });
  }

  /**
   * Translate the `mail` settings namespace snapshot into a transport
   * and `defaultFrom`, then hot-swap them on the running EmailService.
   *
   * Behaviour:
   *  - `provider = 'log' | 'smtp'` keeps the LogTransport (real SMTP
   *    delivery requires `@objectstack/plugin-mail-smtp`, which is not
   *    a dependency of this package). The from-address is still applied.
   *  - `provider = 'resend' | 'postmark'` rebuilds the transport using
   *    `api_key` from settings. If `api_key` is missing the swap is
   *    skipped and a warning is logged — the previous transport stays.
   *
   * Env-locked fields (handled in SettingsService.get) still resolve
   * before this method ever sees them, so an env override transparently
   * wins.
   */
  private applyMailSettings(values: Record<string, unknown>, ctx: PluginContext): void {
    if (!this.service) return;

    const fromEmail = typeof values.from_email === 'string' ? values.from_email : undefined;
    const fromName = typeof values.from_name === 'string' ? values.from_name : undefined;
    if (fromEmail) this.service.setDefaultFrom({ address: fromEmail, name: fromName });

    const provider = String(values.provider ?? 'smtp');
    if (provider === 'smtp' || provider === 'log') {
      // No SMTP transport ships in core; settings-only edits become
      // a no-op for transport but still apply `defaultFrom`. Users
      // wanting real SMTP install `@objectstack/plugin-mail-smtp`
      // and configure it via constructor opts.
      ctx.logger.info(
        `EmailServicePlugin: mail settings applied (provider=${provider}, from=${fromEmail ?? '∅'}); transport unchanged.`,
      );
      return;
    }

    const apiKey = typeof values.api_key === 'string' ? values.api_key : undefined;
    if (!apiKey) {
      ctx.logger.warn(
        `EmailServicePlugin: provider='${provider}' selected but api_key is empty — transport NOT rebuilt.`,
      );
      return;
    }

    try {
      const transport = makeTransport({
        provider: provider as 'resend' | 'postmark',
        apiKey,
        logger: ctx.logger,
      });
      this.service.setTransport(transport);
      ctx.logger.info(`EmailServicePlugin: transport rebuilt from settings (provider=${provider}).`);
    } catch (err: any) {
      ctx.logger.warn('EmailServicePlugin: failed to rebuild transport: ' + (err?.message ?? err));
    }
  }

  private async upsertTemplate(engine: IDataEngine, tpl: EmailTemplate): Promise<void> {
    const row = {
      name: tpl.name,
      label: tpl.label,
      category: tpl.category,
      locale: tpl.locale,
      subject: tpl.subject,
      body_html: tpl.bodyHtml,
      ...(tpl.bodyText ? { body_text: tpl.bodyText } : {}),
      ...(tpl.fromOverride?.address ? {
        from_address: tpl.fromOverride.address,
        ...(tpl.fromOverride.name ? { from_name: tpl.fromOverride.name } : {}),
      } : {}),
      ...(tpl.replyTo ? { reply_to: tpl.replyTo } : {}),
      active: tpl.active,
      is_system: tpl.isSystem,
      ...(tpl.description ? { description: tpl.description } : {}),
      ...(tpl.variables?.length ? { variables_json: JSON.stringify(tpl.variables) } : {}),
    };
    const existing = await (engine as any).find('sys_email_template', {
      where: { name: tpl.name, locale: tpl.locale },
      limit: 1,
      context: SYSTEM_CTX,
    });
    const existingRow = Array.isArray(existing) ? existing[0] : (existing as any)?.data?.[0];
    if (existingRow?.id) {
      // Only re-seed if the existing row is system-managed (is_system=true);
      // never overwrite a tenant-customised row.
      if (existingRow.is_system === false) return;
      await (engine as any).update('sys_email_template', { id: existingRow.id, ...row }, {
        context: SYSTEM_CTX,
      });
    } else {
      await (engine as any).insert('sys_email_template', row, {
        context: SYSTEM_CTX,
      });
    }
  }
}

function extractOverrides(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  if (p.values && typeof p.values === 'object' && p.values !== null) {
    return p.values as Record<string, unknown>;
  }
  return p;
}
