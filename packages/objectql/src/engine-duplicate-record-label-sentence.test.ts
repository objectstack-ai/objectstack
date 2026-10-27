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
 *
 * [#26867] The same resolution travels on the envelope as `fieldLabel`, which
 * the HTTP doors' user-facing sentence names the field by (`mapDataError`,
 * `@objectstack/types`): "A record with this Account Name already exists",
 * with `field` keeping the API key. It is absent when the field has no label,
 * and the sentence is then the unnamed one. The labels are read in the
 * writer's locale (translation bundle → declared `label`), the ladder the
 * record validator and the `DELETE_RESTRICTED` refusal climb.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine';
import { DuplicateRecordError } from './duplicate-record-error';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { mapDataError } from '@objectstack/types';

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

/** The execution context a write carries — `{}` for a bare-kernel caller. */
type Ctx = { context?: { locale?: string } };

const DOORS: Array<[string, (engine: ObjectQL, ctx?: Ctx) => Promise<unknown>]> = [
  ['insert', (engine, ctx = {}) => engine.insert('crm_account', { name: 'Acme' }, ctx as any)],
  ['batch insert', (engine, ctx = {}) => engine.insert('crm_account', [{ name: 'Acme' }, { name: 'Acme' }], ctx as any)],
  ['update by id', (engine, ctx = {}) => engine.update('crm_account', { id: 'r1', name: 'Acme' }, ctx as any)],
  ['update by predicate', (engine, ctx = {}) => engine.update('crm_account', { name: 'Acme' }, { where: { name: 'Old' }, multi: true, ...ctx } as any)],
];

/** A `zh-CN` bundle for both labels, echoing the key on a miss as `II18nService` does. */
const ZH: Record<string, string> = {
  'objects.crm_account.label': '客户',
  'objects.crm_account.fields.name.label': '客户名称',
};
const i18n = {
  t: (key: string, locale: string) => (locale === 'zh-CN' && ZH[key]) || key,
  getLocales: () => ['en', 'zh-CN'],
};

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
      expect(failure).not.toHaveProperty('fieldLabel');
      expect(failure.message).toBe(
        "Duplicate record refused on 'Account': a unique constraint already holds these values. No record was written.",
      );
    });

    it('[#26867] `fieldLabel` carries the label, and the HTTP sentence names the field by it', async () => {
      const engine = makeRig(LABELLED, namedColumn);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure.fieldLabel).toBe('Account Name');
      const answer = mapDataError(failure, 'crm_account');
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('UNIQUE_VIOLATION');
      expect(answer.body.field).toBe('name');
      expect(answer.body.error).toBe('A record with this Account Name already exists');
    });

    it('[#26867] no label in hand: no `fieldLabel`, and the HTTP sentence is the unnamed one', async () => {
      const engine = makeRig(UNLABELLED, namedColumn);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure).not.toHaveProperty('fieldLabel');
      const answer = mapDataError(failure, 'crm_account');
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('UNIQUE_VIOLATION');
      expect(answer.body.field).toBe('name');
      expect(answer.body.error).toBe('A record with this value already exists');
    });

    it('[#26867] in the writer\'s locale: the translated labels, in both sentences', async () => {
      const engine = makeRig(LABELLED, namedColumn);
      engine.setI18nService(i18n as any);
      await engine.init();

      const failure = await refusalOf(() => write(engine, { context: { locale: 'zh-CN' } }));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.fieldLabel).toBe('客户名称');
      expect(failure.message).toBe(
        "Duplicate record refused on '客户': a unique constraint on '客户名称' already holds this value. " +
          'No record was written.',
      );
      const answer = mapDataError(failure, 'crm_account');
      expect(answer.body.error).toBe('A record with this 客户名称 already exists');
      expect(answer.body.field).toBe('name');
    });

    it('[#26867] a locale the bundle does not translate: the declared labels', async () => {
      const engine = makeRig(LABELLED, namedColumn);
      engine.setI18nService(i18n as any);
      await engine.init();

      const failure = await refusalOf(() => write(engine, { context: { locale: 'en' } }));

      expect(failure.fieldLabel).toBe('Account Name');
      expect(failure.message).toContain("refused on 'Account': a unique constraint on 'Account Name'");
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
