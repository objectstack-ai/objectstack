// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#38163] `uploadFile` / `uploadFiles` of the ObjectStack data source
// (`@object-ui/data-objectstack`) upload through the route a standard server
// serves: the storage service's presigned flow. They used to post to
// `/api/data/<resource>/upload`, which this stack answers 404
// `ENDPOINT_NOT_FOUND`, so every call failed.
//
// The data source runs against a real stack (`bootStack` with
// `StorageServicePlugin` and the attachments fixture), through a fetch that
// hands each request to the stack's Hono app. The session is bearer-only:
// no cookie exists on this transport, so a request that lost the bearer would
// be anonymous and refused. What the pin reads: the call resolves, the
// returned id names a committed `sys_file` row, a `recordId` upload wrote the
// `sys_attachment` row, and no request reached an upload path the server does
// not serve.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './fixtures/attachments-fixture.js';

const ORIGIN = 'http://stack-38163.test';
const SYS = { isSystem: true } as const;
/** An upload path the standard server does not serve: the data source's old one, with or without a version. */
const UNSERVED_UPLOAD = /\/api\/(v\d+\/)?data\/[^/]+\/upload/;

describe('data-objectstack uploads reach the storage service on a real stack (#38163)', () => {
  let stack: VerifyStack;
  let admin: string;
  let ql: any;
  let caseId: string;
  const paths: string[] = [];

  /** The stack's Hono app as a fetch; `withBearer` plays a host's authenticated fetch. */
  const stackFetch =
    (withBearer: string | null) =>
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, ORIGIN);
      if (url.origin !== ORIGIN) throw new Error(`request left the stack: ${url.href}`);
      paths.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      const headers = new Headers(init?.headers);
      if (withBearer) headers.set('Authorization', `Bearer ${withBearer}`);
      return stack.raw(`${url.pathname}${url.search}`, { ...init, headers });
    };

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'upload-route-38163-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
      ],
    });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    const created = await stack.apiAs(admin, 'POST', '/data/att_case', { name: 'Upload target' });
    expect(created.status, 'create att_case').toBeLessThan(300);
    const body = (await created.json()) as any;
    caseId = String(body.id ?? body.record?.id ?? body.data?.id);
  }, 180_000);
  afterAll(async () => {
    await stack?.stop();
  });

  it('uploadFile with recordId stores the file and attaches it to the record, under the token alone', async () => {
    paths.length = 0;
    const source = new ObjectStackAdapter({ baseUrl: ORIGIN, token: admin, fetch: stackFetch(null), autoReconnect: false });

    const result = await source.uploadFile('att_case', new File(['hello'], 'hello.txt', { type: 'text/plain' }), {
      recordId: caseId,
    });

    expect(result).toMatchObject({ filename: 'hello.txt', mimeType: 'text/plain', size: 5 });
    const file = await ql.findOne('sys_file', { where: { id: result.id }, context: SYS });
    expect(file, 'sys_file row').toBeTruthy();
    expect(file.status).toBe('committed');
    const attachment = await ql.findOne('sys_attachment', { where: { file_id: result.id }, context: SYS });
    expect(attachment, 'sys_attachment row').toBeTruthy();
    expect(attachment.parent_object).toBe('att_case');
    expect(String(attachment.parent_id)).toBe(caseId);
    expect(result.metadata?.attachmentId).toBe(attachment.id);
    expect(paths.filter((p) => UNSERVED_UPLOAD.test(p))).toEqual([]);
  }, 60_000);

  it('uploadFiles stores every file, through a host fetch that carries the bearer', async () => {
    paths.length = 0;
    const source = new ObjectStackAdapter({ baseUrl: ORIGIN, fetch: stackFetch(admin), autoReconnect: false });

    const results = await source.uploadFiles('att_case', [
      new File(['one'], 'one.txt', { type: 'text/plain' }),
      new File(['two!'], 'two.txt', { type: 'text/plain' }),
    ]);

    expect(results.map((r) => [r.filename, r.size])).toEqual([
      ['one.txt', 3],
      ['two.txt', 4],
    ]);
    for (const r of results) {
      const file = await ql.findOne('sys_file', { where: { id: r.id }, context: SYS });
      expect(file?.status, `sys_file ${r.id}`).toBe('committed');
    }
    expect(paths.filter((p) => UNSERVED_UPLOAD.test(p))).toEqual([]);
  }, 60_000);
});
