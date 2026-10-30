// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28120] An in-process search-field override on a stored-metadata table that
 * names no field reaches the engine's refusal through the reader seam, rather
 * than being narrowed into a search the door and the engine both refuse.
 *
 * The seam (`serveStoredMetadataReadsThrough`) narrows a DEFAULT `$search` on
 * `sys_metadata` / `sys_metadata_history` to the searchable set minus the body
 * and hash columns (`narrowStoredMetadataSearch`). It read an empty override as
 * "names none", took that branch and wrote the narrowed set back over the
 * caller's, so `searchFields: []` from a host handler was served where the REST
 * door and the engine refuse it `400 VALIDATION_ERROR` (#27732). An override
 * naming only unknown fields is refused by the engine `400 INVALID_FIELD`
 * through the seam as well, rather than resolved to a default set.
 *
 * Driven through the seam over a REAL {@link ObjectQL} engine, with the real
 * family definition registered and a driver double that records each read, so
 * "refused before any driver read" and "which columns were scanned" are
 * measured rather than assumed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SysMetadataObject } from '@objectstack/metadata-core';
import { ObjectQL } from '@objectstack/objectql';
import { mapDataError } from '@objectstack/types';
import { serveStoredMetadataReadsThrough } from './stored-metadata-reader-seam.js';

/** Every column a `$or` of `$icontains` clauses names, in order, de-duplicated. */
function scannedColumns(where: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.startsWith('$')) walk(v);
      else if (v && typeof v === 'object' && '$icontains' in (v as Record<string, unknown>)) out.add(k);
      else walk(v);
    }
  };
  walk(where);
  return [...out];
}

function makeDriver() {
  const reads: Array<{ via: string; where: unknown }> = [];
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) { reads.push({ via: 'find', where: ast?.where }); return []; },
    async findOne(_o: string, ast: any) { reads.push({ via: 'findOne', where: ast?.where }); return null; },
    async count(_o: string, ast: any) { reads.push({ via: 'count', where: ast?.where }); return 0; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads };
}

/** The seam over the real engine: each repository verb reads through `engine`. */
function servedApi(engine: ObjectQL): any {
  const repo = (name: string) => ({
    find: (q: any) => engine.find(name, q),
    findOne: (q: any) => engine.findOne(name, q),
    count: (q: any) => engine.count(name, q),
  });
  return serveStoredMetadataReadsThrough({ object: repo } as any, engine);
}

/** The refusal as the REST door would answer it: `mapDataError`'s status and code. */
async function wireAnswer(read: Promise<unknown>) {
  const err = await read.then(
    () => { throw new Error('expected a refusal, got an answer'); },
    (e: unknown) => e,
  );
  const mapped = mapDataError(err);
  return { status: mapped.status, code: mapped.body.code, param: (err as any).param };
}

type Verb = 'find' | 'findOne' | 'count';
const VERBS: readonly Verb[] = ['find', 'findOne', 'count'];

describe('[#28120] the stored-metadata seam hands a no-field override to the engine\'s refusal', () => {
  let api: any;
  let reads: Array<{ via: string; where: unknown }>;

  beforeEach(async () => {
    const engine = new ObjectQL();
    const made = makeDriver();
    reads = made.reads;
    engine.registerDriver(made.driver, true);
    await engine.init();
    engine.registry.registerObject(SysMetadataObject as any, 'test-package');
    api = servedApi(engine);
  });

  describe.each(VERBS)('%s', (verb) => {
    it('searchFields: [] is refused 400 VALIDATION_ERROR, before any driver read', async () => {
      const answer = await wireAnswer(api.object('sys_metadata')[verb]({ search: 'z', searchFields: [] }));
      expect(answer).toEqual({ status: 400, code: 'VALIDATION_ERROR', param: 'searchFields' });
      expect(reads).toEqual([]);
    });

    it('a comma string naming no field, and an empty object-form list, are refused the same way', async () => {
      expect(await wireAnswer(api.object('sys_metadata')[verb]({ search: 'z', searchFields: ' , ' })))
        .toEqual({ status: 400, code: 'VALIDATION_ERROR', param: 'searchFields' });
      expect(await wireAnswer(api.object('sys_metadata')[verb]({ search: { query: 'z', fields: [] } })))
        .toEqual({ status: 400, code: 'VALIDATION_ERROR', param: 'search.fields' });
      expect(reads).toEqual([]);
    });

    it('an override naming only unknown fields is refused 400 INVALID_FIELD, before any driver read', async () => {
      const answer = await wireAnswer(api.object('sys_metadata')[verb]({ search: 'z', searchFields: ['no_such_field'] }));
      expect(answer).toEqual({ status: 400, code: 'INVALID_FIELD', param: 'searchFields' });
      expect(reads).toEqual([]);
    });

    it('CONTROL: a named override still narrows to what it names', async () => {
      await api.object('sys_metadata')[verb]({ search: 'z', searchFields: ['name'] });
      expect(reads.map((r) => scannedColumns(r.where))).toEqual([['name']]);
    });

    it('CONTROL: an absent override is still narrowed off the body and hash columns', async () => {
      await api.object('sys_metadata')[verb]({ search: 'z' });
      expect(reads).toHaveLength(1);
      const scanned = scannedColumns(reads[0]!.where);
      expect(scanned).toContain('name');
      expect(scanned).not.toContain('metadata');
      expect(scanned).not.toContain('checksum');
    });
  });
});
