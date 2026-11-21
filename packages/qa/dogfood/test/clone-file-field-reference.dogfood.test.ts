// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `POST /data/:object/:id/clone` on a record whose file fields are set, end to
// end through the real stack: REST clone door → `cloneData` → ObjectQL insert
// → the storage service's field-reference copy-on-claim hooks, with real bytes
// on a local adapter.
//
// ── What this pins ──────────────────────────────────────────────────────────
//
// A clone with no body answers 201, and every file-class field of the copy
// references the source's file the way any write naming an already-owned
// `sys_file` id does (ADR-0104 D3 wave 2, exclusive ownership): the bytes are
// copied into a fresh `sys_file`, the copy is owned by the clone's slot, and
// the source keeps its own file. Covered: a single `file`, a `multiple: true`
// `file`, and an `image` — the multi-capable pair and one more member of
// `FILE_REFERENCE_TYPES`.
//
// The defect this guards: `cloneData` read the source through the caller's
// expanded read, which serves a file field as the `{ id, name, size, mimeType,
// url }` object, and re-inserted that object; the media value-shape check
// refused it with 400 "… has an invalid file value: … expected string,
// received object".
//
// ── Why each assertion is load-bearing ──────────────────────────────────────
//
//   The CONTROL is the `overrides` workaround — the same clone naming the
//   source's ids explicitly — which answered 201 before the fix. The plain
//   clone is held to the SAME reference rule the control demonstrates (a new
//   id, owned by the clone, same bytes), so the pin cannot pass by inventing a
//   second ownership rule.
//
//   The READ-BACK of the stored form (`RAW_FILE_VALUES_CONTEXT_KEY`) and of
//   `sys_file`'s ownership columns, under a system context: the 201 body alone
//   would not show which file the clone's slot holds.
//
//   `overrides` still wins: a file field named in `overrides` takes the
//   override, not the source's file.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field, RAW_FILE_VALUES_CONTEXT_KEY, isFileIdToken } from '@objectstack/spec/data';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';

const SYS = { isSystem: true } as const;
const RAW = { ...SYS, [RAW_FILE_VALUES_CONTEXT_KEY]: true } as const;
const OBJECT = 'cff_doc';

const CffDoc = ObjectSchema.create({
  name: OBJECT,
  label: 'Clone File Document',
  fields: {
    name: Field.text({ label: 'Name' }),
    report: Field.file({ label: 'Report' }),
    papers: Field.file({ label: 'Papers', multiple: true }),
    cover: Field.image({ label: 'Cover' }),
  },
});

const cffStack = defineStack({
  manifest: {
    id: 'com.dogfood.clone-file-field-reference',
    namespace: 'cff',
    version: '0.0.0',
    type: 'app',
    name: 'Clone File Field Reference Fixture',
    description: 'An object with single, multiple and image file fields, cloned through the data API.',
  },
  objects: [CffDoc],
});

describe('POST /data/:object/:id/clone on a record whose file fields are set', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let token: string;
  let ql: any;

  /** Upload real bytes through presign → PUT → complete; returns the `sys_file` id. */
  async function upload(name: string, body: string, mimeType: string): Promise<string> {
    const auth = { Authorization: `Bearer ${token}` };
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ filename: name, mimeType, size: body.length, scope: 'user' }),
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as any;
    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: data.headers ?? { 'content-type': mimeType },
      body,
    });
    expect(put.status, 'raw PUT').toBeLessThan(300);
    const complete = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ fileId: data.fileId }),
    });
    expect(complete.status, 'complete').toBe(200);
    return String(data.fileId);
  }

  const call = async (method: 'POST', path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, body: (await res.json()) as any };
  };

  /** The record's file fields in their STORED form, read above every access layer. */
  const stored = async (id: string) => ql.findOne(OBJECT, { where: { id }, context: RAW });

  /** A `sys_file` row's owner and bytes, read above every access layer. */
  const fileState = async (id: string) => {
    const row = await ql.findOne('sys_file', { where: { id }, context: SYS });
    expect(row, `sys_file ${id} exists`).toBeTruthy();
    const bytes = await fs.readFile(join(rootDir, String(row.key)), 'utf8');
    return { owner: [row.ref_object, String(row.ref_id), row.ref_field], bytes };
  };

  /** Create a source record through the data door with every file field set. */
  async function sourceRecord(tag: string) {
    const files = {
      report: await upload(`${tag}-report.txt`, `${tag} report`, 'text/plain'),
      papers: [
        await upload(`${tag}-a.txt`, `${tag} paper a`, 'text/plain'),
        await upload(`${tag}-b.txt`, `${tag} paper b`, 'text/plain'),
      ],
      cover: await upload(`${tag}-cover.png`, `${tag} cover`, 'image/png'),
    };
    const created = await call('POST', `/data/${OBJECT}`, { name: tag, ...files });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = String(created.body.id ?? created.body.data?.id ?? created.body.record?.id);
    // The source owns every file it names.
    expect((await fileState(files.report)).owner).toEqual([OBJECT, id, 'report']);
    expect((await fileState(files.papers[0])).owner).toEqual([OBJECT, id, 'papers']);
    expect((await fileState(files.cover)).owner).toEqual([OBJECT, id, 'cover']);
    return { id, files };
  }

  /** The clone's id from a 201 clone answer. */
  const cloneIdOf = (body: any) => String(body.id ?? body.data?.id ?? body.record?.id);

  /**
   * Every file field of the clone holds a NEW `sys_file` id, owned by the
   * clone's slot, carrying the source file's bytes — and the source still owns
   * its own file. The exclusive-ownership copy rule, per value.
   */
  async function expectCopiedPerReferenceRule(source: { id: string; files: any }, cloneId: string) {
    const copy = await stored(cloneId);
    const pairs: Array<[string, string, string]> = [
      ['report', source.files.report, copy.report],
      ['papers', source.files.papers[0], copy.papers?.[0]],
      ['papers', source.files.papers[1], copy.papers?.[1]],
      ['cover', source.files.cover, copy.cover],
    ];
    expect(Array.isArray(copy.papers) ? copy.papers.length : copy.papers).toBe(2);
    for (const [field, srcId, copyId] of pairs) {
      expect(isFileIdToken(copyId), `${field}: the clone stores a file id, got ${JSON.stringify(copyId)}`).toBe(true);
      expect(copyId, `${field}: the clone references its own copy, not the source's file`).not.toBe(srcId);
      const src = await fileState(srcId);
      const dst = await fileState(copyId);
      expect(src.owner, `${field}: the source keeps its file`).toEqual([OBJECT, source.id, field]);
      expect(dst.owner, `${field}: the copy is owned by the clone's slot`).toEqual([OBJECT, cloneId, field]);
      expect(dst.bytes, `${field}: the copy carries the source's bytes`).toBe(src.bytes);
    }
  }

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cff-dogfood-'));
    stack = await bootStack(cffStack, {
      extraPlugins: [
        // The `sys_migration` flag ledger (#4243): a store created by this boot
        // attests its file migration, so the media value-shape check enforces.
        new PlatformObjectsPlugin(),
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('CONTROL: a clone whose overrides name the source file ids answers 201 and copies every file', async () => {
    const source = await sourceRecord('ctl');
    const r = await call('POST', `/data/${OBJECT}/${source.id}/clone`, { overrides: { ...source.files } });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await expectCopiedPerReferenceRule(source, cloneIdOf(r.body));
  });

  it('a clone with no body answers 201, and its file fields follow the same copy rule', async () => {
    const source = await sourceRecord('bare');
    const r = await call('POST', `/data/${OBJECT}/${source.id}/clone`);

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const cloneId = cloneIdOf(r.body);
    expect(cloneId).not.toBe(source.id);
    await expectCopiedPerReferenceRule(source, cloneId);
  });

  it('a file field named in overrides takes the override, not the source file', async () => {
    const source = await sourceRecord('ovr');
    const replacement = await upload('ovr-replacement.txt', 'replacement', 'text/plain');
    const r = await call('POST', `/data/${OBJECT}/${source.id}/clone`, {
      overrides: { report: replacement, papers: null },
    });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const cloneId = cloneIdOf(r.body);
    const copy = await stored(cloneId);
    // An unowned upload is claimed by the clone's slot as it stands — no copy.
    expect(copy.report).toBe(replacement);
    expect((await fileState(replacement)).owner).toEqual([OBJECT, cloneId, 'report']);
    expect(copy.papers ?? null).toBeNull();
    // The field the overrides left alone still follows the copy rule.
    expect(isFileIdToken(copy.cover)).toBe(true);
    expect(copy.cover).not.toBe(source.files.cover);
    expect((await fileState(copy.cover)).owner).toEqual([OBJECT, cloneId, 'cover']);
    // The source is untouched.
    expect((await fileState(source.files.report)).owner).toEqual([OBJECT, source.id, 'report']);
  });
});
