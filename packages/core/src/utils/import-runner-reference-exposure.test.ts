// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22739] An import cell resolved against a lookup TARGET whose declared
 * exposure does not serve `list` answers as a target the caller cannot read:
 * `reference_not_found`, for a cell that matches and a cell that does not
 * alike, and the target is never read.
 *
 * The decision is the spec's one (`canServeApiOperation`), asked of the
 * target's `enable` block as the protocol's `getMetaItem` serves it. It takes
 * no caller, so a member and an administrator are answered the same. The real
 * doors (`POST /data/:object/import` and `/import/jobs`, both personas) are
 * pinned in `packages/qa/dogfood/test/import-reference-exposure.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type FindArgs = Parameters<ImportProtocolLike['findData']>[0];

const TARGET = 'rx_target';
const RECORD = { id: 'rx_1', name: 'Existing' };

const metaMap = new Map<string, ExportFieldMeta>([
  ['name', { name: 'name', type: 'text' }],
  ['ref', { name: 'ref', type: 'lookup', reference: TARGET }],
]);

/** A protocol over one target record, whose declaration is `enable` (or a throw). */
function protocol(enable: unknown, opts: { metaThrows?: boolean } = {}) {
  const findData = vi.fn(async (args: FindArgs) => {
    if (args.object !== TARGET) return [];
    const [[field, value]] = Object.entries(args.query!.where!);
    return (RECORD as Record<string, unknown>)[field] === value ? [RECORD] : [];
  });
  const getMetaItem = vi.fn(async ({ name }: { type: string; name: string }) => {
    if (opts.metaThrows) throw new Error('metadata store unavailable');
    return { type: 'object', name, item: { name, ...(enable === undefined ? {} : { enable }) } };
  });
  const p: ImportProtocolLike = { findData, getMetaItem, createData: vi.fn(async (a) => ({ id: 'new', ...a.data })), updateData: vi.fn() };
  return { p, findData, getMetaItem };
}

const run = (p: ImportProtocolLike, context: Record<string, unknown>) =>
  runImport({
    p, context, objectName: 'rx_source', metaMap, writeMode: 'insert', matchFields: [], dryRun: true,
    runAutomations: false, trimWhitespace: true, createMissingOptions: false, skipBlankMatchKey: false,
    rows: [{ name: 'a', ref: 'Existing' }, { name: 'b', ref: 'Missing' }, { name: 'c', ref: 'rx_1' }],
  });

const verdict = (r: { ok: boolean; code?: string; field?: string }) => ({ ok: r.ok, code: r.code, field: r.field });
const NOT_FOUND = { ok: false, code: 'reference_not_found', field: 'ref' };
const PERSONAS = { member: { userId: 'u_member', roles: ['member'] }, admin: { userId: 'u_admin', roles: ['admin'] } };

describe('[#22739] import reference resolution asks the target its declared exposure, for list', () => {
  for (const [persona, context] of Object.entries(PERSONAS)) {
    for (const [label, enable] of [
      ['apiEnabled: false', { apiEnabled: false }],
      ['the deny-all whitelist', { apiMethods: [] }],
      ['a whitelist granting get but not list', { apiMethods: ['get'] }],
      ['a whitelist granting no read', { apiMethods: ['create'] }],
    ] as const) {
      it(`${persona}: ${label} answers a match, a miss and an id alike, and reads nothing`, async () => {
        const { p, findData } = protocol(enable);
        const summary = await run(p, context);
        expect(summary.results.map(verdict)).toEqual([NOT_FOUND, NOT_FOUND, NOT_FOUND]);
        expect(findData).not.toHaveBeenCalled();
      });
    }

    for (const [label, enable] of [
      ['no enable block', undefined],
      ['a whitelist granting list', { apiMethods: ['list'] }],
    ] as const) {
      it(`CONTROL ${persona}: ${label} resolves a match and an id, and misses a miss`, async () => {
        const { p } = protocol(enable);
        const summary = await run(p, context);
        expect(summary.results.map(verdict)).toEqual([{ ok: true, code: undefined, field: undefined }, NOT_FOUND, { ok: true, code: undefined, field: undefined }]);
      });
    }
  }

  it('a declaration that cannot be read withholds the target (fail-closed), asked once per import', async () => {
    const { p, findData, getMetaItem } = protocol(undefined, { metaThrows: true });
    const summary = await run(p, PERSONAS.member);
    expect(summary.results.map(verdict)).toEqual([NOT_FOUND, NOT_FOUND, NOT_FOUND]);
    expect(findData).not.toHaveBeenCalled();
    expect(getMetaItem).toHaveBeenCalledTimes(1);
  });
});
