// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22694] An import row answers a sandboxed hook's refusal in the hook's own
 * words — the sentence `POST /data/:object` answers — never the QuickJS debug
 * wrapper.
 *
 * ## What was measured broken
 *
 * A `beforeInsert` hook body throwing `new Error('Locked rows cannot be created
 * by import.')` on a booted stack: `POST /data/:object` and `/createMany`
 * answered the sentence, while `POST /data/:object/import` answered `200` with
 * `results[0].error` = `hook 'mz_lock_insert' threw: Error: Locked rows …`
 * (`IMPORT_ROW_FAILED`), and the async job's stored row read the same.
 * `toFailedResult` built the row from `.message`; it now reads
 * `sandboxBusinessMessage`, the read every other door makes.
 *
 * ## What is driven
 *
 * The real `runImport` on each write path that can meet a hook — the inline
 * `createData` path, the batched `createManyData` path degraded to per-row
 * writes, the partial-success `insertManyData` outcomes, and the update half of
 * an upsert. The thrown error is the shape `runtime/src/sandbox/quickjs-runner.ts`
 * produces (`.message` the wrapper, `.innerMessage` the sentence), reproduced
 * here because `@objectstack/core` sits below `@objectstack/runtime`. The REST
 * doors over the real handlers are pinned in
 * `packages/rest/src/rest-write-route-hook-refusal-sentence.ledger.test.ts`.
 *
 * §3 pins door-to-row agreement directly: the row's sentence IS what
 * `mapDataError` (the create door) answers for the same error, including for a
 * sentence `sanitizeRowError` would have paraphrased. §4 holds the controls.
 */

import { describe, it, expect, vi } from 'vitest';
import { mapDataError } from '@objectstack/types';
import { runImport, sanitizeRowError, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type CreateArgs = Parameters<ImportProtocolLike['createData']>[0];

const OBJECT = 'mz_locked';
const SENTENCE = 'Locked rows cannot be created by import.';

/** The `SandboxError` shape a refusing hook body produces. */
function sandboxRefusal(sentence: string, extra: Record<string, unknown> = {}): Error {
  const err = new Error(`hook 'mz_lock_insert' threw: Error: ${sentence}`);
  err.name = 'SandboxError';
  return Object.assign(err, { innerMessage: sentence }, extra);
}

/** The same shape for a body that CRASHED: the runner sets `innerMessage` to the native error text. */
function sandboxCrash(): Error {
  const err = new Error("hook 'mz_lock_insert' threw: TypeError: boom");
  err.name = 'SandboxError';
  return Object.assign(err, { innerMessage: 'TypeError: boom' });
}

const metaMap = new Map<string, ExportFieldMeta>([['name', { name: 'name', type: 'text' }]]);

const baseOpts = {
  objectName: OBJECT,
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

const WRAPPER_RE = /threw:|hook '/;

/** Inline path: no bulk primitive, so each row is one `createData`. */
function inlineProtocol(refuse: () => Error): ImportProtocolLike {
  return {
    findData: vi.fn(async () => []),
    createData: vi.fn(async (args: CreateArgs) => {
      if (args.data.name === 'r1') throw refuse();
      return { id: `id_${String(args.data.name)}` };
    }),
    updateData: vi.fn(),
  };
}

async function rowFor(err: () => Error) {
  const summary = await runImport({ ...baseOpts, p: inlineProtocol(err), rows: [{ name: 'r1' }] });
  expect(summary.errors).toBe(1);
  return summary.results[0];
}

describe('[#22694] §1 — each write path reports the hook\'s sentence', () => {
  it('the inline `createData` path', async () => {
    const p = inlineProtocol(() => sandboxRefusal(SENTENCE));
    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r0' }, { name: 'r1' }, { name: 'r2' }] });

    expect(summary.created).toBe(2);
    expect(summary.results[1]).toEqual({ row: 2, ok: false, action: 'failed', error: SENTENCE, code: 'IMPORT_ROW_FAILED' });
    expect(JSON.stringify(summary)).not.toMatch(WRAPPER_RE);
  });

  it('the batched `createManyData` path, degraded to per-row writes', async () => {
    const createManyData = vi.fn(async () => { throw sandboxRefusal(SENTENCE); });
    const p = { ...inlineProtocol(() => sandboxRefusal(SENTENCE)), createManyData };
    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r0' }, { name: 'r1' }, { name: 'r2' }] });

    // Anti-vacuity: the batch really ran and really degraded.
    expect(createManyData).toHaveBeenCalledTimes(1);
    expect(p.createData).toHaveBeenCalledTimes(3);
    expect(summary.results[1]).toMatchObject({ ok: false, action: 'failed', error: SENTENCE, code: 'IMPORT_ROW_FAILED' });
    expect(JSON.stringify(summary)).not.toMatch(WRAPPER_RE);
  });

  it('the partial-success `insertManyData` outcomes', async () => {
    const insertManyData = vi.fn(async (args: { records: Array<Record<string, unknown>> }) => ({
      outcomes: args.records.map((r) => (r.name === 'r1'
        ? { ok: false, error: sandboxRefusal(SENTENCE) }
        : { ok: true, record: { id: `id_${String(r.name)}` } })),
    }));
    const createManyData = vi.fn();
    const p = { ...inlineProtocol(() => sandboxRefusal(SENTENCE)), createManyData, insertManyData } as unknown as ImportProtocolLike;
    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r0' }, { name: 'r1' }, { name: 'r2' }] });

    expect(insertManyData).toHaveBeenCalledTimes(1);
    expect(createManyData).not.toHaveBeenCalled();
    expect(summary.results[1]).toMatchObject({ ok: false, action: 'failed', error: SENTENCE, code: 'IMPORT_ROW_FAILED' });
    expect(JSON.stringify(summary)).not.toMatch(WRAPPER_RE);
  });

  it('the update half of an upsert', async () => {
    const updateData = vi.fn(async () => { throw sandboxRefusal(SENTENCE); });
    const p: ImportProtocolLike = {
      findData: vi.fn(async () => [{ id: 'e1', name: 'r1' }]),
      createData: vi.fn(),
      updateData,
    };
    const summary = await runImport({ ...baseOpts, writeMode: 'upsert', matchFields: ['name'], p, rows: [{ name: 'r1' }] });

    expect(updateData).toHaveBeenCalledTimes(1);
    expect(summary.results[0]).toMatchObject({ ok: false, action: 'failed', error: SENTENCE, code: 'IMPORT_ROW_FAILED' });
  });
});

describe('[#22694] §2 — what the body declared still rides', () => {
  it('a declared `code` is the row\'s code, beside the sentence', async () => {
    const row = await rowFor(() => sandboxRefusal('This row is frozen.', { code: 'RECORD_LOCKED', status: 409 }));
    expect(row).toMatchObject({ error: 'This row is frozen.', code: 'RECORD_LOCKED' });
  });
});

describe('[#22694] §3 — the row answers what the create door answers', () => {
  it.each([
    ['a plain sentence', SENTENCE],
    // `sanitizeRowError` reads a leading SQL verb as a leaked statement and
    // would answer its generic database sentence here.
    ['a sentence opening with an SQL verb', 'Update the cost centre before importing this row.'],
    ['a sentence carrying a " - " separator', 'Delete refused - 3 open invoices reference this account.'],
    // `sanitizeRowError` cuts at 300; the create door relays the sentence whole.
    ['a sentence longer than 300 characters', `${'This row cannot be imported. '.repeat(12)}Ask the owner.`],
  ])('%s', async (_label, sentence) => {
    const err = () => sandboxRefusal(sentence);
    const row = await rowFor(err);

    expect(row.error).toBe(sentence);
    expect(row.error).toBe(mapDataError(err(), OBJECT).body.error);
  });

  it('anti-vacuity: `sanitizeRowError` really does rewrite two of those sentences', () => {
    expect(sanitizeRowError('Update the cost centre before importing this row.')).not.toBe(
      'Update the cost centre before importing this row.',
    );
    expect(sanitizeRowError('Delete refused - 3 open invoices reference this account.')).not.toBe(
      'Delete refused - 3 open invoices reference this account.',
    );
  });
});

describe('[#22694] §4 — controls: what the read must NOT change', () => {
  it('CONTROL — a hook body that CRASHED is not a refusal: its row is built from `.message` exactly as before', async () => {
    const crash = sandboxCrash();
    const row = await rowFor(sandboxCrash);

    // `sandboxBusinessMessage` declines a crash, so the native error text is
    // never presented as the author's sentence.
    expect(row.error).not.toBe('TypeError: boom');
    expect(row.error).toBe(sanitizeRowError(crash.message));
    expect(row.code).toBe('IMPORT_ROW_FAILED');
  });

  it('CONTROL — a plain error whose own text looks like the wrapper is relayed as it always was', async () => {
    // No `innerMessage`: nothing about this error came from the sandbox, so a
    // pattern-strip would be the only thing that could change it.
    const text = "hook 'guard' threw: Error: locked";
    const row = await rowFor(() => Object.assign(new Error(text), { code: 'RECORD_LOCKED' }));
    expect(row).toMatchObject({ error: text, code: 'RECORD_LOCKED' });
  });

  it('CONTROL — an `innerMessage` that is not a non-empty string falls back to `.message`', async () => {
    for (const inner of ['', 42, null]) {
      const row = await rowFor(() => Object.assign(new Error("hook 'g' threw: Error: refused"), { innerMessage: inner }));
      expect(row.error, String(inner)).toBe("hook 'g' threw: Error: refused");
    }
  });

  it('CONTROL — driver text with no `innerMessage` is still cleaned', async () => {
    const sql = "insert into `mz_locked` (`name`) values ('r1') - SQLITE_BUSY: database is locked";
    const row = await rowFor(() => new Error(sql));
    expect(row.error).toBe('SQLITE_BUSY: database is locked');
  });
});
