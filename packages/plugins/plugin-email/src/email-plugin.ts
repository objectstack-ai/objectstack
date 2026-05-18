// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type {
  IEmailTransport,
  EmailAddress,
} from '@objectstack/spec/contracts';
import { SysEmail } from '@objectstack/platform-objects/audit';
import { EmailService, LogTransport, type EmailPersistence } from './email-service.js';

/**
 * Plugin configuration.
 */
export interface EmailServicePluginOptions {
  /**
   * Pluggable delivery transport. When omitted, a `LogTransport` is
   * installed which never sends mail — suitable for development. For
   * production, wire a concrete transport (nodemailer, Resend SDK, …).
   */
  transport?: IEmailTransport;
  /** Default `From` address applied when `input.from` is omitted. */
  defaultFrom?: EmailAddress;
  /** Persist each attempt to sys_email. Default true when ObjectQL engine present. */
  persist?: boolean;
  /** Retry attempts on transport throw. Default 0. */
  retries?: number;
}

/**
 * EmailServicePlugin — registers the `email` service.
 *
 * @example
 * ```ts
 * import { EmailServicePlugin } from '@objectstack/plugin-email';
 * import nodemailer from 'nodemailer';
 *
 * const smtp = nodemailer.createTransport({ host: 'smtp.example.com', port: 587 });
 * const transport = { async send(msg) { const r = await smtp.sendMail(msg); return { messageId: r.messageId }; } };
 *
 * kernel.use(new EmailServicePlugin({
 *   transport,
 *   defaultFrom: { name: 'Acme CRM', address: 'no-reply@acme.com' },
 *   retries: 2,
 * }));
 * ```
 */
export class EmailServicePlugin implements Plugin {
  name = 'com.objectstack.service.email';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: EmailServicePluginOptions;
  private service?: EmailService;

  constructor(options: EmailServicePluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    // Register sys_email schema via manifest service.
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service.email',
      name: 'Email Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      defaultDatasource: 'cloud',
      namespace: 'sys',
      objects: [SysEmail],
    });

    const transport = this.options.transport ?? new LogTransport(ctx.logger);
    if (!this.options.transport) {
      ctx.logger.info(
        'EmailServicePlugin: no transport configured — using LogTransport (mail will NOT be sent)',
      );
    }

    // Persistence is wired in `start` once the ObjectQL engine is available;
    // here we register the service synchronously so dependents can resolve it.
    this.service = new EmailService({
      transport,
      defaultFrom: this.options.defaultFrom,
      retries: this.options.retries,
      logger: ctx.logger,
    });
    ctx.registerService('email', this.service);
    ctx.logger.info('EmailServicePlugin: email service registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    if (this.options.persist === false) return;
    ctx.hook('kernel:ready', async () => {
      let engine: IDataEngine | null = null;
      try { engine = ctx.getService<IDataEngine>('objectql'); }
      catch { try { engine = ctx.getService<IDataEngine>('data'); } catch { /* ignore */ } }
      if (!engine || !this.service) return;
      const persistence: EmailPersistence = {
        async insert(row) {
          const created = await (engine as any).insert('sys_email', row, {
            context: { isSystem: true, roles: [], permissions: [] },
          });
          return created?.id ? { id: String(created.id) } : { id: String(row.id) };
        },
        async update(id, patch) {
          await (engine as any).update('sys_email', id, patch, {
            context: { isSystem: true, roles: [], permissions: [] },
          });
        },
      };
      // Swap the service to persistence-enabled by re-constructing with same options.
      const upgraded = new EmailService({
        transport: (this.service as any).options.transport,
        defaultFrom: (this.service as any).options.defaultFrom,
        retries: (this.service as any).options.retries,
        logger: ctx.logger,
        persistence,
      });
      // Replace the registered instance via the same service name.
      ctx.registerService('email', upgraded);
      this.service = upgraded;
      ctx.logger.info('EmailServicePlugin: sys_email persistence enabled');
    });
  }
}
