// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24981] An import cell is resolved against a lookup TARGET's own title
 * field: ADR-0079's `resolveDisplayField`, the one rule the list export writes
 * a lookup cell by. It is asked after the id and the lookup's own
 * `displayField`, and before the fixed fallback keys, which are unchanged.
 *
 * Only a STORED title is asked. A title the target declares virtual (a
 * `formula`) has no column, and the engine's filter seam
 * (`assertFilterIsMaterializable`) refuses every `where` over one by the spec
 * predicate `isVirtualSearchField`; the resolver asks the same predicate and
 * never sends that query. How a formula title should match is the open half of
 * the card, with the maintainer, so such a cell still answers
 * `reference_not_found`.
 *
 * The fake's `findData` answers like the engine: equality over the stored row,
 * and an `INVALID_FIELD` / 400 refusal for a `where` over a formula field.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type FindArgs = Parameters<ImportProtocolLike['findData']>[0];
type Row = Record<string, unknown>;
type Declaration = { fields: Record<string, Row>; nameField?: string; displayNameField?: string; enable?: unknown };

const TEXT = { type: 'text' };
const FORMULA = { type: 'formula', returnType: 'text' };

/** The card's three targets, plus one whose stored title two records share. */
const DECLARATIONS: Record<string, Declaration> = {
  // `Wren`: a STORED title off the fixed key list.
  xt_person: { displayNameField: 'nickname', fields: { first_name: TEXT, nickname: TEXT } },
  // `John Smith`: a FORMULA title whose name IS on the fixed key list.
  xt_contact: {
    nameField: 'full_name',
    fields: { first_name: TEXT, last_name: TEXT, title: TEXT, full_name: { ...FORMULA, expression: 'first_name + " " + last_name' } },
  },
  // `Acme (EMEA)`: a FORMULA title off the fixed key list.
  xt_account: {
    nameField: 'display_title',
    fields: { name: TEXT, region: TEXT, display_title: { ...FORMULA, expression: 'name + " (" + region + ")"' } },
  },
  xt_member: { nameField: 'nickname', fields: { nickname: TEXT } },
};

const ROWS: Record<string, Row[]> = {
  xt_person: [{ id: 'p1', first_name: 'Ann', nickname: 'Wren' }],
  xt_contact: [{ id: 'c1', first_name: 'John', last_name: 'Smith', title: 'VP of Engineering' }],
  xt_account: [{ id: 'a1', name: 'Acme', region: 'EMEA' }],
  xt_member: [{ id: 'm1', nickname: 'Robin' }, { id: 'm2', nickname: 'Robin' }],
};

const lookup = (name: string, reference: string, extra: Partial<ExportFieldMeta> = {}): [string, ExportFieldMeta] =>
  [name, { name, type: 'lookup', reference, ...extra }];

const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text' }],
  // The lookup's own `displayField` is asked before the target's title.
  lookup('person', 'xt_person', { displayField: 'first_name' }),
  lookup('contact', 'xt_contact'),
  lookup('account', 'xt_account'),
  lookup('member', 'xt_member'),
]);

function protocol(overrides: Record<string, Partial<Declaration>> = {}) {
  const refusals: Array<{ object: string; field: string; code: string; status: number }> = [];
  const findData = vi.fn(async (args: FindArgs) => {
    const decl = { ...DECLARATIONS[args.object], ...overrides[args.object] };
    const [[field, value]] = Object.entries(args.query!.where!);
    if (decl.fields?.[field]?.type === 'formula') {
      const err = Object.assign(new Error(`filters on '${field}', a virtual formula field`), { code: 'INVALID_FIELD', status: 400 });
      refusals.push({ object: args.object, field, code: err.code, status: err.status });
      throw err;
    }
    return (ROWS[args.object] ?? []).filter((r) => r[field] === value);
  });
  const getMetaItem = vi.fn(async ({ name }: { type: string; name: string }) =>
    ({ type: 'object', name, item: { name, ...DECLARATIONS[name], ...overrides[name] } }));
  const p: ImportProtocolLike = { findData, getMetaItem, createData: vi.fn(async (a) => ({ id: 'new', ...a.data })), updateData: vi.fn() };
  return { p, findData, getMetaItem, refusals };
}

const run = (p: ImportProtocolLike, rows: Row[]) =>
  runImport({
    p, context: { userId: 'u_member', roles: ['member'] }, objectName: 'xt_source', metaMap, writeMode: 'insert',
    matchFields: [], dryRun: true, runAutomations: false, trimWhitespace: true, createMissingOptions: false,
    skipBlankMatchKey: false, rows,
  });

/** The `where` keys asked of one target, in order. */
const askedOf = (findData: ReturnType<typeof protocol>['findData'], object: string) =>
  findData.mock.calls.filter(([a]) => a.object === object).map(([a]) => Object.keys(a.query!.where!)[0]);

const verdict = (r: { ok: boolean; code?: string; field?: string }) => ({ ok: r.ok, code: r.code, field: r.field });
const OK = { ok: true, code: undefined, field: undefined };

describe('[#24981] import resolves a lookup cell by the target object\'s stored title field', () => {
  for (const [label, override] of [
    ['displayNameField (the card\'s cell, as authored)', {}],
    ['nameField (the alias as the registry normalizes it)', { displayNameField: undefined, nameField: 'nickname' }],
  ] as const) {
    it(`Wren resolves through a stored ${label}, asked after the id and the lookup's displayField`, async () => {
      const { p, findData, refusals } = protocol({ xt_person: override });
      const summary = await run(p, [{ name: 'a', person: 'Wren' }]);
      expect(summary.results.map(verdict)).toEqual([OK]);
      expect(askedOf(findData, 'xt_person')).toEqual(['id', 'first_name', 'nickname']);
      expect(refusals).toEqual([]);
    });
  }

  it('the stored title stores the matched record\'s id', async () => {
    const { p, getMetaItem } = protocol();
    const createData = vi.fn(async (a: { data: Row }) => ({ id: 'new', ...a.data }));
    p.createData = createData;
    const summary = await runImport({
      p, context: {}, objectName: 'xt_source', metaMap, writeMode: 'insert', matchFields: [], dryRun: false,
      runAutomations: false, trimWhitespace: true, createMissingOptions: false, skipBlankMatchKey: false,
      rows: [{ name: 'a', person: 'Wren' }, { name: 'b', person: 'Wren' }],
    });
    expect(summary.results.map(verdict)).toEqual([OK, OK]);
    expect(createData.mock.calls.map(([a]) => a.data.person)).toEqual(['p1', 'p1']);
    // The title comes off the declaration the exposure check already reads:
    // one metadata read per target per import, however many rows ask it.
    expect(getMetaItem.mock.calls.map(([r]) => r.name)).toEqual(['xt_person']);
  });

  for (const [cell, object, column, title] of [
    ['John Smith', 'xt_contact', 'contact', 'full_name'],
    ['Acme (EMEA)', 'xt_account', 'account', 'display_title'],
  ] as const) {
    it(`a formula title (${object}.${title}) is never asked by where: '${cell}' still answers reference_not_found`, async () => {
      const { p, findData, refusals } = protocol();
      const summary = await run(p, [{ name: 'a', [column]: cell }]);
      expect(summary.results.map(verdict)).toEqual([{ ok: false, code: 'reference_not_found', field: column }]);
      const asked = askedOf(findData, object);
      expect(asked).not.toContain(title);
      // The fixed fallback keys are unchanged; only a member the target
      // declares virtual is skipped, which the engine could only refuse.
      expect(asked).toEqual(['id', 'name', 'title', 'label', 'full_name', 'email', 'username'].filter((f) => f !== title));
      expect(refusals).toEqual([]);
    });
  }

  it('two records sharing a stored title answer the import\'s ambiguity refusal, and link neither', async () => {
    const { p, findData } = protocol();
    const summary = await run(p, [{ name: 'a', member: 'Robin' }]);
    expect(summary.results.map(verdict)).toEqual([{ ok: false, code: 'reference_ambiguous', field: 'member' }]);
    expect(askedOf(findData, 'xt_member')).toEqual(['id', 'nickname']);
  });

  it('[#22739] a target whose exposure refuses list still answers reference_not_found, and is never read', async () => {
    const { p, findData, getMetaItem } = protocol({ xt_person: { enable: { apiEnabled: false } } });
    const summary = await run(p, [{ name: 'a', person: 'Wren' }, { name: 'b', person: 'Missing' }]);
    const NOT_FOUND = { ok: false, code: 'reference_not_found', field: 'person' };
    expect(summary.results.map(verdict)).toEqual([NOT_FOUND, NOT_FOUND]);
    expect(findData).not.toHaveBeenCalled();
    expect(getMetaItem).toHaveBeenCalledTimes(1);
  });
});
