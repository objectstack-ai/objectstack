// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24951] A unique refusal's user-facing sentence names the object and the
 * field by their declared `label`.
 *
 * Every door keeps `DuplicateRecordError.message` as thrown, so a refused record
 * save and a screen flow both show it to the end user verbatim — and it used to
 * read `Duplicate record refused on 'crm_account': …`, an API name the user
 * cannot act on. The engine now resolves the labels from its registry at the
 * write, falling back to the API name only where none is declared; the API
 * names stay on `object` / `field` and open `developerMessage`.
 *
 * Asserted through the real write doors (`insert` single and batch, `update`
 * by id and by predicate) on a registry double, so the pin covers the label lookup at each
 * call site and not only the sentence builder.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine';
import { DuplicateRecordError } from './duplicate-record-error';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

vi.mock('./registry', async () => {
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

const registryDouble = SchemaRegistry as unknown as { getObject: ReturnType<typeof vi.fn> };

/** better-sqlite3: names the column, so the envelope carries `field`. */
const namedColumn = () =>
  Object.assign(
    new Error('insert into `crm_account` (`id`, `name`) values (?, ?) - UNIQUE constraint failed: crm_account.name'),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' },
  );

/** mysql2: names the INDEX only, so the envelope carries no `field`. */
const indexOnly = () =>
  Object.assign(new Error("Duplicate entry 'Acme' for key 'idx_account_name'"), { code: 'ER_DUP_ENTRY', errno: 1062 });

const LABELLED = {
  name: 'crm_account',
  label: 'Account',
  fields: { name: { type: 'text', label: 'Account Name' } },
};

const UNLABELLED = {
  name: 'crm_account',
  fields: { name: { type: 'text' } },
};

function makeRig(schema: unknown, refuse: () => unknown) {
  registryDouble.getObject.mockReturnValue(schema);
  const driver: any = {
    name: 'fake',
    version: '0.0.0',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => ({ id: 'r1', name: 'Old' })),
    create: vi.fn(async () => {
      throw refuse();
    }),
    bulkCreate: vi.fn(async () => {
      throw refuse();
    }),
    update: vi.fn(async () => {
      throw refuse();
    }),
    updateMany: vi.fn(async () => {
      throw refuse();
    }),
    delete: vi.fn(),
    count: vi.fn(),
  };
  const engine = new ObjectQL();
  engine.registerDriver(driver as IDataDriver, true);
  return engine;
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  return run().then(
    () => {
      throw new Error('expected the write to be refused');
    },
    (e) => e as any,
  );
}

const DOORS: Array<[string, (engine: ObjectQL) => Promise<unknown>]> = [
  ['insert', (engine) => engine.insert('crm_account', { name: 'Acme' })],
  ['batch insert', (engine) => engine.insert('crm_account', [{ name: 'Acme' }, { name: 'Acme' }])],
  ['update by id', (engine) => engine.update('crm_account', { id: 'r1', name: 'Acme' })],
  ['update by predicate', (engine) => engine.update('crm_account', { name: 'Acme' }, { where: { name: 'Old' }, multi: true } as any)],
];

describe('a unique refusal names the object and field by label (#24951)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(DOORS)('on %s', (_door, write) => {
    it('a labelled object and field: the sentence names both labels, and no API name', async () => {
      const engine = makeRig(LABELLED, namedColumn);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure).toBeInstanceOf(DuplicateRecordError);
      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.message).toBe(
        "Duplicate record refused on 'Account': a unique constraint on 'Account Name' already holds this value. " +
          'No record was written.',
      );
      expect(failure.message).not.toContain('crm_account');
      // The API names stay where diagnostics read them.
      expect(failure.object).toBe('crm_account');
      expect(failure.field).toBe('name');
    });

    it('an unlabelled object and field: the sentence falls back to the API names', async () => {
      const engine = makeRig(UNLABELLED, namedColumn);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.message).toBe(
        "Duplicate record refused on 'crm_account': a unique constraint on 'name' already holds this value. " +
          'No record was written.',
      );
    });

    it('no determinable field: the field-less sentence, naming the object by label', async () => {
      const engine = makeRig(LABELLED, indexOnly);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBeUndefined();
      expect(failure.message).toBe(
        "Duplicate record refused on 'Account': a unique constraint already holds these values. No record was written.",
      );
    });

    it('`developerMessage` names the API names, never the labels', async () => {
      const engine = makeRig(LABELLED, namedColumn);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure.developerMessage).toMatch(/^Duplicate record refused on object 'crm_account', field 'name'\. /);
      expect(failure.developerMessage).not.toContain('Account Name');
    });
  });

  it('a field-less refusal\'s `developerMessage` names the object API name alone', async () => {
    const engine = makeRig(LABELLED, indexOnly);
    await engine.init();

    const failure = await refusalOf(() => engine.insert('crm_account', { name: 'Acme' }));

    expect(failure.developerMessage).toMatch(/^Duplicate record refused on object 'crm_account'\. /);
  });
});
