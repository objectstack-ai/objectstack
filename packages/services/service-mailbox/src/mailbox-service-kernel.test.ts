// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How the ingest seam is reached: through the kernel, as the `mailbox`
 * service the plugin registers, against the engine `ObjectQLPlugin` provides.
 * A real `ObjectKernel` boot — the seam is not handed an engine here, it
 * resolves the kernel's own on the call — over `@objectstack/driver-sql` +
 * better-sqlite3 `:memory:`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { DataEngineInsertOptions, EngineQueryOptions } from '@objectstack/spec/data';
import { MAILBOX_SERVICE, MailIngestService, MailboxServicePlugin } from './index.js';
import { plainMessage } from './ingest/messages.fixture.js';

const SYSTEM = { isSystem: true } as const;
const ORG = 'org_kernel_mail';

const Contact = ObjectSchema.create({
  name: 'kerneltest_contact',
  label: 'Contact',
  fields: {
    name: Field.text({ label: 'Name' }),
    email: Field.email({ label: 'Email', mailAssociation: true }),
  },
});

describe('the `mailbox` kernel service on a real kernel boot', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new MailboxServicePlugin());
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(Contact as any, 'mailbox-kernel-test', 'mailbox-kernel-test');
    await ql.syncSchemas();
  }, 60_000);

  afterAll(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* best-effort teardown */
    }
  });

  it('is the ingest seam, and it stores and associates a message through the kernel’s own engine', async () => {
    const service = kernel.getService<MailIngestService>(MAILBOX_SERVICE);
    expect(service).toBeInstanceOf(MailIngestService);

    const insert = async (object: string, data: Record<string, unknown>) =>
      String(((await ql.insert(object, data, { context: SYSTEM } satisfies DataEngineInsertOptions)) as { id: unknown }).id);
    const mailbox = await insert('sys_mailbox', { organization_id: ORG, name: 'Inbox', address: 'inbox@corp.test' });
    const contact = await insert('kerneltest_contact', { organization_id: ORG, name: 'C', email: 'customer@acme.test' });

    const result = await service.ingest({ mailboxId: mailbox, raw: plainMessage({ 'Message-ID': '<kernel-1@acme.test>' }) }, SYSTEM);

    expect(result).toMatchObject({
      outcome: 'stored',
      associationState: 'associated',
      associations: [{ object: 'kerneltest_contact', recordId: contact, matchedField: 'email', matchedAddress: 'customer@acme.test' }],
    });
    const rows = (await ql.find('sys_mail_message', { where: { mailbox_id: mailbox }, context: SYSTEM } satisfies EngineQueryOptions)) as unknown[];
    expect(rows).toHaveLength(1);
  });
});
