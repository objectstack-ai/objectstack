// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How the IMAP sync is reached in a composed runtime: a real `ObjectKernel`
 * boot with `ObjectQLPlugin`, the mailbox plugin composed with an IMAP account
 * source, and a job service — the sync is scheduled at `kernel:ready` as the
 * interval job `mailbox:imap-sync`, its run stores a message from the IMAP
 * server double through the kernel's own engine, and shutdown cancels it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { DataEngineInsertOptions, EngineQueryOptions } from '@objectstack/spec/data';
import type { IJobService, JobHandler, JobSchedule } from '@objectstack/spec/contracts';
import { staticCredentials } from '@objectstack/connector-imap';
import { ImapServerDouble } from '@objectstack/connector-imap/testing';
import { MAILBOX_SYNC_JOB, MailboxServicePlugin } from './index.js';
import { plainMessage } from './ingest/messages.fixture.js';

const SYSTEM = { isSystem: true } as const;
const ORG = 'org_kernel_sync';

const Contact = ObjectSchema.create({
  name: 'kernelsync_contact',
  label: 'Contact',
  fields: {
    name: Field.text({ label: 'Name' }),
    email: Field.email({ label: 'Email', mailAssociation: true }),
  },
});

/** A job service that records what is scheduled and cancelled, and runs a job only when told. */
class RecordingJobs implements IJobService {
  readonly scheduled = new Map<string, { schedule: JobSchedule; handler: JobHandler }>();
  readonly cancelled: string[] = [];
  async schedule(name: string, schedule: JobSchedule, handler: JobHandler): Promise<void> {
    this.scheduled.set(name, { schedule, handler });
  }
  async cancel(name: string): Promise<void> {
    this.cancelled.push(name);
    this.scheduled.delete(name);
  }
  async trigger(name: string): Promise<void> {
    await this.scheduled.get(name)?.handler({ jobId: name });
  }
}

class RecordingJobsPlugin implements Plugin {
  name = 'test.recording-jobs';
  version = '1.0.0';
  constructor(private readonly jobs: RecordingJobs) {}
  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('job', this.jobs);
  }
}

describe('the IMAP sync in a booted kernel', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let imap: ImapServerDouble;
  const jobs = new RecordingJobs();
  let fedMailbox = '';

  beforeAll(async () => {
    imap = new ImapServerDouble();
    const endpoint = await imap.listen();
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new RecordingJobsPlugin(jobs));
    await kernel.use(
      new MailboxServicePlugin({
        imap: {
          accountFor: (mailbox) =>
            mailbox.id === fedMailbox
              ? {
                  account: { id: mailbox.id, username: 'user', imap: { ...endpoint, security: 'none' } },
                  credentials: staticCredentials({ type: 'password', password: 'secret' }),
                }
              : null,
          pollIntervalMs: 30_000,
        },
      }),
    );
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(Contact as any, 'mailbox-sync-kernel-test', 'mailbox-sync-kernel-test');
    await ql.syncSchemas();
  }, 60_000);

  afterAll(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* best-effort teardown */
    }
    await imap?.close();
  });

  it('is scheduled at kernel:ready as the interval job, at the composed poll interval', () => {
    expect(jobs.scheduled.get(MAILBOX_SYNC_JOB)?.schedule).toEqual({ type: 'interval', intervalMs: 30_000 });
  });

  it('stores and associates a message from the IMAP folder when the job runs', async () => {
    const insert = async (object: string, data: Record<string, unknown>) =>
      String(((await ql.insert(object, data, { context: SYSTEM } satisfies DataEngineInsertOptions)) as { id: unknown }).id);
    fedMailbox = await insert('sys_mailbox', { organization_id: ORG, name: 'Shared', address: 'inbox@corp.test' });
    const contact = await insert('kernelsync_contact', { organization_id: ORG, name: 'C', email: 'customer@acme.test' });
    imap.append('INBOX', plainMessage({ 'Message-ID': '<kernel-sync-1@acme.test>' }));

    const outcome = await jobs.scheduled.get(MAILBOX_SYNC_JOB)!.handler({ jobId: MAILBOX_SYNC_JOB });

    expect(outcome).toEqual({ outcome: 'completed' });
    const rows = (await ql.find('sys_mail_message', { where: { mailbox_id: fedMailbox }, context: SYSTEM } satisfies EngineQueryOptions)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    const links = (await ql.find('sys_mail_association', { where: { mail_message_id: rows[0]!.id }, context: SYSTEM } satisfies EngineQueryOptions)) as Array<
      Record<string, unknown>
    >;
    expect(links.map((l) => l.record_id)).toEqual([contact]);
  });

  it('reports a run in which a mailbox could not be synced as degraded, never as completed', async () => {
    await imap.close();
    const outcome = await jobs.scheduled.get(MAILBOX_SYNC_JOB)!.handler({ jobId: MAILBOX_SYNC_JOB });
    expect(outcome).toMatchObject({ outcome: 'degraded', reason: '1 of 1 mailbox(es) not synced' });
  });

  it('cancels the job when the kernel shuts down', async () => {
    await kernel.shutdown();
    expect(jobs.cancelled).toContain(MAILBOX_SYNC_JOB);
  });
});
