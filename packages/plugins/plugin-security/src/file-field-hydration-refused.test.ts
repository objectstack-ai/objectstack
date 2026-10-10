// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A file field whose `sys_file` read the security layer refused does not read
 * as "no file" — with the REAL security layer (`SecurityPlugin` on a real
 * `ObjectQL` over a real `SqlDriver`).
 *
 * The reader's permission set grants read on the record's object and not on
 * `sys_file` — the platform default since `member_default` names no wildcard,
 * so every member whose application does not grant `sys_file` explicitly is
 * this reader. The engine expands a stored file id by reading `sys_file` AS
 * THE CALLER; measured here, the object-level CRUD gate refuses that sub-read
 * with a THROW (`PERMISSION_DENIED`, 403), never a short result. The field used
 * to come back as the bare id — the value an id with no committed file row
 * reads as — so a refused file and an absent one were one answer. It now
 * comes back as `{ id, metadataRefused: true }`.
 *
 * Controls: a record with no file still reads empty, and a reader granted
 * `sys_file` read still gets the hydrated file. The seam's other branches (a
 * missing table, an outage) are pinned in objectql's
 * `engine-file-hydrate-refused.test.ts` and `engine-file-hydrate-outage.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from './security-plugin';

const DOC = 'sec_file_refusal_doc';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const FILE_ID = 'f_7cQx2Lm90a';

const RECORD_READER_SET = PermissionSetSchema.parse({
  name: 'file_refusal_record_reader',
  label: 'Record reader',
  objects: { [DOC]: { allowRead: true } },
});
const FILE_READER_SET = PermissionSetSchema.parse({
  name: 'file_refusal_file_reader',
  label: 'Record and file reader',
  objects: { [DOC]: { allowRead: true }, sys_file: { allowRead: true } },
});

const RECORD_READER_CTX = { userId: 'usr_record_reader', positions: [], permissions: [RECORD_READER_SET.name], posture: 'MEMBER' };
const FILE_READER_CTX = { userId: 'usr_file_reader', positions: [], permissions: [FILE_READER_SET.name], posture: 'MEMBER' };

const envelopeOf = (e: any) => ({ code: e?.code, status: e?.statusCode ?? e?.status });

describe('a file field the security layer refused reads as refused, not as "no file" — the real security layer', () => {
  let engine: ObjectQL;
  let warn: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.file-field-hydration-refused',
      name: 'File field hydration refused',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: DOC,
          label: 'Doc',
          sharingModel: 'public_read_write',
          fields: {
            title: { name: 'title', type: 'text' },
            attachment: { name: 'attachment', type: 'file' },
          },
        },
        // The storage service's `sys_file`, as far as the hydration reads it:
        // no `access` block and no `sharingModel`, exactly as it ships.
        {
          name: 'sys_file',
          label: 'System File',
          fields: {
            key: { name: 'key', type: 'text' },
            name: { name: 'name', type: 'text' },
            mime_type: { name: 'mime_type', type: 'text' },
            size: { name: 'size', type: 'number' },
            status: { name: 'status', type: 'text' },
          },
        },
      ],
    } as never);
    await engine.syncSchemas();

    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [RECORD_READER_SET, FILE_READER_SET],
      },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: RECORD_READER_SET.name });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    warn = vi.fn();
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(warn);

    await engine.insert('sys_file', [
      { id: FILE_ID, key: 'k/1', name: 'contract.pdf', mime_type: 'application/pdf', size: 1024, status: 'committed' },
    ], { context: SYS_CTX } as never);
    await engine.insert(DOC, [
      { id: 'd1', title: 'with file', attachment: FILE_ID },
      { id: 'd2', title: 'no file', attachment: null },
    ], { context: SYS_CTX } as never);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the refusal it starts from: this reader may not read sys_file directly', async () => {
    const direct = await engine.find('sys_file', { context: RECORD_READER_CTX } as never).then(() => null, (e: any) => e);
    expect(envelopeOf(direct)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('a reader without sys_file read sees the field marked refused, not the bare id an absent file reads as', async () => {
    warn.mockClear();
    const rows = await engine.find(DOC, { context: RECORD_READER_CTX } as never);
    const withFile = rows.find((r: any) => r.id === 'd1');

    expect(withFile?.attachment).toEqual({ id: FILE_ID, metadataRefused: true });
    expect(withFile?.title).toBe('with file');
    // Handed to the caller in the value, so the seam no longer warns per read
    // with a storage remedy that cannot fix a permission.
    expect(warn.mock.calls.filter(([msg]) => String(msg).startsWith('sys_file lookup failed'))).toEqual([]);

    const one = await engine.findOne(DOC, { where: { id: 'd1' }, context: RECORD_READER_CTX } as never);
    expect(one?.attachment).toEqual({ id: FILE_ID, metadataRefused: true });
  });

  it('CONTROL a record with no file still reads empty for that reader', async () => {
    const rows = await engine.find(DOC, { context: RECORD_READER_CTX } as never);
    expect(rows.find((r: any) => r.id === 'd2')?.attachment).toBeNull();
  });

  it('CONTROL a reader with sys_file read gets the hydrated file', async () => {
    const rows = await engine.find(DOC, { context: FILE_READER_CTX } as never);
    expect(rows.find((r: any) => r.id === 'd1')?.attachment).toEqual({
      id: FILE_ID,
      name: 'contract.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      url: `/api/v1/storage/files/${FILE_ID}`,
    });
  });
});
