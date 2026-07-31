// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FIELD-FILE COLLECTION — ADR-0104 D3 wave 2 PR-5b (#3459), driven end to end
// through a REAL boot: real storage adapter, real bytes on disk, real
// `lifecycle.sweep()`.
//
// @proof: adr0104-field-file-collection
//
// This is the only code on the platform that deletes a user's bytes, and until
// now the only proof it behaved was unit tests over fakes. Its sibling lineage
// — attachments — has had an end-to-end proof since #2755
// (attachments-permission-matrix.dogfood.test.ts); field files, which reach
// collection by a different route (exclusive ownership, released by the write
// path, gated per deployment), had none.
//
// The four properties, each the inverse of a way this could destroy data:
//
//   • CYCLE — a file released by its ONE owning record is tombstoned, and the
//     sweep reclaims the row AND the bytes once the declared window passes.
//   • REVIVAL — re-referencing inside the window brings it back; the grace
//     window is a real window, not a formality.
//   • VETO (ownership) — a tombstone that regained an owner behind the hooks'
//     back is un-tombstoned, never reaped. This is the half of PR-5b that had
//     to ship in the same change as the tombstone itself.
//   • VETO (gate) — a deployment whose migration flag has REGRESSED stops
//     collecting immediately, without a restart, because the guard re-reads
//     the flag at sweep time rather than trusting the memoized read the
//     release path uses.
//
// The gate being OPEN here is itself an assertion: this store is created from
// empty by the boot, so #3438's creation-time attestation must have closed the
// gate before any of this can run. If that regressed, the first test says so.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './fixtures/attachments-fixture.js';

const SYS = { isSystem: true } as const;
const DAY_MS = 86_400_000;
/** Past the `sys_file` tombstone TTL declared in system-file.object.ts. */
const EXPIRED = () => new Date(Date.now() - 31 * DAY_MS);

/** The probe object: one record, one file field, nothing else. */
const PROBE = 'ffc_doc';

describe('objectstack verify FIELD-FILE COLLECTION (ADR-0104 PR-5b): released files are collected, and every way of not knowing keeps them (#adr0104-field-file-collection)', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: any;
  let lifecycle: any;
  let token: string;

  /** Upload real bytes and return the `sys_file` id. Scope `user` — the field
   * lineage, deliberately NOT the attachments scope the old guardrail covered. */
  async function uploadFile(name: string): Promise<string> {
    const auth = { Authorization: `Bearer ${token}` };
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ filename: name, mimeType: 'text/plain', size: 5, scope: 'user' }),
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as any;
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
    expect(data.fileId, 'presign carried no fileId').toBeTruthy();
    return String(data.fileId);
  }

  const file = (id: string) => ql.findOne('sys_file', { where: { id }, context: SYS });
  const bytesExist = async (key: string) =>
    fs.access(join(rootDir, key)).then(() => true, () => false);

  /** Create a probe record holding `fileId` in its file field. */
  async function recordHolding(fileId: string): Promise<string> {
    const row = await ql.insert(PROBE, { name: 'probe', doc: fileId }, { context: { ...SYS } });
    return String((row as any).id ?? row);
  }

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'ffc-dogfood-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      extraPlugins: [
        // The `sys_migration` flag ledger is platform infrastructure, not a
        // storage concern (#4243) — the gate cannot be read without it.
        new PlatformObjectsPlugin(),
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    lifecycle = await stack.kernel.getServiceAsync('lifecycle');
    expect(lifecycle?.sweep, 'the lifecycle service must be registered').toBeTruthy();

    // A record object with a file field, registered against the live boot —
    // the field-reference hooks are global, so a runtime object is governed
    // exactly like an authored one.
    ql.registry.registerObject({
      name: PROBE,
      label: 'Field-file Probe',
      fields: {
        name: { type: 'text', label: 'Name' },
        doc: { type: 'file', label: 'Doc' },
      },
    });
    await ql.syncObjectSchema(PROBE);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /**
   * The precondition every other test here rests on — and a live proof of
   * #3438's creation-time attestation: this store was created from empty by
   * this boot, so the gate must already be closed. A deployment that has NOT
   * verified its migration collects nothing, which would make the rest of this
   * file pass vacuously.
   */
  it('PRECONDITION: a store created by this boot has already attested its file migration', async () => {
    const flag = await ql.findOne('sys_migration', {
      where: { id: 'adr-0104-file-references' },
      context: SYS,
    });
    expect(flag, 'no sys_migration row — creation-time attestation (#3438) regressed').toBeTruthy();
    expect(flag.verified_at, 'attested row is not verified').toBeTruthy();
    expect(Number(flag.blocking)).toBe(0);
  });

  it('CYCLE: a released field file is tombstoned, then the sweep reclaims the row and the bytes', async () => {
    const fileId = await uploadFile('cycle.txt');
    const recordId = await recordHolding(fileId);

    // Claimed by exactly one slot.
    const claimed = await file(fileId);
    expect(claimed.status).toBe('committed');
    expect(claimed.ref_object).toBe(PROBE);
    expect(String(claimed.ref_id)).toBe(recordId);
    expect(claimed.ref_field).toBe('doc');
    const key = String(claimed.key);
    expect(await bytesExist(key), 'bytes exist before release').toBe(true);

    // The owner lets go — an OBSERVED transition, which is the only thing
    // that may ever make a file collectable.
    await ql.update(PROBE, { id: recordId, doc: null }, { context: { ...SYS } });
    const released = await file(fileId);
    expect(released.status, 'release must tombstone on a verified deployment').toBe('deleted');
    expect(released.deleted_at).toBeTruthy();
    expect(released.ref_id ?? null, 'ownership is cleared on release').toBeNull();

    // Inside the window the sweep must NOT touch it.
    let report = await lifecycle.sweep();
    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
    expect((await file(fileId))?.status, 'a fresh tombstone survives the sweep').toBe('deleted');
    expect(await bytesExist(key)).toBe(true);

    // Past the window: row gone, bytes gone.
    await ql.update('sys_file', { id: fileId, deleted_at: EXPIRED() }, { context: { ...SYS } });
    report = await lifecycle.sweep();
    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
    expect(await file(fileId), 'expired tombstone reaped').toBeNull();
    expect(await bytesExist(key), 'bytes reclaimed by the guard').toBe(false);
  }, 60_000);

  it('REVIVAL: re-referencing inside the grace window brings a released file back', async () => {
    const fileId = await uploadFile('revive.txt');
    const recordId = await recordHolding(fileId);
    await ql.update(PROBE, { id: recordId, doc: null }, { context: { ...SYS } });
    expect((await file(fileId)).status).toBe('deleted');

    // The same record points at it again — a normal write, not a repair.
    await ql.update(PROBE, { id: recordId, doc: fileId }, { context: { ...SYS } });

    const revived = await file(fileId);
    expect(revived.status, 'a re-referenced file comes back to life').toBe('committed');
    expect(revived.deleted_at ?? null).toBeNull();
    expect(revived.ref_object).toBe(PROBE);
    expect(String(revived.ref_id)).toBe(recordId);

    // And it survives an expiry-driven sweep, because it is no longer a tombstone.
    const report = await lifecycle.sweep();
    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
    expect((await file(fileId))?.status).toBe('committed');
  }, 60_000);

  /**
   * The half of PR-5b that had to ship in the same change as the tombstone.
   * Tombstoning released files while the guard re-verified only
   * `sys_attachment` — always empty for a field file — would have made every
   * release a GUARANTEED byte delete rather than a risky one.
   */
  it('VETO (ownership): a tombstone that regained an owner behind the hooks is un-tombstoned, not reaped', async () => {
    const fileId = await uploadFile('undead.txt');
    const recordId = await recordHolding(fileId);
    await ql.update(PROBE, { id: recordId, doc: null }, { context: { ...SYS } });
    const tombstoned = await file(fileId);
    expect(tombstoned.status).toBe('deleted');
    const key = String(tombstoned.key);

    // Hook-bypass re-claim: a DIRECT DRIVER write, so no after-hook can
    // un-tombstone it. Only the guard's own sweep-time re-verify can catch
    // this — which is exactly the property under test.
    const driver = ql.getDriverForObject('sys_file');
    await driver.update('sys_file', fileId, {
      ref_object: PROBE,
      ref_id: recordId,
      ref_field: 'doc',
    });
    await ql.update('sys_file', { id: fileId, deleted_at: EXPIRED() }, { context: { ...SYS } });

    const report = await lifecycle.sweep();
    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);

    const survived = await file(fileId);
    expect(survived, 'an owned file must never be reaped').toBeTruthy();
    expect(survived.status, 'the guard un-tombstones what regained an owner').toBe('committed');
    expect(survived.deleted_at ?? null).toBeNull();
    expect(await bytesExist(key), 'bytes untouched').toBe(true);
  }, 60_000);

  /**
   * A deployment whose data has drifted closes its own gate — and must do so
   * for tombstones ALREADY written, without waiting for a restart. That is why
   * the guard re-reads the flag at sweep time instead of trusting the release
   * path's memoized read.
   */
  it('VETO (gate): a regressed migration flag stops collection immediately, tombstones and all', async () => {
    const fileId = await uploadFile('gated.txt');
    const recordId = await recordHolding(fileId);
    await ql.update(PROBE, { id: recordId, doc: null }, { context: { ...SYS } });
    expect((await file(fileId)).status).toBe('deleted');
    const key = String(file ? String((await file(fileId)).key) : '');
    await ql.update('sys_file', { id: fileId, deleted_at: EXPIRED() }, { context: { ...SYS } });

    // What a later FAILING `os migrate files-to-references --apply` records.
    await ql.update(
      'sys_migration',
      { id: 'adr-0104-file-references', verified_at: null, blocking: 3 },
      { context: { ...SYS } },
    );
    try {
      const report = await lifecycle.sweep();
      expect(report.errors, JSON.stringify(report.errors)).toEqual([]);

      const kept = await file(fileId);
      expect(kept, 'a closed gate must keep an expired tombstone').toBeTruthy();
      expect(kept.status, 'the release stands; only permission to delete is withheld').toBe('deleted');
      expect(await bytesExist(key), 'bytes kept while the gate is closed').toBe(true);
    } finally {
      await ql.update(
        'sys_migration',
        { id: 'adr-0104-file-references', verified_at: new Date(), blocking: 0 },
        { context: { ...SYS } },
      );
      ql.invalidateDataMigrationFlags?.();
    }

    // Re-verified: the same row is now collectable, proving the veto was the
    // gate and nothing else.
    const report = await lifecycle.sweep();
    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
    expect(await file(fileId), 'reaped once the gate is open again').toBeNull();
    expect(await bytesExist(key)).toBe(false);
  }, 60_000);
});
