// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  FILE_ATTACHMENT_SERVICE,
  type IFileAttachmentService,
  type II18nService,
  type IJobService,
  type JobRunOutcome,
} from '@objectstack/spec/contracts';
import { SysMailAssociation, SysMailbox, SysMailMessage } from './objects/index.js';
import { installMailReadVisibility, type MailGateEngine } from './mail-read-visibility.js';
import { MAILBOX_SERVICE, MailIngestService, type MailIngestEngine } from './ingest/index.js';
import { MailboxSyncService, type MailboxAccountResolver, type MailSyncEngine } from './sync/index.js';

/** The manifest id this plugin registers its objects under. */
export const MAILBOX_SERVICE_MANIFEST_ID = 'com.objectstack.service.mailbox';

/** The job the IMAP sync runs as, on the composed job service. */
export const MAILBOX_SYNC_JOB = 'mailbox:imap-sync';
/** How often every mailbox is polled, by default (ms). */
export const DEFAULT_MAILBOX_POLL_INTERVAL_MS = 60_000;

/** The IMAP sync of the plugin: off unless the host composes it. */
export interface MailboxImapSyncOptions {
  /**
   * Which IMAP account feeds a mailbox, and with what credential — asked per
   * mailbox per run. Answer `null` for a mailbox this host does not sync.
   */
  accountFor: MailboxAccountResolver;
  /** How often every mailbox is polled (ms). Default {@link DEFAULT_MAILBOX_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number;
  /** Messages fetched per IMAP command. */
  batchSize?: number;
  /** Messages handed to ingest per mailbox per run. */
  maxMessagesPerRun?: number;
  /** Larger messages are skipped, and logged at `error`. */
  maxMessageBytes?: number;
  /** Listed bytes fetched per IMAP command. */
  maxBatchBytes?: number;
}

export interface MailboxServicePluginOptions {
  /** Poll the mailboxes' IMAP folders into the ingest seam. Absent: no mail source is connected. */
  imap?: MailboxImapSyncOptions;
}

/**
 * MailboxServicePlugin — the inbound-mail capability (`requires: ['mailbox']`).
 *
 * Owns the inbound-mail objects (ADR-0029 D1/D2): `sys_mailbox` (a mailbox's
 * identity: address and owner), `sys_mail_message` (the RFC 5322 mirror of one
 * inbound message) and `sys_mail_association` (a message's links to the app's
 * records). They are registered only where an app requires the capability, so
 * a deployment without mailboxes carries none of them.
 *
 * Installs the two read gates (`mail-read-visibility.ts`): a message is served
 * to a caller who can read a record it is associated with, to its mailbox's
 * owner, and to holders of `manage_mailboxes` — so the unassociated pool is
 * restricted by default, never organization-wide.
 *
 * Registers the ingest seam as the kernel service `mailbox`
 * ({@link MAILBOX_SERVICE}, a {@link MailIngestService}): `ingest` turns one
 * raw RFC 822 message into one `sys_mail_message` row, deduplicated per
 * mailbox, with automatic mail (auto-replies, bounces) suppressed, and stamps
 * its associations from the email fields an app flags with `mailAssociation`;
 * `rematch` replays a mailbox's stored participant sets against the records
 * that exist now and adds the missing links. A stored message's attachments,
 * and each message it forwards as an attachment (as an `.eml` file), are
 * stored as files of its `sys_mail_message` row through the kernel service
 * `file-attachments` ({@link FILE_ATTACHMENT_SERVICE}), which the storage
 * capability registers; the seam resolves it per message, so plugin order does
 * not matter, and where none is composed it stores the message without them
 * and says so once.
 *
 * With `imap` composed, it also feeds the seam: the mailbox sync
 * ({@link MailboxSyncService}) runs as the interval job
 * {@link MAILBOX_SYNC_JOB} on the composed job service, reading each
 * mailbox's IMAP folder above its stored cursor through
 * `@objectstack/connector-imap`. Without `imap` — the capability boot
 * (`requires: ['mailbox']`) constructs the plugin with no options — no mail
 * source is connected, and the boot says so once.
 */
export class MailboxServicePlugin implements Plugin {
  name = MAILBOX_SERVICE_MANIFEST_ID;
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.engine.objectql'];

  private sync?: MailboxSyncService;
  private jobs?: IJobService;

  constructor(private readonly options: MailboxServicePluginOptions = {}) {}

  /** The IMAP sync, when composed — for a host that runs it on its own schedule. */
  get syncService(): MailboxSyncService | undefined {
    return this.sync;
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: MAILBOX_SERVICE_MANIFEST_ID,
      name: 'Mailbox Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      namespace: 'sys',
      objects: [SysMailbox, SysMailMessage, SysMailAssociation],
    });

    // The engine is resolved on each call, not here: the seam is reachable
    // as soon as it is registered, and reads the engine only when used.
    const ingest = new MailIngestService({
      engine: () => ctx.getService<MailIngestEngine>('objectql'),
      logger: ctx.logger,
      attachments: () => {
        try {
          return ctx.getService<IFileAttachmentService>(FILE_ATTACHMENT_SERVICE);
        } catch {
          // Not composed: the storage capability is not mounted in this kernel.
          return undefined;
        }
      },
    });
    ctx.registerService(MAILBOX_SERVICE, ingest);

    const imap = this.options.imap;
    if (imap) {
      if (typeof imap.accountFor !== 'function') {
        throw new TypeError(
          'MailboxServicePlugin: `imap.accountFor` must be a function answering the IMAP account of a mailbox (or null).',
        );
      }
      this.sync = new MailboxSyncService({
        engine: () => ctx.getService<MailSyncEngine>('objectql'),
        ingest,
        accountFor: imap.accountFor,
        logger: ctx.logger,
        batchSize: imap.batchSize,
        maxMessagesPerRun: imap.maxMessagesPerRun,
        maxMessageBytes: imap.maxMessageBytes,
        maxBatchBytes: imap.maxBatchBytes,
      });
    }

    // ADR-0029 D8 — contribute the objects' translations on kernel:ready.
    ctx.hook('kernel:ready', async () => {
      try {
        const i18n = ctx.getService<II18nService>('i18n');
        if (i18n && typeof i18n.loadTranslations === 'function') {
          const { MailboxTranslations } = await import('./translations/index.js');
          for (const [locale, data] of Object.entries(MailboxTranslations)) {
            i18n.loadTranslations(locale, data as Record<string, unknown>);
          }
        }
      } catch { /* i18n optional */ }
    });
  }

  async start(ctx: PluginContext): Promise<void> {
    // The engine is resolvable once the kernel is ready; the gates are
    // installed before any request is served.
    ctx.hook('kernel:ready', async () => {
      let engine: MailGateEngine | undefined;
      try {
        engine = ctx.getService<MailGateEngine>('objectql');
      } catch {
        engine = undefined;
      }
      if (!engine || !installMailReadVisibility(engine, ctx.logger)) {
        // Not a quiet degradation: without the gates every caller with object
        // read on sys_mail_message would be served the unassociated pool.
        ctx.logger.error(
          'MailboxServicePlugin: the ObjectQL engine or its middleware seam is not available — the sys_mail_message ' +
            'and sys_mail_association read gates are NOT installed, so the unassociated pool is not restricted. ' +
            'Compose the mailbox capability with the ObjectQL engine (com.objectstack.engine.objectql).',
        );
        return;
      }
      ctx.logger.info('MailboxServicePlugin: sys_mail_message and sys_mail_association read gates installed');
    });

    // The job service may start after this plugin: it is resolved once every
    // plugin has started, when an absent one is absent for good.
    ctx.hook('kernel:ready', async () => {
      await this.scheduleSync(ctx);
    });
  }

  /**
   * The kernel's teardown hook: cancel the sync job and close any IMAP
   * session a run still holds, so nothing outlives the kernel.
   */
  async destroy(): Promise<void> {
    const jobs = this.jobs;
    this.jobs = undefined;
    if (jobs) {
      try {
        await jobs.cancel(MAILBOX_SYNC_JOB);
      } catch {
        /* the job service is going down too */
      }
    }
    this.sync?.close();
  }

  private async scheduleSync(ctx: PluginContext): Promise<void> {
    const sync = this.sync;
    if (!sync) {
      ctx.logger.info(
        'MailboxServicePlugin: no IMAP account source is composed (`imap.accountFor`), so no mailbox is synced; ' +
          'mail arrives only through the `mailbox` service\'s ingest seam.',
      );
      return;
    }
    let jobs: IJobService | undefined;
    try {
      jobs = ctx.getService<IJobService>('job');
    } catch {
      jobs = undefined;
    }
    if (!jobs || typeof jobs.schedule !== 'function') {
      ctx.logger.warn(
        'MailboxServicePlugin: the IMAP sync is composed but no job service is, so no mailbox is polled. ' +
          "Compose the job capability (requires: ['job']), or run MailboxServicePlugin.syncService.syncAll() on your own schedule.",
      );
      return;
    }
    const intervalMs = this.options.imap?.pollIntervalMs ?? DEFAULT_MAILBOX_POLL_INTERVAL_MS;
    await jobs.schedule(MAILBOX_SYNC_JOB, { type: 'interval', intervalMs }, async (): Promise<JobRunOutcome> => {
      const { results, failures } = await sync.syncAll({ isSystem: true });
      for (const failure of failures) {
        ctx.logger.warn(`MailboxServicePlugin: mailbox '${failure.mailboxId}' was not synced: ${failure.error}`);
      }
      if (failures.length > 0) {
        return { outcome: 'degraded', reason: `${failures.length} of ${failures.length + results.length} mailbox(es) not synced` };
      }
      return { outcome: 'completed' };
    });
    this.jobs = jobs;
    ctx.logger.info(`MailboxServicePlugin: IMAP sync scheduled every ${intervalMs} ms (job '${MAILBOX_SYNC_JOB}')`);
  }
}
