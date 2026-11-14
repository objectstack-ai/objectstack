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

/**
 * better-sqlite3 on a field declared `unique: 'organization'`: the index is the
 * composite `(organization_id, name)`, and the organization part is the implied
 * scope, so the column is still determinable.
 */
const organizationScoped = () =>
  Object.assign(
    new Error(
      'insert into `crm_account` (`id`, `name`, `organization_id`) values (?, ?, ?) - ' +
        'UNIQUE constraint failed: crm_account.organization_id, crm_account.name',
    ),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' },
  );

/** …and a declared index over two AUTHORED columns beside it: still a composite. */
const authoredComposite = () =>
  Object.assign(
    new Error('UNIQUE constraint failed: crm_account.organization_id, crm_account.region, crm_account.name'),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' },
  );

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
      // The sentence itself is in the writer's locale too, not only the label in it.
      expect(answer.body.error).toBe('已存在相同客户名称的记录');
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

describe('an organization-scoped unique field names the field, by label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(DOORS)('on %s', (_door, write) => {
    it('the implied organization part is set aside: `field`, `fieldLabel`, and the HTTP sentence name the field', async () => {
      const engine = makeRig(LABELLED, organizationScoped);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure).toBeInstanceOf(DuplicateRecordError);
      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBe('name');
      expect(failure.fieldLabel).toBe('Account Name');
      const answer = mapDataError(failure, 'crm_account');
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('UNIQUE_VIOLATION');
      expect(answer.body.field).toBe('name');
      expect(answer.body.error).toBe('A record with this Account Name already exists');
    });

    it('in the writer\'s locale: the translated label', async () => {
      const engine = makeRig(LABELLED, organizationScoped);
      engine.setI18nService(i18n as any);
      await engine.init();

      const failure = await refusalOf(() => write(engine, { context: { locale: 'zh-CN' } }));

      expect(failure.fieldLabel).toBe('客户名称');
      expect(mapDataError(failure, 'crm_account').body.error).toBe('已存在相同客户名称的记录');
    });

    it('two authored columns beside the organization part: no field, the unnamed sentence', async () => {
      const engine = makeRig(LABELLED, authoredComposite);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure.code).toBe('DUPLICATE_RECORD');
      expect(failure.status).toBe(409);
      expect(failure.field).toBeUndefined();
      expect(failure).not.toHaveProperty('fieldLabel');
      const answer = mapDataError(failure, 'crm_account');
      expect(answer.body).not.toHaveProperty('field');
      expect(answer.body.error).toBe('A record with this value already exists');
    });
  });
});

/**
 * The duplicate refusal's end-user sentence is composed in the writer's
 * locale from the platform operation catalog (`duplicate_record*`), and a
 * composite unique index the object DECLARES is named by its fields' labels.
 * The wire shape does not move: `code` stays `UNIQUE_VIOLATION`, the status
 * 409, and `field` keeps its single-column contract (absent for a composite).
 */
describe('the duplicate refusal speaks the writer\'s locale, and names a declared composite unique index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const WEEKLY = {
    name: 'crm_weekly_cost',
    label: 'Weekly Cost',
    fields: {
      plant: { type: 'text', label: 'Plant' },
      carbon_grade: { type: 'text', label: 'Carbon Grade' },
      cost_week: { type: 'text', label: 'Cost Week' },
    },
    indexes: [{ fields: ['plant', 'carbon_grade', 'cost_week'], unique: 'organization' }],
  };
  const WEEKLY_ZH: Record<string, string> = {
    'objects.crm_weekly_cost.label': '周成本',
    'objects.crm_weekly_cost.fields.plant.label': '工厂',
    'objects.crm_weekly_cost.fields.carbon_grade.label': '牌号',
    'objects.crm_weekly_cost.fields.cost_week.label': '成本周次',
  };
  const weeklyI18n = (overrides: Record<string, string> = {}) => ({
    t: (key: string, locale: string) => overrides[key] ?? ((locale === 'zh-CN' && WEEKLY_ZH[key]) || key),
    getLocales: () => ['en', 'zh-CN'],
  });

  /** better-sqlite3 on the `unique: 'organization'` index: the organization part, then the three authored columns. */
  const sqliteComposite = () =>
    Object.assign(
      new Error(
        'UNIQUE constraint failed: crm_weekly_cost.organization_id, crm_weekly_cost.plant, ' +
          'crm_weekly_cost.carbon_grade, crm_weekly_cost.cost_week',
      ),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    );
  /** node-postgres: the columns ride `error.detail`, the message names the constraint. */
  const postgresComposite = () =>
    Object.assign(new Error('duplicate key value violates unique constraint "uniq_crm_weekly_cost_plant"'), {
      code: '23505',
      detail: 'Key (organization_id, plant, carbon_grade, cost_week)=(org_a, p1, g1, 2026-W45) already exists.',
    });
  const mysqlIndexOnly = () =>
    Object.assign(new Error("Duplicate entry 'p1-g1-2026-W45' for key 'idx_weekly'"), { code: 'ER_DUP_ENTRY', errno: 1062 });

  const WEEKLY_DOORS: Array<[string, (engine: ObjectQL, ctx?: Ctx) => Promise<unknown>]> = [
    ['insert', (engine, ctx = {}) => engine.insert('crm_weekly_cost', { plant: 'p1' }, ctx as any)],
    ['update by id', (engine, ctx = {}) => engine.update('crm_weekly_cost', { id: 'r1', plant: 'p1' }, ctx as any)],
  ];

  const EN_NAMED = 'A record with the same “Plant”, “Carbon Grade”, “Cost Week” already exists';
  const ZH_NAMED = '已存在「工厂」、「牌号」、「成本周次」均相同的记录';

  describe.each(WEEKLY_DOORS)('on %s', (_door, write) => {
    it('en: the declared index\'s fields by label; no `field`, the wire code and status unchanged', async () => {
      const engine = makeRig(WEEKLY, sqliteComposite);
      await engine.init();

      const failure = await refusalOf(() => write(engine));

      expect(failure).toBeInstanceOf(DuplicateRecordError);
      expect(failure.field).toBeUndefined();
      expect(failure).not.toHaveProperty('fieldLabel');
      expect(failure.endUserMessage).toBe(EN_NAMED);
      expect(failure.message).toBe(
        "Duplicate record refused on 'Weekly Cost': a unique constraint on 'Plant', 'Carbon Grade', 'Cost Week' " +
          'already holds these values. No record was written.',
      );
      expect(failure.developerMessage).toMatch(
        /^Duplicate record refused on object 'crm_weekly_cost', unique index fields 'plant', 'carbon_grade', 'cost_week'\. /,
      );
      const answer = mapDataError(failure, 'crm_weekly_cost');
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('UNIQUE_VIOLATION');
      expect(answer.body).not.toHaveProperty('field');
      expect(answer.body).not.toHaveProperty('userMessage');
      expect(answer.body.error).toBe(EN_NAMED);
    });

    it('zh-CN: the sentence and the labels both in the writer\'s locale', async () => {
      const engine = makeRig(WEEKLY, sqliteComposite);
      engine.setI18nService(weeklyI18n() as any);
      await engine.init();

      const failure = await refusalOf(() => write(engine, { context: { locale: 'zh-CN' } }));

      const answer = mapDataError(failure, 'crm_weekly_cost');
      expect(answer.status).toBe(409);
      expect(answer.body.code).toBe('UNIQUE_VIOLATION');
      expect(answer.body).not.toHaveProperty('field');
      expect(answer.body.error).toBe(ZH_NAMED);
    });

    it('the Postgres DETAIL shape matches the same declared index', async () => {
      const engine = makeRig(WEEKLY, postgresComposite);
      engine.setI18nService(weeklyI18n() as any);
      await engine.init();

      const failure = await refusalOf(() => write(engine, { context: { locale: 'zh-CN' } }));

      expect(mapDataError(failure, 'crm_weekly_cost').body.error).toBe(ZH_NAMED);
    });

    it('fallback: a locale the catalog does not carry reads the en sentence, with the declared labels', async () => {
      const engine = makeRig(WEEKLY, sqliteComposite);
      engine.setI18nService(weeklyI18n() as any);
      await engine.init();

      const failure = await refusalOf(() => write(engine, { context: { locale: 'de-DE' } }));

      expect(mapDataError(failure, 'crm_weekly_cost').body.error).toBe(EN_NAMED);
    });

    it('a deployment\'s `errors.duplicate_record_fields` translation overrides the built-in sentence', async () => {
      const engine = makeRig(WEEKLY, sqliteComposite);
      engine.setI18nService(weeklyI18n({ 'errors.duplicate_record_fields': '{{fields}}组合重复。' }) as any);
      await engine.init();

      const failure = await refusalOf(() => write(engine, { context: { locale: 'zh-CN' } }));

      expect(mapDataError(failure, 'crm_weekly_cost').body.error).toBe('「工厂」、「牌号」、「成本周次」组合重复。');
    });
  });

  // Controls: nothing short of a declared unique index with exactly the named
  // columns, every one of them labelled, names a field — a wrong field name is
  // worse than none. Each still answers in the writer's locale.
  const UNTRANSLATED_COST_WEEK = { 'objects.crm_weekly_cost.fields.cost_week.label': 'objects.crm_weekly_cost.fields.cost_week.label' };
  const CONTROLS: Array<[string, unknown, () => unknown, Record<string, string>]> = [
    ['no declared index matches the columns', { ...WEEKLY, indexes: [{ fields: ['plant', 'cost_week'], unique: 'organization' }] }, sqliteComposite, {}],
    ['the matching declared index is not unique', { ...WEEKLY, indexes: [{ fields: ['plant', 'carbon_grade', 'cost_week'], unique: false }] }, sqliteComposite, {}],
    ['the object declares no index', { ...WEEKLY, indexes: undefined }, sqliteComposite, {}],
    // The bundle echoes the key for `cost_week`, so no translation rescues the missing label.
    ['one field of the index has no label', { ...WEEKLY, fields: { ...WEEKLY.fields, cost_week: { type: 'text' } } }, sqliteComposite, UNTRANSLATED_COST_WEEK],
    ['the store named an index, not columns (MySQL)', WEEKLY, mysqlIndexOnly, {}],
  ];

  it.each(CONTROLS)('%s: the unnamed sentence, in zh-CN and en', async (_label, schema, refuse, overrides) => {
    const engine = makeRig(schema, refuse);
    engine.setI18nService(weeklyI18n(overrides) as any);
    await engine.init();

    const zh = await refusalOf(() => engine.insert('crm_weekly_cost', { plant: 'p1' }, { context: { locale: 'zh-CN' } } as any));
    const zhAnswer = mapDataError(zh, 'crm_weekly_cost');
    expect(zhAnswer.status).toBe(409);
    expect(zhAnswer.body.code).toBe('UNIQUE_VIOLATION');
    expect(zhAnswer.body).not.toHaveProperty('field');
    expect(zhAnswer.body.error).toBe('已存在相同值的记录');

    const en = await refusalOf(() => engine.insert('crm_weekly_cost', { plant: 'p1' }));
    expect(mapDataError(en, 'crm_weekly_cost').body.error).toBe('A record with this value already exists');
  });

  it('a single field with no label in zh-CN: the unnamed sentence in Chinese, `field` still the API key', async () => {
    const engine = makeRig(UNLABELLED, namedColumn);
    // A bundle that translates nothing: the field has no label in any locale.
    engine.setI18nService({ t: (key: string) => key, getLocales: () => ['en', 'zh-CN'] } as any);
    await engine.init();

    const failure = await refusalOf(() => engine.insert('crm_account', { name: 'Acme' }, { context: { locale: 'zh-CN' } } as any));

    const answer = mapDataError(failure, 'crm_account');
    expect(answer.body.field).toBe('name');
    expect(answer.body.error).toBe('已存在相同值的记录');
  });
});
