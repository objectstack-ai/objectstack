// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package upgrade plan's comparison (epic cloud#3652 Q3): what it lists
 * for each shape of change between an installed version and the incoming one.
 */

import { describe, expect, it } from 'vitest';
import { SeedMode } from '@objectstack/spec/data';
import {
  comparePackageVersions,
  isEmptyPackageUpgradePlan,
  seedModeOverwritesMatchedRows,
  typeChangeCategory,
  upgradePlanSeedDatasets,
} from './package-upgrade-plan.js';
import { schemaUpgradeVerdict } from './package-upgrade-verdict.js';

type Fields = Record<string, Record<string, unknown>>;

const side = (fields: Fields, extra: Record<string, unknown> = {}) => ({
  objects: [{ name: 'acme_deal', label: 'Deal', fields }],
  ...extra,
});

describe('fields and objects', () => {
  it('an identical pair lists nothing', () => {
    const body = side({ title: { type: 'text' } }, { data: [{ object: 'acme_deal', records: [{ name: 'a' }] }] });
    const plan = comparePackageVersions(body, structuredClone(body));
    expect(isEmptyPackageUpgradePlan(plan)).toBe(true);
  });

  it('objects added and removed are listed by name', () => {
    const plan = comparePackageVersions(
      { objects: [{ name: 'acme_old', fields: {} }, { name: 'acme_kept', fields: {} }] },
      { objects: [{ name: 'acme_kept', fields: {} }, { name: 'acme_new', fields: {} }] },
    );
    expect(plan.objects).toEqual({ added: ['acme_new'], removed: ['acme_old'] });
  });

  it('a field added carries whether it is required; a field removed whether it is stored', () => {
    const plan = comparePackageVersions(
      side({ title: { type: 'text' }, total: { type: 'formula' } }),
      side({ title: { type: 'text' }, code: { type: 'text', required: true } }),
    );
    expect(plan.fields.added).toEqual([{ object: 'acme_deal', field: 'code', type: 'text', required: true, stored: true }]);
    expect(plan.fields.removed).toEqual([{ object: 'acme_deal', field: 'total', type: 'formula', required: false, stored: false }]);
    // A computed field held no column: its removal is no suspected rename.
    expect(plan.suspectedRenames).toEqual([]);
  });
});

describe('renames', () => {
  it('a field removed and one added of the same type in one object, no renamedFrom → one suspected rename', () => {
    const plan = comparePackageVersions(side({ company: { type: 'text' } }), side({ account_name: { type: 'text' } }));
    expect(plan.suspectedRenames).toEqual([
      { object: 'acme_deal', field: 'company', type: 'text', candidates: [{ field: 'account_name', type: 'text' }] },
    ]);
    expect(plan.declaredRenames).toEqual([]);
    // Nothing declares a rename, so both keys are still listed as removed and added.
    expect(plan.fields.removed.map((f) => f.field)).toEqual(['company']);
    expect(plan.fields.added.map((f) => f.field)).toEqual(['account_name']);
  });

  it("the same pair with renamedFrom: ['company'] on the new field → one declared rename and no suspected rename", () => {
    const plan = comparePackageVersions(
      side({ company: { type: 'text' } }),
      side({ account_name: { type: 'text', renamedFrom: ['company'] } }),
    );
    expect(plan.declaredRenames).toEqual([
      { object: 'acme_deal', from: 'company', to: 'account_name', fromType: 'text', toType: 'text' },
    ]);
    expect(plan.suspectedRenames).toEqual([]);
    expect(plan.fields.added).toEqual([]);
    expect(plan.fields.removed).toEqual([]);
    expect(plan.typeChanges).toEqual([]);
  });

  it('a declared rename whose type changes is ALSO a type change, judged on its own', () => {
    const plan = comparePackageVersions(
      side({ amount: { type: 'text' } }),
      side({ amount_value: { type: 'number', renamedFrom: ['amount'] } }),
    );
    expect(plan.declaredRenames).toEqual([
      { object: 'acme_deal', from: 'amount', to: 'amount_value', fromType: 'text', toType: 'number' },
    ]);
    // `needs_confirm`, not `destructive`: the declared rename does not decide
    // whether the type change is reported.
    expect(plan.typeChanges).toEqual([
      { object: 'acme_deal', field: 'amount_value', from: 'text', to: 'number', category: 'needs_confirm', renamedFrom: 'amount' },
    ]);
  });

  it('a renamedFrom naming a key the installed version does not have declares nothing', () => {
    const plan = comparePackageVersions(
      side({ company: { type: 'text' } }),
      side({ account_name: { type: 'text', renamedFrom: ['firm'] } }),
    );
    expect(plan.declaredRenames).toEqual([]);
    expect(plan.suspectedRenames).toHaveLength(1);
  });

  it('a renamedFrom naming a key the new version still declares is no rename', () => {
    const plan = comparePackageVersions(
      side({ company: { type: 'text' } }),
      side({ company: { type: 'text' }, account_name: { type: 'text', renamedFrom: ['company'] } }),
    );
    expect(plan.declaredRenames).toEqual([]);
    expect(plan.fields.added.map((f) => f.field)).toEqual(['account_name']);
  });

  it('one removed field and two added name both as candidates; a linked pair is not a candidate', () => {
    const plan = comparePackageVersions(
      side({ company: { type: 'text' }, region: { type: 'select' } }),
      side({ account_name: { type: 'text' }, area: { type: 'select', renamedFrom: ['region'] }, note: { type: 'textarea' } }),
    );
    expect(plan.declaredRenames.map((r) => `${r.from}→${r.to}`)).toEqual(['region→area']);
    expect(plan.suspectedRenames).toEqual([
      {
        object: 'acme_deal', field: 'company', type: 'text',
        candidates: [{ field: 'account_name', type: 'text' }, { field: 'note', type: 'textarea' }],
      },
    ]);
  });
});

describe('type changes', () => {
  it('a type change carries its drift category', () => {
    const plan = comparePackageVersions(
      side({ stage: { type: 'text' }, score: { type: 'formula' }, total: { type: 'number' } }),
      side({ stage: { type: 'select' }, score: { type: 'number' }, total: { type: 'formula' } }),
    );
    expect(plan.typeChanges).toEqual([
      { object: 'acme_deal', field: 'stage', from: 'text', to: 'select', category: 'needs_confirm' },
      { object: 'acme_deal', field: 'score', from: 'formula', to: 'number', category: 'safe' },
      { object: 'acme_deal', field: 'total', from: 'number', to: 'formula', category: 'destructive' },
    ]);
  });

  it('the category reads the storage fact, one rule per case', () => {
    expect(typeChangeCategory({ type: 'formula' }, { type: 'text' })).toBe('safe');
    expect(typeChangeCategory({ type: 'text' }, { type: 'formula' })).toBe('destructive');
    expect(typeChangeCategory({ type: 'text' }, { type: 'number' })).toBe('needs_confirm');
  });
});

describe('seed datasets', () => {
  const records = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `r${i}`, label: `Row ${i}` }));

  it('an upsert dataset change and an ignore dataset change are both listed with their modes', () => {
    const plan = comparePackageVersions(
      side({}, { data: [
        { object: 'acme_deal', mode: 'upsert', records: records(2) },
        { object: 'acme_stage', mode: 'ignore', records: records(1) },
      ] }),
      side({}, { data: [
        { object: 'acme_deal', mode: 'upsert', records: records(3) },
        { object: 'acme_stage', mode: 'ignore', records: [{ name: 'r0', label: 'Renamed' }] },
      ] }),
    );
    expect(plan.seeds.changed).toEqual([
      { key: 'acme_deal', object: 'acme_deal', externalId: 'name', mode: 'upsert', records: 3, fromMode: 'upsert', fromRecords: 2, changed: ['records'] },
      { key: 'acme_stage', object: 'acme_stage', externalId: 'name', mode: 'ignore', records: 1, fromMode: 'ignore', fromRecords: 1, changed: ['records'] },
    ]);
  });

  it('a dataset that declares no mode is listed under the spec default', () => {
    const plan = comparePackageVersions(side({}), side({}, { data: [{ object: 'acme_deal', records: records(1) }] }));
    expect(plan.seeds.added).toEqual([{ key: 'acme_deal', object: 'acme_deal', externalId: 'name', mode: 'ignore', records: 1 }]);
  });

  it('a removed dataset and a mode change are listed', () => {
    const plan = comparePackageVersions(
      side({}, { data: [{ object: 'acme_deal', mode: 'ignore', records: records(1) }, { object: 'acme_old', records: records(1) }] }),
      side({}, { data: [{ object: 'acme_deal', mode: 'upsert', records: records(1) }] }),
    );
    expect(plan.seeds.removed.map((d) => d.key)).toEqual(['acme_old']);
    expect(plan.seeds.changed).toEqual([expect.objectContaining({ key: 'acme_deal', mode: 'upsert', fromMode: 'ignore', changed: ['mode'] })]);
  });

  it('the modes whose replay writes over a row it matches, of every mode the spec declares', () => {
    expect(SeedMode.options.filter(seedModeOverwritesMatchedRows)).toEqual(['update', 'upsert']);
  });

  it('a dataset is keyed by its object, its non-default match key and locales, and its repeat', () => {
    const keys = [...upgradePlanSeedDatasets({ data: [
      { object: 'acme_deal', records: [] },
      { object: 'acme_deal', externalId: 'code', records: [] },
      { object: 'acme_deal', locale: ['zh-CN', 'en'], records: [] },
      { object: 'acme_deal', records: [] },
    ] }).keys()];
    expect(keys).toEqual(['acme_deal', 'acme_deal by code', 'acme_deal [en,zh-CN]', 'acme_deal #2']);
  });

  it('record key order is not a change', () => {
    const plan = comparePackageVersions(
      side({}, { data: [{ object: 'acme_deal', records: [{ name: 'a', label: 'A' }] }] }),
      side({}, { data: [{ object: 'acme_deal', records: [{ label: 'A', name: 'a' }] }] }),
    );
    expect(plan.seeds.changed).toEqual([]);
  });
});

describe('objectExtensions: an extension field counts like an owned one (#34095)', () => {
  // HotCRM's shape: one package owns `crm_account`, another of the same
  // artifact adds receivables figures to it through `objectExtensions`.
  const ACCOUNT = { name: 'crm_account', label: 'Account', fields: { name: { type: 'text' } } };
  const extending = (fields: Fields, extra: Record<string, unknown> = {}) => ({ extend: 'crm_account', fields, ...extra });
  const SUMMARY = { type: 'summary', summaryOperations: { object: 'crm_invoice', field: 'amount', function: 'sum' } };

  it('an extension field the incoming version adds is listed in fields.added, as an owned one is', () => {
    const plan = comparePackageVersions(
      { objects: [ACCOUNT] },
      { objects: [ACCOUNT], objectExtensions: [extending({ invoiced_amount: SUMMARY, received_amount: SUMMARY })] },
    );
    expect(plan.fields.added).toEqual([
      { object: 'crm_account', field: 'invoiced_amount', type: 'summary', required: false, stored: true },
      { object: 'crm_account', field: 'received_amount', type: 'summary', required: false, stored: true },
    ]);
    expect(plan.objects).toEqual({ added: [], removed: [] });
  });

  it('the rollback lists the same fields in fields.removed', () => {
    const plan = comparePackageVersions(
      { objects: [ACCOUNT], objectExtensions: [extending({ invoiced_amount: SUMMARY })] },
      { objects: [ACCOUNT] },
    );
    expect(plan.fields.removed).toEqual([{ object: 'crm_account', field: 'invoiced_amount', type: 'summary', required: false, stored: true }]);
  });

  it('an object reached only through an extension (another package owns it) is compared by the fields added, never listed as an object', () => {
    const added = comparePackageVersions({}, { objectExtensions: [extending({ tier: { type: 'text' } })] });
    expect(added.fields.added).toEqual([{ object: 'crm_account', field: 'tier', type: 'text', required: false, stored: true }]);
    expect(added.objects).toEqual({ added: [], removed: [] });

    const removed = comparePackageVersions({ objectExtensions: [extending({ tier: { type: 'text' } })] }, {});
    expect(removed.fields.removed).toEqual([{ object: 'crm_account', field: 'tier', type: 'text', required: false, stored: true }]);
    expect(removed.objects).toEqual({ added: [], removed: [] });
  });

  it('a retyped extension field is a type change, and the verdict asks its confirmation', () => {
    const plan = comparePackageVersions(
      { objectExtensions: [extending({ tier: { type: 'text' }, score: { type: 'number' } })] },
      { objectExtensions: [extending({ tier: { type: 'number' }, score: { type: 'formula' } })] },
    );
    expect(plan.typeChanges).toEqual([
      { object: 'crm_account', field: 'tier', from: 'text', to: 'number', category: 'needs_confirm' },
      { object: 'crm_account', field: 'score', from: 'number', to: 'formula', category: 'destructive' },
    ]);
    expect(schemaUpgradeVerdict('com.acme.o2c', plan).findings.map((f) => f.kind === 'type_change' && `${f.field}:${f.category}`))
      .toEqual(['tier:needs_confirm', 'score:destructive']);
  });

  it('a dropped extension field is listed removed and judged as an owned drop: alone it is refused by nothing, beside an added one it is a suspected rename', () => {
    const before = { objects: [ACCOUNT], objectExtensions: [extending({ tier: { type: 'text' } })] };
    const dropped = comparePackageVersions(before, { objects: [ACCOUNT] });
    expect(dropped.fields.removed).toEqual([{ object: 'crm_account', field: 'tier', type: 'text', required: false, stored: true }]);
    // The verdict's rule for a removed field (ruling record 6709061297): reported by a dry run, refused by nothing.
    expect(schemaUpgradeVerdict('com.acme.o2c', dropped).findings).toEqual([]);

    const replaced = comparePackageVersions(before, { objects: [ACCOUNT], objectExtensions: [extending({ segment: { type: 'text' } })] });
    expect(replaced.suspectedRenames).toEqual([{ object: 'crm_account', field: 'tier', type: 'text', candidates: [{ field: 'segment', type: 'text' }] }]);
    expect(schemaUpgradeVerdict('com.acme.o2c', replaced).findings).toEqual([expect.objectContaining({ kind: 'suspected_rename', field: 'tier' })]);
  });

  it('the fields compared are the served ones: the extension with the higher priority writes last', () => {
    const ext = (type: string, priority?: number) => extending({ tier: { type } }, priority === undefined ? {} : { priority });
    // Listed low → high, and high → low: the 300 extension's `number` is served either way.
    for (const extensions of [[ext('text'), ext('number', 300)], [ext('number', 300), ext('text')]]) {
      const plan = comparePackageVersions({ objects: [ACCOUNT], objectExtensions: [ext('text')] }, { objects: [ACCOUNT], objectExtensions: extensions });
      expect(plan.typeChanges).toEqual([{ object: 'crm_account', field: 'tier', from: 'text', to: 'number', category: 'needs_confirm' }]);
    }
  });

  it('CONTROL: an owned-field plan is unchanged by the fold', () => {
    const before = side({ title: { type: 'text' }, legacy: { type: 'text' } });
    const after = side({ title: { type: 'number' }, fresh: { type: 'text' } });
    const owned = comparePackageVersions(before, after);
    // The same pair with empty extension lists, and with an unchanged extension of another object.
    const unchanged = { objectExtensions: [{ extend: 'crm_account', fields: { tier: { type: 'text' } } }] };
    expect(JSON.stringify(comparePackageVersions({ ...before, objectExtensions: [] }, { ...after, objectExtensions: [] }))).toBe(JSON.stringify(owned));
    expect(JSON.stringify(comparePackageVersions({ ...before, ...unchanged }, { ...after, ...unchanged }))).toBe(JSON.stringify(owned));
  });
});
