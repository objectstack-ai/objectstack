// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { II18nService } from '@objectstack/spec/contracts';
import { SysMailAssociation, SysMailbox, SysMailMessage } from './objects/index.js';
import { installMailReadVisibility, type MailGateEngine } from './mail-read-visibility.js';

/** The manifest id this plugin registers its objects under. */
export const MAILBOX_SERVICE_MANIFEST_ID = 'com.objectstack.service.mailbox';

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
 * The ingest engine that writes these rows (the IMAP connector, dedupe,
 * association stamping and re-match) is the next half of the inbound-mail
 * programme and lands in this package.
 */
export class MailboxServicePlugin implements Plugin {
  name = MAILBOX_SERVICE_MANIFEST_ID;
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.engine.objectql'];

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
  }
}
