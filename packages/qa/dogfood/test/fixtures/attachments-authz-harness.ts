// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Shared boot + upload helpers for the attachment AUTHORIZATION pins added by
// #9483 (QA run #9401 coverage gaps on three attachments-storage items).
//
// These live here rather than in `attachments-fixture.ts` because that module
// is the fixture's DATA (objects, permission sets, stack) and is imported by
// the standing permission matrix. This module is the harness the three new
// clause pins share: the same real `objectstack dev` pairing the matrix boots
// (storage + audit), and the same REAL three-step presigned upload — no
// short-cut that writes a `sys_file` row directly, because a hand-written file
// row would not carry the server-stamped `owner_id` every download verdict
// below turns on.

import { mkdtempSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './attachments-fixture.js';

/** A booted attachments fixture plus the temp dir its local adapter writes to. */
export interface AttachmentsHarness {
  readonly stack: VerifyStack;
  readonly rootDir: string;
}

/**
 * Boot the attachments fixture with the real storage + audit pairing.
 *
 * `bindToSettings:false` mirrors the matrix: the settings live-wire would swap
 * in a './storage' adapter and move the bytes out from under `rootDir`.
 */
export async function bootAttachmentsHarness(): Promise<AttachmentsHarness> {
  const rootDir = mkdtempSync(join(tmpdir(), 'att-authz-'));
  const stack = await bootStack(attachmentsFixtureStack as never, {
    security: attachmentsFixtureSecurity(),
    extraPlugins: [
      new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      new AuditPlugin(),
    ],
  });
  return { stack, rootDir };
}

export async function stopAttachmentsHarness(h: AttachmentsHarness | undefined): Promise<void> {
  await h?.stack?.stop();
  if (h?.rootDir) await fs.rm(h.rootDir, { recursive: true, force: true });
}

/** The bytes every helper below uploads — 5 bytes, matching the declared size. */
export const FILE_BYTES = 'hello';

/**
 * Drive the REAL presigned three-step upload (presign -> raw PUT -> complete)
 * and return the committed `sys_file` id.
 */
export async function uploadFile(
  stack: VerifyStack,
  token: string | null,
  name = 'hello.txt',
): Promise<string> {
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const presignRes = await stack.api('/storage/upload/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      filename: name,
      mimeType: 'text/plain',
      size: FILE_BYTES.length,
      scope: 'attachments',
    }),
  });
  expect(presignRes.status, 'presign').toBe(200);
  const { data } = (await presignRes.json()) as any;
  const putRes = await stack.raw(toPath(String(data.uploadUrl)), {
    method: 'PUT',
    headers: data.headers ?? { 'content-type': 'text/plain' },
    body: FILE_BYTES,
  });
  expect(putRes.status, 'raw PUT').toBeLessThan(300);
  const completeRes = await stack.api('/storage/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ fileId: data.fileId }),
  });
  expect(completeRes.status, 'complete').toBe(200);
  return String(data.fileId);
}

/** Strip the origin off an absolute adapter URL so it can be re-injected. */
export function toPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}

/**
 * Seconds of life left in a LocalStorageAdapter capability URL.
 *
 * The adapter signs `base64url(JSON).hmac`, and the payload carries `exp` (an
 * epoch-seconds deadline). Reading it is how the two TTL BRANCHES of
 * `authorizeDownload` are told apart from the outside: the ungated/`public_read`
 * return hands back `presignedTtl` (3600s) while an authorized gated grant
 * hands back the much shorter `downloadTtl` (300s). Without this the two
 * branches are indistinguishable — both answer 200/302 with a working URL —
 * and a test asserting only "a URL came back" cannot tell which one ran.
 */
export function ttlSecondsOf(capabilityUrl: string): number {
  const token = capabilityUrl.split('/').pop() ?? '';
  const [b64] = token.split('.');
  const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as { exp: number };
  return payload.exp - Math.floor(Date.now() / 1000);
}
