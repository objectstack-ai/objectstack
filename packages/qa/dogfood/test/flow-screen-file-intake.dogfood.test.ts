// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW SCREEN FILE INTAKE (#25801) — a flat screen collects a file before the
// record that will own it exists, and the write after the screen claims it.
// Driven end to end through a REAL boot: real storage adapter, real bytes on
// disk, the real trigger and resume doors, as a plain member.
//
// The chain, each link asserted where it lands rather than as "no error":
//
//   • the paused screen tells a client the field is a FILE (`type: 'file'` on
//     the wire), so the console knows to render the upload widget;
//   • the upload lands as a `sys_file` no record owns yet — the one-file,
//     one-owner rule met by unattached-then-claimed (ADR-0104 D3);
//   • the resume door admits the file's id and nothing else: a URL is refused
//     400 `INVALID_SCREEN_INPUT` before anything is written, and the pause
//     survives it;
//   • the resume with the id runs the `create_record` after the screen, which
//     stores the id in the record's `file` field and CLAIMS the file for that
//     record — `ref_object` / `ref_id` / `ref_field` on the `sys_file` row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { screenFileStack, screenFileFixtureSecurity } from './fixtures/flow-screen-file-fixture.js';

const SYS = { isSystem: true } as const;
const FLOW = 'sfi_contract_intake';

describe('objectstack verify FLOW SCREEN FILE INTAKE (#25801): a screen collects a file, the write after it claims the file', () => {
  let stack: VerifyStack;
  let ql: any;
  let memberTok: string;

  /** Upload real bytes as `token` and return the `sys_file` id (scope `user`, the field lineage). */
  async function uploadFile(token: string, name: string): Promise<string> {
    const auth = { Authorization: `Bearer ${token}` };
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ filename: name, mimeType: 'application/pdf', size: 5, scope: 'user' }),
    });
    expect(presign.status, `presign: ${await presign.clone().text()}`).toBe(200);
    const { data } = (await presign.json()) as any;
    expect(data.fileId, 'presign carried no fileId').toBeTruthy();
    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: data.headers ?? { 'content-type': 'application/pdf' },
      body: '%PDF-',
    });
    expect(put.status, 'raw PUT').toBeLessThan(300);
    const complete = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ fileId: data.fileId }),
    });
    expect(complete.status, `complete: ${await complete.clone().text()}`).toBe(200);
    return String(data.fileId);
  }

  const file = (id: string) => ql.findOne('sys_file', { where: { id }, context: SYS });
  const contractsNamed = (name: string) => ql.find('sfi_contract', { where: { name }, context: SYS });

  /** Trigger the intake flow as `token`; returns the paused result. */
  async function start(token: string): Promise<any> {
    const triggered = await stack.apiAs(token, 'POST', `/automation/${FLOW}/trigger`, { params: {} });
    expect(triggered.status, await triggered.clone().text()).toBeLessThan(300);
    const tj = (await triggered.json()) as any;
    const result = tj.result ?? tj.data ?? tj;
    expect(result.status).toBe('paused');
    expect(result.runId, 'no runId on the paused result').toBeTruthy();
    return result;
  }

  const resume = (token: string, runId: string, inputs: Record<string, unknown>) =>
    stack.apiAs(token, 'POST', `/automation/${FLOW}/runs/${runId}/resume`, { inputs });

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sfi-dogfood-'));
    stack = await bootStack(screenFileStack as never, {
      automation: true,
      security: screenFileFixtureSecurity(),
      extraPlugins: [
        // The `sys_migration` flag ledger the file-reference lifecycle reads (#4243).
        new PlatformObjectsPlugin(),
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });
    // The seeded admin first, so the sign-up below is a plain member who
    // resolves to the fixture's fallback grant.
    await stack.signIn();
    memberTok = await stack.signUp('sfi-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the paused screen carries the field as `type: \'file\'`, and nothing is written yet', async () => {
    const paused = await start(memberTok);
    const field = (paused.screen?.fields ?? []).find((f: any) => f.name === 'contract_file');
    expect(field, `no contract_file on the paused screen: ${JSON.stringify(paused.screen)}`).toBeTruthy();
    expect(field.type).toBe('file');
    expect(field.required).toBe(true);
    expect(await contractsNamed('never written')).toEqual([]);
  });

  it('an upload lands as a file no record owns yet', async () => {
    const fileId = await uploadFile(memberTok, 'unowned.pdf');
    const row = await file(fileId);
    expect(row, 'the upload left no sys_file row').toBeTruthy();
    expect(row.ref_object ?? null, 'a fresh upload is owned by no record').toBeNull();
    expect(row.ref_id ?? null).toBeNull();
  });

  it('refuses a resume that carries a URL, writes nothing, and keeps the pause for the id', async () => {
    const fileId = await uploadFile(memberTok, 'nda.pdf');
    const { runId } = await start(memberTok);

    for (const wrong of [`/api/v1/storage/files/${fileId}`, { id: fileId, name: 'nda.pdf', url: '/x' }]) {
      const refused = await resume(memberTok, runId, { contract_name: 'NDA refused', contract_file: wrong });
      expect(refused.status, JSON.stringify(wrong)).toBe(400);
      const text = await refused.text();
      expect(text).toContain('INVALID_SCREEN_INPUT');
      expect(text).toContain('contract_file');
    }
    expect(await contractsNamed('NDA refused'), 'a refused resume wrote a record').toEqual([]);
    expect((await file(fileId)).ref_id ?? null, 'a refused resume claimed the file').toBeNull();

    // Refused, not consumed: the corrected submission lands on the same run.
    const resumed = await resume(memberTok, runId, { contract_name: 'NDA refused', contract_file: fileId });
    expect(resumed.status, await resumed.clone().text()).toBeLessThan(300);
    expect(await contractsNamed('NDA refused')).toHaveLength(1);
  });

  it('a resume with the file id writes the record and claims the file for it', async () => {
    const fileId = await uploadFile(memberTok, 'msa.pdf');
    const { runId } = await start(memberTok);

    const resumed = await resume(memberTok, runId, { contract_name: 'MSA 2026', contract_file: fileId });
    expect(resumed.status, await resumed.clone().text()).toBeLessThan(300);

    // The record the end of the wizard wrote holds the file — the stored id,
    // which the read path expands into the `{ id, name, url, … }` read form.
    const rows = await contractsNamed('MSA 2026');
    expect(rows).toHaveLength(1);
    const recordId = String(rows[0].id);
    expect(rows[0].doc).toMatchObject({ id: fileId, name: 'msa.pdf' });

    // …and that write claimed the file for the record: one file, one owner.
    const claimed = await file(fileId);
    expect(claimed.status).toBe('committed');
    expect(claimed.ref_object).toBe('sfi_contract');
    expect(String(claimed.ref_id)).toBe(recordId);
    expect(claimed.ref_field).toBe('doc');

    // The member reads their record back with the file in it, through the data door.
    const read = await stack.apiAs(memberTok, 'GET', `/data/sfi_contract/${recordId}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const body = (await read.json()) as any;
    expect((body.record ?? body).doc).toMatchObject({ id: fileId, name: 'msa.pdf' });
  }, 60_000);
});
