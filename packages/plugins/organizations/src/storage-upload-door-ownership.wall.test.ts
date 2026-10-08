// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22046 (ruling B and its addendum) — the storage upload doors' ownership
 * rule, measured on a BOOTED organization wall.
 *
 * `@objectstack/service-storage` declares one ownership rule (`isFileUploader`)
 * that three upload doors consult after their by-id read and before any write
 * or disclosure: the commit door, the chunked-completion door and the progress
 * door. Its own suite pins the rule per door. What that suite cannot boot is
 * the organization wall, and the ruling's addendum asks for exactly that: per
 * door, a caller acting in ANOTHER organization, naming an upload it did not
 * start, is answered `403 PERMISSION_DENIED` with the same body as a caller in
 * the uploader's own organization — and the by-id read that precedes the rule
 * discloses nothing and writes nothing across the wall.
 *
 * ## Why this file lives in THIS package
 *
 * The wall is raised by this package's `OrganizationsPlugin` (the `org-scoping`
 * registrar the `tenancy` service probes). ADR-0132's entitlement boundary
 * forbids every other workspace package from declaring
 * `@objectstack/organizations` (`no-framework-dependents.pin.test.ts`), so the
 * storage package — and the dogfood package, whose multi-organization blocks
 * skip for the same reason — cannot mount it. The boundary is asymmetric: this
 * package may depend on framework packages freely, so the measurement comes
 * here rather than the plugin going there. It is the smallest package that
 * boots the wall.
 *
 * ## What is real
 *
 * `bootStack` (`@objectstack/verify`): an `ObjectKernel` over in-process
 * SQLite, the Hono app every request below is injected through, the real
 * `AuthPlugin` (better-auth sessions, organizations, invitations) and
 * `SecurityPlugin`. THIS package's `OrganizationsPlugin` and the real
 * `StorageServicePlugin` are mounted the way a host mounts them. The walled
 * posture is REQUESTED through `OS_TENANCY_POSTURE=isolated` and read back off
 * the `tenancy` service the boot resolved — not assumed. The three callers are
 * made through the product's own doors: the seeded platform owner, a colleague
 * invited into the owner's organization who accepted, and an outsider who
 * created an organization of their own. Nothing is stubbed.
 *
 * The rows each door names are read back through the engine as SYSTEM, whole,
 * before and after every refused call, and compared column for column — that is
 * "writes nothing". "Discloses nothing" is the refusal body: one code, one
 * status, and nothing about the row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { OrganizationsPlugin } from './organizations-plugin.js';

const APP = {
  manifest: {
    id: 'com.example.uploadwall',
    namespace: 'uploadwall',
    version: '0.0.1',
    type: 'app',
    name: 'Upload Door Wall Fixture',
  },
  objects: [],
};

const SYS = { context: { isSystem: true } } as const;

const COLLEAGUE_EMAIL = 'upload-wall-colleague@verify.test';
const OUTSIDER_EMAIL = 'upload-wall-outsider@verify.test';

interface Answer {
  status: number;
  body: any;
}

describe('the upload doors on a booted organization wall (#22046)', () => {
  const restoreEnv: Array<[string, string | undefined]> = [];
  let rootDir: string;
  let stack: VerifyStack;
  let ql: any;
  /** The seeded platform owner — every upload below is theirs. */
  let uploader: string;
  /** Invited into the uploader's organization; not the uploader. */
  let colleague: string;
  /** Acting in an organization of their own. */
  let outsider: string;
  let uploaderOrg: string;
  let outsiderOrg: string;

  const answer = async (res: Response): Promise<Answer> => ({
    status: res.status,
    body: await res.json().catch(() => undefined),
  });
  const activeOrganization = async (token: string): Promise<string | null> => {
    const res = await stack.apiAs(token, 'GET', '/auth/get-session');
    return ((await res.json()) as any)?.session?.activeOrganizationId ?? null;
  };
  const stored = (object: string, id: string) => ql.findOne(object, { where: { id } }, SYS);

  const presign = async (): Promise<string> => {
    const res = await answer(
      await stack.apiAs(uploader, 'POST', '/storage/upload/presigned', {
        filename: 'wall-plan.txt',
        mimeType: 'text/plain',
        size: 5,
      }),
    );
    expect(res.status).toBe(200);
    return res.body.data.fileId;
  };
  const startChunked = async (): Promise<{ uploadId: string; fileId: string; resumeToken: string }> => {
    const res = await answer(
      await stack.apiAs(uploader, 'POST', '/storage/upload/chunked', {
        filename: 'wall-chunked.bin',
        mimeType: 'application/octet-stream',
        totalSize: 10,
      }),
    );
    expect(res.status).toBe(200);
    return { uploadId: res.body.data.uploadId, fileId: res.body.data.fileId, resumeToken: res.body.data.resumeToken };
  };
  /** The upload's declared 10 bytes, as chunk 0 — a completion assembles only an upload that holds them (#22313). */
  const holdTheDeclaredBytes = async (uploadId: string, resumeToken: string) => {
    const res = await stack.api(`/storage/upload/chunked/${uploadId}/chunk/0`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${uploader}`,
        'Content-Type': 'application/octet-stream',
        'x-resume-token': resumeToken,
      },
      body: new TextEncoder().encode('0123456789'),
    });
    expect(res.status, await res.clone().text()).toBe(200);
  };

  /** The one refusal: code and status, and nothing about the row. */
  const expectRefused = (res: Answer, secrets: string[], label: string) => {
    expect(res.status, label).toBe(403);
    expect(res.body?.success, label).toBe(false);
    expect(res.body?.error?.code, label).toBe('PERMISSION_DENIED');
    expect(res.body?.data, label).toBeUndefined();
    const text = JSON.stringify(res.body);
    for (const s of secrets) expect(text.includes(s), `${label}: ${s}`).toBe(false);
  };

  beforeAll(async () => {
    for (const [name, value] of [
      ['OS_TENANCY_POSTURE', 'isolated'],
      // A walled deployment must declare what a new user joins, or this
      // package's own boot gate refuses it.
      ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
    ] as const) {
      restoreEnv.push([name, process.env[name]]);
      process.env[name] = value;
    }
    rootDir = mkdtempSync(join(tmpdir(), 'upload-wall-'));
    stack = await bootStack(APP as never, {
      extraPlugins: [
        new OrganizationsPlugin(),
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });
    ql = await stack.kernel.getServiceAsync('objectql');

    uploader = await stack.signIn();
    uploaderOrg = (await activeOrganization(uploader))!;

    colleague = await stack.signUp(COLLEAGUE_EMAIL);
    const invited = await answer(
      await stack.apiAs(uploader, 'POST', '/auth/organization/invite-member', {
        email: COLLEAGUE_EMAIL,
        role: 'member',
        organizationId: uploaderOrg,
      }),
    );
    expect(invited.status).toBe(200);
    const accepted = await stack.apiAs(colleague, 'POST', '/auth/organization/accept-invitation', {
      invitationId: invited.body.id,
    });
    expect(accepted.status).toBe(200);
    expect((await stack.apiAs(colleague, 'POST', '/auth/organization/set-active', { organizationId: uploaderOrg })).status).toBe(200);

    outsider = await stack.signUp(OUTSIDER_EMAIL);
    const created = await answer(
      await stack.apiAs(outsider, 'POST', '/auth/organization/create', { name: 'Upload Wall Other', slug: 'upload-wall-other' }),
    );
    expect(created.status).toBe(200);
    outsiderOrg = created.body.id;
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    for (const [name, value] of restoreEnv.reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('PREMISE: the wall is up, and the three callers sit where the pins say they do', async () => {
    const tenancy: any = await stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(tenancy.degraded).toBe(false);

    expect(uploaderOrg).toBeTruthy();
    expect(await activeOrganization(colleague)).toBe(uploaderOrg);
    expect(await activeOrganization(outsider)).toBe(outsiderOrg);
    expect(outsiderOrg).not.toBe(uploaderOrg);

    // The rows the doors act on are stamped into the uploader's organization —
    // the wall the outsider is on the far side of.
    const fileId = await presign();
    const row = await stored('sys_file', fileId);
    expect(row.organization_id).toBe(uploaderOrg);
    expect(row.owner_id).toBeTruthy();
    const { uploadId } = await startChunked();
    expect((await stored('sys_upload_session', uploadId)).organization_id).toBe(uploaderOrg);
  });

  describe('the commit door', () => {
    const commit = (token: string, fileId: string, eTag: string) =>
      stack.apiAs(token, 'POST', '/storage/upload/complete', { fileId, eTag });

    it('SAME ORGANIZATION: a colleague is refused 403 PERMISSION_DENIED, and the row is unchanged', async () => {
      const fileId = await presign();
      const before = await stored('sys_file', fileId);
      expectRefused(await answer(await commit(colleague, fileId, 'etag-colleague')), ['wall-plan', fileId, uploaderOrg], 'colleague');
      expect(await stored('sys_file', fileId)).toEqual(before);
    });

    it('ANOTHER ORGANIZATION: an outsider gets the colleague’s body, and the row is unchanged', async () => {
      const fileId = await presign();
      const before = await stored('sys_file', fileId);
      const cross = await answer(await commit(outsider, fileId, 'etag-outsider'));
      expectRefused(cross, ['wall-plan', fileId, uploaderOrg], 'outsider');
      expect(await stored('sys_file', fileId)).toEqual(before);
      expect(cross).toEqual(await answer(await commit(colleague, fileId, 'etag-colleague')));
    });

    it('POSITIVE: the uploader commits', async () => {
      const fileId = await presign();
      const own = await answer(await stack.apiAs(uploader, 'POST', '/storage/upload/complete', { fileId, eTag: 'etag-uploader' }));
      expect(own.status).toBe(200);
      expect(own.body.data.fileId).toBe(fileId);
      const row = await stored('sys_file', fileId);
      expect(row.status).toBe('committed');
      expect(row.etag).toBe('etag-uploader');
    });
  });

  describe('the chunked-completion door', () => {
    const complete = (token: string, uploadId: string) =>
      stack.apiAs(token, 'POST', `/storage/upload/chunked/${uploadId}/complete`, { parts: [] });

    it('SAME ORGANIZATION: a colleague is refused 403 PERMISSION_DENIED, and neither row moves', async () => {
      const { uploadId, fileId } = await startChunked();
      const sessionBefore = await stored('sys_upload_session', uploadId);
      const fileBefore = await stored('sys_file', fileId);
      expectRefused(await answer(await complete(colleague, uploadId)), ['wall-chunked', fileId, uploaderOrg], 'colleague');
      expect(await stored('sys_upload_session', uploadId)).toEqual(sessionBefore);
      expect(await stored('sys_file', fileId)).toEqual(fileBefore);
    });

    it('ANOTHER ORGANIZATION: an outsider gets the colleague’s body, and neither row moves', async () => {
      const { uploadId, fileId } = await startChunked();
      const sessionBefore = await stored('sys_upload_session', uploadId);
      const fileBefore = await stored('sys_file', fileId);
      const cross = await answer(await complete(outsider, uploadId));
      expectRefused(cross, ['wall-chunked', fileId, uploaderOrg], 'outsider');
      expect(await stored('sys_upload_session', uploadId)).toEqual(sessionBefore);
      expect(await stored('sys_file', fileId)).toEqual(fileBefore);
      expect(cross).toEqual(await answer(await complete(colleague, uploadId)));
    });

    it('POSITIVE: the uploader completes', async () => {
      const { uploadId, fileId, resumeToken } = await startChunked();
      await holdTheDeclaredBytes(uploadId, resumeToken);
      const own = await answer(await stack.apiAs(uploader, 'POST', `/storage/upload/chunked/${uploadId}/complete`, { parts: [] }));
      expect(own.status).toBe(200);
      expect(own.body.data.fileId).toBe(fileId);
      expect((await stored('sys_upload_session', uploadId)).status).toBe('completed');
      expect((await stored('sys_file', fileId)).status).toBe('committed');
    });
  });

  describe('the progress door', () => {
    const progress = (token: string, uploadId: string) =>
      stack.apiAs(token, 'GET', `/storage/upload/chunked/${uploadId}/progress`);

    it('SAME ORGANIZATION: a colleague is refused 403 PERMISSION_DENIED, shown nothing, and the row is unchanged', async () => {
      const { uploadId, fileId } = await startChunked();
      const before = await stored('sys_upload_session', uploadId);
      expectRefused(await answer(await progress(colleague, uploadId)), ['wall-chunked', fileId, uploaderOrg], 'colleague');
      expect(await stored('sys_upload_session', uploadId)).toEqual(before);
    });

    it('ANOTHER ORGANIZATION: an outsider gets the colleague’s body, shown nothing, and the row is unchanged', async () => {
      const { uploadId, fileId } = await startChunked();
      const before = await stored('sys_upload_session', uploadId);
      const cross = await answer(await progress(outsider, uploadId));
      expectRefused(cross, ['wall-chunked', fileId, uploaderOrg], 'outsider');
      expect(await stored('sys_upload_session', uploadId)).toEqual(before);
      expect(cross).toEqual(await answer(await progress(colleague, uploadId)));
    });

    it('POSITIVE: the uploader reads its progress', async () => {
      const { uploadId, fileId } = await startChunked();
      const own = await answer(await stack.apiAs(uploader, 'GET', `/storage/upload/chunked/${uploadId}/progress`));
      expect(own.status).toBe(200);
      expect(own.body.data.fileId).toBe(fileId);
      expect(own.body.data.filename).toBe('wall-chunked.bin');
    });
  });
});
