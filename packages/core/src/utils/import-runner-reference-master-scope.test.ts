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
 * still `reference_ambiguous`. A name absent under the row's master is never a
 * match under another master: it is `reference_out_of_scope` when another
 * master has it (#36794), and `reference_not_found` when no record has it.
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
    { id: 't3', name: 'Design review', project: 'p1' },
  ],
};

/** The importing object: an invoice that sets a contract, a milestone and a task. */
const metaMap = buildFieldMetaMap({
  fields: {
    name: TEXT,
    contract: { type: 'lookup', reference: 'xm_contract', label: 'Contract' },
    milestone: { type: 'lookup', reference: 'xm_milestone' },
    project: { type: 'lookup', reference: 'xm_project', label: 'Project' },
    task: { type: 'lookup', reference: 'xm_task', dependsOn: [{ field: 'project', param: 'project' }] },
    // A multi-value lookup scoped the same way, for the multi-value refusal.
    tasks: {
      type: 'lookup', reference: 'xm_task', multiple: true, dependsOn: [{ field: 'project', param: 'project' }],
    },
    // A second column pointing at the master, used only by the two-column case.
    other_contract: { type: 'lookup', reference: 'xm_contract' },
  },
});

const CALLER = { userId: 'u1', tenantId: 'org1' };

/** Field equality on every key; a combinator or operator is refused, never read as a field name. */
const matches = (row: Row, where: Record<string, unknown>): boolean => {
  for (const [k, v] of Object.entries(where)) {
    if (k.startsWith('$')) throw new Error('fake findData: unsupported logical operator ' + k);
    if (v !== null && typeof v === 'object') throw new Error('fake findData: unsupported operator on ' + k);
    if (row[k] !== v) return false;
  }
  return true;
};

function protocol() {
  const findData = vi.fn(async (args: FindArgs) =>
    (ROWS[args.object] ?? []).filter((r) => matches(r, args.query!.where as Record<string, unknown>)));
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

  // [#36794] Each name exists under ANOTHER master, so each is refused as reference_out_of_scope.
  it('a name absent under the row\'s master is refused (reference_out_of_scope), never a match under another master', async () => {
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
      { ok: false, code: 'reference_out_of_scope', field: 'milestone' },
      { ok: false, code: 'reference_out_of_scope', field: 'milestone' },
      { ok: false, code: 'reference_out_of_scope', field: 'milestone' },
    ]);
    expect(createData).not.toHaveBeenCalled();
  });

  it('every lookup, scoped or not, is read as the importing caller', async () => {
    const { p, findData } = protocol();
    await run(p, [{ name: 'INV-1', contract: 'Contract A', milestone: 'Advance 30%' }]);
    const scoped = findData.mock.calls.filter(([a]) => a.object === 'xm_milestone').map(([a]) => a);
    expect(scoped.length).toBeGreaterThan(0);
    for (const a of findData.mock.calls.map(([call]) => call)) expect(a.context).toBe(CALLER);
    expect(scoped.every((a) => (a.query!.where as Record<string, unknown>).contract === 'c1')).toBe(true);
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

  it('a key naming a detail of another master is not a shared key: that row alone answers reference_out_of_scope', async () => {
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
    expect(summary.results.map(verdict)).toEqual([OK, { ok: false, code: 'reference_out_of_scope', field: 'milestone' }]);
    expect(createData.mock.calls.map(([a]) => a.data.milestone)).toEqual(['m3']);
  });
});

describe('[#36159] [#36794] a scoped miss whose value exists outside the row\'s scope is reference_out_of_scope, naming the scoping column', () => {
  const refusal = (r: { ok: boolean; code?: string; field?: string; error?: string }) =>
    ({ ok: r.ok, code: r.code, field: r.field, error: r.error });
  const cellErrors = (r: { errors?: Array<{ field: string; code: string; scope?: unknown }> }) =>
    (r.errors ?? []).map(({ field, code, scope }) => ({ field, code, scope }));

  it('a dependsOn-scoped cell naming another parent\'s record: reference_out_of_scope naming Project and its cell', async () => {
    const { p, createData } = protocol();
    // "Design review" exists, under Apollo only.
    const summary = await run(p, [{ name: 'INV-1', project: 'Gemini', task: 'Design review' }]);
    expect(summary.results.map(refusal)).toEqual([{
      ok: false, code: 'reference_out_of_scope', field: 'task',
      error: 'task: no record matches "Design review" (Project = "Gemini")',
    }]);
    // The scoping column rides on the cell error as data, so a client never parses the sentence.
    expect(summary.results.map(cellErrors)).toEqual([[
      { field: 'task', code: 'reference_out_of_scope', scope: [{ field: 'project', value: 'Gemini' }] },
    ]]);
    expect(createData).not.toHaveBeenCalled();
  });

  it('a master-scoped cell naming another master\'s detail, by name or by id: the same sentence naming Contract', async () => {
    const { p } = protocol();
    const summary = await run(p, [
      { name: 'INV-1', contract: 'Contract B', milestone: 'Final 70%' },
      { name: 'INV-2', contract: 'Contract B', milestone: 'm1' },
    ]);
    expect(summary.results.map(refusal)).toEqual([
      {
        ok: false, code: 'reference_out_of_scope', field: 'milestone',
        error: 'milestone: no record matches "Final 70%" (Contract = "Contract B")',
      },
      {
        ok: false, code: 'reference_out_of_scope', field: 'milestone',
        error: 'milestone: no record matches "m1" (Contract = "Contract B")',
      },
    ]);
    expect(summary.results.map(cellErrors)).toEqual([
      [{ field: 'milestone', code: 'reference_out_of_scope', scope: [{ field: 'contract', value: 'Contract B' }] }],
      [{ field: 'milestone', code: 'reference_out_of_scope', scope: [{ field: 'contract', value: 'Contract B' }] }],
    ]);
  });

  it('a value that matches no record at all keeps reference_not_found and the plain sentence, with no scope', async () => {
    const { p } = protocol();
    const summary = await run(p, [
      { name: 'INV-1', project: 'Gemini', task: 'Retrospective' },
      { name: 'INV-2', contract: 'Contract B', milestone: 'Holdback 5%' },
    ]);
    expect(summary.results.map(refusal)).toEqual([
      { ok: false, code: 'reference_not_found', field: 'task', error: 'task: no record matches "Retrospective"' },
      { ok: false, code: 'reference_not_found', field: 'milestone', error: 'milestone: no record matches "Holdback 5%"' },
    ]);
    expect(summary.results.map(cellErrors)).toEqual([
      [{ field: 'task', code: 'reference_not_found', scope: undefined }],
      [{ field: 'milestone', code: 'reference_not_found', scope: undefined }],
    ]);
    for (const r of summary.results) expect(r.errors?.[0]).not.toHaveProperty('scope');
  });

  it('a multi-value cell: the token outside the scope is refused with the same sentence', async () => {
    const { p } = protocol();
    const summary = await run(p, [
      { name: 'INV-1', project: 'Gemini', tasks: 'Kickoff; Design review' },
      { name: 'INV-2', project: 'Gemini', tasks: 'Kickoff; Retrospective' },
    ]);
    expect(summary.results.map(refusal)).toEqual([
      {
        ok: false, code: 'reference_out_of_scope', field: 'tasks',
        error: 'tasks: no record matches "Design review" (Project = "Gemini")',
      },
      { ok: false, code: 'reference_not_found', field: 'tasks', error: 'tasks: no record matches "Retrospective"' },
    ]);
  });

  it('a scope the caller may not filter by is refused by the field guard: reference_not_found, never out of scope', async () => {
    const { p, findData } = protocol();
    // The caller cannot read xm_task.project: the field-predicate guard refuses
    // any read that filters by it, as plugin-security's does.
    findData.mockImplementation(async (args: FindArgs) => {
      const where = args.query!.where as Record<string, unknown>;
      if (args.object === 'xm_task' && 'project' in where) {
        throw Object.assign(new Error('[Security] Access denied'), {
          code: 'PERMISSION_DENIED', status: 403,
          details: { object: 'xm_task', fields: ['project'], reason: 'field_predicate_denied' },
        });
      }
      return (ROWS[args.object] ?? []).filter((r) => matches(r, where));
    });
    // "Design review" is Apollo's, and the row names Apollo: the guard, not the
    // row's parent, is why the scoped read found nothing.
    const summary = await run(p, [{ name: 'INV-1', project: 'Apollo', task: 'Design review' }]);
    expect(summary.results.map(refusal)).toEqual([
      { ok: false, code: 'reference_not_found', field: 'task', error: 'task: no record matches "Design review"' },
    ]);
    expect(summary.results.map(cellErrors)).toEqual([[{ field: 'task', code: 'reference_not_found', scope: undefined }]]);
    // No unscoped probe ran: every xm_task read carried the scope.
    const taskReads = findData.mock.calls.map(([c]) => c).filter((c) => c.object === 'xm_task');
    expect(taskReads.length).toBeGreaterThan(0);
    for (const c of taskReads) expect(c.query!.where).toHaveProperty('project');
  });

  it('a scope the engine cannot filter by (every scoped read refused): reference_not_found saying the lookup could not be made, never out of scope', async () => {
    const { p, findData } = protocol();
    // The scope names a target field no driver can filter by (a formula): the
    // engine's filter seam refuses every read carrying it, as INVALID_FIELD.
    findData.mockImplementation(async (args: FindArgs) => {
      const where = args.query!.where as Record<string, unknown>;
      if (args.object === 'xm_task' && 'project' in where) {
        throw Object.assign(new Error("ObjectQL.find('xm_task') filters on 'project', a virtual formula field"), {
          code: 'INVALID_FIELD', status: 400, field: 'project', fields: ['project'],
        });
      }
      return (ROWS[args.object] ?? []).filter((r) => matches(r, where));
    });
    // "Design review" exists, under Apollo, and the row names Gemini: still no
    // out-of-scope claim, because the scoped question was never asked.
    const summary = await run(p, [{ name: 'INV-1', project: 'Gemini', task: 'Design review' }]);
    expect(summary.results.map(refusal)).toEqual([{
      ok: false, code: 'reference_not_found', field: 'task',
      error: 'task: "Design review" could not be looked up within Project = "Gemini": the target field this lookup\'s '
        + 'dependsOn filters by cannot be filtered on, so point that dependsOn entry at a stored field',
    }]);
    expect(summary.results.map(cellErrors)).toEqual([[{ field: 'task', code: 'reference_not_found', scope: undefined }]]);
    // No unscoped probe ran.
    const taskReads = findData.mock.calls.map(([c]) => c).filter((c) => c.object === 'xm_task');
    expect(taskReads.length).toBeGreaterThan(0);
    for (const c of taskReads) expect(c.query!.where).toHaveProperty('project');
  });

  it('a scoped lookup whose every read is refused for another reason (no read on the target): the plain sentence, no cause claimed', async () => {
    const { p, findData } = protocol();
    // The caller holds no read on xm_task: every read of it is refused, naming no field.
    findData.mockImplementation(async (args: FindArgs) => {
      if (args.object === 'xm_task') {
        throw Object.assign(new Error('[Security] Access denied'), {
          code: 'PERMISSION_DENIED', status: 403, details: { object: 'xm_task' },
        });
      }
      return (ROWS[args.object] ?? []).filter((r) => matches(r, args.query!.where as Record<string, unknown>));
    });
    const summary = await run(p, [{ name: 'INV-1', project: 'Gemini', task: 'Design review' }]);
    expect(summary.results.map(refusal)).toEqual([
      { ok: false, code: 'reference_not_found', field: 'task', error: 'task: no record matches "Design review"' },
    ]);
    expect(summary.results.map(cellErrors)).toEqual([[{ field: 'task', code: 'reference_not_found', scope: undefined }]]);
  });

  it('an INVALID_FIELD refusal naming a field outside the scope is not the scope\'s: the plain sentence', async () => {
    const { p, findData } = protocol();
    findData.mockImplementation(async (args: FindArgs) => {
      if (args.object === 'xm_task') {
        throw Object.assign(new Error("ObjectQL.find('xm_task') filters on 'name', a virtual formula field"), {
          code: 'INVALID_FIELD', status: 400, field: 'name', fields: ['name'],
        });
      }
      return (ROWS[args.object] ?? []).filter((r) => matches(r, args.query!.where as Record<string, unknown>));
    });
    const summary = await run(p, [{ name: 'INV-1', project: 'Gemini', task: 'Design review' }]);
    expect(summary.results.map(refusal)).toEqual([
      { ok: false, code: 'reference_not_found', field: 'task', error: 'task: no record matches "Design review"' },
    ]);
  });

  it('[#37717] a scoped lookup none of whose reads answered is never probed unscoped: a value the scope cell\'s type cannot take keeps the plain sentence', async () => {
    const { p, findData } = protocol();
    // Every read carrying the scope is refused for the scope cell's value
    // (INVALID_FILTER, a comparand the field's type cannot take); a read
    // without the scope would answer. "Design review" exists, under Apollo.
    findData.mockImplementation(async (args: FindArgs) => {
      const where = args.query!.where as Record<string, unknown>;
      if (args.object === 'xm_task' && 'project' in where) {
        throw Object.assign(new Error("ObjectQL.find('xm_task'): 'project' cannot take that value"), {
          code: 'INVALID_FILTER', status: 400, field: 'project',
        });
      }
      return (ROWS[args.object] ?? []).filter((r) => matches(r, where));
    });
    const summary = await run(p, [{ name: 'INV-1', project: 'Gemini', task: 'Design review' }]);
    expect(summary.results.map(refusal)).toEqual([
      { ok: false, code: 'reference_not_found', field: 'task', error: 'task: no record matches "Design review"' },
    ]);
    expect(summary.results.map(cellErrors)).toEqual([[{ field: 'task', code: 'reference_not_found', scope: undefined }]]);
    // No unscoped probe ran: every xm_task read carried the scope.
    const taskReads = findData.mock.calls.map(([c]) => c).filter((c) => c.object === 'xm_task');
    expect(taskReads.length).toBeGreaterThan(0);
    for (const c of taskReads) expect(c.query!.where).toHaveProperty('project');
  });

  it('the unscoped probe is the importing caller\'s own read, and a record that caller cannot read stays unnamed', async () => {
    const { p, findData } = protocol();
    // The caller's reads see no Apollo task: the fake hides xm_task rows of p1
    // from this caller, as row-level security would.
    findData.mockImplementation(async (args: FindArgs) =>
      (ROWS[args.object] ?? [])
        .filter((r) => !(args.object === 'xm_task' && r.project === 'p1'))
        .filter((r) => matches(r, args.query!.where as Record<string, unknown>)));
    const summary = await run(p, [{ name: 'INV-1', project: 'Gemini', task: 'Design review' }]);
    expect(summary.results.map(refusal)).toEqual([
      { ok: false, code: 'reference_not_found', field: 'task', error: 'task: no record matches "Design review"' },
    ]);
    const taskReads = findData.mock.calls.map(([a]) => a).filter((a) => a.object === 'xm_task');
    // Both the scoped lookup and the unscoped probe ran, and every read ran as the caller.
    expect(taskReads.some((a) => (a.query!.where as Row).project === 'p2')).toBe(true);
    expect(taskReads.some((a) => !('project' in (a.query!.where as Row)))).toBe(true);
    for (const a of findData.mock.calls.map(([call]) => call)) expect(a.context).toBe(CALLER);
  });
});
