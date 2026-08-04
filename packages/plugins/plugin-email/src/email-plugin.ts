// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
  IEmailTransport,
  EmailAddress,
  IMetadataService,
} from '@objectstack/spec/contracts';
import { SysEmail, SysEmailTemplate } from '@objectstack/platform-objects/audit';
import { EmailService, LogTransport, type EmailPersistence, type TemplateLoader, type EmailTemplateRow } from './email-service.js';
import {
  makeTransport,
  SmtpTransport,
  smtpOptionsFromMailSettings,
  isEmailTransportProvider,
  unsupportedProviderFix,
  type EmailTransportProvider,
} from './transports/index.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';
import type { EmailTemplateDefinition as EmailTemplate } from '@objectstack/spec/system';
import {
  bootstrapDeclaredEmailTemplates,
  upsertDeclaredEmailTemplate,
  deactivateDeclaredEmailTemplate,
  mapTemplateToRow,
} from './bootstrap-declared-email-templates.js';
import {
  bindEmailTemplateProvenanceStamp,
  unbindEmailTemplateProvenanceStamp,
} from './email-template-provenance.js';

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
  /** Provider tag — `'log' | 'resend' | 'postmark' | 'smtp'`. Default `'log'`. */
  provider?: EmailTransportProvider;
  /** API key for resend/postmark. */
  apiKey?: string;
  /**
   * Provider-specific extra options — Postmark `messageStream`, or the
   * SMTP connection for `provider: 'smtp'` (`host` / `port` / `secure` /
   * `user` / `password`, see `SmtpTransportOptions`). A `smtp` provider
   * with no `host` THROWS at init: a boot that cannot deliver must fail
   * loudly rather than degrade to a LogTransport that reports success.
   */
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
  /** Engine carrying the template provenance hook — unbound in dispose(). */
  private boundEngine?: IDataEngine;
  /** Live `email_template` metadata subscription — detached in dispose(). */
  private unsubscribeTemplates?: () => void;
  /** SMTP transport currently in use, if any — closed in dispose(). */
  private liveSmtp?: SmtpTransport;

  constructor(options: EmailServicePluginOptions = {}) {
    this.options = options;
  }

  /**
   * Materialise the constructor-configured transport.
   *
   * Deliberately propagates `makeTransport`'s throw (missing SMTP host,
   * missing API key): on the construction path — `os serve`, an explicit
   * `new EmailServicePlugin({ provider: 'smtp' })` — a provider that cannot
   * be built must fail the boot. Falling back to a LogTransport here would
   * hand the operator a server that reports every send as successful and
   * delivers nothing (#5087).
   */
  private resolveTransport(ctx: PluginContext): IEmailTransport {
    if (this.options.transport) return this.options.transport;
    const provider = this.options.provider ?? 'log';
    if (provider === 'log') return new LogTransport(ctx.logger);
    const transport = makeTransport({
      provider,
      apiKey: this.options.apiKey,
      options: this.options.providerOptions,
      logger: ctx.logger,
    });
    if (transport instanceof SmtpTransport) this.liveSmtp = transport;
    return transport;
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
              const sources: Record<string, string> = {};
              for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
                values[k] = v?.value;
                if (v?.source) sources[k] = String(v.source);
              }
              this.applyMailSettings(values, sources, ctx);
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

          // Register the `mail/test` action handler so pressing "Send test
          // email" actually delivers one. This OVERRIDES the built-in
          // fallback in service-settings, which can only validate the form
          // (and says so) — the same pattern `storage/test` uses.
          //
          // The handler accepts both the persisted snapshot (`values`)
          // and the (possibly unsaved) form state posted as
          // `payload.values`, with overrides winning. When the merged
          // provider/credentials differ from what the live `svc` is bound
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
              // "edited but not saved" path. For `smtp` this ALWAYS
              // happens: the button must exercise the host/port/TLS/
              // credentials on screen, and a real connection is the only
              // thing that can report an authentication failure honestly
              // (#5087 — this action used to report success for SMTP
              // while the live transport was still the LogTransport).
              let target: EmailService = svc;
              let tempDescription = '';
              /** One-shot SMTP transport built for this test — closed below. */
              let tempSmtp: SmtpTransport | undefined;
              const provider = String(merged.provider ?? 'smtp');
              const apiKey = typeof merged.api_key === 'string' ? merged.api_key : undefined;
              if (provider === 'smtp') {
                const smtp = smtpOptionsFromMailSettings(merged);
                if (!smtp.host) {
                  return { ok: false, severity: 'error', message: 'SMTP host is required — nothing was sent.' };
                }
                try {
                  tempSmtp = new SmtpTransport({ ...smtp, logger: ctx.logger });
                  target = new EmailService({
                    transport: tempSmtp,
                    defaultFrom: merged.from_email
                      ? {
                          address: String(merged.from_email),
                          name: merged.from_name ? String(merged.from_name) : undefined,
                        }
                      : undefined,
                    // Same sys_email audit trail as any other delivery —
                    // a test send is a send.
                    ...(svc.options.persistence ? { persistence: svc.options.persistence } : {}),
                    logger: ctx.logger,
                  });
                  tempDescription = ` via smtp (${smtp.host}:${smtp.port ?? 587})`;
                } catch (err: any) {
                  return { ok: false, severity: 'error', message: `Failed to build SMTP transport: ${err?.message ?? String(err)}` };
                }
              } else if (provider !== 'log') {
                // A provider with no transport behind it — a value stored while
                // the settings page still offered SendGrid / Amazon SES (#5094).
                // Refuse before asking for an API key: nothing here can use one.
                if (!isEmailTransportProvider(provider)) {
                  return {
                    ok: false,
                    severity: 'error',
                    message: `provider='${provider}' is not a provider this server can deliver with, so NOTHING was `
                      + 'sent (and nothing has been sent through it since it was saved). Fix: '
                      + unsupportedProviderFix(provider),
                  };
                }
                if (!apiKey) {
                  return { ok: false, severity: 'error', message: `${provider}: api_key is required.` };
                }
                try {
                  const transport = makeTransport({
                    provider,
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
                    ...(svc.options.persistence ? { persistence: svc.options.persistence } : {}),
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
                  // Carry the transport's own words (SMTP reply codes,
                  // provider error bodies) — the operator needs to read
                  // "535 authentication failed", not "Send failed".
                  return {
                    ok: false,
                    severity: 'error',
                    message: `Test send failed${tempDescription}: ${result.error ?? 'unknown transport error'}`,
                  };
                }
                // A LogTransport "send" is not a delivery. Say so instead of
                // reporting the success it never had (#5087).
                if (target === svc && svc.options.transport instanceof LogTransport) {
                  return {
                    ok: false,
                    severity: 'warning',
                    message: 'No delivery transport is active — the message was only logged and recorded in sys_email. '
                      + 'Configure an SMTP host (or an API provider) and save before testing.',
                  };
                }
                return {
                  ok: true,
                  severity: 'info',
                  message: `Sent test email to ${to}${tempDescription} (id=${result.id}).`,
                };
              } catch (err: any) {
                return { ok: false, severity: 'error', message: err?.message ?? String(err) };
              } finally {
                // The test transport is this call's own — release it rather
                // than leaving a connection behind on every button press.
                await tempSmtp?.close();
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

      // ── DECLARED email_template METADATA → sys_email_template (#4509) ──
      // The second door: everything authored as `email_template` metadata
      // (stack `emailTemplates:`, `*.email-template.ts`, Studio, PUT /meta)
      // materializes into the rows sendTemplate actually reads. Gated on the
      // DATA ENGINE alone — materializing rows is a pure write, so it must not
      // sit behind transport/settings availability. (The webhook bridge learned
      // this the hard way: gated behind its dispatch prerequisites, a
      // realtime-less deployment silently materialized nothing — the very
      // no-op class this closes, #3461.)
      await this.bootDeclaredTemplates(ctx, engine);
    });
  }

  /**
   * [#4509] Materialize declared `email_template` metadata, bind the provenance
   * stamp, and keep the rows live for runtime authoring.
   *
   * `email_template` is `allowRuntimeCreate: true` (unlike `webhook`), so a
   * boot-only sweep would leave a Studio save inert until the next restart —
   * the same bug, half-fixed. The subscription re-materializes the single
   * changed item; `MetadataManager.register` notifies watchers only AFTER the
   * write has landed, so re-reading on the event cannot race the data.
   */
  private async bootDeclaredTemplates(ctx: PluginContext, engine: IDataEngine): Promise<void> {
    // Bind the provenance stamp so an admin edit freezes a seeded row.
    this.boundEngine = engine;
    try { bindEmailTemplateProvenanceStamp(engine as any, ctx.logger as any); }
    catch (err: any) {
      ctx.logger.warn('EmailServicePlugin: template provenance stamp not bound: ' + (err?.message ?? err));
    }

    let metadataService: IMetadataService | undefined;
    try { metadataService = ctx.getService<IMetadataService>('metadata'); } catch { /* optional */ }

    try {
      await bootstrapDeclaredEmailTemplates(engine, metadataService, ctx.logger as any);
    } catch (err: any) {
      ctx.logger.warn(
        'EmailServicePlugin: declared email-template bootstrap failed (built-in templates still serve): '
        + (err?.message ?? err),
      );
    }

    // Live path — Studio saves / PUT /meta land as `added`/`changed` events.
    if (typeof metadataService?.subscribe !== 'function') return;
    try {
      this.unsubscribeTemplates = metadataService.subscribe('email_template', (event: any) => {
        void (async () => {
          try {
            const kind = event?.type;
            if (kind === 'deleted' || kind === 'unlink') {
              // Delete events carry no locale — deactivate by name, and only
              // rows this bridge owns.
              await deactivateDeclaredEmailTemplate(engine, String(event?.name ?? ''), undefined, ctx.logger as any);
              return;
            }
            const raw = event?.data ?? (event?.name
              ? await metadataService.get?.('email_template', event.name)
              : undefined);
            if (!raw) return;
            await upsertDeclaredEmailTemplate(engine, (raw as any)?.content ?? raw, undefined, ctx.logger as any);
            ctx.logger.info(`EmailServicePlugin: email template '${event?.name}' materialized from a runtime write`);
          } catch (err: any) {
            ctx.logger.warn(
              `EmailServicePlugin: runtime email-template sync failed for '${event?.name}': ${err?.message ?? err}`,
            );
          }
        })();
      });
      ctx.logger.info('EmailServicePlugin: subscribed to email_template metadata changes');
    } catch (err: any) {
      ctx.logger.warn('EmailServicePlugin: email_template subscription failed: ' + (err?.message ?? err));
    }
  }

  async dispose(): Promise<void> {
    try { this.unsubscribeTemplates?.(); } catch { /* best effort */ }
    this.unsubscribeTemplates = undefined;
    if (this.liveSmtp) {
      try { await this.liveSmtp.close(); } catch { /* best effort */ }
      this.liveSmtp = undefined;
    }
    if (this.boundEngine) {
      try { unbindEmailTemplateProvenanceStamp(this.boundEngine as any); } catch { /* best effort */ }
      this.boundEngine = undefined;
    }
  }

  /**
   * Translate the `mail` settings namespace snapshot into a transport
   * and `defaultFrom`, then hot-swap them on the running EmailService.
   *
   * Behaviour:
   *  - `provider = 'smtp'` builds a real {@link SmtpTransport} from
   *    `smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` /
   *    `smtp_password` and swaps it in (ADR-0012 — SMTP ships in core).
   *  - `provider = 'log'` keeps the LogTransport. The from-address is
   *    still applied.
   *  - `provider = 'resend' | 'postmark'` rebuilds the transport using
   *    `api_key` from settings.
   *  - anything else — including `sendgrid` / `ses`, which the settings page
   *    offered for several releases without a transport behind either (#5094)
   *    and which persisted workspaces still resolve — keeps the previous
   *    transport and reports at `error` with the SMTP migration that replaces
   *    it. A settings value written by an older release must not be able to
   *    stop a server from booting, and must not be able to look configured.
   *
   * **This path never throws.** A settings save must not be able to kill a
   * running server, so a transport that cannot be built leaves the previous
   * one in place — but it says so at `error` level, naming the consequence
   * (mail is NOT being delivered) and the fix, and `mail/test` surfaces the
   * same failure to whoever pressed the button. What it must never do is
   * keep a LogTransport and report success: that silent gap IS #5087.
   * (The constructor / CLI path is the opposite — it throws, so a boot that
   * cannot deliver fails loudly instead of starting half-configured.)
   *
   * `sources` carries each key's provenance from the resolver so the
   * unconfigured out-of-the-box state (`provider` still at its manifest
   * default of `smtp`, no host anywhere) is reported as the information it
   * is, while an OPERATOR-selected SMTP with no host is an error. Escalating
   * both would print an error on every fresh dev boot and train everyone to
   * skim errors — the failure mode AGENTS.md's degradation-log-level section
   * warns about.
   *
   * Env-locked fields (handled in SettingsService.get) still resolve
   * before this method ever sees them, so an env override transparently
   * wins.
   */
  private applyMailSettings(
    values: Record<string, unknown>,
    sources: Record<string, string>,
    ctx: PluginContext,
  ): void {
    if (!this.service) return;

    const fromEmail = typeof values.from_email === 'string' ? values.from_email : undefined;
    const fromName = typeof values.from_name === 'string' ? values.from_name : undefined;
    if (fromEmail) this.service.setDefaultFrom({ address: fromEmail, name: fromName });

    const provider = String(values.provider ?? 'smtp');

    if (provider === 'smtp') {
      const smtp = smtpOptionsFromMailSettings(values);
      if (!smtp.host) {
        // The settings page carries no host — but the boot may already have
        // built one from OS_EMAIL_SMTP_* / providerOptions, in which case
        // SMTP mail IS being delivered and there is nothing to report.
        if (this.service.options.transport instanceof SmtpTransport) {
          ctx.logger.info(
            'EmailServicePlugin: mail settings carry no SMTP host — keeping the SMTP transport configured '
            + 'at boot (OS_EMAIL_SMTP_HOST / providerOptions).',
          );
          return;
        }
        const selected = (sources.provider ?? 'default') !== 'default';
        const line = "EmailServicePlugin: provider='smtp' but no SMTP host is configured — the previous "
          + 'transport is kept and NO mail is delivered over SMTP. Fix: set Settings → Mail → Host '
          + '(or OS_MAIL_SMTP_HOST), or select another provider.';
        if (selected) ctx.logger.error(line);
        else ctx.logger.info(`${line} (Mail has never been configured — this is the out-of-the-box state.)`);
        return;
      }
      try {
        const transport = new SmtpTransport({ ...smtp, logger: ctx.logger });
        this.service.setTransport(transport);
        this.liveSmtp = transport;
        ctx.logger.info(
          `EmailServicePlugin: SMTP transport built from settings (host=${smtp.host}:${smtp.port ?? 587}, `
          + `tls=${smtp.secure !== false}, auth=${smtp.user ? 'yes' : 'no'}).`,
        );
      } catch (err: any) {
        ctx.logger.error(
          "EmailServicePlugin: provider='smtp' selected but the SMTP transport could NOT be built — the "
          + 'previous transport is kept and NO mail is delivered over SMTP. Fix the SMTP settings and save '
          + 'again. Cause: ' + (err?.message ?? err),
        );
      }
      return;
    }

    if (provider === 'log') {
      ctx.logger.info(
        `EmailServicePlugin: mail settings applied (provider=log, from=${fromEmail ?? '∅'}); `
        + 'transport unchanged — messages are logged and recorded in sys_email, never delivered.',
      );
      return;
    }

    // A stored provider this build cannot deliver with — checked BEFORE the
    // api_key branch, because "set an API key" is the wrong instruction for a
    // provider that has no transport to hand the key to. Same shape as every
    // other failure here: previous transport kept, error naming the consequence
    // and the fix, no throw. Workspaces that saved `sendgrid` / `ses` while the
    // settings page still offered them arrive here on every boot (#5094).
    if (!isEmailTransportProvider(provider)) {
      ctx.logger.error(
        `EmailServicePlugin: provider='${provider}' is not a provider this server can deliver with — the `
        + 'previous transport is kept and NO mail is delivered through it. Fix: '
        + unsupportedProviderFix(provider),
      );
      return;
    }

    const apiKey = typeof values.api_key === 'string' ? values.api_key : undefined;
    if (!apiKey) {
      ctx.logger.error(
        `EmailServicePlugin: provider='${provider}' selected but api_key is empty — the previous transport `
        + 'is kept and NO mail is delivered through it. Fix: set Settings → Mail → API key.',
      );
      return;
    }

    try {
      const transport = makeTransport({
        provider,
        apiKey,
        logger: ctx.logger,
      });
      this.service.setTransport(transport);
      this.liveSmtp = undefined;
      ctx.logger.info(`EmailServicePlugin: transport rebuilt from settings (provider=${provider}).`);
    } catch (err: any) {
      ctx.logger.error(
        `EmailServicePlugin: provider='${provider}' selected but the transport could NOT be built — the `
        + 'previous transport is kept and NO mail is delivered through it. Cause: ' + (err?.message ?? err),
      );
    }
  }

  /**
   * Seed a built-in / options-supplied template. Provenance axis here is
   * `is_system` — see {@link bootstrapDeclaredEmailTemplates} for the DECLARED
   * metadata door, which uses `managed_by`/`customized` and shares this exact
   * row mapping via {@link mapTemplateToRow}.
   *
   * New rows are stamped `managed_by: 'platform'` — NOT left to the column's
   * `'admin'` default. The default exists for rows an admin creates through the
   * data door, and the declared-metadata bridge refuses to overwrite `admin`
   * rows; an unstamped built-in would therefore masquerade as admin-authored
   * and permanently outrank a template the app actually declared. That is the
   * #4509 failure exactly (an authored password-reset mail losing to the
   * built-in copy), and the ADR-0054 proof pins it.
   */
  private async upsertTemplate(engine: IDataEngine, tpl: EmailTemplate): Promise<void> {
    const row = mapTemplateToRow(tpl);
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
      // A row the declared bridge already owns keeps its `package` provenance —
      // re-stamping it `platform` would hand the built-in door a veto it does
      // not have.
      await (engine as any).update('sys_email_template', { id: existingRow.id, ...row }, {
        context: SYSTEM_CTX,
      });
    } else {
      await (engine as any).insert('sys_email_template', {
        ...row,
        managed_by: 'platform',
        customized: false,
      }, {
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
