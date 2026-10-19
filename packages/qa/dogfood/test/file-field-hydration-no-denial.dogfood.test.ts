// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A record read whose only `sys_file` touch is file-field hydration logs no
// access-denied WARN.
//
// The engine expands a stored file id (ADR-0104 D3) by reading `sys_file`, and
// it used to issue that read AS THE CALLER. A member who may read the record
// but not `sys_file` — the platform default, `member_default` grants no
// `sys_file` read — was refused it, and plugin-security logs every refusal at
// WARN: one `[Security] Access denied: operation 'find' on object 'sys_file'`
// line per by-id read and per list read, for every such reader, for a read the
// reader never asked for, while the body served was right (the field-owned
// file hydrates, #22637). The lines buried the real denials.
//
// The engine now asks the security service's `canReadObject('sys_file')`
// first — as the parent-record read gates ask before they read a parent — and
// serves a refused caller the field-owned arm without the read. What this
// file holds, on a real org-bound boot with the real SecurityPlugin and the
// real StorageServicePlugin (real bytes, the real field-owned verdict):
//
//   - a member's by-id and list reads of a record holding its own file log NO
//     denial, and serve the file hydrated;
//   - their bodies are byte-identical to the bodies served when the security
//     service offers no `canReadObject` (a defined state of the contract, in
//     which the engine reads as the caller, as it did before) — asked of the
//     same boot, so the comparison is about the ask and nothing else;
//   - that no-ask read still logs the denial, so the comparison is armed;
//   - a direct `GET /data/sys_file/:id` by the same member is still `403
//     PERMISSION_DENIED`, and still logs its denial exactly once;
//   - a reader granted `sys_file` read is unchanged: no denial, the same
//     hydrated value, the same body on both arms.
//
// `@objectstack/objectql` resolves through its BUILT output here (a ledgered
// pair in `scripts/check-test-source-alias.mjs`), so a verdict on a change to
// it is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { assertArmed, principalArmed } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const DOC = 'fhn_doc';
const MEMBER_EMAIL = 'fhn-member@verify.test';
const READER_EMAIL = 'fhn-file-reader@verify.test';

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.file-hydration-no-denial',
    namespace: 'fhn',
    version: '0.0.0',
    type: 'app',
    name: 'File Hydration No-Denial Fixture',
    description: 'One record object with a file field, readable by every member.',
  },
  objects: [
    ObjectSchema.create({
      name: DOC,
      label: 'Hydration Doc',
      pluralLabel: 'Hydration Docs',
      sharingModel: 'public_read_write',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        doc: Field.file({ label: 'Doc' }),
      },
    }),
  ],
});

/** The member app grant: the record object, no wildcard, so no `sys_file` read. */
const memberBaselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'fhn_member_baseline',
  label: 'File-hydration fixture — the member app grant, no wildcard',
  objects: { [DOC]: { allowRead: true, allowCreate: true, allowEdit: true } },
});

/** The control's grant: object-level `sys_file` read on top of the baseline. */
const fileReaderSet: PermissionSet = PermissionSetSchema.parse({
  name: 'fhn_file_reader',
  label: 'File-hydration fixture — object-level sys_file read',
  objects: { sys_file: { allowRead: true } },
});

/** The denial plugin-security logs, as a matcher (its developer sentence's opener). */
const DENIAL = '[Security] Access denied';

describe('file-field hydration: a record read is not a sys_file access attempt', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let readerTok: string;
  let fileId: string;
  let recordId: string;
  /** The kernel logger every plugin context shares — plugin-security's `ctx.logger`. */
  let logger: { warn: (...args: unknown[]) => void };
  /** The registered `security` service, the object the engine resolves on every read. */
  let security: { canReadObject?: unknown };

  /** Every security denial the stack logs while `run` is in flight. */
  const denialsDuring = async <T>(run: () => Promise<T>): Promise<{ value: T; denials: string[] }> => {
    const spy = vi.spyOn(logger, 'warn');
    try {
      const value = await run();
      return { value, denials: spy.mock.calls.map((args) => String(args[0])).filter((w) => w.includes(DENIAL)) };
    } finally {
      spy.mockRestore();
    }
  };

  /** `run`, with the security service offering no `canReadObject` — the contract's optional-method state. */
  const withoutReadAdmission = async <T>(run: () => Promise<T>): Promise<T> => {
    const own = Object.getOwnPropertyDescriptor(security, 'canReadObject');
    expect(own, 'the registered service carries canReadObject as its own member').toBeTruthy();
    delete security.canReadObject;
    try {
      return await run();
    } finally {
      Object.defineProperty(security, 'canReadObject', own!);
    }
  };

  /** One read of `path` as `token`: its status, its body text, and the denials it logged. */
  const read = async (token: string, path: string) => {
    const { value, denials } = await denialsDuring(async () => {
      const res = await stack.apiAs(token, 'GET', path);
      return { status: res.status, text: await res.text() };
    });
    return { ...value, denials };
  };

  /** The file field of the fixture record, read off a by-id or a list body. */
  const docOf = (text: string): unknown => {
    const body = JSON.parse(text);
    const rec = body.records?.find((r: any) => String(r.id) === recordId) ?? body.record ?? body.data ?? body;
    return rec?.doc;
  };

  const hydrated = () => ({
    id: fileId,
    name: 'contract.txt',
    size: 5,
    mimeType: 'text/plain',
    url: `/api/v1/storage/files/${fileId}`,
  });

  /** Upload real bytes as the admin and return the `sys_file` id (scope `user`, the field lineage). */
  async function uploadFile(name: string): Promise<string> {
    const auth = { Authorization: `Bearer ${adminTok}` };
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ filename: name, mimeType: 'text/plain', size: 5, scope: 'user' }),
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as any;
    expect(data.fileId, 'presign carried no fileId').toBeTruthy();
    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: data.headers ?? { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(put.status, 'raw PUT').toBeLessThan(300);
    const complete = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ fileId: data.fileId }),
    });
    expect(complete.status, 'complete').toBe(200);
    return String(data.fileId);
  }

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'fhn-dogfood-'));
    stack = await bootStack(fixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberBaselineSet, fileReaderSet],
        fallbackPermissionSet: memberBaselineSet.name,
      }),
      extraPlugins: [
        new PlatformObjectsPlugin(),
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
      // Org-bound: the member holds `org_member`, the position the platform's
      // member floors are domained to.
      orgContext: true,
    });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER_EMAIL);
    readerTok = await stack.signUp(READER_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');
    security = await stack.kernel.getServiceAsync('security');
    logger = (stack.kernel as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger;

    const readerId = (await ql.findOne('sys_user', { where: { email: READER_EMAIL }, context: SYS }))?.id;
    const set = await catalogPermissionSet(ql, fileReaderSet.name);
    expect(set, 'fixture permission set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: readerId, permission_set: set.name }, { context: { ...SYS } });

    fileId = await uploadFile('contract.txt');
    const row = await ql.insert(DOC, { name: 'contract', doc: fileId }, { context: { ...SYS } });
    recordId = String((row as any).id ?? row);
    // The field-reference hooks claimed the file for the record: it is
    // field-owned, which is what the refused reader's hydration serves by.
    const file = await ql.findOne('sys_file', { where: { id: fileId }, context: SYS });
    expect(file?.ref_object).toBe(DOC);
    expect(String(file?.ref_id)).toBe(recordId);

    await assertArmed([
      principalArmed({
        stack,
        token: memberTok,
        who: 'the member holding the app grant and no sys_file read',
        positions: ['org_member'],
        permissions: [],
        control: 'object-level read on the fixture object only, by the fallback baseline',
        disarmedBy: 'a member that resolved a sys_file grant would never meet the refusal this file is about',
      }),
      principalArmed({
        stack,
        token: readerTok,
        who: 'the reader granted object-level sys_file read',
        positions: ['org_member'],
        permissions: [fileReaderSet.name],
        control: 'object-level read on sys_file, granted by an explicit permission set',
        disarmedBy: 'a reader that never resolved the grant would be the member again, and the control would measure nothing',
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  for (const [door, path] of [
    ['by id', () => `/data/${DOC}/${recordId}`],
    ['list', () => `/data/${DOC}`],
  ] as const) {
    it(`${door}: the member's read logs no denial, and serves the no-ask read's body byte for byte`, async () => {
      const before = await withoutReadAdmission(() => read(memberTok, path()));
      // Armed: without the ask, the member's read is refused sys_file and
      // that refusal is logged — the line this file is about.
      expect(before.status).toBe(200);
      expect(before.denials).toHaveLength(1);
      expect(before.denials[0]).toContain("on object 'sys_file'");

      const after = await read(memberTok, path());
      expect(after.status).toBe(200);
      expect(after.denials).toEqual([]);
      expect(after.text).toBe(before.text);
      // The field-owned file is hydrated (#22637), not marked refused.
      expect(docOf(after.text)).toEqual(hydrated());
    }, 60_000);

    it(`${door}: CONTROL a reader with sys_file read is unchanged — no denial, the same file, the same body`, async () => {
      const before = await withoutReadAdmission(() => read(readerTok, path()));
      const after = await read(readerTok, path());
      expect(before.status).toBe(200);
      expect(after.status).toBe(200);
      expect(before.denials).toEqual([]);
      expect(after.denials).toEqual([]);
      expect(after.text).toBe(before.text);
      expect(docOf(after.text)).toEqual(hydrated());
    }, 60_000);
  }

  it('the member\'s direct sys_file read is still 403 PERMISSION_DENIED, and logs its denial exactly once', async () => {
    const res = await read(memberTok, `/data/sys_file/${fileId}`);
    expect(res.status).toBe(403);
    const body = JSON.parse(res.text);
    expect(body.code ?? body.error?.code).toBe('PERMISSION_DENIED');
    expect(res.denials).toHaveLength(1);
    expect(res.denials[0]).toContain("on object 'sys_file'");
  });
});
