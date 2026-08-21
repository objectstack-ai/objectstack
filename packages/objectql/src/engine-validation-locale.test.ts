// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

/**
 * #3957 — the CALL SITE, not the catalog.
 *
 * `record-validator.ts` can localize perfectly and still ship English if the
 * engine never hands it a locale. `ExecutionContext.locale` has carried the
 * contract "Drives message catalogs and number/date formatting" since ADR-0053
 * Phase 2 with no consumer — declared ≠ enforced (AGENTS.md PD #10). These
 * tests assert on what a caller actually gets back from `ql.insert` /
 * `ql.update`, for every write shape the engine validates: single insert, batch
 * insert, single-id update, and multi-row update.
 */
vi.mock('./registry', async () => {
  // [#10551] The one shared factory — see `registry-module-mock.ts` for the
  // member set, the #9002 / #9154 lessons it carries, and why the async factory
  // form is what makes this import legal under `vi.mock` hoisting.
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

// The reporting object from the issue: Chinese labels, range-guarded currency.
const SETTLEMENT_SCHEMA = {
  name: 'mes_settlement',
  fields: {
    name: { type: 'text', label: '名称' },
    penalty_amount: { type: 'currency', label: '处罚金额', min: 0 },
    quota_hours: { type: 'number', label: '定额工时', min: 0 },
  },
};

function makeDriver() {
  const driver: any = {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]),
    findOne: vi.fn().mockResolvedValue({ id: 'r1' }),
    create: vi.fn(async (_o: string, row: any) => ({ id: 'r1', ...row })),
    update: vi.fn(async (_o: string, id: string, row: any) => ({ id, ...row })),
    updateMany: vi.fn(async () => 2),
    delete: vi.fn(),
  };
  return driver;
}

async function makeEngine(driver: any) {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'mes_settlement' ? SETTLEMENT_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(driver, true);
  await ql.init();
  return ql;
}

/** The message a write attempt fails with. */
async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e: any) {
    return String(e?.message ?? '');
  }
  throw new Error('expected the write to be rejected');
}

const zhCN = { locale: 'zh-CN' } as any;

describe('engine write path — validation messages honour ExecutionContext.locale (#3957)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('single insert: a zh-CN principal reads Chinese', async () => {
    const ql = await makeEngine(makeDriver());
    const msg = await messageOf(() =>
      ql.insert('mes_settlement', { name: 'S1', penalty_amount: -1 }, { context: zhCN }),
    );
    expect(msg).toBe('处罚金额必须大于或等于 0');
    expect(msg).not.toContain('penalty_amount');
  });

  it('batch insert: each rejected row is localized', async () => {
    const ql = await makeEngine(makeDriver());
    const msg = await messageOf(() =>
      ql.insert(
        'mes_settlement',
        [{ name: 'ok', penalty_amount: 1 }, { name: 'bad', penalty_amount: -1 }],
        { context: zhCN },
      ),
    );
    expect(msg).toBe('处罚金额必须大于或等于 0');
  });

  it('single-id update: localized', async () => {
    const ql = await makeEngine(makeDriver());
    const msg = await messageOf(() =>
      ql.update('mes_settlement', { id: 'r1', quota_hours: -3 }, { context: zhCN }),
    );
    expect(msg).toBe('定额工时必须大于或等于 0');
  });

  it('multi-row update: localized (the bulk call site, cf. #3106)', async () => {
    const driver = makeDriver();
    const ql = await makeEngine(driver);
    const msg = await messageOf(() =>
      ql.update(
        'mes_settlement',
        { quota_hours: -3 },
        { multi: true, where: { name: 'S1' }, context: zhCN } as any,
      ),
    );
    expect(msg).toBe('定额工时必须大于或等于 0');
    // The write never reached storage.
    expect(driver.updateMany).not.toHaveBeenCalled();
  });

  /**
   * No principal locale (a system write, a programmatic call, an anonymous
   * request) keeps the pre-#3957 English rendering — now against the declared
   * label instead of the API name.
   */
  it('no locale: English, and still the label rather than the column name', async () => {
    const ql = await makeEngine(makeDriver());
    const msg = await messageOf(() =>
      ql.insert('mes_settlement', { name: 'S1', penalty_amount: -1 }),
    );
    expect(msg).toBe('处罚金额 must be ≥ 0');
  });

  /**
   * An app whose metadata is authored in English but shipped with a `zh-CN`
   * bundle: the bridged i18n service supplies the translated label.
   */
  it('uses the bridged i18n service for the field label and message overrides', async () => {
    vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
      name === 'mes_settlement'
        ? {
          name: 'mes_settlement',
          fields: { penalty_amount: { type: 'currency', label: 'Penalty Amount', min: 0 } },
        }
        : undefined,
    );
    const ql = new ObjectQL();
    ql.registerDriver(makeDriver(), true);
    await ql.init();
    ql.setI18nService({
      t: (key: string, locale: string) => {
        if (key === 'objects.mes_settlement.fields.penalty_amount.label' && locale === 'zh-CN') return '处罚金额';
        if (key === 'validation.field.min_value' && locale === 'zh-CN') return '{{label}}不得小于 {{min}} 元';
        return key;
      },
    });
    const msg = await messageOf(() =>
      ql.insert('mes_settlement', { penalty_amount: -1 }, { context: zhCN }),
    );
    expect(msg).toBe('处罚金额不得小于 0 元');
  });

  it('a client can format its own text from code + constraint', async () => {
    const ql = await makeEngine(makeDriver());
    try {
      await ql.insert('mes_settlement', { penalty_amount: -1 }, { context: zhCN });
      throw new Error('expected the write to be rejected');
    } catch (e: any) {
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.fields).toEqual([
        expect.objectContaining({
          field: 'penalty_amount',
          code: 'min_value',
          label: '处罚金额',
          constraint: { min: 0 },
        }),
      ]);
    }
  });
});
