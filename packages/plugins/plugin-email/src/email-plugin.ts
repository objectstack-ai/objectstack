// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
  IEmailTransport,
  EmailAddress,
  IMetadataService,
  IQueueService,
  QueueBackoffPolicy,
} from '@objectstack/spec/contracts';
import { SysEmail, SysEmailTemplate } from '@objectstack/platform-objects/audit';
import {
  EmailService,
  LogTransport,
  EMAIL_SEND_QUEUE,
  type EmailPersistence,
  type EmailQueueDelivery,
  type TemplateLoader,
} from './email-service.js';
import { createSysEmailTemplateLoader } from './template-loader.js';
import {
  makeTransport,
  SmtpTransport,
  smtpOptionsFromMailSettings,
  isEmailTransportProvider,
  unsupportedProviderFix,
  type EmailTransportProvider,
} from './transports/index.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';
import type {
  EmailTemplateDefinition as EmailTemplate,
  SettingsChangeHandler,
  SettingsUnsubscribe,
} from '@objectstack/spec/system';
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
import { sweepStrandedOutbox, type OutboxSweepResult } from './outbox-sweep.js';
import {
  EMAIL_ATTACHMENT_RECLAIM_QUEUE,
  EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
  type EmailAttachmentReclaimPayload,
  type EmailAttachmentStore,
} from './attachment-storage.js';
import {
  reclaimAttachmentContent,
  type AttachmentReclaimEngine,
} from './attachment-reclaim.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * "No source could answer" — distinct from "nothing declares this name", which
 * is a plain `undefined`. Only the latter may retire a materialized template
 * row; see {@link EmailServicePlugin.readEffectiveTemplate}.
 */
const FAILED_READ = Symbol('email-template-read-failed');

/**
 * Drop the underscore-prefixed keys a SERVED metadata item carries
 * (`_diagnostics`, `_packageId`, `_provenance`, `_draft`, …). Every one of
 * them is a read-time verdict the protocol attaches, never an authored field:
 * `EmailTemplateDefinitionSchema` is a `strictObject` and declares no
 * underscore key, so leaving them on turns a perfectly good declaration into a
 * validation failure.
 */
function stripReadDecorations(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out;
}

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
  /**
   * Deliver through the durable `queue` service instead of inline (#5160).
   * Default false — inline delivery, unchanged.
   *
   * When `true`, `send()` persists the `sys_email` row, publishes an
   * `email.send.async` job referencing it, and returns `status: 'queued'`
   * straight away; a worker delivers the row and finalizes it in place, and
   * `retries` becomes the queue's attempt budget (`retries + 1` attempts,
   * exponentially backed off, then DLQ) instead of an in-process loop.
   *
   * Declaring it `true` here — the constructor / `OS_EMAIL_QUEUE_ENABLED`
   * channel — is a DEPLOYMENT declaration, so a boot that cannot honour it
   * fails rather than starting half-configured (#5132 precedent). The
   * settings-page toggle is the opposite trade: it degrades to inline
   * delivery and says so, because one save must not stop the mail.
   */
  queueDelivery?: boolean;
}

/**
 * Backoff applied to queued deliveries: 1s, 2s, 4s … capped at 5 minutes.
 *
 * Deliberately unlike the inline loop's 2s ceiling — an SMTP host that just
 * rejected a connection is rarely ready 2s later, and the whole point of
 * moving the retry into `sys_job_queue` is that waiting minutes costs nothing
 * (no process is held open across it).
 */
const QUEUE_DELIVERY_BACKOFF: QueueBackoffPolicy = {
  type: 'exponential',
  delayMs: 1000,
  maxDelayMs: 5 * 60_000,
};

/**
 * The `settings` slot as THIS plugin consumes it.
 *
 * [#4251 B5] `service-settings` registers its `SettingsService` here and the
 * slot carries no `packages/spec` contract, so the four members this plugin
 * calls are declared structurally — plugin-email must not take a runtime
 * dependency on service-settings, which is optional. Same shape and reasoning
 * as plugin-auth's and rest's `SettingsReadSurface`; each consumer names the
 * slice it uses, so omitting a member it calls is a compile error rather than
 * silence. The change-bus types are the SPEC's, not re-declared here.
 */
interface MailSettingsSurface {
  /**
   * Capability probe only — never called. Its presence is what the call site
   * reads as "this settings service can serve a live client", so it is typed
   * as a member of unknown shape rather than given a fictional signature.
   */
  createClient?: unknown;
  /** Resolve the whole `mail` namespace as `key → { value, source }`. */
  getNamespace(
    namespace: string,
    ctx?: Record<string, unknown>,
  ): Promise<{ values: Record<string, { value?: unknown; source?: string } | undefined> }>;
  /** Rebuild the transport when the namespace changes. Optional: no change bus → the boot read stands. */
  subscribe?(namespace: string | undefined, handler: SettingsChangeHandler): SettingsUnsubscribe;
  /** Override service-settings' validate-only `mail/test` fallback with a real send. */
  registerAction?(
    namespace: string,
    action: string,
    handler: (input: {
      values?: Record<string, unknown>;
      payload?: Record<string, unknown>;
      ctx?: { body?: Record<string, unknown> };
    }) => Promise<unknown>,
  ): void;
}

/**
 * Resolve a queue service that can actually carry a durable email job, or
 * `undefined`.
 *
 * The presence of a service named `queue` is NOT the question. `ObjectKernel`
 * pre-injects an in-memory fallback for `queue` on every boot that lacks a
 * queue plugin (`createMemoryQueue`), and that fallback delivers synchronously,
 * un-awaited, with no durability, no retry and no DLQ. Publishing to it would
 * let `send()` answer `queued` for a message nothing can ever retry — the
 * declared-but-not-delivered gap #5087 closed for transports, re-opened one
 * layer over. It labels itself for exactly this purpose
 * (`__serviceInfo.status === 'degraded'`, ADR-0076 D12), so read the label.
 */
/**
 * Resolve the `file-storage` capability that can hold out-of-row attachment
 * content (#5172), or `undefined`.
 *
 * Typed at the lookup — `EmailAttachmentStore`, declared in this package —
 * rather than erased to `any` (#4127/#4251, the #5210 shape): the three calls
 * this makes are `upload` / `download` / `delete`, and every one of them fails
 * *invisibly* if the slot's shape changes under us. An upload that throws
 * `x.upload is not a function` inside the offload's own `try` looks exactly
 * like "the operator has no storage", so mail would quietly stop being durable
 * with a log line blaming the deployment.
 *
 * Unlike `queue`, the kernel injects no in-memory fallback for `file-storage`,
 * so absence is a plain throw from `getService` and there is no `degraded`
 * label to read. The structural probe is still real: `SwappableStorageService`
 * forwards to whatever adapter the `storage` settings namespace names.
 */
export function resolveAttachmentStore(
  getService: (name: string) => unknown,
): EmailAttachmentStore | undefined {
  let storage: unknown;
  try { storage = getService('file-storage'); } catch { return undefined; }
  const candidate = storage as Partial<EmailAttachmentStore> | undefined;
  if (
    !candidate
    || typeof candidate.upload !== 'function'
    || typeof candidate.download !== 'function'
    || typeof candidate.delete !== 'function'
  ) {
    return undefined;
  }
  return candidate as EmailAttachmentStore;
}

export function resolveDurableQueue(getService: (name: string) => unknown): IQueueService | undefined {
  let queue: any;
  try { queue = getService('queue'); } catch { return undefined; }
  if (!queue || typeof queue.publish !== 'function' || typeof queue.subscribe !== 'function') {
    return undefined;
  }
  if (queue.__serviceInfo?.status === 'degraded') return undefined;
  return queue as IQueueService;
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
  /**
   * Live `email_template` protocol-mutation listener (#7733) — detached in
   * dispose(). Only set on the `onMetadataMutation` fallback; the preferred
   * `registerMutationProjector` seam is a per-type Map slot with no
   * unregister verb, so that half is released by dropping the protocol.
   */
  private unsubscribeTemplateMutations?: () => void;
  /**
   * Whether the live template bridge is armed. Cleared in dispose(), and read
   * by the materializer because the projector seam has no unregister verb: a
   * disposed plugin's projector stays in the protocol's per-type slot, and
   * without this it would keep writing `sys_email_template` rows through an
   * engine whose provenance hook has already been unbound.
   */
  private templateBridgeArmed = false;
  /** SMTP transport currently in use, if any — closed in dispose(). */
  private liveSmtp?: SmtpTransport;
  /**
   * The `mail` settings page's override of `options.queueDelivery`.
   * `undefined` means no operator has touched the toggle (the manifest
   * default still resolves it), so the constructor declaration stands —
   * the same "is this value SELECTED or merely defaulted?" reading
   * `applyMailSettings` already applies to `provider`.
   */
  private queueDeliveryFromSettings?: boolean;
  /**
   * Settles when the boot outbox sweep (#5161) has finished — with its counts,
   * or `undefined` when the sweep itself failed (already reported at `error`).
   *
   * Boot does NOT await it, so this is how anything that needs determinism
   * (tests, an operator script) observes the sweep instead of guessing.
   */
  outboxSweepSettled?: Promise<OutboxSweepResult | undefined>;

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
        const settings = ctx.getService<MailSettingsSurface>('settings');
        if (settings && typeof settings.createClient === 'function') {
          const applySettings = async (phase: 'boot' | 'saved' = 'boot') => {
            try {
              const payload = await settings.getNamespace('mail');
              const values: Record<string, unknown> = {};
              const sources: Record<string, string> = {};
              for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
                values[k] = v?.value;
                if (v?.source) sources[k] = String(v.source);
              }
              this.applyMailSettings(values, sources, ctx, phase);
            } catch (err: any) {
              ctx.logger.warn('EmailServicePlugin: failed to apply mail settings: ' + (err?.message ?? err));
            }
          };
          await applySettings('boot');
          // Subscribe to namespace changes; rebuild on every update.
          if (typeof settings.subscribe === 'function') {
            settings.subscribe('mail', () => {
              void applySettings('saved');
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
                // ALWAYS inline, never the queue (#5160). The operator pressed
                // a button and is waiting for the SMTP server's own answer;
                // "queued" would be the same non-answer #5087 removed here.
                const result = await target.sendInline({
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
            // The engine's OWN answer is forwarded, not laundered into
            // `row.id`. ObjectQL honours the id it is handed, so this confirms
            // `row.id` — and on the day some driver re-keys the row instead,
            // `EmailPersistence`'s insert contract (#5523) says so loudly here
            // rather than letting the outbox drain hook double-send the
            // message. `created` without a usable id means the engine reported
            // no identity at all, which is not a disagreement: confirm the row
            // we asked for.
            return created?.id ? { id: String(created.id) } : { id: String(row.id) };
          },
          async update(id, patch) {
            await (engine as any).update('sys_email', { id, ...patch }, {
              context: SYSTEM_CTX,
            });
          },
        };

      // Locale resolution lives in its own module (#7731) — the inline version
      // here queried `{ name }` unordered with `limit: 1` whenever no locale
      // was passed, which answered an i18n bundle with whatever row the driver
      // yielded first instead of the documented en-US default.
      const templateLoader: TemplateLoader = createSysEmailTemplateLoader(engine as any);

      // Mutate the existing service instance so consumers that already
      // captured a reference (e.g. AuthManager) see the upgrade.
      if (persistence) this.service.setPersistence(persistence);
      this.service.setTemplateLoader(templateLoader);
      ctx.logger.info('EmailServicePlugin: sys_email persistence + template loader enabled');

      // Out-of-row attachment content (#5172). A thunk for the same reason the
      // queue is one: `file-storage` is a SwappableStorageService whose
      // adapter changes when the `storage` settings namespace does, and it may
      // register after this plugin. Resolving here once would pin the service
      // to the adapter that happened to exist at boot.
      this.service.setAttachmentStorage({
        resolve: () => resolveAttachmentStore((name) => ctx.getService(name)),
      });

      // Re-apply the delivery mode now that persistence exists: queue
      // delivery references a `sys_email` row, so it is only meaningful once
      // there is somewhere to write one. (`applyMailSettings` above may
      // already have set the flag; this recomputes the same answer.)
      this.applyQueueDelivery(ctx);

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
                    // `error`, not `warn` (#5161): the insert returned, the row
                    // is there, everything looks normal — and the mail was NOT
                    // sent. Nothing else in this process will look at that row
                    // again, so a line nobody reads is the whole loss.
                    ctx.logger.error(
                      `EmailServicePlugin: outbox drain FAILED for sys_email row '${rowId}' — that message was `
                      + 'NOT sent and the row stays at `queued`; nothing retries it in this process. Fix: it is '
                      + 'picked up by the boot outbox sweep on the next restart; to have failures retried and '
                      + 'dead-lettered instead of waiting for one, turn on Settings → Mail → "Durable queue '
                      + 'delivery" (@objectstack/service-queue over an ObjectQL engine). '
                      + `Cause: ${err?.message ?? err}`,
                    );
                  }
                })();
              }, 0);
            } catch (err: any) {
              // Same class one level up: the row was inserted and never even
              // scheduled for delivery.
              ctx.logger.error(
                'EmailServicePlugin: outbox drain hook error — an inserted sys_email row was never scheduled '
                + 'for delivery and stays at `queued`, undelivered, while the insert reported success. Fix: the '
                + `boot outbox sweep picks it up on the next restart. Cause: ${err?.message ?? err}`,
              );
            }
          },
          { packageId: DRAIN_PKG },
        );
        ctx.logger.info('EmailServicePlugin: sys_email outbox drain hook installed');
      }

      // ── 'email.send.async' SUBSCRIBER ────────────────────────────────
      // The consuming half of queue delivery (#5160). The canonical payload
      // is `{ rowId }` — the id of a `sys_email` row `send()` already
      // persisted — and the worker finalizes THAT row in place.
      //
      // It used to be `svc.send(msg.data)`, which inserted a brand-new
      // sys_email row on every delivery: a message the queue retried 5 times
      // left 5 rows, four of them permanently `failed`, none of them carrying
      // the true attempt count. One message is one row; `attempt_count`
      // accumulates on it across redeliveries.
      try {
        const queue = ctx.getService<IQueueService>('queue');
        if (queue && typeof queue.subscribe === 'function' && this.service) {
          const svc = this.service;
          await queue.subscribe(EMAIL_SEND_QUEUE, async (msg: any) => {
            const data = msg?.data;
            const rowId = typeof data?.rowId === 'string' && data.rowId ? data.rowId : '';
            // `msg.attempts` is 1-based for the CURRENT delivery, so the
            // attempts already spent on this row is one fewer.
            const priorAttempts = Math.max(0, Number(msg?.attempts ?? 1) - 1);

            if (!rowId) {
              // Migration window: producers written against the pre-#5160
              // subscriber publish a raw SendEmailInput. Deliver it inline —
              // routing it through `send()` while queue mode is on would
              // re-publish the very message being consumed.
              const legacy = await svc.sendInline(data);
              if (legacy.status === 'failed') throw new Error(legacy.error ?? 'email send failed');
              return;
            }

            const rows = await (engine as any).find('sys_email', {
              where: { id: rowId },
              limit: 1,
              context: SYSTEM_CTX,
            });
            const row = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0];
            if (!row) {
              // Do NOT throw: no number of retries makes a deleted row
              // reappear, and burning the attempt budget only moves the same
              // dead job to the DLQ later. Report it — a send that was
              // accepted and can never be delivered is a durability loss, and
              // it will look like nothing happened at all.
              ctx.logger.error(
                `EmailServicePlugin: sys_email row '${rowId}' referenced by an ${EMAIL_SEND_QUEUE} job no longer `
                + 'exists — that message will NEVER be delivered and the caller was already told it was queued. '
                + 'Fix: stop deleting sys_email rows in `queued` state (it is an append-only log), or drain the '
                + 'queue before purging.',
              );
              return;
            }
            // Already delivered — a duplicate delivery (lease expiry, a
            // second worker) must not send the mail twice.
            if (row.status === 'sent' || row.message_id) return;

            // maxAttempts: 1 — the QUEUE owns retrying. Letting the row loop
            // retry underneath it would multiply the two budgets together.
            const result = await svc.deliverPersistedRow(row, { maxAttempts: 1, priorAttempts });
            if (result.status === 'failed') {
              // Force the queue to retry / DLQ by throwing
              throw new Error(result.error ?? 'email send failed');
            }
          });
          ctx.logger.info(`EmailServicePlugin: subscribed to ${EMAIL_SEND_QUEUE} queue`);
        }
      } catch (err) {
        ctx.logger.warn(`EmailServicePlugin: ${EMAIL_SEND_QUEUE} subscription failed`, err as any);
      }

      // ── 'email.attachment.reclaim' SUBSCRIBER (#5172) ─────────────────
      // The consuming half of out-of-row attachment content. Each job is
      // published at a row's terminal transition with a one-day delay and
      // carries the storage keys, so it can delete the content even when the
      // row it belonged to is gone by the time it fires — which is exactly
      // what keeps a future row-retention policy from orphaning bytes.
      try {
        const queue: IQueueService | undefined = resolveDurableQueue((name) => ctx.getService(name));
        if (queue) {
          const reclaimEngine = engine as unknown as AttachmentReclaimEngine;
          await queue.subscribe<EmailAttachmentReclaimPayload>(
            EMAIL_ATTACHMENT_RECLAIM_QUEUE,
            async (msg) => {
              const payload = msg?.data;
              if (!payload?.rowId) return;
              // A throw here is the job's retry signal, and the reclaimer
              // throws only for failures a retry can fix (a delete that did
              // not land). Both shipped adapters delete idempotently, so the
              // retry re-runs the whole key list cleanly.
              await reclaimAttachmentContent(payload, {
                engine: reclaimEngine,
                store: resolveAttachmentStore((name) => ctx.getService(name)),
                logger: ctx.logger,
                rearm: async (delayMs) => {
                  try {
                    await queue.publish<EmailAttachmentReclaimPayload>(
                      EMAIL_ATTACHMENT_RECLAIM_QUEUE,
                      payload,
                      {
                        delay: delayMs,
                        // A DIFFERENT key from the original publish: the job
                        // being re-armed is the one currently running, so
                        // reusing its key would let the running message's own
                        // idempotency record suppress its successor.
                        idempotencyKey: `sys_email_attachments:${payload.rowId}:rearm:${Date.now()}`,
                        maxAttempts: 5,
                        retries: 4,
                        backoff: { type: 'exponential', delayMs: 60_000, maxDelayMs: 60 * 60_000 },
                        metadata: { object: 'sys_email', rowId: payload.rowId },
                      },
                    );
                    return true;
                  } catch {
                    return false;
                  }
                },
              });
            },
          );
          ctx.logger.info(
            `EmailServicePlugin: subscribed to ${EMAIL_ATTACHMENT_RECLAIM_QUEUE} queue `
            + `(out-of-row attachment content is reclaimed ${Math.round(EMAIL_ATTACHMENT_RECLAIM_GRACE_MS / 3600_000)}h `
            + 'after a sys_email row reaches a terminal state; its filename/size/hash stay on the row forever)',
          );
        }
      } catch (err) {
        // `error`, not `warn`: without this subscriber, content that was
        // uploaded on the promise of being temporary is never deleted, and
        // nothing else in the process looks at those jobs.
        ctx.logger.error(
          `EmailServicePlugin: ${EMAIL_ATTACHMENT_RECLAIM_QUEUE} subscription FAILED — out-of-row attachment `
          + 'content will keep being written but never reclaimed, so the storage backend grows without bound '
          + 'while everything else looks healthy. Fix: check the durable queue service '
          + `(@objectstack/service-queue over an ObjectQL engine) and restart. Cause: ${(err as any)?.message ?? err}`,
        );
      }

      // ── CONSTRUCTOR / CLI GATE (#5160, #5132 precedent) ──────────────
      // `queueDelivery: true` from the constructor (or OS_EMAIL_QUEUE_ENABLED)
      // is a deployment declaration: this server was told to make mail
      // delivery survive its own restart. If it cannot, the honest answer is a
      // failed boot, not a server that looks configured and silently retries
      // in-process — the same judgement #5132 made for a provider that cannot
      // deliver.
      //
      // Asserted HERE, at kernel:ready, and not in `init()`: during Phase 1
      // the queue provider may simply not have registered yet, and the
      // kernel's own core-service fallbacks are injected only after that
      // phase. A verdict recorded then would be contradicted by the same boot
      // (AGENTS.md — "never record a verdict the boot can still contradict").
      if (this.options.queueDelivery === true) {
        const blocker = this.queueDeliveryBlocker(ctx, !!persistence);
        if (blocker) {
          throw new Error(
            `EmailServicePlugin: queueDelivery is enabled but ${blocker}, so mail would keep being delivered `
            + 'inline — a send that fails would be retried only in this process and lost if it dies, which is '
            + 'the durability this option was switched on to get. Fix: mount the queue capability backed by a '
            + 'durable adapter (@objectstack/service-queue over an ObjectQL engine, which upgrades to the '
            + 'sys_job_queue DbQueueAdapter)'
            + (persistence ? '' : ' and leave sys_email persistence on (`persist` must not be false)')
            + ', or set OS_EMAIL_QUEUE_ENABLED=false / omit `queueDelivery` to declare inline delivery.',
          );
        }
      }

      // ── STRANDED OUTBOX SWEEP (#5161) ────────────────────────────────
      // The `queued` rows nobody was consuming: a process that died between
      // the insert and the delivery left a row named after a queue that had no
      // reader. Swept HERE — one anchor with the boot gate above, after the
      // registries are settled and the subscriber is attached, so a re-queued
      // row has somewhere to land.
      //
      // NOT awaited: a backlog of stranded mail must not hold the server off
      // its port, and in inline mode every row is a transport round trip. And
      // self-catching BECAUSE it is not awaited: a `kernel:ready` handler that
      // throws now fails the boot on BOTH kernels (#5170 unified that), but
      // this sweep is detached from the handler, so an escaping rejection
      // would surface as an unhandled rejection instead — losing the report of
      // the very failure it exists to prevent. A stranded-row report is also
      // not grounds to refuse an otherwise healthy boot; the gate above is
      // where this plugin refuses.
      if (persistence) {
        const svc = this.service;
        this.outboxSweepSettled = (async () => {
          try {
            return await sweepStrandedOutbox({ engine: engine as any, service: svc, logger: ctx.logger });
          } catch (err: any) {
            ctx.logger.error(
              'EmailServicePlugin: the boot sweep of stranded sys_email rows FAILED to run — messages accepted '
              + 'before the last restart are still sitting at `queued`, nothing else looks at them, and the '
              + 'server will keep reporting healthy with that mail undelivered. Fix: make sure sys_email is '
              + 'readable by the system context (schema sync ran, the datasource is up), then restart to '
              + `re-sweep. Cause: ${err?.message ?? err}`,
            );
            return undefined;
          }
        })();
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
   * Effective delivery mode: the settings toggle when an operator has set
   * one, otherwise the constructor / CLI declaration.
   */
  private queueDeliveryEnabled(): boolean {
    return this.queueDeliveryFromSettings ?? this.options.queueDelivery === true;
  }

  /**
   * Build the wiring handed to {@link EmailService}. `resolve` is a thunk on
   * purpose: `QueueServicePlugin` swaps its in-memory placeholder for the
   * `sys_job_queue`-backed adapter during `kernel:ready`, so a handle captured
   * now would publish into the discarded one for the life of the process
   * (AGENTS.md — "resolve where it is used, not where you start").
   */
  private makeQueueDelivery(ctx: PluginContext): EmailQueueDelivery {
    return {
      resolve: () => resolveDurableQueue((name) => ctx.getService(name)),
      // ONE retry budget, shared by both modes. `retries` already means
      // "extra attempts after the first" for inline delivery; queued, the
      // same number becomes the queue's total attempt cap. A second knob
      // here would let the two layers disagree, and nesting a row-level
      // loop inside a queue-level one would multiply them.
      maxAttempts: Math.max(1, (this.options.retries ?? 0) + 1),
      backoff: QUEUE_DELIVERY_BACKOFF,
    };
  }

  /** Push the effective delivery mode onto the running service. */
  private applyQueueDelivery(ctx: PluginContext): void {
    if (!this.service) return;
    this.service.setQueueDelivery(
      this.queueDeliveryEnabled() ? this.makeQueueDelivery(ctx) : undefined,
    );
  }

  /**
   * Why queue delivery cannot be honoured right now, or `undefined` when it
   * can. Phrased as a sentence fragment for both gates to embed.
   */
  private queueDeliveryBlocker(ctx: PluginContext, hasPersistence: boolean): string | undefined {
    if (!hasPersistence) {
      return 'sys_email persistence is disabled (`persist: false`), so a queued job would have no row to deliver';
    }
    if (!resolveDurableQueue((name) => ctx.getService(name))) {
      return 'no durable queue service is registered (the kernel\'s in-memory fallback delivers synchronously '
        + 'with no durability, retry or DLQ, so it cannot carry this)';
    }
    return undefined;
  }

  /**
   * [#4509] Materialize declared `email_template` metadata, bind the provenance
   * stamp, and keep the rows live for runtime authoring.
   *
   * `email_template` is `allowRuntimeCreate: true` (unlike `webhook`), so a
   * boot-only sweep would leave a Studio save inert until the next restart —
   * the same bug, half-fixed.
   *
   * [#7733] The live path needs BOTH announcements, because the two authoring
   * doors announce on different seams and neither one covers the other:
   *
   *   • `metadataService.subscribe('email_template', …)` — fed by
   *     `MetadataManager.register()` → `notifyWatchers()`. That is the artifact
   *     / package-ingest door. `register` announces only AFTER the write has
   *     landed, so re-reading on the event cannot race the data.
   *
   *   • `protocol.registerMutationProjector` / `onMetadataMutation` — fed by
   *     `saveMetaItem` / `publishMetaItem` / `deleteMetaItem`, i.e. the
   *     RUNTIME-AUTHORING door: `PUT /api/v1/meta/email_template/:name`, the
   *     Studio save behind it, the AI builders, direct protocol callers.
   *
   * The comment this replaces claimed the first seam covered "Studio saves /
   * PUT /meta" too. It does not, and nothing else made up the difference:
   * `saveMetaItem` persists to `sys_metadata`, write-throughs to the ObjectQL
   * SchemaRegistry (the `[Registry] Registered email_template` line the QA run
   * saw) and announces on its OWN seam — it never calls `register()`, and
   * `notifyWatchers` has no caller outside `MetadataManager`. So the watcher
   * was armed against an event the PUT path never emits: 200 on the write, no
   * row in `sys_email_template`, and only a restart — which re-runs the boot
   * sweep over the persisted row — made the template send.
   *
   * The projector seam is preferred over the listener seam for the same reason
   * plugin-security's permission projection prefers it (ADR-0094): it is
   * AWAITED inside the write, so `PUT` → read `sys_email_template` is
   * consistent with no race window, and a materialization failure is reported
   * on the write's own response (`projectionApplied`) instead of vanishing into
   * a log. `onMetadataMutation` is the fallback for protocol implementations
   * that predate the projector.
   *
   * Both seams landing the same write is harmless and NOT guarded against:
   * `upsertDeclaredEmailTemplate` is keyed on `(name, locale)` and idempotent,
   * so a second delivery updates the row it just wrote. Deduping would need
   * per-write state whose only job is to skip a write that costs one indexed
   * lookup.
   */
  private async bootDeclaredTemplates(ctx: PluginContext, engine: IDataEngine): Promise<void> {
    // Bind the provenance stamp so an admin edit freezes a seeded row.
    this.boundEngine = engine;
    this.templateBridgeArmed = true;
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

    // Live door 1 — package ingest / artifact reload, via the metadata service.
    if (typeof metadataService?.subscribe === 'function') {
      try {
        this.unsubscribeTemplates = metadataService.subscribe('email_template', (event: any) => {
          void this.materializeTemplateMutation(ctx, engine, {
            name: event?.name,
            // Watch events name the CHANGE (`added` / `changed` / `deleted` /
            // `unlink`); mutation events name the resulting STATE. Fold to the
            // one verb the materializer takes.
            deleted: event?.type === 'deleted' || event?.type === 'unlink',
            body: event?.data,
            metadataService,
          }).catch(() => { /* already logged */ });
        });
        ctx.logger.info('EmailServicePlugin: subscribed to email_template metadata changes');
      } catch (err: any) {
        ctx.logger.warn('EmailServicePlugin: email_template subscription failed: ' + (err?.message ?? err));
      }
    }

    // Live door 2 — runtime authoring (`PUT /meta`, Studio, publish, delete),
    // via the protocol's post-persistence seam. [#7733]
    this.wireTemplateMutationProjection(ctx, engine, metadataService);
  }

  /**
   * Arm the protocol-side half of the live template path (#7733).
   *
   * Prefers the AWAITED ADR-0094 projector so the write itself carries the
   * materialization; falls back to the fire-and-forget `onMetadataMutation`
   * listener (#2588) on protocol implementations that predate it. Silent no-op
   * when the kernel registers no protocol at all (a data-plane-only host) —
   * that deployment simply has no runtime-authoring door to bridge, and the
   * boot sweep above still covers it.
   */
  private wireTemplateMutationProjection(
    ctx: PluginContext,
    engine: IDataEngine,
    metadataService: IMetadataService | undefined,
  ): void {
    let protocol: any;
    try { protocol = ctx.getService('protocol'); } catch { return; }
    if (!protocol) return;

    // `MetadataMutationEvent.state` is the row's resulting lifecycle. `draft`
    // is the ADR-0005 staging buffer and is deliberately NOT live — the same
    // reading every other consumer of this seam applies.
    const materialize = (evt: any) => {
      if (evt?.state === 'draft') return undefined;
      return this.materializeTemplateMutation(ctx, engine, {
        name: evt?.name,
        deleted: evt?.state === 'deleted',
        body: evt?.body,
        metadataService,
        protocol,
      });
    };

    try {
      if (typeof protocol.registerMutationProjector === 'function') {
        protocol.registerMutationProjector('email_template', async (evt: any) => {
          // Throws on purpose: `runMutationProjector` catches it and reports
          // `projectionApplied: { success:false, error }` on the save's own
          // response, so an author whose template did not materialize learns
          // it from the write instead of from a mail that never arrives.
          await materialize(evt);
        });
        ctx.logger.info('EmailServicePlugin: projecting email_template metadata mutations');
        return;
      }
      if (typeof protocol.onMetadataMutation === 'function') {
        this.unsubscribeTemplateMutations = protocol.onMetadataMutation((evt: any) => {
          if (evt?.type !== 'email_template') return;
          void materialize(evt)?.catch(() => { /* already logged */ });
        });
        ctx.logger.info('EmailServicePlugin: subscribed to email_template metadata mutations');
      }
    } catch (err: any) {
      ctx.logger.warn(
        'EmailServicePlugin: email_template mutation projection failed to wire: ' + (err?.message ?? err),
      );
    }
  }

  /**
   * Apply ONE announced `email_template` change to `sys_email_template` —
   * shared by both live doors, so a Studio save and a package ingest land
   * through exactly the same write (and the same seed-not-clobber rules).
   *
   * `body` is used when the announcement carries it (the projector's
   * just-persisted item, a watch event's `data`); otherwise the item is
   * re-read through the metadata service. Both are re-read AFTER persistence,
   * so neither can race the row it describes.
   *
   * A DELETE is not automatically a withdrawal. `DELETE /meta/:type/:name`
   * discards a CUSTOMIZATION overlay (ADR-0005), so on an artifact-backed
   * template it resets to the packaged declaration rather than removing it —
   * deactivating there would silently retire a template the package still
   * ships. So a delete re-reads the EFFECTIVE item (ADR-0094 names this the
   * projector's job) and re-materializes the revealed baseline; only when
   * nothing resolves is the template genuinely gone and the rows deactivated.
   * A FAILED read is not an answer and deactivates nothing — a transient DB
   * error must never be what stops a live template being sent.
   *
   * Rethrows after logging: the projector caller turns that into the write's
   * `projectionApplied` verdict, and the fire-and-forget callers swallow it.
   */
  private async materializeTemplateMutation(
    ctx: PluginContext,
    engine: IDataEngine,
    evt: {
      name: unknown;
      deleted: boolean;
      body: unknown;
      metadataService: IMetadataService | undefined;
      protocol?: any;
    },
  ): Promise<void> {
    if (!this.templateBridgeArmed) return;
    try {
      if (evt.deleted) {
        const revealed = await this.readEffectiveTemplate(ctx, evt);
        if (revealed === FAILED_READ) return;
        if (revealed) {
          await upsertDeclaredEmailTemplate(engine, revealed, undefined, ctx.logger as any);
          ctx.logger.info(
            `EmailServicePlugin: email template '${evt.name}' reset to its packaged declaration`,
          );
          return;
        }
        // Genuinely withdrawn. Delete announcements carry no locale —
        // deactivate by name, and only rows this bridge owns.
        await deactivateDeclaredEmailTemplate(engine, String(evt.name ?? ''), undefined, ctx.logger as any);
        return;
      }
      const raw = evt.body ?? (evt.name
        ? await evt.metadataService?.get?.('email_template', String(evt.name))
        : undefined);
      if (!raw) return;
      // [#8378] `evt.body` / `metadataService.get` hand back the authoring
      // document itself — there is no `{ name, content }` envelope. Unwrapping
      // could only have replaced the template with one of its values, and on
      // this door `content` cannot even arrive: `saveMetaItem` validates every
      // `email_template` write against `EmailTemplateDefinitionSchema` and
      // refuses the key with 422 `INVALID_METADATA` before persisting.
      await upsertDeclaredEmailTemplate(engine, raw, undefined, ctx.logger as any);
      ctx.logger.info(`EmailServicePlugin: email template '${evt.name}' materialized from a runtime write`);
    } catch (err: any) {
      ctx.logger.warn(
        `EmailServicePlugin: runtime email-template sync failed for '${evt.name}': ${err?.message ?? err}`,
      );
      throw err;
    }
  }

  /**
   * The effective (layered) `email_template` body a delete may have revealed,
   * `undefined` when nothing declares the name any more, or {@link FAILED_READ}
   * when no source could answer.
   *
   * `protocol.getMetaItem` first — it is the layered read, so it reports the
   * packaged declaration an overlay was hiding. `metadataService.get` is the
   * fallback for hosts without that surface; it answers from the artifact
   * registry, which for a delete is the same baseline. The three outcomes are
   * kept apart on purpose: only "nothing declares it" may deactivate a row.
   *
   * The body is stripped of read decorations before it is returned. A served
   * item carries the protocol's own underscore keys (`_diagnostics` from
   * `decorateMetadataItem`, `_packageId` / `_provenance` from the registry and
   * the overlay row), `EmailTemplateDefinitionSchema` is a `strictObject`, and
   * it declares no underscore key — so handing the decorated body to the
   * upsert would reject the very baseline this read exists to restore. This is
   * the read-side twin of the strip `saveMetaItem` does on the write side.
   */
  private async readEffectiveTemplate(
    ctx: PluginContext,
    evt: { name: unknown; metadataService: IMetadataService | undefined; protocol?: any },
  ): Promise<unknown | typeof FAILED_READ> {
    const name = String(evt.name ?? '');
    if (!name) return undefined;
    let answered = false;
    let item: unknown;
    if (typeof evt.protocol?.getMetaItem === 'function') {
      try {
        const res: any = await evt.protocol.getMetaItem({ type: 'email_template', name });
        answered = true;
        item = res?.item ?? res?.data ?? (res?.name ? res : undefined);
      } catch (err: any) {
        ctx.logger.warn(
          `EmailServicePlugin: effective read of email template '${name}' failed: ${err?.message ?? err}`,
        );
      }
    }
    if (!answered && typeof evt.metadataService?.get === 'function') {
      try {
        item = await evt.metadataService.get('email_template', name);
        answered = true;
      } catch (err: any) {
        ctx.logger.warn(
          `EmailServicePlugin: effective read of email template '${name}' failed: ${err?.message ?? err}`,
        );
      }
    }
    if (!answered) return FAILED_READ;
    if (!item) return undefined;
    // [#8378] The effective read answers the template document itself; no
    // `{ name, content }` envelope exists to unwrap on this path either.
    return stripReadDecorations(item);
  }

  async dispose(): Promise<void> {
    this.templateBridgeArmed = false;
    try { this.unsubscribeTemplates?.(); } catch { /* best effort */ }
    this.unsubscribeTemplates = undefined;
    try { this.unsubscribeTemplateMutations?.(); } catch { /* best effort */ }
    this.unsubscribeTemplateMutations = undefined;
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
    phase: 'boot' | 'saved' = 'boot',
  ): void {
    if (!this.service) return;

    // ── Delivery mode (#5160) ────────────────────────────────────────
    // Handled before every early `return` below, so a provider that cannot
    // be built does not also strand the delivery mode at its old value.
    // Only an operator-SELECTED value overrides the constructor declaration;
    // the manifest default (`source: 'default'`) is not a decision anyone
    // made, and treating it as one would let a settings page nobody opened
    // silently switch off a mode the deployment declared.
    if ((sources.queue_delivery ?? 'default') !== 'default') {
      this.queueDeliveryFromSettings = values.queue_delivery === true
        || String(values.queue_delivery).toLowerCase() === 'true';
    }
    this.applyQueueDelivery(ctx);
    if (this.queueDeliveryEnabled() && phase === 'saved') {
      // Reported on a SAVE, not at boot: at boot the queue provider may
      // simply not have registered yet, and a verdict recorded then is one
      // this very boot can contradict. After a save the registry is settled
      // and this is the operator's immediate feedback. Inline delivery
      // continues either way — this save must not stop the mail, so what is
      // lost is durability, not delivery, and the line says which.
      const blocker = this.queueDeliveryBlocker(ctx, !!this.service.options.persistence);
      if (blocker) {
        ctx.logger.error(
          `EmailServicePlugin: "durable queue delivery" is ON but ${blocker} — mail is still being SENT, `
          + 'inline, but a failed send is retried only in this process and lost if it dies (no sys_job_queue '
          + 'job, no DLQ). Fix: mount the queue capability with a durable adapter '
          + '(@objectstack/service-queue over an ObjectQL engine), or turn the toggle off so inline delivery '
          + 'is the declared intent.',
        );
      } else {
        ctx.logger.info('EmailServicePlugin: durable queue delivery enabled from mail settings.');
      }
    }

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
