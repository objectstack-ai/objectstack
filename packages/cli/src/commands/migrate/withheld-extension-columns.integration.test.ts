// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30626] The `os migrate` value walks on a real engine (`ObjectQL` + sqlite
 * `SqlDriver`) while a module package that extends the walked object is
 * disabled.
 *
 * The walks scope by the served fold, which withholds a disabled package's
 * extension fields (#30304) while the storage fold keeps their columns and
 * values. Pinned: each walk's report names every in-scope column it skipped
 * that way (object, field, package id) and its plan prints it; with the
 * package enabled the same column is read and nothing is named.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { cleanBlankSingleValues, formatBlankSingleValuesReport } from './blank-single-values.js';
import { cleanBlankMultiValues, formatBlankMultiValuesReport } from './blank-multi-values.js';
import { migrateOptionCodes, formatOptionCodesReport } from './option-codes.js';
import { migrateTextScalars, formatTextScalarsReport } from './text-scalars.js';
import { withheldColumns, formatWithheldColumns } from '../../utils/migrate-withheld-columns.js';

const APP_PKG = 'com.qa.wx.app';
const MODULE_PKG = 'com.qa.wx.loyalty';
const OBJECT = 'wx_account';
const OPTS = [{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'Silver' }];

const manifest = (id: string, type: string) =>
  ({ id, name: id, version: '1.0.0', type, namespace: 'wx', ...(type === 'module' ? { dependencies: { [APP_PKG]: '^1.0.0' } } : {}) }) as any;
const OWNER = {
  name: OBJECT, label: 'Account', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
  },
};
/** A column for each walk to rewrite, each added only by the module's extension. */
const EXTENSION = {
  name: OBJECT,
  fields: {
    wx_tier: { name: 'wx_tier', type: 'select', options: OPTS },
    wx_level: { name: 'wx_level', type: 'select', options: [{ value: '3', label: 'Three' }] },
    wx_tags: { name: 'wx_tags', type: 'multiselect', options: OPTS },
    wx_note: { name: 'wx_note', type: 'text' },
  },
};

const silent = { info: () => {}, warn: () => {} };
const live: ObjectQL[] = [];
afterEach(async () => {
  while (live.length) {
    try { await live.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  live.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.installPackage(manifest(APP_PKG, 'app'), 'code');
  engine.registry.installPackage(manifest(MODULE_PKG, 'module'), 'code');
  engine.registry.registerObject(OWNER as any, APP_PKG, 'wx', 'own');
  engine.registry.registerObject(EXTENSION as any, MODULE_PKG, 'wx', 'extend');
  await engine.syncSchemas();
  // The legacy values each walk would rewrite, written below the engine's door.
  await driver.create(OBJECT, { id: 'r1', name: 'A', wx_tier: '', wx_level: 3, wx_tags: [], wx_note: 7 });
  return engine;
}

/** `column`: the one this walk rewrites; `inScope`: every extension column its own rule covers. */
const WALKS = [
  { label: 'blank-single-values', column: 'wx_tier', inScope: ['wx_level', 'wx_tier'], run: cleanBlankSingleValues, format: formatBlankSingleValuesReport },
  { label: 'blank-multi-values', column: 'wx_tags', inScope: ['wx_tags'], run: cleanBlankMultiValues, format: formatBlankMultiValuesReport },
  { label: 'option-codes', column: 'wx_level', inScope: ['wx_level', 'wx_tags', 'wx_tier'], run: migrateOptionCodes, format: formatOptionCodesReport },
  { label: 'text-scalars', column: 'wx_note', inScope: ['wx_note'], run: migrateTextScalars, format: formatTextScalarsReport },
] as const;

describe('os migrate value walks: a disabled module\'s extension columns are named (#30626)', () => {
  let engine: ObjectQL;
  beforeEach(async () => { engine = await boot(); });

  for (const walk of WALKS) {
    it(`${walk.label}: the control — enabled, the column is read and nothing is named`, async () => {
      const report: any = await walk.run(engine as any, silent, {});
      expect(report.columns.map((c: any) => `${c.object}.${c.field}`)).toContain(`${OBJECT}.${walk.column}`);
      expect(report.withheldColumns).toEqual([]);
      expect(walk.format(report).join('\n')).not.toContain(`(package ${MODULE_PKG})`);
    });

    it(`${walk.label}: disabled, the plan names each skipped in-scope column with its package`, async () => {
      engine.registry.disablePackage(MODULE_PKG);
      const report: any = await walk.run(engine as any, silent, {});
      expect(report.columns).toEqual([]);
      expect(report.withheldColumns).toEqual(walk.inScope.map((field) => ({ object: OBJECT, field, packageId: MODULE_PKG })));
      expect(walk.format(report)).toContain(`  • ${OBJECT}.${walk.column} (package ${MODULE_PKG})`);
    });
  }

  it('value-shapes (no column rule): every withheld field of the object is named', async () => {
    engine.registry.disablePackage(MODULE_PKG);
    const named = withheldColumns(engine as any, undefined);
    expect(named.map((c) => c.field)).toEqual(['wx_level', 'wx_note', 'wx_tags', 'wx_tier']);
    expect(named.every((c) => c.object === OBJECT && c.packageId === MODULE_PKG)).toBe(true);
    expect(formatWithheldColumns(named)).toHaveLength(5);
  });
});
