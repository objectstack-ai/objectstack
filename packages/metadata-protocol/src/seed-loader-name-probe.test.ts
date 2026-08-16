// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

/**
 * [#9071] The seed loader's external-key lookup chain must ASK the metadata
 * registry before it spells `where: { name }`.
 *
 * ## The observation
 *
 * A real `serve` boot with a 342-row seed (`objectstack-ai/cloud#1350`) emitted
 * hundreds of ERROR-level `Find operation failed` lines: for every object whose
 * dataset declares an `externalId` other than `name` and which has NO `name`
 * column, the chain probed `name` anyway and the SQL driver refused the filter
 * (`INVALID_FILTER` / 400 — `Filter on 'name' names a column that object '…'
 * has no column for, so the predicate never ran.`).
 *
 * ## What is under test, and what is deliberately NOT
 *
 * The driver's refusal is CORRECT and stays exactly as it is: a predicate on a
 * column the object does not have never ran, so answering "no rows" would be a
 * lie (ADR-0110 D3 — a miss and a fault are different facts). So these tests
 * never assert that the error is caught, downgraded or logged more quietly.
 * They assert the only thing that removes the noise honestly: **the filter is
 * never spelled**, so the refusal is never provoked.
 *
 * The fake engine below therefore refuses an unresolvable WHERE column with the
 * driver's own envelope — `code`/`status` per ADR-0112 and the driver's first
 * sentence — and every test counts the refusals it raised. A double that
 * answered such a filter with `[]` would be looser than the producer it stands
 * in for and would make this whole file green over the defect.
 *
 * Both directions are pinned, per the card: the leg DISAPPEARS on an object
 * with no `name` column, and it still FIRES (and still answers) on one that
 * declares it.
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** Columns every object has whether or not its author declared them. */
const ALWAYS_PRESENT = ['id', 'organization_id', 'created_at', 'updated_at'];

interface Refusal {
  object: string;
  column: string;
}

/**
 * An engine whose `find` resolves WHERE columns against a declared column set
 * and REFUSES what it cannot resolve — `driver-sql`'s behaviour, in the one
 * respect this card is about.
 */
function createColumnStrictEngine(columns: Record<string, string[]>) {
  const store: Record<string, any[]> = {};
  const refusals: Refusal[] = [];
  let idCounter = 0;

  function refuse(object: string, column: string): never {
    refusals.push({ object, column });
    const err: any = new Error(
      `Filter on '${column}' names a column that object '${object}' has no column for, ` +
        'so the predicate never ran. A filter on a field that does not exist can only match ' +
        'zero records, so the query was refused instead of answered with an empty list.',
    );
    err.code = 'INVALID_FILTER';
    err.status = 400;
    throw err;
  }

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      const declared = columns[objectName];
      let records = store[objectName] || [];
      // Column resolution happens BEFORE row matching, exactly as the driver
      // does it: a filter naming an unresolvable column is refused whether or
      // not the table holds rows (a `.filter()` callback over an empty table
      // never runs, and "no rows to test" must not read as "column fine").
      for (const key of Object.keys(query?.where || {})) {
        if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
        if (declared && !declared.includes(key) && !ALWAYS_PRESENT.includes(key)) {
          refuse(objectName, key);
        }
      }
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => {
            // A combinator this double does not implement is REFUSED, never
            // read as a field name — a double looser than the producer it
            // stands in for turns a green suite into no suite.
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return r[k] === v;
          }),
        );
      }
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      const rows = await (engine.find as any)(objectName, { ...query, limit: 1 });
      return rows[0] ?? null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      if (Array.isArray(data)) {
        const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...d }));
        store[objectName].push(...records);
        return records;
      }
      const record = { id: `gen-${++idCounter}`, ...data };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (objectName: string, data: any) => {
      assertEngineUpdateDispatch(data, undefined);
      const records = store[objectName] || [];
      const idx = records.findIndex((r) => r.id === data.id);
      if (idx >= 0) {
        records[idx] = { ...records[idx], ...data };
        return records[idx];
      }
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store, refusals };
}

function createMetadata(objects: Record<string, any>): IMetadataService {
  return {
    getObject: vi.fn(async (name: string) => objects[name]),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => objects[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

/** Every WHERE key any `find` call in this run filtered on, per object. */
function filteredColumns(engine: IDataEngine, objectName: string): string[] {
  return (engine.find as any).mock.calls
    .filter(([obj]: [string]) => obj === objectName)
    .flatMap(([, query]: [string, any]) => Object.keys(query?.where || {}));
}

// The card's shape: contact keyed by `email`, no `name` column anywhere on it;
// an activity references it by that email.
const CONTACT_WITHOUT_NAME = {
  name: 'crm_contact',
  fields: {
    first_name: { type: 'text' },
    last_name: { type: 'text' },
    email: { type: 'email' },
  },
};

const ACTIVITY = {
  name: 'crm_activity',
  fields: {
    subject: { type: 'text' },
    contact: { type: 'lookup', reference: 'crm_contact' },
  },
};

describe('[#9071] SeedLoader external-key probe — the `name` leg is asked for, not assumed', () => {
  it('never spells `where: { name }` on an object that declares no `name` column', async () => {
    const { engine, store, refusals } = createColumnStrictEngine({
      crm_contact: ['first_name', 'last_name', 'email'],
      crm_activity: ['subject', 'contact'],
    });
    // A contact row already in the database, addressable only by its id — the
    // `email` leg will MISS it, so the chain runs past the `name` leg to `id`.
    store.crm_contact = [{ id: 'ctc_priya', email: 'priya.shah@lattice.example.com' }];

    const metadata = createMetadata({ crm_contact: CONTACT_WITHOUT_NAME, crm_activity: ACTIVITY });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [
        {
          object: 'crm_contact',
          externalId: 'email',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ first_name: 'Ada', last_name: 'Lovelace', email: 'ada@acme.example' }],
        },
        {
          object: 'crm_activity',
          externalId: 'subject',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ subject: 'Discovery Call', contact: 'ctc_priya' }],
        },
      ] as any[],
      config: CONFIG,
    } as any);

    // The point of the card: no refusal was provoked, because no filter on a
    // nonexistent column was ever sent.
    expect(refusals).toEqual([]);
    expect(filteredColumns(engine, 'crm_contact')).not.toContain('name');

    // …and the lookup still resolves, through the same leg it always did.
    expect(result.success).toBe(true);
    const written = (engine.insert as any).mock.calls
      .flatMap(([obj, data]: [string, any]) => (obj === 'crm_activity' ? [data].flat() : []));
    expect(written[0].contact).toBe('ctc_priya');
  });

  it('still probes `name` — and still resolves through it — when the object declares one', async () => {
    const { engine, store, refusals } = createColumnStrictEngine({
      crm_account: ['name', 'code'],
      crm_activity: ['subject', 'account'],
    });
    // Addressable by `name` only: the `code` leg misses, so the `name` leg is
    // the one that must answer.
    store.crm_account = [{ id: 'acc_acme', name: 'Acme Corp', code: 'ACME-1' }];

    const metadata = createMetadata({
      crm_account: { name: 'crm_account', fields: { name: { type: 'text' }, code: { type: 'text' } } },
      crm_activity: {
        name: 'crm_activity',
        fields: { subject: { type: 'text' }, account: { type: 'lookup', reference: 'crm_account' } },
      },
    });

    const result = await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [
        {
          object: 'crm_account',
          externalId: 'code',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          // A DIFFERENT account, so the in-memory map cannot answer for 'Acme Corp'.
          records: [{ name: 'Globex Ltd', code: 'GLOBEX-1' }],
        },
        {
          object: 'crm_activity',
          externalId: 'subject',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ subject: 'Renewal Review', account: 'Acme Corp' }],
        },
      ] as any[],
      config: CONFIG,
    } as any);

    expect(refusals).toEqual([]);
    expect(filteredColumns(engine, 'crm_account')).toContain('name');
    expect(result.success).toBe(true);
    const written = (engine.insert as any).mock.calls
      .flatMap(([obj, data]: [string, any]) => (obj === 'crm_activity' ? [data].flat() : []));
    expect(written[0].account).toBe('acc_acme');
  });

  it('skips the leg in its FIRST position too — a target with no dataset defaults to `name`', async () => {
    // A reference whose target carries no dataset in this load keeps the
    // metadata-level `name` default as its FIRST probe (buildReferenceMap), so
    // the same refusal is provoked one position earlier. Same defect, same fix.
    const { engine, store, refusals } = createColumnStrictEngine({
      crm_contact: ['first_name', 'last_name', 'email'],
      crm_activity: ['subject', 'contact'],
    });
    store.crm_contact = [{ id: 'ctc_priya', email: 'priya.shah@lattice.example.com' }];

    const metadata = createMetadata({ crm_contact: CONTACT_WITHOUT_NAME, crm_activity: ACTIVITY });

    await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [
        {
          object: 'crm_activity',
          externalId: 'subject',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ subject: 'Discovery Call', contact: 'ctc_priya' }],
        },
      ] as any[],
      config: CONFIG,
    } as any);

    expect(refusals).toEqual([]);
    expect(filteredColumns(engine, 'crm_contact')).not.toContain('name');
  });

  it('keeps the leg when NOTHING can describe the object — an unknown is not a denial', async () => {
    // Neither the metadata service nor an engine schema registry knows the
    // target. The honest answer is "unknown", and the historical probe stands:
    // narrowing the chain on a fact nobody established would be this file
    // inventing a column list.
    const { engine, refusals } = createColumnStrictEngine({
      // `crm_contact` has a declared column set on the ENGINE (so the fake can
      // still refuse) while no METADATA describes it.
      crm_contact: ['email'],
      crm_activity: ['subject', 'contact'],
    });

    const metadata = createMetadata({ crm_activity: ACTIVITY });

    await new SeedLoaderService(engine, metadata, createLogger()).load({
      seeds: [
        {
          object: 'crm_activity',
          externalId: 'subject',
          mode: 'upsert',
          env: ['prod', 'dev', 'test'],
          records: [{ subject: 'Discovery Call', contact: 'someone@example.com' }],
        },
      ] as any[],
      config: CONFIG,
    } as any);

    expect(refusals.map((r) => r.column)).toContain('name');
  });

  it('re-asks the registry on the next load — a publish may have added the column', async () => {
    // The answer is memoised per LOAD, not per service instance: a service is
    // reused across loads and a publish between two of them can add the very
    // column the memo is about.
    const columns: Record<string, string[]> = {
      crm_account: ['code'],
      crm_activity: ['subject', 'account'],
    };
    const { engine, store, refusals } = createColumnStrictEngine(columns);
    const objects: Record<string, any> = {
      crm_account: { name: 'crm_account', fields: { code: { type: 'text' } } },
      crm_activity: {
        name: 'crm_activity',
        fields: { subject: { type: 'text' }, account: { type: 'lookup', reference: 'crm_account' } },
      },
    };
    const metadata = createMetadata(objects);
    const loader = new SeedLoaderService(engine, metadata, createLogger());

    const seeds = [
      {
        object: 'crm_activity',
        externalId: 'subject',
        mode: 'upsert',
        env: ['prod', 'dev', 'test'],
        records: [{ subject: 'Renewal Review', account: 'Acme Corp' }],
      },
    ] as any[];

    await loader.load({ seeds, config: CONFIG } as any);
    expect(filteredColumns(engine, 'crm_account')).not.toContain('name');

    // The column is published — in the registry AND in the table — and the row
    // it makes addressable appears.
    objects.crm_account.fields.name = { type: 'text' };
    columns.crm_account.push('name');
    (engine.find as any).mockClear();
    store.crm_account = [{ id: 'acc_acme', name: 'Acme Corp', code: 'ACME-1' }];

    await loader.load({ seeds, config: CONFIG } as any);
    expect(filteredColumns(engine, 'crm_account')).toContain('name');
    expect(refusals).toEqual([]);
  });
});
