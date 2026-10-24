// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The file-reference claim path resolves a referenced file within the
 * organization the write acts in.
 *
 * `installFileReferenceHooks` looks every file id a file-class field carries up
 * in `sys_file`, then either claims the file for the written record or copies
 * it into a fresh `sys_file` the record owns (ADR-0104 D3 exclusive ownership).
 * The copy has always been stamped for the acting organization
 * (`systemWriteContext`). The two LOOKUPS now carry the same organization, so
 * the driver's own tenant term (ADR-0131 D8, the wall's verdict) decides which
 * files the write can reach — the rule is the platform's, never restated here.
 *
 * Through a real engine — `ObjectQL` → `SqlDriver` (sqlite in memory) under the
 * `isolated` posture — with the hooks installed exactly as
 * `StorageServicePlugin.start()` installs them, over a real local storage
 * adapter, so a copy really reads and writes bytes.
 *
 * Pinned, by invariant:
 *   - a write in one organization neither claims nor copies a file another
 *     organization holds: the value is kept as written, as an id the platform
 *     does not manage is, and the other organization's row is untouched;
 *   - control: a file of the writing organization is still claimed, and one
 *     another record of that organization owns is still copied, the copy
 *     stamped for that organization;
 *   - a write that names no organization is judged exactly as before.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { installFileReferenceHooks } from './file-reference-lifecycle.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { SystemFile } from './objects/system-file.object.js';

const OBJECT = 'xorg_case';
const SYS = { context: { isSystem: true } };

const quietLogger = () => ({ info() {}, warn() {}, debug() {}, error() {} });

/** The execution context of a signed-in caller acting in `organization`. */
const actingIn = (organization: string) => ({ context: { userId: `u_${organization}`, tenantId: organization } });

interface Harness {
  ql: ObjectQL;
  storage: LocalStorageAdapter;
  rootDir: string;
}

let harness: Harness | undefined;

async function boot(posture: 'isolated' | 'single' = 'isolated'): Promise<Harness> {
  const ql = new ObjectQL({ logger: quietLogger() } as any);
  ql.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any,
    true,
  );
  await ql.init();
  ql.setTenancyPostureProvider(() => posture);
  ql.registry.registerObject(SystemFile as any, 'test-file-reference-organization-scope');
  ql.registry.registerObject(
    { name: OBJECT, fields: { name: { type: 'text' }, attachment: { type: 'file' } } } as any,
    'test-file-reference-organization-scope',
  );
  await ql.syncSchemas();
  const rootDir = await fs.mkdtemp(join(tmpdir(), 'oss-file-ref-org-'));
  const storage = new LocalStorageAdapter({ rootDir });
  installFileReferenceHooks(ql as any, () => storage, quietLogger());
  harness = { ql, storage, rootDir };
  return harness;
}

afterEach(async () => {
  const h = harness;
  harness = undefined;
  if (!h) return;
  await h.ql.destroy().catch(() => {});
  await fs.rm(h.rootDir, { recursive: true, force: true });
});

/** A committed `sys_file` row in `organization`, with its bytes in storage. */
async function seedFile(
  h: Harness,
  organization: string,
  id: string,
  owner?: { recordId: string },
): Promise<void> {
  const key = `user/${id}.txt`;
  await h.storage.upload(key, Buffer.from(`bytes of ${id}`));
  await h.ql.insert(
    'sys_file',
    {
      id,
      key,
      name: `${id}.txt`,
      mime_type: 'text/plain',
      size: 11,
      scope: 'user',
      status: 'committed',
      organization_id: organization,
      ...(owner ? { ref_object: OBJECT, ref_id: owner.recordId, ref_field: 'attachment' } : {}),
    },
    { context: { isSystem: true, tenantId: organization } },
  );
}

/** A record of {@link OBJECT} in `organization`, written directly (no file reference). */
async function seedRecord(h: Harness, organization: string, id: string): Promise<void> {
  await h.ql.insert(OBJECT, { id, name: id }, actingIn(organization));
}

const fileRows = async (h: Harness) =>
  (await h.ql.find('sys_file', { ...SYS })) as Array<Record<string, any>>;
const fileRow = async (h: Harness, id: string) => (await fileRows(h)).find((r) => r.id === id);
const recordRow = async (h: Harness, id: string) =>
  ((await h.ql.find(OBJECT, { ...SYS })) as Array<Record<string, any>>).find((r) => r.id === id);

describe('the file-reference claim path resolves a file within the writing organization', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await boot('isolated');
  });

  it('an insert in one organization does not take ownership of an unowned file another organization holds', async () => {
    await seedFile(h, 'org_b', 'file_b_free');

    await h.ql.insert(OBJECT, { id: 'case_a1', name: 'a1', attachment: 'file_b_free' }, actingIn('org_a'));

    const file = await fileRow(h, 'file_b_free');
    expect(file?.ref_object ?? null).toBeNull();
    expect(file?.ref_id ?? null).toBeNull();
    expect(file?.organization_id).toBe('org_b');
    // The value is kept as written — an id this organization's platform does
    // not manage, exactly as an unknown id is kept.
    expect((await recordRow(h, 'case_a1'))?.attachment).toBe('file_b_free');
  });

  it('an insert in one organization does not copy a file a record of another organization owns', async () => {
    await seedRecord(h, 'org_b', 'case_b1');
    await seedFile(h, 'org_b', 'file_b_owned', { recordId: 'case_b1' });
    const before = await fileRows(h);

    await h.ql.insert(OBJECT, { id: 'case_a2', name: 'a2', attachment: 'file_b_owned' }, actingIn('org_a'));

    const after = await fileRows(h);
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after.filter((r) => r.organization_id === 'org_a')).toEqual([]);
    expect((await recordRow(h, 'case_a2'))?.attachment).toBe('file_b_owned');
    const original = await fileRow(h, 'file_b_owned');
    expect([original?.ref_object, original?.ref_id, original?.ref_field]).toEqual([OBJECT, 'case_b1', 'attachment']);
  });

  it('an update in one organization does not take ownership of an unowned file another organization holds', async () => {
    await seedRecord(h, 'org_a', 'case_a3');
    await seedFile(h, 'org_b', 'file_b_free2');

    await h.ql.update(OBJECT, { id: 'case_a3', attachment: 'file_b_free2' }, actingIn('org_a'));

    const file = await fileRow(h, 'file_b_free2');
    expect(file?.ref_id ?? null).toBeNull();
    expect((await recordRow(h, 'case_a3'))?.attachment).toBe('file_b_free2');
  });

  it('CONTROL — an unowned file of the writing organization is claimed for the record', async () => {
    await seedFile(h, 'org_a', 'file_a_free');

    await h.ql.insert(OBJECT, { id: 'case_a4', name: 'a4', attachment: 'file_a_free' }, actingIn('org_a'));

    const file = await fileRow(h, 'file_a_free');
    expect([file?.ref_object, file?.ref_id, file?.ref_field]).toEqual([OBJECT, 'case_a4', 'attachment']);
    expect((await recordRow(h, 'case_a4'))?.attachment).toBe('file_a_free');
  });

  it('CONTROL — a file another record of the writing organization owns is copied, the copy stamped for it', async () => {
    await seedRecord(h, 'org_a', 'case_a5');
    await seedFile(h, 'org_a', 'file_a_owned', { recordId: 'case_a5' });

    await h.ql.insert(OBJECT, { id: 'case_a6', name: 'a6', attachment: 'file_a_owned' }, actingIn('org_a'));

    const held = (await recordRow(h, 'case_a6'))?.attachment;
    expect(typeof held).toBe('string');
    expect(held).not.toBe('file_a_owned');
    const copy = await fileRow(h, held);
    expect(copy?.organization_id).toBe('org_a');
    expect([copy?.ref_object, copy?.ref_id, copy?.ref_field]).toEqual([OBJECT, 'case_a6', 'attachment']);
    expect((await h.storage.download(copy!.key)).toString()).toBe('bytes of file_a_owned');
  });
});

describe('a write that carries no organization is judged as before', () => {
  it('the single posture: one tenant, so the lookup is not narrowed', async () => {
    const h = await boot('single');
    await seedFile(h, 'org_b', 'file_single');

    await h.ql.insert(OBJECT, { id: 'case_s1', name: 's1', attachment: 'file_single' }, actingIn('org_a'));

    const file = await fileRow(h, 'file_single');
    expect([file?.ref_object, file?.ref_id]).toEqual([OBJECT, 'case_s1']);
  });
});
