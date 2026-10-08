// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22283] The storage settings "Limits" group, honoured over a REAL boot.
//
// Setup's File Storage page renders `max_upload_mb`, `presigned_ttl` and
// `session_ttl`, and an admin's save persisted them while nothing read them. The
// package suite (`service-storage/src/storage-limits.test.ts`) pins every door
// over a fake settings service; this file is the one place the whole path runs
// for real: the settings service's cascade, `PUT /api/settings/storage`, its
// `settings:changed` delivery to `StorageServicePlugin`, and the HTTP upload
// doors answering through the real adapter.
//
//   1. Nothing saved — the declared default (100 MB) is enforced and the
//      presigned TTL is the declared 3600 s.
//   2. A save reaches the doors without a restart — the presigned door refuses
//      a declared size over it, the presigned URL carries the saved TTL, and
//      the local raw PUT refuses a body over it while accepting one at it.
//
// Not eligible for the shared showcase project: it writes org-wide settings.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './fixtures/attachments-fixture.js';

const MIB = 1024 * 1024;

describe('[#22283] the storage Limits settings are enforced at the upload doors of a real boot', () => {
  let stack: VerifyStack;
  let token: string;

  const presign = (size: number): Promise<Response> =>
    stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'limit.bin', mimeType: 'application/octet-stream', size, scope: 'user' }),
    });

  const rawPut = (path: string, bytes: number): Promise<Response> =>
    stack.raw(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    });

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'upload-limits-dogfood-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      // Bound to the `storage` settings namespace — the plugin's default.
      extraPlugins: [new StorageServicePlugin({ adapter: 'local', local: { rootDir } })],
    });
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('nothing saved: the declared 100 MB default is enforced, and the presigned TTL is 3600 s', async () => {
    const over = await presign(100 * MIB + 1);
    expect(over.status, 'a declared size one byte over 100 MB').toBe(413);
    const refusal = (await over.json()) as any;
    expect(refusal.success).toBe(false);
    expect(refusal.error.code).toBe('VALIDATION_ERROR');

    const ok = await presign(100 * MIB);
    expect(ok.status, 'exactly 100 MB').toBe(200);
    expect(((await ok.json()) as any).data.expiresIn).toBe(3600);
  });

  it('a save in the File Storage settings reaches the doors: presign and the raw PUT refuse over it', async () => {
    const save = await stack.raw('/api/settings/storage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ max_upload_mb: 1, presigned_ttl: 120 }),
    });
    expect(save.status, await save.clone().text()).toBe(200);

    // The plugin re-reads the namespace on `settings:changed`, asynchronously
    // to the PUT's answer — wait for the save to land rather than racing it.
    let over = await presign(MIB + 1);
    for (let i = 0; i < 40 && over.status !== 413; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      over = await presign(MIB + 1);
    }
    expect(over.status, 'a declared size one byte over the saved 1 MB').toBe(413);
    expect(((await over.json()) as any).error.code).toBe('VALIDATION_ERROR');

    const ok = await presign(10);
    expect(ok.status).toBe(200);
    const { data } = (await ok.json()) as any;
    expect(data.expiresIn, 'the saved presigned_ttl').toBe(120);

    // The local adapter's byte door judges what actually arrives, whatever was declared.
    const path = String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, '');
    const tooBig = await rawPut(path, MIB + 1);
    expect(tooBig.status, 'a body one byte over the saved 1 MB').toBe(413);
    expect(((await tooBig.json()) as any).error.code).toBe('VALIDATION_ERROR');
    const fits = await rawPut(path, MIB);
    expect(fits.status, 'a body of exactly 1 MB').toBeLessThan(300);
  });
});
