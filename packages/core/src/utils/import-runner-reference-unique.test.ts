// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27947] An import cell is also resolved against a lookup TARGET's unique
 * fields: every field whose `unique` declares a constraint (`isUniqueDeclared`:
 * `true`, `'organization'`, `'global'`), and every `autonumber` field that
 * omits `unique`, which the spec makes `unique: 'organization'` by contract.
 * An autonumber that writes `unique: false` has opted out and is not asked.
 *
 * They are asked AFTER the existing candidates (the id, the lookup's
 * `displayField`, the target's title field, the fixed human keys), in the
 * target's declared field order, each at most once. The existing rules hold:
 * the first field to match wins, and a field matching more than one record is
 * `reference_ambiguous`, never a silent pick.
 *
 * The fake's `findData` answers like the engine: equality over the stored row.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type FindArgs = Parameters<ImportProtocolLike['findData']>[0];
type Row = Record<string, unknown>;
type Declaration = { fields: Record<string, Row>; nameField?: string };

const TEXT = { type: 'text' };

const DECLARATIONS: Record<string, Declaration> = {
  xu_account: {
    nameField: 'name',
    fields: {
      name: TEXT,
      // The contract default: an autonumber that omits `unique` is unique.
      account_number: { type: 'autonumber', autonumberFormat: 'ACC-{000000}' },
      region: TEXT,
      tax_id: { type: 'text', unique: true },
      // An opted-out autonumber: a display-only ordinal, never asked.
      ordinal: { type: 'autonumber', unique: false },
      external_code: { type: 'text', unique: 'global' },
      // Already a fixed key: asked once, in its fixed place.
      email: { type: 'email', unique: 'organization' },
    },
  },
};

const ROWS: Record<string, Row[]> = {
  xu_account: [
    { id: 'a1', name: 'Acme', account_number: 'ACC-000012', region: 'EMEA', tax_id: 'TX-1', ordinal: '7', external_code: 'EXT-1' },
    // A name that equals another record's autonumber: the name is asked first.
    { id: 'a2', name: 'ACC-000013', account_number: 'ACC-000002', region: 'APAC', tax_id: 'TX-2', ordinal: '8' },
    { id: 'a3', name: 'Globex', account_number: 'ACC-000013', region: 'APAC', tax_id: 'TX-3', ordinal: '9' },
    // Two holders of one tax id, as a read across organizations can see.
    { id: 'a4', name: 'Initech', account_number: 'ACC-000004', tax_id: 'TX-SHARED', ordinal: '10' },
    { id: 'a5', name: 'Umbrella', account_number: 'ACC-000005', tax_id: 'TX-SHARED', ordinal: '11' },
  ],
};

const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text' }],
  ['account', { name: 'account', type: 'lookup', reference: 'xu_account' }],
]);

function protocol() {
  const findData = vi.fn(async (args: FindArgs) => {
    const [[field, value]] = Object.entries(args.query!.where!);
    return (ROWS[args.object] ?? []).filter((r) => r[field] === value);
  });
  const getMetaItem = vi.fn(async ({ name }: { type: string; name: string }) =>
    ({ type: 'object', name, item: { name, ...DECLARATIONS[name] } }));
  const createData = vi.fn(async (a: { data: Row }) => ({ id: 'new', ...a.data }));
  const p: ImportProtocolLike = { findData, getMetaItem, createData, updateData: vi.fn() };
  return { p, findData, createData };
}

const run = (p: ImportProtocolLike, rows: Row[]) =>
  runImport({
    p, context: {}, objectName: 'xu_source', metaMap, writeMode: 'insert', matchFields: [], dryRun: false,
    runAutomations: false, trimWhitespace: true, createMissingOptions: false, skipBlankMatchKey: false, rows,
  });

/** The `where` keys asked of the target, in order. */
const asked = (findData: ReturnType<typeof protocol>['findData']) =>
  findData.mock.calls.filter(([a]) => a.object === 'xu_account').map(([a]) => Object.keys(a.query!.where!)[0]);

const verdict = (r: { ok: boolean; code?: string; field?: string }) => ({ ok: r.ok, code: r.code, field: r.field });
const OK = { ok: true, code: undefined, field: undefined };
const FIXED = ['id', 'name', 'title', 'label', 'full_name', 'email', 'username'];

describe('[#27947] import resolves a lookup cell by the target object\'s unique fields', () => {
  it('an autonumber cell (ACC-000012) resolves, asked after every existing candidate', async () => {
    const { p, findData, createData } = protocol();
    const summary = await run(p, [{ name: 'r', account: 'ACC-000012' }]);
    expect(summary.results.map(verdict)).toEqual([OK]);
    expect(createData.mock.calls.map(([a]) => a.data.account)).toEqual(['a1']);
    expect(asked(findData)).toEqual([...FIXED, 'account_number']);
  });

  it('another declared-unique field (tax_id, unique: true) resolves', async () => {
    const { p, findData, createData } = protocol();
    const summary = await run(p, [{ name: 'r', account: 'TX-3' }]);
    expect(summary.results.map(verdict)).toEqual([OK]);
    expect(createData.mock.calls.map(([a]) => a.data.account)).toEqual(['a3']);
    expect(asked(findData)).toEqual([...FIXED, 'account_number', 'tax_id']);
  });

  it('an earlier candidate that matches still wins: the name ACC-000013 links a2, not a3\'s autonumber', async () => {
    const { p, findData, createData } = protocol();
    const summary = await run(p, [{ name: 'r', account: 'ACC-000013' }]);
    expect(summary.results.map(verdict)).toEqual([OK]);
    expect(createData.mock.calls.map(([a]) => a.data.account)).toEqual(['a2']);
    expect(asked(findData)).toEqual(['id', 'name']);
  });

  it('a value matching nothing still answers reference_not_found, after the unique fields in declared order', async () => {
    const { p, findData, createData } = protocol();
    const summary = await run(p, [{ name: 'r', account: 'ACC-999999' }]);
    expect(summary.results.map(verdict)).toEqual([{ ok: false, code: 'reference_not_found', field: 'account' }]);
    expect(createData).not.toHaveBeenCalled();
    // Declared order, `email` not asked twice, the opted-out `ordinal` never.
    expect(asked(findData)).toEqual([...FIXED, 'account_number', 'tax_id', 'external_code']);
  });

  it('an opted-out autonumber (unique: false) is not asked: its value answers reference_not_found', async () => {
    const { p, findData } = protocol();
    const summary = await run(p, [{ name: 'r', account: '7' }]);
    expect(summary.results.map(verdict)).toEqual([{ ok: false, code: 'reference_not_found', field: 'account' }]);
    expect(asked(findData)).not.toContain('ordinal');
  });

  it('a unique field two records answer is still reference_ambiguous, and links neither', async () => {
    const { p, findData, createData } = protocol();
    const summary = await run(p, [{ name: 'r', account: 'TX-SHARED' }]);
    expect(summary.results.map(verdict)).toEqual([{ ok: false, code: 'reference_ambiguous', field: 'account' }]);
    expect(createData).not.toHaveBeenCalled();
    expect(asked(findData)).toEqual([...FIXED, 'account_number', 'tax_id']);
  });
});
