// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22431] A file with neither an attachments scope nor a field owner — an
// upload no record has claimed, which is how an avatar or an organization logo
// stored as a URL lives — needs a signed-in caller at both download doors,
// over a REAL showcase boot. `acl: 'public_read'` stays the one anonymous
// download (ADR-0104).
//
// The package suite (`service-storage/src/storage-routes.test.ts`) pins the
// gate over a hand-wired resolver. This file is where the composed one runs:
// the plugin's own `kernel:ready` mount binds the kernel's `auth` service as
// the resolver, so the answer a caller gets here is the deployment's answer.
//
// The half that decides whether the change is safe to ship is the COOKIE case.
// A browser renders these files through `<img src>` / `<a href>`, which can
// carry no bearer header — only the session cookie the sign-in set. So the
// signed-in reader is asserted twice: once with the bearer a script sends,
// once with nothing but that cookie, and both must reach the bytes.
//
// Not eligible for the shared showcase project: it boots its own plugins.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const BYTES = 'unclaimed';

/** Strip the origin off an absolute adapter URL so it can be re-injected. */
const toPath = (url: string): string => url.replace(/^https?:\/\/[^/]+/, '');

describe('[#22431] a download of a file with no attachments scope and no field owner needs a signed-in caller', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: any;
  let token: string;
  let cookie: string;
  /** Uploaded with no scope named — the shape the console's upload adapter sends. */
  let unclaimed: string;
  let attached: string;

  const bearer = () => ({ Authorization: `Bearer ${token}` });

  /** The real three-step presigned upload; `scope` omitted unless named. */
  const upload = async (name: string, scope?: string): Promise<string> => {
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer() },
      body: JSON.stringify({ filename: name, mimeType: 'text/plain', size: BYTES.length, ...(scope ? { scope } : {}) }),
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as any;
    const put = await stack.raw(toPath(String(data.uploadUrl)), {
      method: 'PUT',
      headers: data.headers ?? { 'content-type': 'text/plain' },
      body: BYTES,
    });
    expect(put.status, 'raw PUT').toBeLessThan(300);
    const complete = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer() },
      body: JSON.stringify({ fileId: data.fileId }),
    });
    expect(complete.status, 'complete').toBe(200);
    return String(data.fileId);
  };

  /** Both doors for one caller: the JSON door and the redirect door. */
  const doors = async (fileId: string, headers: Record<string, string> = {}) => ({
    url: await stack.api(`/storage/files/${fileId}/url`, { headers }),
    redirect: await stack.api(`/storage/files/${fileId}`, { headers, redirect: 'manual' } as RequestInit),
  });

  const expectRefused = async (res: Response, label: string) => {
    expect(res.status, label).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success, label).toBe(false);
    expect(body.error?.code, label).toBe('AUTH_REQUIRED');
  };

  /** A 302 whose target, followed with NO credential, serves the uploaded bytes. */
  const expectBytesBehindRedirect = async (res: Response, label: string) => {
    expect(res.status, label).toBe(302);
    const location = res.headers.get('location');
    expect(location, `${label}: a 302 with no Location`).toBeTruthy();
    const bytes = await stack.raw(toPath(String(location)));
    expect(bytes.status, label).toBe(200);
    expect(await bytes.text(), label).toBe(BYTES);
  };

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'unclaimed-download-'));
    stack = await bootShowcase({
      security: showcaseAppDefaultSecurity(),
      extraPlugins: [new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false })],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    token = await stack.signIn();

    // The browser transport: the session cookie the sign-in response sets.
    const signIn = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    expect(signIn.status).toBe(200);
    cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .filter((pair) => pair.includes('session_token='))
      .join('; ');
    expect(cookie, 'the sign-in sets a session cookie').toContain('session_token=');

    unclaimed = await upload('unclaimed.txt');
    attached = await upload('attached.txt', 'attachments');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('the file under test is unclaimed: no attachments scope, no field owner, not public_read', async () => {
    const row = await ql.findOne('sys_file', { where: { id: unclaimed }, context: SYS });
    expect(row?.scope).not.toBe('attachments');
    expect(row?.ref_object ?? null).toBeNull();
    expect(row?.acl ?? 'private').not.toBe('public_read');
  });

  it('an anonymous caller is refused 401 AUTH_REQUIRED at both download doors', async () => {
    const { url, redirect } = await doors(unclaimed);
    await expectRefused(url, 'the URL door');
    await expectRefused(redirect, 'the redirect door');
    expect(redirect.headers.get('location'), 'no capability URL leaks on the refusal').toBeNull();
  });

  it('a signed-in caller with a bearer token is served as before', async () => {
    const { url, redirect } = await doors(unclaimed, bearer());
    expect(url.status).toBe(200);
    const body = (await url.json()) as any;
    const bytes = await stack.raw(toPath(String(body.data.url)));
    expect(await bytes.text()).toBe(BYTES);
    await expectBytesBehindRedirect(redirect, 'bearer, redirect door');
  });

  it('a signed-in browser is served through its session cookie alone — what <img src> carries', async () => {
    const { url, redirect } = await doors(unclaimed, { cookie });
    expect(url.status, 'the URL door, cookie only').toBe(200);
    await expectBytesBehindRedirect(redirect, 'cookie only, redirect door');
  });

  it("acl: 'public_read' keeps the file anonymous, and only that declaration does", async () => {
    await ql.update('sys_file', { acl: 'public_read' }, { where: { id: unclaimed }, context: SYS });
    try {
      const { url, redirect } = await doors(unclaimed);
      expect(url.status, 'public_read, anonymous URL door').toBe(200);
      await expectBytesBehindRedirect(redirect, 'public_read, anonymous redirect door');
    } finally {
      await ql.update('sys_file', { acl: 'private' }, { where: { id: unclaimed }, context: SYS });
    }
    await expectRefused((await doors(unclaimed)).redirect, 'back to private');
  });

  it('controls: an anonymous upload and an anonymous attachments-scope download stay refused', async () => {
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'anon.txt', mimeType: 'text/plain', size: 1 }),
    });
    await expectRefused(presign, 'anonymous upload');
    const { url, redirect } = await doors(attached);
    await expectRefused(url, 'attachments-scope, URL door');
    await expectRefused(redirect, 'attachments-scope, redirect door');
  });
});
