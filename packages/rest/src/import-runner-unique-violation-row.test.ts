// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14723] An import ROW reports a unique-constraint refusal as
 * `UNIQUE_VIOLATION` — the one wire spelling the route has.
 *
 * ## The fork this closes
 *
 * `toFailedResult` relayed the thrown error's own `code`. The engine's
 * `DuplicateRecordError` envelope carries the REGISTERED `DUPLICATE_RECORD`,
 * so an import row said `DUPLICATE_RECORD` while the whole-request failure on
 * the very same `POST /data/:object/import` answered `UNIQUE_VIOLATION`
 * through `mapDataError` — two spellings of one condition in one route's
 * responses. Maintainer ruling (2026-09-03): converge on `UNIQUE_VIOLATION`;
 * the engine's thrown identity does not move.
 *
 * ## What is driven
 *
 * The REAL `DuplicateRecordError` class (what `p.createData` throws when the
 * protocol relays the engine's refusal), through the real `runImport`, on both
 * write paths the runner has — the per-row `createData` fallback and the
 * batched `createManyData` path, whose logical failure degrades to per-row
 * writes. §3 pins the door-to-row agreement directly: the row's `code` IS the
 * whole-request door's `code` for the same envelope.
 *
 * ## Reverse verification — predicted before running
 *
 * Revert the mapping in `toFailedResult` (relay `e?.code` again): §1 and §2
 * go red with the row reading `DUPLICATE_RECORD`; §3's parity case goes red
 * the same way; the two GUARD cases stay green in both directions, because
 * they pin what the mapping must NOT do.
 */

import { describe, it, expect, vi } from 'vitest';
import { DuplicateRecordError } from '@objectstack/objectql';
import { uniqueViolationColumn } from '@objectstack/types';
import { runImport, type ImportProtocolLike } from './import-runner';
import { mapDataError } from './error-response.js';
import type { ExportFieldMeta } from './export-format.js';

const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text' }],
]);

const baseOpts = {
  objectName: 'task',
  metaMap,
  writeMode: 'insert' as const,
  matchFields: [] as string[],
  dryRun: false,
  runAutomations: false,
  trimWhitespace: true,
  createMissingOptions: false,
  skipBlankMatchKey: false,
};

/** The offending user data — must never reach the row report. */
const OFFENDING_VALUE = 'dup@example.com';

/** better-sqlite3 via knex: the compiled statement, with the bound value, and the column behind it. */
const sqliteRaw = () =>
  Object.assign(
    new Error(
      `insert into \`task\` (\`name\`, \`id\`) values ('${OFFENDING_VALUE}', 'x') returning * - ` +
        'UNIQUE constraint failed: task.name',
    ),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' },
  );

/** The engine's envelope exactly as `engine.insert` builds it. */
const envelope = () => new DuplicateRecordError('task', sqliteRaw(), uniqueViolationColumn(sqliteRaw()));

function protocolWith(overrides: Partial<ImportProtocolLike>): ImportProtocolLike {
  return {
    findData: vi.fn(async () => []),
    createData: vi.fn(async (args: { data: { name: string } }) => ({ id: `id_${args.data.name}` })),
    updateData: vi.fn(),
    ...overrides,
  };
}

function expectNothingLeaked(summary: unknown): void {
  const payload = JSON.stringify(summary);
  expect(payload).not.toContain('DUPLICATE_RECORD');
  expect(payload).not.toContain('insert into');
  expect(payload).not.toContain('UNIQUE constraint failed');
  expect(payload).not.toContain('SQLITE_CONSTRAINT');
  expect(payload).not.toContain(OFFENDING_VALUE);
}

describe('[#14723] §1 — the per-row `createData` path', () => {
  it('a `DuplicateRecordError` row reports `UNIQUE_VIOLATION`, and nothing of the driver', async () => {
    const p = protocolWith({
      createData: vi.fn(async (args: { data: { name: string } }) => {
        if (args.data.name === 'r1') throw envelope();
        return { id: `id_${args.data.name}` };
      }),
    });

    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r0' }, { name: 'r1' }, { name: 'r2' }] });

    expect(summary.errors).toBe(1);
    expect(summary.created).toBe(2);
    expect(summary.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed', code: 'UNIQUE_VIOLATION' });
    // The sentence is the sanitised platform sentence, not the driver's.
    expect(typeof summary.results[1].error).toBe('string');
    expectNothingLeaked(summary);
  });
});

describe('[#14723] §2 — the batched `createManyData` path, degraded to per-row writes', () => {
  it('the conflicting row alone reports `UNIQUE_VIOLATION`; its siblings are created', async () => {
    const createManyData = vi.fn(async () => { throw envelope(); });
    const createData = vi.fn(async (args: { data: { name: string } }) => {
      if (args.data.name === 'r1') throw envelope();
      return { id: `id_${args.data.name}` };
    });
    const p = protocolWith({ createData, createManyData });

    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r0' }, { name: 'r1' }, { name: 'r2' }] });

    expect(createManyData).toHaveBeenCalledTimes(1);
    expect(createData).toHaveBeenCalledTimes(3);
    expect(summary.results[0]).toMatchObject({ ok: true, action: 'created' });
    expect(summary.results[1]).toMatchObject({ ok: false, action: 'failed', code: 'UNIQUE_VIOLATION' });
    expect(summary.results[2]).toMatchObject({ ok: true, action: 'created' });
    expectNothingLeaked(summary);
  });
});

describe('[#14723] §3 — the row and the whole-request door agree on the spelling', () => {
  it('the same envelope answers `UNIQUE_VIOLATION` on both surfaces of the route', async () => {
    const env = envelope();
    const door = mapDataError(env, 'task');
    expect(door.status).toBe(409);
    expect(door.body.code).toBe('UNIQUE_VIOLATION');

    const p = protocolWith({ createData: vi.fn(async () => { throw env; }) });
    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r1' }] });

    expect(summary.results[0].code).toBe(door.body.code);
  });

  it('anti-vacuity: the envelope\'s own code is the OTHER registered spelling — the mapping, not the relay, decides', () => {
    const env = envelope();
    expect(env.code).toBe('DUPLICATE_RECORD');
    expect(env.name).toBe('DuplicateRecordError');
    expect(env.status).toBe(409);
    expect(env.field).toBe('name');
  });
});

describe('[#14723] [GUARD] what the mapping must NOT do', () => {
  it('a producer that merely SPEAKS `DUPLICATE_RECORD` is not the engine\'s envelope and keeps its own code', async () => {
    // The same discrimination the whole-request arm makes (#14389 §5): the
    // gate is the registered code AND the class name.
    const hookRefusal = Object.assign(new Error('already there, says the hook'), { code: 'DUPLICATE_RECORD', status: 409 });
    const p = protocolWith({ createData: vi.fn(async () => { throw hookRefusal; }) });

    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r1' }] });

    expect(summary.results[0]).toMatchObject({ ok: false, code: 'DUPLICATE_RECORD', error: 'already there, says the hook' });
  });

  it('a field-level finding still wins over the thrown code (#4633 precedence is untouched)', async () => {
    const validation = Object.assign(new Error('name must be ≤ 4 characters'), {
      code: 'VALIDATION_FAILED',
      name: 'ValidationError',
      fields: [{ field: 'name', code: 'max_length', message: 'name must be ≤ 4 characters' }],
    });
    const p = protocolWith({ createData: vi.fn(async () => { throw validation; }) });

    const summary = await runImport({ ...baseOpts, p, rows: [{ name: 'r1' }] });

    expect(summary.results[0]).toMatchObject({ ok: false, code: 'max_length', field: 'name' });
  });
});
