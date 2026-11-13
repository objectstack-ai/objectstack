// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The transport's request-body limit (10 MiB by default,
// `@objectstack/plugin-hono-server` `src/body-limit.ts`) bounds what the
// HTTP door reads, not what an upload door accepts: each of the three storage
// byte doors reads `rawBody()` and bounds the file by its own `max_upload_mb`.
// Over a REAL boot under the default limit, a body over 10 MiB still lands
// through the presigned raw PUT, the chunk PUT and the upload-link PUT, while
// a JSON body of the same size to a data route is answered 413.
//
// Not eligible for the shared showcase project: it boots its own storage root.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { MCPServerPlugin } from '@objectstack/mcp';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './fixtures/attachments-fixture.js';

const MIB = 1024 * 1024;
/** Over the transport's 10 MiB default, and a whole chunk the chunked door accepts (its floor is 5 MiB). */
const OVER_DEFAULT = 12 * MIB;

describe('the request-body limit leaves each upload door its own bound, over a real boot', () => {
  let stack: VerifyStack;
  let token: string;

  const json = { 'Content-Type': 'application/json' };
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const bytes = (byte: number) => new Uint8Array(OVER_DEFAULT).fill(byte);
  const declared = { 'content-length': String(OVER_DEFAULT) };

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'body-limit-upload-doors-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      // `bindToSettings:false` keeps the constructor rootDir and leaves
      // `max_upload_mb` unset, so each door's own bound is none at all: what
      // is measured here is that the transport limit does not stand in for it.
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new MCPServerPlugin(),
      ],
    });
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('CONTROL: a JSON body over the default limit to a data route is answered 413 PAYLOAD_TOO_LARGE', async () => {
    const body = JSON.stringify({ name: 'x'.repeat(OVER_DEFAULT) });
    const res = await stack.api('/data/att_case', {
      method: 'POST',
      headers: { ...json, ...auth(), 'content-length': String(Buffer.byteLength(body)) },
      body,
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('the presigned raw PUT receives a body over the default limit whole', async () => {
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ filename: 'large.bin', mimeType: 'application/octet-stream', size: OVER_DEFAULT, scope: 'attachments' }),
    });
    expect(presign.status, await presign.clone().text()).toBe(200);
    const { data } = (await presign.json()) as any;
    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: { ...(data.headers ?? { 'content-type': 'application/octet-stream' }), ...declared },
      body: bytes(0x61),
    });
    expect(put.status, await put.clone().text()).toBeLessThan(300);
    const complete = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ fileId: data.fileId }),
    });
    expect(complete.status, await complete.clone().text()).toBe(200);
    expect(((await complete.json()) as any).data.size).toBe(OVER_DEFAULT);
  });

  it('the chunk PUT receives a chunk over the default limit whole', async () => {
    const init = await stack.api('/storage/upload/chunked', {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ filename: 'large-chunk.bin', mimeType: 'application/octet-stream', totalSize: OVER_DEFAULT, chunkSize: OVER_DEFAULT }),
    });
    expect(init.status, await init.clone().text()).toBe(200);
    const { uploadId, resumeToken, totalChunks } = ((await init.json()) as any).data;
    expect(totalChunks).toBe(1);
    const put = await stack.api(`/storage/upload/chunked/${uploadId}/chunk/0`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/octet-stream', 'x-resume-token': resumeToken, ...declared },
      body: bytes(0x62),
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const progress = await stack.api(`/storage/upload/chunked/${uploadId}/progress`, { headers: auth() });
    expect(progress.status).toBe(200);
    expect(((await progress.json()) as any).data.uploadedSize).toBe(OVER_DEFAULT);
  });

  it('the upload-link PUT receives a body over the default limit whole', async () => {
    const created = await stack.apiAs(token, 'POST', '/data/att_case', { name: 'body-limit case' });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const createdBody: any = await created.json();
    const caseId = String(createdBody?.id ?? createdBody?.record?.id ?? createdBody?.data?.id ?? '');
    expect(caseId).not.toBe('');
    const mcp = await stack.api('/mcp', {
      method: 'POST',
      headers: { ...json, Accept: 'application/json, text/event-stream', ...auth() },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'create_upload_link', arguments: { objectName: 'att_case', recordId: caseId, attachments: true } },
      }),
    });
    expect(mcp.status).toBe(200);
    const rpc: any = await mcp.json();
    const minted = JSON.parse(rpc.result?.content?.[0]?.text ?? 'null');
    expect(rpc.result?.isError, JSON.stringify(minted)).not.toBe(true);
    const put = await stack.raw(String(minted.url).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'large-link.bin', ...auth(), ...declared },
      body: bytes(0x63),
    });
    const body: any = await put.json();
    expect(put.status, JSON.stringify(body)).toBe(200);
    expect(body.data.size).toBe(OVER_DEFAULT);
  });
});
