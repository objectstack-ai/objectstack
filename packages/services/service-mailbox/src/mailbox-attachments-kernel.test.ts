// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A message's attachments, stored through the REAL attach verb: a real
 * `ObjectKernel` boot composing `ObjectQLPlugin`, `StorageServicePlugin` (its
 * local adapter in a temp directory, which registers `file-attachments` and
 * arms it at `kernel:bootstrapped`) and `MailboxServicePlugin`, over
 * `@objectstack/driver-sql` + better-sqlite3 `:memory:`. The ingest seam is
 * reached as the kernel service `mailbox`; it finds the verb on its own, as it
 * does in a deployment.
 *
 * What is pinned, each beside its control:
 *
 *  - one forwarded message with one file is ONE `sys_mail_message` row and TWO
 *    attachments — the file and the forwarded message as an `.eml` — each a
 *    committed `sys_file` behind a `sys_attachment` whose parent is that row,
 *    both in the mailbox's organization, the bytes as the message carried them
 *    (control: a message without parts has no attachment);
 *  - a re-delivered copy adds no attachment (control: the same parts under
 *    another Message-ID are another message's);
 *  - a mailbox in another organization stores its message's files in that
 *    organization (control: the first mailbox's, in its own);
 *  - a part over the deployment's upload size limit is refused by the verb
 *    (`PAYLOAD_TOO_LARGE`) and leaves nothing behind, while the message and its
 *    other parts are stored, and the refusal is said at `error`, by name;
 *  - without the storage capability the message is stored without its parts,
 *    and that is said once.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from '@objectstack/service-storage';
import type { DataEngineInsertOptions, EngineQueryOptions } from '@objectstack/spec/data';
import type { IStorageService } from '@objectstack/spec/contracts';
import { MAILBOX_SERVICE, type MailIngestService, MailboxServicePlugin } from './index.js';
import { binaryBytes, messageWithParts, plainMessage, rfc822 } from './ingest/messages.fixture.js';

const SYSTEM = { isSystem: true } as const;
const ORG_A = 'org_attach_a';
const ORG_B = 'org_attach_b';
/** `max_upload_mb` as saved: 0.001 MB ⇒ floor(0.001 × 1 MiB) = 1048 bytes. */
const MAX_UPLOAD_MB = 0.001;
const MAX_UPLOAD_BYTES = 1048;

type Row = Record<string, any>;

/** A settings service carrying only the saved upload size limit, as `StorageServicePlugin` reads it. */
class UploadLimitSettingsPlugin implements Plugin {
  name = 'test.upload-limit-settings';
  version = '1.0.0';
  async init(ctx: PluginContext): Promise<void> {
    ctx.registerService('settings', {
      createClient: () => ({}),
      getNamespace: async () => ({ values: { max_upload_mb: { value: MAX_UPLOAD_MB, source: 'global' } } }),
      subscribe: () => undefined,
      registerAction: () => undefined,
    });
  }
}

/** Hands the test the kernel's logger — the one every plugin context carries — so what the seam says is read. */
class LoggerProbePlugin implements Plugin {
  name = 'test.logger-probe';
  version = '1.0.0';
  logger?: PluginContext['logger'];
  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger;
  }
}

async function bootKernel(options: { storage: boolean }) {
  const probe = new LoggerProbePlugin();
  const kernel = new ObjectKernel({ logger: { level: 'fatal' } });
  await kernel.use(probe);
  await kernel.use(new ObjectQLPlugin());
  let rootDir: string | undefined;
  if (options.storage) {
    rootDir = await fs.mkdtemp(join(tmpdir(), 'oss-23307-'));
    await kernel.use(new UploadLimitSettingsPlugin());
    await kernel.use(new StorageServicePlugin({ adapter: 'local', local: { rootDir }, registerRoutes: false }));
  }
  await kernel.use(new MailboxServicePlugin());
  await kernel.bootstrap();
  // What the seam says from here on: it speaks only when it ingests.
  const error = vi.spyOn(probe.logger!, 'error');
  const warn = vi.spyOn(probe.logger!, 'warn');
  const ql = kernel.getService<ObjectQL>('objectql');
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await driver.connect();
  ql.registerDriver(driver, true);
  await ql.syncSchemas();
  const said = (spy: typeof error) => spy.mock.calls.map((args) => String(args[0]));
  return { kernel, ql, rootDir, errors: () => said(error), warnings: () => said(warn) };
}

const ORIGINAL = rfc822(
  [
    ['From', 'Customer <customer@acme.test>'],
    ['To', 'rep@corp.test'],
    ['Subject', 'What does it cost?'],
    ['Message-ID', '<kernel-attach-orig@acme.test>'],
  ],
  'What does it cost?',
);
/** A file within the deployment's upload size limit. */
const QUOTE = binaryBytes(100);

/** The card's message: one forwarded message and one file. */
const forwardWithFile = (messageId: string, extra: Parameters<typeof messageWithParts>[0]['parts'] = []) =>
  messageWithParts({
    messageId,
    parts: [
      { contentType: 'application/pdf; name="quote.pdf"', disposition: 'attachment; filename="quote.pdf"', bytes: QUOTE },
      ...extra,
      { contentType: 'message/rfc822', disposition: 'attachment; filename="question.eml"', message: ORIGINAL },
    ],
  });

describe('a message’s attachments, through the real file-attachments verb on a booted kernel', () => {
  let booted: Awaited<ReturnType<typeof bootKernel>>;
  let mailboxes: MailIngestService;
  let storage: IStorageService;

  const find = (object: string, where: Row): Promise<Row[]> =>
    booted.ql.find(object, { where, limit: 500, context: SYSTEM } satisfies EngineQueryOptions) as Promise<Row[]>;
  const insert = async (object: string, data: Row): Promise<string> =>
    String(((await booted.ql.insert(object, data, { context: SYSTEM } satisfies DataEngineInsertOptions)) as Row).id);
  const newMailbox = (organization: string) =>
    insert('sys_mailbox', { organization_id: organization, name: `Inbox ${organization}`, address: 'inbox@corp.test' });
  /** A row's attachments, by file name (the store answers in no declared order; message order is pinned on the calls, in the unit suite). */
  const attachmentsOf = async (messageId: string) =>
    (await find('sys_attachment', { parent_object: 'sys_mail_message', parent_id: messageId })).sort((a, b) =>
      String(a.file_name).localeCompare(String(b.file_name)),
    );
  const bytesOf = async (fileId: string) => {
    const [file] = await find('sys_file', { id: fileId });
    return new Uint8Array(await storage.download(String(file!.key)));
  };

  beforeAll(async () => {
    booted = await bootKernel({ storage: true });
    mailboxes = booted.kernel.getService<MailIngestService>(MAILBOX_SERVICE);
    storage = booted.kernel.getService<IStorageService>('storage');
  }, 60_000);

  afterAll(async () => {
    try {
      await booted?.kernel.shutdown();
    } catch {
      /* best-effort teardown */
    }
    if (booted?.rootDir) await fs.rm(booted.rootDir, { recursive: true, force: true });
  });

  it('arms: the mail message opts into attachments, and the verb is registered', () => {
    expect(booted.ql.registry.getObject('sys_mail_message')?.enable?.files).toBe(true);
    expect(booted.kernel.getService('file-attachments')).toBeTruthy();
  });

  it('one forwarded message with one file: one row, two attachments on it, both in the mailbox’s organization', async () => {
    const mailbox = await newMailbox(ORG_A);
    const result = await mailboxes.ingest({ mailboxId: mailbox, raw: forwardWithFile('<kernel-attach-1@corp.test>') }, SYSTEM);

    expect(result.outcome).toBe('stored');
    const rows = await find('sys_mail_message', { mailbox_id: mailbox });
    expect(rows).toHaveLength(1);
    const messageId = String(rows[0]!.id);
    expect((result as { messageId: string }).messageId).toBe(messageId);

    const attachments = await attachmentsOf(messageId);
    expect(attachments.map((a) => [a.file_name, a.mime_type, a.size, a.organization_id])).toEqual([
      ['question.eml', 'message/rfc822', Buffer.byteLength(ORIGINAL), ORG_A],
      ['quote.pdf', 'application/pdf', QUOTE.byteLength, ORG_A],
    ]);
    for (const attachment of attachments) {
      const [file] = await find('sys_file', { id: attachment.file_id });
      expect(file).toMatchObject({ status: 'committed', organization_id: ORG_A, scope: 'attachments' });
    }
    expect(Buffer.from(await bytesOf(String(attachments[0]!.file_id))).toString('utf8')).toBe(ORIGINAL);
    expect(await bytesOf(String(attachments[1]!.file_id))).toEqual(QUOTE);
    expect(booted.errors().filter((m) => m.includes('[mailbox]'))).toEqual([]);
  });

  it('control: a message without parts has no attachment', async () => {
    const mailbox = await newMailbox(ORG_A);
    const result = await mailboxes.ingest(
      { mailboxId: mailbox, raw: plainMessage({ 'Message-ID': '<kernel-attach-none@acme.test>' }) },
      SYSTEM,
    );
    expect(await attachmentsOf((result as { messageId: string }).messageId)).toEqual([]);
  });

  it('a re-delivered copy adds no attachment; control: the same parts under another Message-ID are another message’s', async () => {
    const mailbox = await newMailbox(ORG_A);
    const raw = forwardWithFile('<kernel-attach-again@corp.test>');
    const first = await mailboxes.ingest({ mailboxId: mailbox, raw }, SYSTEM);
    const filesBefore = (await find('sys_file', {})).length;

    expect(await mailboxes.ingest({ mailboxId: mailbox, raw }, SYSTEM)).toEqual({
      outcome: 'duplicate',
      messageId: (first as { messageId: string }).messageId,
    });
    expect(await attachmentsOf((first as { messageId: string }).messageId)).toHaveLength(2);
    expect(await find('sys_file', {})).toHaveLength(filesBefore);

    const other = await mailboxes.ingest({ mailboxId: mailbox, raw: forwardWithFile('<kernel-attach-other@corp.test>') }, SYSTEM);
    expect(other.outcome).toBe('stored');
    expect(await attachmentsOf((other as { messageId: string }).messageId)).toHaveLength(2);
    expect(await find('sys_file', {})).toHaveLength(filesBefore + 2);
  });

  it('a mailbox in another organization stores its message’s files in that organization', async () => {
    const mailbox = await newMailbox(ORG_B);
    const result = await mailboxes.ingest({ mailboxId: mailbox, raw: forwardWithFile('<kernel-attach-org-b@corp.test>') }, SYSTEM);
    const attachments = await attachmentsOf((result as { messageId: string }).messageId);
    expect(attachments.map((a) => a.organization_id)).toEqual([ORG_B, ORG_B]);
    for (const attachment of attachments) {
      const [file] = await find('sys_file', { id: attachment.file_id });
      expect(file!.organization_id).toBe(ORG_B);
    }
  });

  it('a part over the upload size limit is refused and leaves nothing; the message and its other parts are stored, and it is said', async () => {
    const mailbox = await newMailbox(ORG_A);
    const big = binaryBytes(MAX_UPLOAD_BYTES);
    expect(big.byteLength).toBeGreaterThan(MAX_UPLOAD_BYTES);
    const filesBefore = (await find('sys_file', {})).length;
    const raw = forwardWithFile('<kernel-attach-big@corp.test>', [
      { contentType: 'application/octet-stream', disposition: 'attachment; filename="big.bin"', bytes: big },
    ]);

    const result = await mailboxes.ingest({ mailboxId: mailbox, raw }, SYSTEM);

    expect(result.outcome).toBe('stored');
    expect(await find('sys_mail_message', { mailbox_id: mailbox })).toHaveLength(1);
    const attachments = await attachmentsOf((result as { messageId: string }).messageId);
    expect(attachments.map((a) => a.file_name)).toEqual(['question.eml', 'quote.pdf']);
    // The refused part left no sys_file at all, committed or pending.
    expect(await find('sys_file', {})).toHaveLength(filesBefore + 2);
    expect(await find('sys_file', { name: 'big.bin' })).toEqual([]);
    const said = booted.errors().filter((m) => m.includes("'big.bin'"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('PAYLOAD_TOO_LARGE (413)');
    expect(said[0]).toContain('is NOT stored');
  });
});

describe('a message’s attachments on a kernel without the storage capability', () => {
  let booted: Awaited<ReturnType<typeof bootKernel>>;

  beforeAll(async () => {
    booted = await bootKernel({ storage: false });
  }, 60_000);

  afterAll(async () => {
    try {
      await booted?.kernel.shutdown();
    } catch {
      /* best-effort teardown */
    }
  });

  it('stores the message without its parts, and says so once', async () => {
    expect(() => booted.kernel.getService('file-attachments')).toThrow();
    const mailboxes = booted.kernel.getService<MailIngestService>(MAILBOX_SERVICE);
    const mailbox = String(
      ((await booted.ql.insert(
        'sys_mailbox',
        { organization_id: ORG_A, name: 'Inbox', address: 'inbox@corp.test' },
        { context: SYSTEM } satisfies DataEngineInsertOptions,
      )) as Row).id,
    );
    for (const id of ['<kernel-nostore-1@corp.test>', '<kernel-nostore-2@corp.test>']) {
      expect((await mailboxes.ingest({ mailboxId: mailbox, raw: forwardWithFile(id) }, SYSTEM)).outcome).toBe('stored');
    }
    const rows = (await booted.ql.find('sys_mail_message', {
      where: { mailbox_id: mailbox },
      context: SYSTEM,
    } satisfies EngineQueryOptions)) as Row[];
    expect(rows).toHaveLength(2);
    expect(booted.warnings().filter((m) => m.includes("'file-attachments' service is composed"))).toHaveLength(1);
    expect(booted.errors().filter((m) => m.includes('[mailbox]'))).toEqual([]);
  });
});
