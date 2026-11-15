// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33523] A lookup cell naming a DETAIL record is resolved within the master
 * the same import row sets, as the record picker narrows its candidates. A
 * detail's name is unique only inside its master: two contracts may each carry
 * an "Advance 30%" billing step, and a row naming contract A and that step
 * means A's step.
 *
 * The scope comes from either of two declarations:
 * - the lookup TARGET declares a `master_detail` field, and exactly one other
 *   single-value reference column of the row points at that master;
 * - the importing lookup field declares `dependsOn`, which names the sibling
 *   column and the target field it filters by.
 *
 * A row that sets no master keeps the whole-object lookup, so a tie there is
 * still `reference_ambiguous`. A name absent under the row's master is
 * `reference_not_found`, never a match under another master.
 *
 * The fake's `findData` answers like the engine: equality over every `where`
 * key of the stored row, and it records the context each read ran under.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import { buildFieldMetaMap } from './import-field-meta.js';

type FindArgs = Parameters<ImportProtocolLike['findData']>[0];
type Row = Record<string, unknown>;

const TEXT = { type: 'text' };

const DECLARATIONS: Record<string, { fields: Record<string, Row>; nameField?: string }> = {
  xm_contract: { nameField: 'name', fields: { name: TEXT } },
  xm_milestone: {
    nameField: 'name',
    fields: { name: TEXT, contract: { type: 'master_detail', reference: 'xm_contract' } },
  },
  xm_project: { nameField: 'name', fields: { name: TEXT } },
  // A plain lookup to its project: no master, so only `dependsOn` scopes it.
  xm_task: { nameField: 'name', fields: { name: TEXT, project: { type: 'lookup', reference: 'xm_project' } } },
};

const ROWS: Record<string, Row[]> = {
  xm_contract: [
    { id: 'c1', name: 'Contract A' },
    { id: 'c2', name: 'Contract B' },
    { id: 'c3', name: 'Contract C' },
  ],
  xm_milestone: [
    { id: 'm1', name: 'Advance 30%', contract: 'c1' },
    { id: 'm2', name: 'Advance 30%', contract: 'c2' },
    { id: 'm3', name: 'Final 70%', contract: 'c1' },
  ],
  xm_project: [
    { id: 'p1', name: 'Apollo' },
    { id: 'p2', name: 'Gemini' },
  ],
  xm_task: [
    { id: 't1', name: 'Kickoff', project: 'p1' },
    { id: 't2', name: 'Kickoff', project: 'p2' },
  ],
};

/** The importing object: an invoice that sets a contract, a milestone and a task. */
const metaMap = buildFieldMetaMap({
  fields: {
    name: TEXT,
    contract: { type: 'lookup', reference: 'xm_contract' },
    milestone: { type: 'lookup', reference: 'xm_milestone' },
    project: { type: 'lookup', reference: 'xm_project' },
    task: { type: 'lookup', reference: 'xm_task', dependsOn: [{ field: 'project', param: 'project' }] },
    // A second column pointing at the master, used only by the two-column case.
    other_contract: { type: 'lookup', reference: 'xm_contract' },
  },
});

const CALLER = { userId: 'u1', tenantId: 'org1' };

function protocol() {
  const findData = vi.fn(async (args: FindArgs) =>
    (ROWS[args.object] ?? []).filter((r) => Object.entries(args.query!.where!).every(([f, v]) => r[f] === v)));
  const getMetaItem = vi.fn(async ({ name }: { type: string; name: string }) =>
    ({ type: 'object', name, item: { name, ...DECLARATIONS[name] } }));
  const createData = vi.fn(async (a: { data: Row }) => ({ id: 'new', ...a.data }));
  const p: ImportProtocolLike = { findData, getMetaItem, createData, updateData: vi.fn() };
  return { p, findData, createData };
}

const run = (p: ImportProtocolLike, rows: Row[]) =>
  runImport({
    p, context: CALLER, objectName: 'xm_invoice', metaMap, writeMode: 'insert', matchFields: [], dryRun: false,
    runAutomations: false, trimWhitespace: true, createMissingOptions: false, skipBlankMatchKey: false, rows,
  });

const verdict = (r: { ok: boolean; code?: string; field?: string }) => ({ ok: r.ok, code: r.code, field: r.field });
const OK = { ok: true, code: undefined, field: undefined };

describe('[#33523] an import lookup naming a detail resolves within the row\'s own master', () => {
  it('two masters each with a detail "Advance 30%": each row links its own master\'s detail', async () => {
    const { p, createData } = protocol();
    const summary = await run(p, [
      { name: 'INV-1', contract: 'Contract A', milestone: 'Advance 30%' },
      { name: 'INV-2', contract: 'Contract B', milestone: 'Advance 30%' },
    ]);
    expect(summary.results.map(verdict)).toEqual([OK, OK]);
    expect(createData.mock.calls.map(([a]) => [a.data.contract, a.data.milestone])).toEqual([['c1', 'm1'], ['c2', 'm2']]);
  });

  it('the column order does not matter: a detail column before its master column is still scoped', async () => {
    const { p, createData } = protocol();
    const summary = await run(p, [{ milestone: 'Advance 30%', name: 'INV-1', contract: 'Contract B' }]);
    expect(summary.results.map(verdict)).toEqual([OK]);
    expect(createData.mock.calls.map(([a]) => a.data.milestone)).toEqual(['m2']);
  });

  it('a row with no master cell keeps the whole-object lookup: a tie is reference_ambiguous', async () => {
    const { p, createData } = protocol();
    const summary = await run(p, [
      { name: 'INV-1', milestone: 'Advance 30%' },
      { name: 'INV-2', contract: '', milestone: 'Advance 30%' },
      // A name only one record carries still resolves across the whole object.
      { name: 'INV-3', milestone: 'Final 70%' },
    ]);
    expect(summary.results.map(verdict)).toEqual([
      { ok: false, code: 'reference_ambiguous', field: 'milestone' },
      { ok: false, code: 'reference_ambiguous', field: 'milestone' },
      OK,
    ]);
    expect(createData.mock.calls.map(([a]) => a.data.milestone)).toEqual(['m3']);
  });

  it('a name absent under the row\'s master is reference_not_found, never a match under another master', async () => {
    const { p, createData } = protocol();
    const summary = await run(p, [
      // Contract C has no "Advance 30%"; A and B do.
      { name: 'INV-1', contract: 'Contract C', milestone: 'Advance 30%' },
      // "Final 70%" is unique across the object, but it is contract A's.
      { name: 'INV-2', contract: 'Contract B', milestone: 'Final 70%' },
      // A pasted id of another master's detail is not under this master either.
      { name: 'INV-3', contract: 'Contract B', milestone: 'm1' },
    ]);
    expect(summary.results.map(verdict)).toEqual([
      { ok: false, code: 'reference_not_found', field: 'milestone' },
      { ok: false, code: 'reference_not_found', field: 'milestone' },
      { ok: false, code: 'reference_not_found', field: 'milestone' },
    ]);
    expect(createData).not.toHaveBeenCalled();
  });

  it('every lookup, scoped or not, is read as the importing caller', async () => {
    const { p, findData } = protocol();
    await run(p, [{ name: 'INV-1', contract: 'Contract A', milestone: 'Advance 30%' }]);
    const scoped = findData.mock.calls.filter(([a]) => a.object === 'xm_milestone').map(([a]) => a);
    expect(scoped.length).toBeGreaterThan(0);
    for (const a of findData.mock.calls.map(([call]) => call)) expect(a.context).toBe(CALLER);
    expect(scoped.every((a) => a.query!.where!.contract === 'c1')).toBe(true);
  });

  it('two columns pointing at the master do not say which is the master: the lookup stays unscoped', async () => {
    const { p } = protocol();
    const summary = await run(p, [
      { name: 'INV-1', contract: 'Contract A', other_contract: 'Contract B', milestone: 'Advance 30%' },
    ]);
    expect(summary.results.map(verdict)).toEqual([{ ok: false, code: 'reference_ambiguous', field: 'milestone' }]);
  });

  it('a field\'s own dependsOn scopes a plain lookup the same way', async () => {
    const { p, createData } = protocol();
    const summary = await run(p, [
      { name: 'INV-1', project: 'Gemini', task: 'Kickoff' },
      { name: 'INV-2', task: 'Kickoff' },
    ]);
    expect(summary.results.map(verdict)).toEqual([OK, { ok: false, code: 'reference_ambiguous', field: 'task' }]);
    expect(createData.mock.calls.map(([a]) => a.data.task)).toEqual(['t2']);
  });

  it('a master cell that does not resolve scopes nothing: the detail is judged across the whole object', async () => {
    const { p } = protocol();
    const summary = await run(p, [{ name: 'INV-1', contract: 'Contract Z', milestone: 'Final 70%' }]);
    expect(summary.results.map(verdict)).toEqual([{ ok: false, code: 'reference_not_found', field: 'contract' }]);
  });
});

describe('[#33523] the match-key pass scopes a key column by the row\'s master too', () => {
  it('two rows keyed by the same detail name under different masters are not one key', async () => {
    const { p, createData } = protocol();
    const summary = await runImport({
      p, context: CALLER, objectName: 'xm_invoice', metaMap, writeMode: 'upsert', matchFields: ['milestone'],
      dryRun: false, runAutomations: false, trimWhitespace: true, createMissingOptions: false,
      skipBlankMatchKey: false,
      rows: [
        { name: 'INV-1', contract: 'Contract A', milestone: 'Advance 30%' },
        { name: 'INV-2', contract: 'Contract B', milestone: 'Advance 30%' },
      ],
    });
    expect(summary.results.map(verdict)).toEqual([OK, OK]);
    expect(createData.mock.calls.map(([a]) => a.data.milestone)).toEqual(['m1', 'm2']);
  });

  it('a key naming a detail of another master is not a shared key: that row alone answers reference_not_found', async () => {
    const { p, createData } = protocol();
    const summary = await runImport({
      p, context: CALLER, objectName: 'xm_invoice', metaMap, writeMode: 'upsert', matchFields: ['milestone'],
      dryRun: false, runAutomations: false, trimWhitespace: true, createMissingOptions: false,
      skipBlankMatchKey: false,
      rows: [
        // "Final 70%" is contract A's only: read unscoped, both rows would
        // carry the key m3 and fail together as a duplicate key.
        { name: 'INV-1', contract: 'Contract A', milestone: 'Final 70%' },
        { name: 'INV-2', contract: 'Contract B', milestone: 'Final 70%' },
      ],
    });
    expect(summary.results.map(verdict)).toEqual([OK, { ok: false, code: 'reference_not_found', field: 'milestone' }]);
    expect(createData.mock.calls.map(([a]) => a.data.milestone)).toEqual(['m3']);
  });
});
