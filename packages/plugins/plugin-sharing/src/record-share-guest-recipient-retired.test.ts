// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0138 D8] `sys_record_share`'s `guest` recipient is retired at the ROW
 * door — on a REAL engine over a REAL driver, with the real `SysRecordShare`.
 *
 * The grant door refuses `'guest'` with its prescription
 * (`sharing-service.test.ts`, "[ADR-0138 D8]"). What it cannot prove is the
 * door every other producer of a row crosses: a system-context engine write —
 * a seed, a plugin, a migration — which `grant()` never sees. Before the
 * retirement the `recipient_type` select offered `guest`, so such a write
 * PERSISTED a row that no gate reads (the gates match `recipient_type: 'user'`
 * only): a share that looked granted and enforced nothing (ADR-0078). Now the
 * select's option arm refuses it, naming the values a row may carry.
 *
 * The control row (`user`) is the same write with one value changed, so a red
 * on the guest case cannot come from the harness.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { SysRecordShare } from './objects/sys-record-share.object.js';

// The write names its organization: a fresh tenant column is NOT NULL (ADR-0131
// D1), and this lean engine registers no organization object to derive one from.
const SYS = { context: { isSystem: true, tenantId: 'org_os_qa' } } as never;

/** The four values a row may carry, in the select's declared order. */
const ROW_RECIPIENTS = ['user', 'group', 'position', 'unit_and_subordinates'];

const row = (id: string, recipientType: string) => ({
  id,
  object_name: 'account',
  record_id: 'acc_1',
  recipient_type: recipientType,
  recipient_id: 'usr_target',
  access_level: 'read',
  source: 'manual',
});

let engine: ObjectQL;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.record-share-guest-recipient-retired',
    name: 'Record share: the retired guest recipient',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysRecordShare],
  } as never);
  await engine.syncSchemas();
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

describe('[ADR-0138 D8] the row door refuses a guest recipient_type', () => {
  it('the declared select offers exactly the four row recipients, guest not among them', () => {
    const options = (SysRecordShare.fields.recipient_type as { options?: unknown[] }).options ?? [];
    const values = options.map((o) => (typeof o === 'object' && o !== null ? (o as { value: unknown }).value : o));
    expect(values).toEqual(ROW_RECIPIENTS);
  });

  it('a system-context insert carrying recipient_type guest is refused on that field, and nothing lands', async () => {
    const refusal = await engine.insert('sys_record_share', [row('shr_guest', 'guest')], SYS)
      .then(() => null, (e: unknown) => e as { code?: unknown; fields?: unknown[] });
    expect(refusal, 'the guest row was admitted').not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_FAILED');
    const fieldErrors = (refusal!.fields ?? []) as Array<{ field?: string; code?: string; options?: string[] }>;
    expect(fieldErrors).toHaveLength(1);
    expect(fieldErrors[0]).toMatchObject({ field: 'recipient_type', code: 'invalid_option' });
    expect(fieldErrors[0]!.options).toEqual(ROW_RECIPIENTS);
    const stored = await engine.findOne('sys_record_share', { where: { id: 'shr_guest' }, context: { isSystem: true } } as never);
    expect(stored ?? null).toBeNull();
  });

  it('control: the same insert with recipient_type user lands', async () => {
    await engine.insert('sys_record_share', [row('shr_user', 'user')], SYS);
    const stored = await engine.findOne('sys_record_share', { where: { id: 'shr_user' }, context: { isSystem: true } } as never) as { recipient_type?: string } | null;
    expect(stored?.recipient_type).toBe('user');
  });
});
