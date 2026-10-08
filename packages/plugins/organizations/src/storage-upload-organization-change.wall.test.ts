// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22175 — an uploader whose ACTIVE organization changed after starting an
 * upload, measured on a BOOTED organization wall.
 *
 * The commit door (`POST …/upload/complete`) and the chunked-completion door
 * (`POST …/upload/chunked/:uploadId/complete`) write by id, and those writes
 * are scoped to the caller's active organization. A row stamped for the
 * organization the upload started in is out of that scope's reach once the
 * uploader switches, and the doors used to answer the scoped miss as
 * `500 INTERNAL` with a message diagnosing a data-engine outage. They now ask
 * the store whether that write can reach the row (`organizationOutOfWriteReach`)
 * before any write and answer `409 RESOURCE_CONFLICT`, in the ADR-0112
 * envelope, with a message that names the organization change. Which
 * organization an upload belongs to is NOT changed: switching back finishes it,
 * from where it started.
 *
 * Same boot as `storage-upload-door-ownership.wall.test.ts` (and the same
 * reason this file lives in this package: the wall is raised by THIS
 * package's `OrganizationsPlugin`, which ADR-0132 forbids every other
 * workspace package from mounting). One caller: the seeded platform owner,
 * who holds two organizations and switches between them through the
 * product's own `set-active` door. Nothing is stubbed.
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
    id: 'com.example.uploadorgchange',
    namespace: 'uploadorgchange',
    version: '0.0.1',
    type: 'app',
    name: 'Upload Organization Change Fixture',
  },
  objects: [],
};

const SYS = { context: { isSystem: true } } as const;

interface Answer {
  status: number;
  body: any;
}

describe('the upload doors after the uploader switches organization, on a booted wall (#22175)', () => {
  const restoreEnv: Array<[string, string | undefined]> = [];
  let rootDir: string;
  let stack: VerifyStack;
  let ql: any;
  /** The seeded platform owner — the uploader throughout. */
  let uploader: string;
  /** The organization every upload below is started in. */
  let startOrg: string;
  /** The uploader's second organization — where they switch to. */
  let otherOrg: string;

  const answer = async (res: Response): Promise<Answer> => ({
    status: res.status,
    body: await res.json().catch(() => undefined),
  });
  const activeOrganization = async (): Promise<string | null> => {
    const res = await stack.apiAs(uploader, 'GET', '/auth/get-session');
    return ((await res.json()) as any)?.session?.activeOrganizationId ?? null;
  };
  const switchTo = async (organizationId: string): Promise<void> => {
    const res = await stack.apiAs(uploader, 'POST', '/auth/organization/set-active', { organizationId });
    expect(res.status).toBe(200);
    expect(await activeOrganization()).toBe(organizationId);
  };
  const stored = (object: string, id: string) => ql.findOne(object, { where: { id } }, SYS);

  const presign = async (): Promise<string> => {
    const res = await answer(
      await stack.apiAs(uploader, 'POST', '/storage/upload/presigned', {
        filename: 'org-change-plan.txt',
        mimeType: 'text/plain',
        size: 5,
      }),
    );
    expect(res.status).toBe(200);
    return res.body.data.fileId;
  };
  const startChunked = async (): Promise<{ uploadId: string; fileId: string }> => {
    const res = await answer(
      await stack.apiAs(uploader, 'POST', '/storage/upload/chunked', {
        filename: 'org-change-chunked.bin',
        mimeType: 'application/octet-stream',
        totalSize: 10,
      }),
    );
    expect(res.status).toBe(200);
    return { uploadId: res.body.data.uploadId, fileId: res.body.data.fileId };
  };

  /**
   * The organization-change answer: a 4xx in the declared envelope, its code,
   * and a message that names the change — never the `500` an engine outage
   * answers, nor that outage's prescription.
   */
  const expectOrganizationChanged = (res: Answer, label: string) => {
    const seen = `${label}: ${JSON.stringify(res.body)}`;
    expect(res.status, seen).toBe(409);
    expect(res.body?.success, seen).toBe(false);
    expect(res.body?.error?.code, seen).toBe('RESOURCE_CONFLICT');
    expect(res.body?.data, seen).toBeUndefined();
    expect(res.body?.error?.message, seen).toMatch(/started in a different organization/);
    expect(res.body?.error?.message, seen).not.toMatch(/data engine/);
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
    rootDir = mkdtempSync(join(tmpdir(), 'upload-org-change-'));
    stack = await bootStack(APP as never, {
      extraPlugins: [
        new OrganizationsPlugin(),
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });
    ql = await stack.kernel.getServiceAsync('objectql');

    uploader = await stack.signIn();
    startOrg = (await activeOrganization())!;
    const created = await answer(
      await stack.apiAs(uploader, 'POST', '/auth/organization/create', {
        name: 'Upload Org Change Second',
        slug: 'upload-org-change-second',
      }),
    );
    expect(created.status).toBe(200);
    otherOrg = created.body.id;
    await switchTo(startOrg);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    for (const [name, value] of restoreEnv.reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('PREMISE: the wall is up, the uploader holds two organizations, and uploads are stamped where they start', async () => {
    const tenancy: any = await stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.isolationActive).toBe(true);
    expect(tenancy.degraded).toBe(false);

    expect(startOrg).toBeTruthy();
    expect(otherOrg).toBeTruthy();
    expect(otherOrg).not.toBe(startOrg);

    await switchTo(startOrg);
    const fileId = await presign();
    expect((await stored('sys_file', fileId)).organization_id).toBe(startOrg);
    const { uploadId } = await startChunked();
    expect((await stored('sys_upload_session', uploadId)).organization_id).toBe(startOrg);
  });

  describe('the commit door', () => {
    const commit = (fileId: string, eTag: string) =>
      stack.apiAs(uploader, 'POST', '/storage/upload/complete', { fileId, eTag });

    it('ORGANIZATION CHANGED: 409 RESOURCE_CONFLICT naming the change, not 500; the row is unchanged; switching back commits it', async () => {
      await switchTo(startOrg);
      const fileId = await presign();
      const before = await stored('sys_file', fileId);

      await switchTo(otherOrg);
      expectOrganizationChanged(await answer(await commit(fileId, 'etag-elsewhere')), 'commit after switching');
      expect(await stored('sys_file', fileId)).toEqual(before);

      // The upload still belongs where it started, and finishes there.
      await switchTo(startOrg);
      const home = await answer(await commit(fileId, 'etag-home'));
      expect(home.status, JSON.stringify(home.body)).toBe(200);
      const row = await stored('sys_file', fileId);
      expect(row.status).toBe('committed');
      expect(row.etag).toBe('etag-home');
      expect(row.organization_id).toBe(startOrg);
    });

    it('CONTROL — SAME ORGANIZATION: the uploader commits exactly as before', async () => {
      await switchTo(startOrg);
      const fileId = await presign();
      const own = await answer(await commit(fileId, 'etag-same'));
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.data.fileId).toBe(fileId);
      expect((await stored('sys_file', fileId)).status).toBe('committed');
    });
  });

  describe('the chunked-completion door', () => {
    const complete = (uploadId: string) =>
      stack.apiAs(uploader, 'POST', `/storage/upload/chunked/${uploadId}/complete`, { parts: [] });

    it('ORGANIZATION CHANGED: 409 RESOURCE_CONFLICT naming the change, not 500; neither row moves; switching back completes it', async () => {
      await switchTo(startOrg);
      const { uploadId, fileId } = await startChunked();
      const sessionBefore = await stored('sys_upload_session', uploadId);
      const fileBefore = await stored('sys_file', fileId);

      await switchTo(otherOrg);
      expectOrganizationChanged(await answer(await complete(uploadId)), 'chunked completion after switching');
      expect(await stored('sys_upload_session', uploadId)).toEqual(sessionBefore);
      expect(await stored('sys_file', fileId)).toEqual(fileBefore);

      await switchTo(startOrg);
      const home = await answer(await complete(uploadId));
      expect(home.status, JSON.stringify(home.body)).toBe(200);
      expect((await stored('sys_upload_session', uploadId)).status).toBe('completed');
      const file = await stored('sys_file', fileId);
      expect(file.status).toBe('committed');
      expect(file.organization_id).toBe(startOrg);
    });

    it('CONTROL — SAME ORGANIZATION: the uploader completes exactly as before', async () => {
      await switchTo(startOrg);
      const { uploadId, fileId } = await startChunked();
      const own = await answer(await complete(uploadId));
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.data.fileId).toBe(fileId);
      expect((await stored('sys_upload_session', uploadId)).status).toBe('completed');
      expect((await stored('sys_file', fileId)).status).toBe('committed');
    });
  });

  it('UNCHANGED — the progress door still answers the uploader after the switch (a read; no write is due)', async () => {
    await switchTo(startOrg);
    const { uploadId, fileId } = await startChunked();
    await switchTo(otherOrg);
    const progress = await answer(await stack.apiAs(uploader, 'GET', `/storage/upload/chunked/${uploadId}/progress`));
    expect(progress.status, JSON.stringify(progress.body)).toBe(200);
    expect(progress.body.data.fileId).toBe(fileId);
    expect(progress.body.data.status).toBe('in_progress');
    await switchTo(startOrg);
  });
});
