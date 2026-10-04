// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A file field's declared `accept` / `maxSize` refusal, end to end through the
// real stack: storage service's copy-on-claim before-hook
// (`assertFileConstraints`, `FileConstraintError`) → ObjectQL triggerHooks →
// REST `mapDataError` → HTTP body.
//
// ── What this pins ──────────────────────────────────────────────────────────
//
// The refusal is a verdict about the CALLER's own file — wrong type, too big —
// so it answers `400 ERR_FILE_CONSTRAINT` with a sentence naming the field and
// the constraint. Before `FileConstraintError` declared its `status`, the
// declared-status passthrough never fired and the same refusal left through the
// unclassified-fault terminal as `500 INTERNAL_ERROR` with the sentence
// withheld: enforcement held, the wire contract did not.
//
// ── Why each assertion is load-bearing ──────────────────────────────────────
//
//   `code` AND `status` (ADR-0112). A bare status cannot tell this verdict
//   apart from any other 400 the data door gives.
//
//   The READ-BACK, not the response. A write that answers 400 and lands anyway
//   satisfies a response-only assertion perfectly, so every refusal re-reads
//   the object's rows and the `sys_file` ownership columns under a system
//   context.
//
//   The SMALL-PDF CONTROL, on the same field. Without it the refusal cases pass
//   just as well when every file write is refused for an unrelated reason.
//
// The sentence is asserted by its NAMED SUBJECTS only — the field and the
// constraint — never its full wording: the field and the constraint reach the
// wire through the message alone (the declared-status passthrough forwards
// `status`, the registered `code` and the bounded message, and no other member
// of the thrown error).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field, RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
import { StorageServicePlugin } from '@objectstack/service-storage';

const SYS = { isSystem: true } as const;
const OBJECT = 'ffc_doc';

const FfcDoc = ObjectSchema.create({
  name: OBJECT,
  label: 'Constrained Document',
  fields: {
    name: Field.text({ label: 'Name' }),
    doc: Field.file({ label: 'Document', accept: ['.pdf'], maxSize: 10 }),
  },
});

const ffcStack = defineStack({
  manifest: {
    id: 'com.dogfood.file-field-constraint-refusal',
    namespace: 'ffc',
    version: '0.0.0',
    type: 'app',
    name: 'File Field Constraint Refusal Fixture',
    description: 'A file field declaring accept and maxSize, written through the data API.',
  },
  objects: [FfcDoc],
});

/** The three `sys_file` rows the cases reference — one per verdict. */
const FILES = {
  wrongType: { id: 'ffc_file_txt', name: 'notes.txt', mime_type: 'text/plain', size: 6 },
  oversize: { id: 'ffc_file_big', name: 'big.pdf', mime_type: 'application/pdf', size: 5005 },
  smallPdf: { id: 'ffc_file_ok', name: 'small.pdf', mime_type: 'application/pdf', size: 6 },
  smallPdf2: { id: 'ffc_file_ok2', name: 'small2.pdf', mime_type: 'application/pdf', size: 6 },
} as const;

describe('a file field\'s accept / maxSize refusal answers 400 ERR_FILE_CONSTRAINT', () => {
  let stack: VerifyStack;
  let token: string;
  let ql: any;

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'ffc-pin-'));
    stack = await bootStack(ffcStack, {
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    for (const f of Object.values(FILES)) {
      await ql.insert(
        'sys_file',
        { ...f, key: `user/${f.id}`, status: 'committed', scope: 'user' },
        { context: SYS },
      );
    }
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  const write = async (method: 'POST' | 'PATCH', path: string, data: Record<string, unknown>) => {
    const res = await stack.apiAs(token, method, path, data);
    return { status: res.status, body: (await res.json()) as any };
  };

  /** The rows named `name`, read above every access layer. */
  const rowsNamed = async (name: string) =>
    ql.find(OBJECT, { where: { name }, context: { ...SYS, [RAW_FILE_VALUES_CONTEXT_KEY]: true } });

  /** The `sys_file` ownership columns, read above every access layer. */
  const owner = async (id: string) => {
    const row = await ql.findOne('sys_file', { where: { id }, context: SYS });
    return { ref_object: row?.ref_object ?? null, ref_id: row?.ref_id ?? null, ref_field: row?.ref_field ?? null };
  };
  const UNOWNED = { ref_object: null, ref_id: null, ref_field: null };

  let controlId: string;

  it('a file outside the accept list answers 400 ERR_FILE_CONSTRAINT naming the field and the accept list, and writes no row', async () => {
    const r = await write('POST', `/data/${OBJECT}`, { name: 'wrong type', doc: FILES.wrongType.id });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('ERR_FILE_CONSTRAINT');
    expect(r.body.error).toContain("'doc'");
    expect(r.body.error).toContain('accept list');
    expect(r.body.object).toBe(OBJECT);

    expect(await rowsNamed('wrong type')).toHaveLength(0);
    expect(await owner(FILES.wrongType.id)).toEqual(UNOWNED);
  });

  it('a file over maxSize answers 400 ERR_FILE_CONSTRAINT naming the field and the maximum size, and writes no row', async () => {
    const r = await write('POST', `/data/${OBJECT}`, { name: 'oversize', doc: FILES.oversize.id });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('ERR_FILE_CONSTRAINT');
    expect(r.body.error).toContain("'doc'");
    expect(r.body.error).toContain('maximum size');
    expect(r.body.object).toBe(OBJECT);

    expect(await rowsNamed('oversize')).toHaveLength(0);
    expect(await owner(FILES.oversize.id)).toEqual(UNOWNED);
  });

  it('control: a 6-byte PDF satisfies both declarations, answers 201, and is claimed by the row', async () => {
    const r = await write('POST', `/data/${OBJECT}`, { name: 'control', doc: FILES.smallPdf.id });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    controlId = r.body.record?.id ?? r.body.id;
    expect(controlId).toBeTruthy();

    const stored = await rowsNamed('control');
    expect(stored).toHaveLength(1);
    expect(stored[0].doc).toBe(FILES.smallPdf.id);
    expect(await owner(FILES.smallPdf.id)).toEqual({ ref_object: OBJECT, ref_id: controlId, ref_field: 'doc' });
  });

  it('an UPDATE onto an oversize file is refused the same way and leaves the record and both files as they were', async () => {
    const r = await write('PATCH', `/data/${OBJECT}/${controlId}`, { doc: FILES.oversize.id });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe('ERR_FILE_CONSTRAINT');
    expect(r.body.error).toContain("'doc'");
    expect(r.body.error).toContain('maximum size');

    const stored = await rowsNamed('control');
    expect(stored).toHaveLength(1);
    expect(stored[0].doc).toBe(FILES.smallPdf.id);
    expect(await owner(FILES.smallPdf.id)).toEqual({ ref_object: OBJECT, ref_id: controlId, ref_field: 'doc' });
    expect(await owner(FILES.oversize.id)).toEqual(UNOWNED);
  });

  it('control: an UPDATE onto a permitted file still lands', async () => {
    const r = await write('PATCH', `/data/${OBJECT}/${controlId}`, { doc: FILES.smallPdf2.id });

    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const stored = await rowsNamed('control');
    expect(stored[0].doc).toBe(FILES.smallPdf2.id);
  });
});
