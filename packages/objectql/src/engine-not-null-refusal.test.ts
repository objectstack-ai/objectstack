// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24768] A driver's NOT NULL refusal on a field the object declares leaves the
 * write doors as the record validator's own `ValidationError`, named by the
 * field's label in the caller's locale — on every driver exit and every dialect.
 *
 * `unit_price` (label "Sales Price") is ADR-0113's engine-populated column:
 * `storage: { notNull: true }`, no `required`. The validator judges `required`
 * only, so a write with no value for it reaches the driver, and the DATABASE
 * refuses it. Before this change the door let the driver's error out, and each
 * HTTP door classified it from the text its own way: the runtime dispatcher's
 * `/data` answered `500 INTERNAL_ERROR`, the actions door `400 VALIDATION_ERROR`
 * with the driver's text, `RestServer` `400` with the column key relabelled by a
 * second object read. The doors, on a real driver, are pinned in
 * `packages/runtime/src/dispatcher-not-null-refusal-24768.test.ts` and
 * `packages/rest/src/data-not-null-field-label-24715.test.ts`.
 *
 * Refusals assert `code` and the field envelope, never `toThrow()` alone. The
 * sentence is asked of `renderValidationMessage`, the validator's renderer, and
 * compared with the validator's own refusal on the same request where the
 * locale is what is under test.
 *
 * The driver fixtures are the shapes `notNullViolationSite`'s codes table
 * records per client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { redactPropagatedDriverFault } from '@objectstack/types';
import { renderValidationMessage } from '@objectstack/spec/system';
import { ObjectQL } from './engine';
import { ValidationError, VALIDATION_FAILED_CODE } from './validation/record-validator';
import { DuplicateRecordError } from './duplicate-record-error';
import { NotNullRefusalError } from './not-null-refusal-error';
import { SchemaRegistry } from './registry';
import type { IDataDriver } from '@objectstack/spec/contracts';

vi.mock('./registry', async () => {
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

/** The double's `getObject`, typed (see `engine-insert-duplicate-record.test.ts`). */
const registryDouble = SchemaRegistry as unknown as { getObject: ReturnType<typeof vi.fn> };

type Row = Record<string, unknown>;

const OBJECT = 'line_item';

const SCHEMA = {
  name: OBJECT,
  label: 'Line item',
  fields: {
    name: { type: 'text', label: 'Name' },
    // ADR-0113's engine-populated column: NOT NULL on purpose, not `required`.
    unit_price: { type: 'number', label: 'Sales Price', storage: { notNull: true } },
    // The validator's own `required`, for the parity cases.
    list_price: { type: 'number', label: 'List Price', required: true },
  },
};

/* --------------------------------------------------------------------------
 * Driver fixtures — the dialect shapes, each naming `line_item.unit_price`.
 * ----------------------------------------------------------------------- */

const sqlite = (table = OBJECT, column = 'unit_price') => () =>
  Object.assign(
    new Error(`insert into [statement and bound values redacted] - NOT NULL constraint failed: ${table}.${column}`),
    { code: 'SQLITE_CONSTRAINT_NOTNULL' },
  );
const libsql = () =>
  Object.assign(new Error(`SQLITE_CONSTRAINT: NOT NULL constraint failed: ${OBJECT}.unit_price`), {
    code: 'SQLITE_CONSTRAINT', extendedCode: 'SQLITE_CONSTRAINT_NOTNULL', rawCode: 1299,
  });
const postgres = () =>
  Object.assign(new Error(`null value in column "unit_price" of relation "${OBJECT}" violates not-null constraint`), {
    code: '23502', column: 'unit_price', table: OBJECT,
  });
const mysql = () =>
  Object.assign(new Error("Column 'unit_price' cannot be null"), { code: 'ER_BAD_NULL_ERROR', errno: 1048 });
const sqljs = () => new Error(`NOT NULL constraint failed: ${OBJECT}.unit_price`);

/* --------------------------------------------------------------------------
 * Rig
 * ----------------------------------------------------------------------- */

const STORED: Row[] = [
  { id: 'r1', name: 'a', unit_price: 5, list_price: 7 },
  { id: 'r2', name: 'b', unit_price: 6, list_price: 8 },
];

interface DriverOpts {
  /** What every write method rejects with. */
  refuse: () => unknown;
  /** Omit `bulkCreate` so a batch takes the engine's per-row fallback loop. */
  noBulkCreate?: boolean;
}

function makeDriver(opts: DriverOpts) {
  const driver: any = {
    name: 'fake',
    version: '0.0.0',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),
    execute: vi.fn(),
    find: vi.fn(async () => []),
    // The by-id update reads the prior row before it writes (#7867's not-found gate).
    findOne: vi.fn(async (_obj: string, ast: { where?: { id?: unknown } }) =>
      STORED.find((row) => row.id === ast?.where?.id) ?? null,
    ),
    create: vi.fn(async () => { throw opts.refuse(); }),
    update: vi.fn(async () => { throw opts.refuse(); }),
    updateMany: vi.fn(async () => { throw opts.refuse(); }),
    delete: vi.fn(),
    count: vi.fn(),
  };
  if (!opts.noBulkCreate) driver.bulkCreate = vi.fn(async () => { throw opts.refuse(); });
  return driver as IDataDriver & { create: any; bulkCreate?: any; update: any; updateMany: any };
}

/** A logger that records the doors' `… operation failed` lines (`warn`, `meta.error = { message, stack }`). */
function recordingLogger() {
  const lines: Array<{ msg: string; err: any }> = [];
  const logger = {
    info: vi.fn(), debug: vi.fn(), trace: vi.fn(), error: vi.fn(),
    warn: vi.fn((msg: string, meta?: { error?: unknown }) => { lines.push({ msg, err: meta?.error }); }),
  };
  return { logger, lines };
}

async function makeRig(opts: DriverOpts, schema: unknown = SCHEMA) {
  registryDouble.getObject.mockReturnValue(schema);
  const driver = makeDriver(opts);
  const { logger, lines } = recordingLogger();
  const engine = new ObjectQL({ logger } as any);
  engine.registerDriver(driver, true);
  await engine.init();
  return { engine, driver, lines };
}

/** The rejection, as the value the caller actually receives. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  return run().then(
    () => { throw new Error('expected the write to be refused'); },
    (e) => e as any,
  );
}

/** The catalog sentence the validator renders for `messageKey`. */
const sentence = (messageKey: 'required' | 'required_cleared', label: string, field = 'unit_price', locale?: string) =>
  renderValidationMessage({ messageKey, label, field, params: {} }, { locale });

/** The validator's envelope, for the one field. */
function expectRefusalFor(failure: any, messageKey: 'required' | 'required_cleared', label = 'Sales Price') {
  expect(failure).toBeInstanceOf(ValidationError);
  expect(failure.code).toBe(VALIDATION_FAILED_CODE);
  expect(failure.name).toBe('ValidationError');
  const message = sentence(messageKey, label);
  expect(failure.fields).toEqual([{ field: 'unit_price', code: 'required', message, label }]);
  expect(failure.message).toBe(message);
}

const insertOne = (engine: ObjectQL, opts?: unknown) =>
  engine.insert(OBJECT, { name: 'n', list_price: 1 }, opts as any);
const insertBatch = (engine: ObjectQL) =>
  engine.insert(OBJECT, [{ name: 'n', list_price: 1 }, { name: 'm', list_price: 2 }]);
const updateById = (engine: ObjectQL, opts?: unknown) =>
  engine.update(OBJECT, { id: 'r2', unit_price: null }, opts as any);
const updateByPredicate = (engine: ObjectQL) =>
  engine.update(OBJECT, { unit_price: null }, { where: { name: 'b' }, multi: true } as any);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('[#24768] every driver exit answers with the validator\'s `ValidationError`', () => {
  it('insert, one row: the label, the `required` sentence, the driver\'s error on `cause`', async () => {
    const raw = sqlite()();
    const { engine } = await makeRig({ refuse: () => raw });

    const failure = await refusalOf(() => insertOne(engine));

    expectRefusalFor(failure, 'required');
    expect(failure).toBeInstanceOf(NotNullRefusalError);
    expect(failure.cause).toBeInstanceOf(Error);
    expect(failure.cause.code).toBe('SQLITE_CONSTRAINT_NOTNULL');
    expect(failure.cause.message).toBe((redactPropagatedDriverFault(raw) as Error).message);
    // The driver's text does not become the message a door ships.
    expect(failure.message).not.toMatch(/constraint failed|unit_price/);
  });

  it('insert, a batch through `bulkCreate`', async () => {
    const { engine, driver } = await makeRig({ refuse: sqlite() });
    expectRefusalFor(await refusalOf(() => insertBatch(engine)), 'required');
    expect(driver.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('insert, a batch through the per-row fallback loop', async () => {
    const { engine, driver } = await makeRig({ refuse: sqlite(), noBulkCreate: true });
    expectRefusalFor(await refusalOf(() => insertBatch(engine)), 'required');
    expect(driver.create).toHaveBeenCalled();
  });

  it('update by id: the sentence the validator gives a clear-out (`required_cleared`)', async () => {
    const { engine, driver } = await makeRig({ refuse: sqlite() });
    expectRefusalFor(await refusalOf(() => updateById(engine)), 'required_cleared');
    expect(driver.update).toHaveBeenCalledTimes(1);
  });

  it('update by predicate: the same', async () => {
    const { engine, driver } = await makeRig({ refuse: sqlite() });
    expectRefusalFor(await refusalOf(() => updateByPredicate(engine)), 'required_cleared');
    expect(driver.updateMany).toHaveBeenCalledTimes(1);
  });

  it('the door\'s log line carries the DATABASE\'s diagnosis, not the envelope\'s sentence', async () => {
    const { engine, lines } = await makeRig({ refuse: sqlite() });
    await refusalOf(() => insertOne(engine));
    await refusalOf(() => updateById(engine));

    const insertLine = lines.find((l) => l.msg === 'Insert operation failed');
    const updateLine = lines.find((l) => l.msg === 'Update operation failed');
    expect(String(insertLine?.err?.message)).toMatch(/NOT NULL constraint failed: line_item\.unit_price/);
    expect(String(updateLine?.err?.message)).toMatch(/NOT NULL constraint failed: line_item\.unit_price/);
  });
});

describe('[#24768] every dialect', () => {
  it.each([
    ['better-sqlite3', sqlite()],
    ['libsql', libsql],
    ['node-postgres', postgres],
    ['mysql2', mysql],
    ['sql.js (text only)', sqljs],
  ])('%s', async (_driver, refuse) => {
    const { engine } = await makeRig({ refuse });
    expectRefusalFor(await refusalOf(() => insertOne(engine)), 'required');
  });
});

describe('[#24768] localized the way the validator localizes its own `required`', () => {
  const ZH: Record<string, string> = {
    [`objects.${OBJECT}.fields.unit_price.label`]: '销售价格',
    [`objects.${OBJECT}.fields.list_price.label`]: '标价',
  };
  const i18n = {
    t: (key: string, locale: string) => (locale === 'zh-CN' && ZH[key]) || key,
    getLocales: () => ['en', 'zh-CN'],
  };

  it.each([['zh-CN'], ['zh']])('%s: the translated label in the zh-CN sentence, word for word the validator\'s', async (locale) => {
    const { engine } = await makeRig({ refuse: sqlite() });
    engine.setI18nService(i18n);
    const context = { locale };

    const refusal = await refusalOf(() => insertOne(engine, { context }));
    const expected = sentence('required', '销售价格', 'unit_price', 'zh-CN');
    expect(refusal.fields).toEqual([{ field: 'unit_price', code: 'required', message: expected, label: '销售价格' }]);

    // The validator, on the same request shape, for the field it refuses itself.
    const own = await refusalOf(() => engine.insert(OBJECT, { name: 'n', unit_price: 1 }, { context } as any));
    const ownMessage = own.fields.find((f: any) => f.field === 'list_price')?.message;
    expect(ownMessage).toBe(sentence('required', '标价', 'list_price', 'zh-CN'));
    expect(refusal.fields[0].message.replace('销售价格', 'LABEL')).toBe(ownMessage.replace('标价', 'LABEL'));
  });
});

describe('[#24768] the controls: what the field map cannot name leaves as the driver threw it', () => {
  it('a column no field declares (drift): the driver\'s error, as it leaves the engine', async () => {
    const raw = sqlite(OBJECT, 'legacy_col')();
    const { engine } = await makeRig({ refuse: () => raw });
    const failure = await refusalOf(() => insertOne(engine));
    expect(failure).not.toBeInstanceOf(ValidationError);
    expect(failure.code).toBe('SQLITE_CONSTRAINT_NOTNULL');
  });

  it('a refusal the driver attributes to ANOTHER table: that object\'s door names it, not this one', async () => {
    const { engine } = await makeRig({ refuse: sqlite('other_object', 'unit_price') });
    const failure = await refusalOf(() => insertOne(engine));
    expect(failure).not.toBeInstanceOf(ValidationError);
    expect(failure.code).toBe('SQLITE_CONSTRAINT_NOTNULL');
  });

  it('a NOT NULL code whose column the driver did not name: the driver\'s error', async () => {
    const { engine } = await makeRig({ refuse: () => Object.assign(new Error('insert failed'), { code: '23502' }) });
    const failure = await refusalOf(() => insertOne(engine));
    expect(failure).not.toBeInstanceOf(ValidationError);
    expect(failure.code).toBe('23502');
  });

  it('a unique violation is still the duplicate envelope, never this one', async () => {
    const { engine } = await makeRig({
      refuse: () => Object.assign(new Error(`UNIQUE constraint failed: ${OBJECT}.name`), { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
    });
    const failure = await refusalOf(() => insertOne(engine));
    expect(failure).toBeInstanceOf(DuplicateRecordError);
    expect(failure).not.toBeInstanceOf(ValidationError);
  });

  it('`required` is still the validator\'s, before any driver runs — no pre-write check reads `storage.notNull`', async () => {
    const { engine, driver } = await makeRig({ refuse: sqlite() });
    const failure = await refusalOf(() => engine.insert(OBJECT, { name: 'n' }));
    // `list_price` is refused by the validator; `unit_price` is not judged before the driver.
    expect(failure.fields.map((f: any) => f.field)).toEqual(['list_price']);
    expect(driver.create).not.toHaveBeenCalled();
  });
});
