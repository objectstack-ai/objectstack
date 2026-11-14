// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The transport's request-body limit (10 MiB by default,
// `@objectstack/plugin-hono-server` `src/body-limit.ts`) bounds what the
// HTTP door reads, not what an upload door accepts: each of the three storage
// byte doors reads `rawBody()` and bounds the file by its own `max_upload_mb`.
// Over a REAL boot under the default limit, a body over 10 MiB still lands
// through the presigned raw PUT, the chunk PUT and the upload-link PUT, while
// a JSON body of the same size to a data route is answered 413. The upload
// link's several-file form is bounded by that door's own form limit (each file
// within `max_upload_mb`, times the files the link takes, plus the form's
// framing), not by the transport's.
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
/** `UPLOAD_LINK_MAX_FILES` in `@objectstack/service-storage`: what a multi-file field's link takes. */
const LINK_MAX_FILES = 10;
/** The form framing a several-file submit may add beyond its files (`storage-routes.ts`). */
const FORM_OVERHEAD = 64 * 1024;
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

/** An object whose `scans` field takes several files, so its upload link takes the several-file form. */
const SCAN_CLAIM = 'body_limit_scan_claim';
const scanClaimApp = {
  name: 'com.dogfood.body-limit-scan-claim',
  type: 'standard' as const,
  version: '0.0.0',
  optionalDependencies: ['com.objectstack.engine.objectql'],
  async init(ctx: any) {
    ctx.getService('manifest').register({
      id: 'com.dogfood.body-limit-scan-claim',
      name: 'Scan claim',
      version: '0.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [{
        name: SCAN_CLAIM,
        label: 'Scan Claim',
        fields: {
          name: { type: 'text', label: 'Name' },
          scans: { type: 'file', label: 'Scans', multiple: true },
        },
      }],
    });
  },
  async start() {},
};

/** A request body that counts the bytes the server pulled from it. */
function countedBody(bytes: Uint8Array, chunk = 256 * 1024) {
  const read = { bytes: 0 };
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const next = bytes.subarray(offset, offset + chunk);
      offset += next.byteLength;
      read.bytes += next.byteLength;
      controller.enqueue(next);
    },
  }, { highWaterMark: 0 });
  return { stream, read };
}

describe('the upload link\'s several-file form is bounded by that door\'s own limit, not the request-body limit, over a real boot', () => {
  let stack: VerifyStack;
  let token: string;
  /** `max_upload_mb` saved for this boot: each file within 2 MiB. */
  const MAX_UPLOAD = 2 * MIB;
  const FORM_LIMIT = MAX_UPLOAD * LINK_MAX_FILES + FORM_OVERHEAD;

  const json = { 'Content-Type': 'application/json' };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'body-limit-link-form-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      // Bound to the `storage` settings namespace, so `max_upload_mb` is saved below.
      extraPlugins: [new StorageServicePlugin({ adapter: 'local', local: { rootDir } }), new MCPServerPlugin(), scanClaimApp],
    });
    token = await stack.signIn();
    const save = await stack.raw('/api/settings/storage', {
      method: 'PUT',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ max_upload_mb: MAX_UPLOAD / MIB }),
    });
    expect(save.status, await save.clone().text()).toBe(200);
    // The plugin re-reads the namespace on `settings:changed`, after the PUT's answer.
    const presign = (size: number) => stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ filename: 'probe.bin', mimeType: 'application/octet-stream', size, scope: 'user' }),
    });
    let probe = await presign(MAX_UPLOAD + 1);
    for (let i = 0; i < 40 && probe.status !== 413; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      probe = await presign(MAX_UPLOAD + 1);
    }
    expect(probe.status, 'the saved max_upload_mb is in force').toBe(413);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** A link for a new claim's `scans`, as the path the page is served at. */
  async function linkPath(): Promise<{ path: string; claimId: string }> {
    const created = await stack.apiAs(token, 'POST', `/data/${SCAN_CLAIM}`, { name: 'scan claim' });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const createdBody: any = await created.json();
    const claimId = String(createdBody?.id ?? createdBody?.record?.id ?? createdBody?.data?.id ?? '');
    expect(claimId).not.toBe('');
    const mcp = await stack.api('/mcp', {
      method: 'POST',
      headers: { ...json, Accept: 'application/json, text/event-stream', ...auth() },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'create_upload_link', arguments: { objectName: SCAN_CLAIM, recordId: claimId, field: 'scans' } },
      }),
    });
    expect(mcp.status).toBe(200);
    const rpc: any = await mcp.json();
    const minted = JSON.parse(rpc.result?.content?.[0]?.text ?? 'null');
    expect(rpc.result?.isError, JSON.stringify(minted)).not.toBe(true);
    return { path: String(minted.url).replace(/^https?:\/\/[^/]+/, ''), claimId };
  }

  /** The page's several-file form, as its bytes and the content type that frames them. */
  async function formOf(sizes: number[]): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
    const form = new FormData();
    form.append('count', String(sizes.length));
    sizes.forEach((size, i) => {
      form.append(`file${i}`, new Blob([new Uint8Array(size).fill(0x41 + i)], { type: 'application/octet-stream' }), `scan-${i}.bin`);
    });
    const encoded = new Response(form);
    return { bytes: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')! };
  }

  const putForm = (path: string, contentType: string, body: BodyInit, extra: Record<string, string> = {}) =>
    stack.raw(path, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': contentType, 'x-upload-link-form': 'several', ...extra },
      body,
      duplex: 'half',
    } as RequestInit);

  /** Six files of 1.9 MiB: each within `max_upload_mb`, the form over the 10 MiB request-body limit. */
  const OVER_TRANSPORT = Array.from({ length: 6 }, () => Math.floor(1.9 * MIB));

  it.each([['declared', true], ['not declared', false]])(
    'a form over the request-body limit and within the door\'s own limit lands whole, its length %s',
    async (_label, declare) => {
      const { path } = await linkPath();
      const { bytes, contentType } = await formOf(OVER_TRANSPORT);
      expect(bytes.byteLength).toBeGreaterThan(10 * MIB);
      expect(bytes.byteLength).toBeLessThan(FORM_LIMIT);
      const res = declare
        ? await putForm(path, contentType, bytes, { 'content-length': String(bytes.byteLength) })
        : await putForm(path, contentType, countedBody(bytes).stream);
      const body: any = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.data.fileIds).toHaveLength(OVER_TRANSPORT.length);
      expect(body.data.files.map((file: any) => file.size)).toEqual(OVER_TRANSPORT);
    },
  );

  it('a form that declares more than the door\'s own limit is answered 413 and not read', async () => {
    const { path } = await linkPath();
    const declared = FORM_LIMIT + 1;
    const { stream, read } = countedBody(new Uint8Array(declared));
    const res = await putForm(path, 'multipart/form-data; boundary=x', stream, { 'content-length': String(declared) });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(413);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toContain(`over the ${FORM_LIMIT} bytes this link's upload can carry`);
    expect(read.bytes).toBe(0);
  });

  it('a form with no declared length past the door\'s own limit is answered 413, and the link still takes a form that fits', async () => {
    const { path, claimId } = await linkPath();
    const { bytes, contentType } = await formOf(Array.from({ length: 11 }, () => MAX_UPLOAD));
    expect(bytes.byteLength).toBeGreaterThan(FORM_LIMIT);
    const res = await putForm(path, contentType, countedBody(bytes).stream);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(413);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    // Nothing was stored, and the link was not spent.
    const fits = await formOf([MIB]);
    const again = await putForm(path, fits.contentType, fits.bytes);
    expect(again.status, await again.clone().text()).toBe(200);
    const row: any = await stack.apiAs(token, 'GET', `/data/${SCAN_CLAIM}/${claimId}`).then((r) => r.json());
    const scans = row?.scans ?? row?.record?.scans ?? row?.data?.scans;
    expect(Array.isArray(scans) ? scans : [scans]).toHaveLength(1);
  });

  it('a body that is not the form is still the one file on the same link, read through rawBody()', async () => {
    const { path } = await linkPath();
    // A one-file body is any body that is not the form; one file is bounded by `max_upload_mb`.
    const res = await stack.raw(path, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/octet-stream', 'x-file-name': 'one.bin' },
      body: new Uint8Array(MAX_UPLOAD).fill(0x5a),
    });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.size).toBe(MAX_UPLOAD);
  });
});
