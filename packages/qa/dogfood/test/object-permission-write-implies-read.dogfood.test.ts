// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An object permission that edits or deletes a record also reads it —
// measured at the HTTP doors of the stock showcase.
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
//   1. The metadata save door refuses a permission set granting `allowEdit` or
//      `allowDelete` without read on the same entry: `422 INVALID_METADATA`,
//      the finding at the bit's own path, nothing stored. The same set with
//      `allowRead: true` beside the bit saves.
//   2. A permission set STORED before that refusal existed (a
//      `sys_permission_set` row the save door never judged) still loads, and
//      its unread edit and delete grants grant nothing: `security/explain`
//      answers `denies` for update and delete, and the by-id `PATCH` and
//      `DELETE` answer one refusal for a row that exists and for an id naming
//      none, the stored row untouched.
//   3. Control: the same stored row with `allowRead: true` beside the bits
//      writes the row.
//
// The object is `showcase_semantic_zoo`: it declares `public_read_write`, so
// the platform's ownership floor does not bind it, and no baseline set grants
// anything on it — the grant under test is the only one in play.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const PASS = 'Write-Implies-Read-0001';
const OBJECT = 'showcase_semantic_zoo';

interface Answer { status: number; body: any }

describe('an object permission that edits or deletes a record also reads it (stock showcase, HTTP doors)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let writerTok: string;
  let readerWriterTok: string;
  let rowId = '';
  let seq = 0;
  /** A fresh id no row carries — 16+ characters, the driver's id floor. */
  const unknownId = (): string => `qawir${(seq++).toString(36)}${Date.now().toString(36)}`.padEnd(18, '0');

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, body: parsed };
  };
  /** The answer with the caller-supplied id written out, so two ids compare. */
  const withoutId = (a: Answer, id: string): string => JSON.stringify(a).split(id).join('ID');
  const stored = async (id: string) => JSON.stringify(await ql.findOne(OBJECT, { where: { id }, context: SYS }));

  /** A permission-set row as a store written before the save door judged this shape carries it, bound to a fresh user. */
  const storedSetPrincipal = async (name: string, grant: Record<string, boolean>, email: string): Promise<string> => {
    await ql.insert('sys_permission_set', {
      name,
      label: name,
      object_permissions: JSON.stringify({ [OBJECT]: grant }),
      system_permissions: JSON.stringify([]),
    }, { context: SYS });
    const token = await stack.signUp(email, PASS);
    const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    expect(userId, `${email} provisioned`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: name }, { context: SYS });
    return token;
  };

  /** The `object_crud` layer's verdict `/security/explain` gives the caller for one operation. */
  const crudVerdict = async (token: string, operation: string): Promise<string> => {
    const res = await call(token, 'GET', `/security/explain?object=${OBJECT}&operation=${operation}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return String((res.body?.layers ?? []).find((l: any) => l?.layer === 'object_crud')?.verdict);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    writerTok = await storedSetPrincipal('qa_wir_stored_writer', { allowEdit: true, allowDelete: true }, 'wir-writer@verify.test');
    readerWriterTok = await storedSetPrincipal(
      'qa_wir_stored_reader_writer',
      { allowRead: true, allowEdit: true, allowDelete: true },
      'wir-reader-writer@verify.test',
    );
    const made = await call(adminTok, 'POST', `/data/${OBJECT}`, { id: unknownId(), name: 'write implies read' });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    rowId = String(made.body?.id ?? made.body?.record?.id ?? made.body?.data?.id ?? '');
    expect(rowId, 'fixture row').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  for (const bit of ['allowEdit', 'allowDelete'] as const) {
    it(`the save door refuses ${bit} without read, at the bit's path, and stores nothing`, async () => {
      const name = `qa_wir_${bit.toLowerCase()}_unread`;
      const saved = await call(adminTok, 'PUT', `/meta/permission/${name}`, {
        name, label: name, objects: { [OBJECT]: { [bit]: true } },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(422);
      const wire = JSON.stringify(saved.body);
      expect(wire).toContain('INVALID_METADATA');
      expect(wire).toContain(`objects.${OBJECT}.${bit}`);
      expect((await call(adminTok, 'GET', `/meta/permission/${name}`)).status).toBe(404);
    });

    it(`the save door accepts ${bit} beside allowRead: true`, async () => {
      const name = `qa_wir_${bit.toLowerCase()}_read`;
      const saved = await call(adminTok, 'PUT', `/meta/permission/${name}`, {
        name, label: name, objects: { [OBJECT]: { allowRead: true, [bit]: true } },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    });
  }

  it('a stored set granting edit and delete without read grants neither: explain denies both', async () => {
    expect(await crudVerdict(writerTok, 'read')).toBe('denies');
    expect(await crudVerdict(writerTok, 'update')).toBe('denies');
    expect(await crudVerdict(writerTok, 'delete')).toBe('denies');
    expect(await crudVerdict(readerWriterTok, 'update'), 'control: with read beside it').toBe('grants');
  });

  for (const [verb, method] of [['update', 'PATCH'], ['delete', 'DELETE']] as const) {
    it(`${verb}: a stored set without read gets one refusal for the row and for an id naming none, and the row is untouched`, async () => {
      const before = await stored(rowId);
      const missing = unknownId();
      const body = method === 'PATCH' ? { name: 'should not land' } : undefined;
      const row = await call(writerTok, method, `/data/${OBJECT}/${rowId}`, body);
      const none = await call(writerTok, method, `/data/${OBJECT}/${missing}`, body);

      expect(row.status, JSON.stringify(row.body)).toBe(403);
      expect(row.body?.code ?? row.body?.error?.code, JSON.stringify(row.body)).toBe('PERMISSION_DENIED');
      expect(withoutId(none, missing)).toBe(withoutId(row, rowId));
      expect(await stored(rowId)).toBe(before);
    });
  }

  it('control: the stored set with read beside the bits writes the row', async () => {
    const got = await call(readerWriterTok, 'PATCH', `/data/${OBJECT}/${rowId}`, { name: 'renamed by a reader' });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(JSON.parse(await stored(rowId))?.name).toBe('renamed by a reader');
  });
});
