// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24863] The pick `reader-locale-labels.ts` makes, in isolation.
 *
 *  - The keys: each one the reader asks is an address the translation contract
 *    DECLARES. Every key is turned back into the nested bundle shape a pack
 *    carries and parsed by `TranslationDataSchema`, so a spelling the `flows`
 *    face does not declare is red here, not silently a miss at read time. A
 *    control proves the round trip can fail.
 *  - The pick: the reader's locale is negotiated against the service's locales
 *    (`resolveBundleLocale`), a miss (the echoed key, an empty or blank entry)
 *    or a throwing service picks nothing, and a read with no locale or no
 *    service picks nothing at all.
 *  - The overlay: the step is served under two names that move together, and a
 *    label nothing is picked for keeps the row's own value.
 *
 * The i18n service is the REAL in-memory implementation (`createMemoryI18n`,
 * `@objectstack/core`), loaded the way `AppPlugin` loads a stack's packs.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { SchemaRegistry } from '@objectstack/objectql';
import { TranslationDataSchema, objectLabelKey, translateMetadataDocument } from '@objectstack/spec/system';

import {
  approvalStepLabelKey,
  flowLabelKey,
  flowNameOfProcess,
  localizeRequestLabels,
  negotiatedReaderLocale,
  positionLabelKey,
  readerLabelsFor,
  type ReaderLabelI18n,
} from './reader-locale-labels.js';

/** A dot-notation key and its value, as the nested object a language pack carries. */
function packOf(entries: Record<string, string>): Record<string, unknown> {
  const pack: Record<string, any> = {};
  for (const [key, value] of Object.entries(entries)) {
    const parts = key.split('.');
    let at = pack;
    for (const part of parts.slice(0, -1)) at = (at[part] ??= {});
    at[parts[parts.length - 1]] = value;
  }
  return pack;
}

function i18nWith(packs: Record<string, Record<string, string>>) {
  const i18n = createMemoryI18n();
  for (const [locale, entries] of Object.entries(packs)) i18n.loadTranslations(locale, packOf(entries));
  return i18n;
}

const ZH = {
  [flowLabelKey('account_approval')]: '客户审批',
  [approvalStepLabelKey('account_approval', 'manager_review')]: '经理审核',
  [objectLabelKey('account')]: '客户',
  [positionLabelKey('crm_sales_manager')]: '销售经理',
};

describe('[#24863] every key the reader asks is one the translation contract declares', () => {
  it('spells the flow label, the approval step label and the object label', () => {
    expect(flowLabelKey('account_approval')).toBe('flows.account_approval.label');
    expect(approvalStepLabelKey('account_approval', 'manager_review'))
      .toBe('flows.account_approval.approvals.manager_review.label');
    expect(objectLabelKey('account')).toBe('objects.account.label');
    expect(positionLabelKey('crm_sales_manager')).toBe('positions.crm_sales_manager.label');
  });

  it('a pack holding exactly those keys parses, and keeps each value at its address', () => {
    const result = TranslationDataSchema.safeParse(packOf(ZH)) as { success: boolean; data?: any; error?: unknown };
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(result.data.flows.account_approval.label).toBe('客户审批');
    expect(result.data.flows.account_approval.approvals.manager_review.label).toBe('经理审核');
    expect(result.data.objects.account.label).toBe('客户');
    expect(result.data.positions.crm_sales_manager.label).toBe('销售经理');
  });

  it('control: the same round trip refuses a step key the face does not declare', () => {
    const result = TranslationDataSchema.safeParse(packOf({ 'flows.account_approval.approvals.manager_review.heading': 'x' }));
    expect(result.success).toBe(false);
  });
});

describe('[#24863] the flow a process name names', () => {
  it('is the name after the `flow:` prefix', () => {
    expect(flowNameOfProcess('flow:account_approval')).toBe('account_approval');
  });

  it('is none for a name without the prefix, or with nothing after it', () => {
    expect(flowNameOfProcess('account_approval')).toBeUndefined();
    expect(flowNameOfProcess('flow:')).toBeUndefined();
    expect(flowNameOfProcess(undefined)).toBeUndefined();
  });
});

describe('[#24863] the pick', () => {
  it('reads the reader\'s locale, negotiated: a bare `zh` reaches the `zh-CN` pack', () => {
    const i18n = i18nWith({ 'zh-CN': ZH });
    for (const locale of ['zh-CN', 'zh']) {
      const labels = readerLabelsFor(i18n, locale)!;
      expect(labels.flowLabel('account_approval')).toBe('客户审批');
      expect(labels.stepLabel('account_approval', 'manager_review')).toBe('经理审核');
      expect(labels.objectLabel('account')).toBe('客户');
      expect(labels.positionLabel('crm_sales_manager')).toBe('销售经理');
    }
  });

  it('negotiates through `resolveBundleLocale` even for a service that resolves exactly', () => {
    // A service that answers only the exact tag it holds, as `FileI18nAdapter` does.
    // [#35384] Asked of the step's label, now read off the service's translations.
    const packs: Record<string, Record<string, unknown>> = { en: {}, 'zh-CN': packOf({ [approvalStepLabelKey('f', 'n')]: '步骤' }) };
    const exact: ReaderLabelI18n = {
      t: (key) => key,
      getLocales: () => ['en', 'zh-CN'],
      getTranslations: (locale) => packs[locale] ?? {},
    };
    expect(readerLabelsFor(exact, 'zh')!.stepLabel('f', 'n')).toBe('步骤');
  });

  it('picks nothing on a miss: no entry, an empty entry, a blank entry', () => {
    const i18n = i18nWith({ 'zh-CN': { [flowLabelKey('empty')]: '', [flowLabelKey('blank')]: '  ' } });
    const labels = readerLabelsFor(i18n, 'zh-CN')!;
    expect(labels.flowLabel('account_approval')).toBeUndefined();
    expect(labels.flowLabel('empty')).toBeUndefined();
    expect(labels.flowLabel('blank')).toBeUndefined();
  });

  it('picks nothing for a locale no pack holds', () => {
    expect(readerLabelsFor(i18nWith({ 'zh-CN': ZH }), 'ja-JP')!.flowLabel('account_approval')).toBeUndefined();
  });

  it('picks nothing from a service that throws, and does not throw itself', () => {
    const throwing: ReaderLabelI18n = {
      t: () => { throw new Error('i18n exploded'); },
      getLocales: () => { throw new Error('locales exploded'); },
    };
    expect(readerLabelsFor(throwing, 'zh-CN')!.flowLabel('account_approval')).toBeUndefined();
  });

  it('is no pick at all for a read with no locale, or with no service', () => {
    expect(readerLabelsFor(i18nWith({ 'zh-CN': ZH }), undefined)).toBeUndefined();
    expect(readerLabelsFor(i18nWith({ 'zh-CN': ZH }), '')).toBeUndefined();
    expect(readerLabelsFor(undefined, 'zh-CN')).toBeUndefined();
  });

  it('asks the service once per read, and never through t()', () => {
    const asked: string[] = [];
    let reads = 0;
    const counting: ReaderLabelI18n = {
      t: (key) => { asked.push(key); return key; },
      getLocales: () => ['zh-CN'],
      getTranslations: () => { reads += 1; return packOf(ZH); },
    };
    const labels = readerLabelsFor(counting, 'zh-CN')!;
    expect(labels.stepLabel('account_approval', 'manager_review')).toBe('经理审核');
    labels.stepLabel('account_approval', 'manager_review');
    expect(reads).toBe(1);
    expect(asked).toEqual([]);
  });
});

describe('[#24863] the overlay on a served row', () => {
  const served = () => ({
    process_name: 'flow:account_approval',
    current_step: 'manager_review',
    object_name: 'account',
    process_label: 'Account Approval',
    step_label: 'Manager Review',
    current_step_label: 'Manager Review',
    object_label: 'Account',
  });

  it('moves the flow label, both names of the step label, and the object label', () => {
    const row = served();
    localizeRequestLabels(row, readerLabelsFor(i18nWith({ 'zh-CN': ZH }), 'zh-CN')!);
    expect(row).toMatchObject({
      process_label: '客户审批', step_label: '经理审核', current_step_label: '经理审核', object_label: '客户',
    });
  });

  it('keeps each label nothing is picked for', () => {
    const row = served();
    localizeRequestLabels(row, readerLabelsFor(i18nWith({ 'zh-CN': { [flowLabelKey('account_approval')]: '客户审批' } }), 'zh-CN')!);
    expect(row).toMatchObject({
      process_label: '客户审批', step_label: 'Manager Review', current_step_label: 'Manager Review', object_label: 'Account',
    });
  });

  it('reads no flow key for a process name that names no flow', () => {
    const row = { ...served(), process_name: 'account_approval' };
    localizeRequestLabels(row, readerLabelsFor(i18nWith({ 'zh-CN': ZH }), 'zh-CN')!);
    expect(row).toMatchObject({ process_label: 'Account Approval', step_label: 'Manager Review', object_label: '客户' });
  });
});

/**
 * [#35384] The object's label is resolved the way the metadata route serves
 * it — `translateObject` over every locale the service holds, with `/meta`'s
 * `ResolveOptions` (the reader's locale, the declared fallback chain, and the
 * authored language: the declared `sourceLocale`, else `defaultLocale`) — and
 * never through `t()`.
 *
 * The scenario: an app authored in English (`sourceLocale: 'en'`) that
 * defaults its users to Chinese (`defaultLocale: 'zh-CN'`) and ships a
 * `zh-CN` pack only, so `t('objects.account.label', 'en')` falls to the
 * `zh-CN` row. `/meta` answers an `en` request with the authored label
 * (`packages/rest/src/meta-i18n-declared-fallback-chain.test.ts` §6 pins that
 * half); this reader must say the same, which here means picking nothing so
 * the declared label stands. CONTROLS: a `zh-CN` reader still reads the
 * `zh-CN` row, and with no `sourceLocale` declared an `en` reader walks the
 * declared fallback to it, as `/meta` does.
 */
describe('[#35384] the object label in the declared sourceLocale reads as authored', () => {
  /** The real in-memory service, declared as `AppPlugin.loadTranslations` declares it. */
  const declaredMemory = () => {
    const i18n = i18nWith({ 'zh-CN': ZH });
    i18n.setDefaultLocale('zh-CN');
    i18n.setFallbackLocale('zh-CN');
    i18n.setSourceLocale('en');
    return i18n;
  };
  /** The served adapter's shape (`FileI18nAdapter`): requested locale, then the declared fallback, then the key. */
  const servedI18n = (declared: { defaultLocale: string; sourceLocale?: string }): ReaderLabelI18n => {
    const packs: Record<string, Record<string, unknown>> = { 'zh-CN': packOf(ZH) };
    const fallback = declared.defaultLocale;
    const read = (data: unknown, key: string): string | undefined => {
      let cur: unknown = data;
      for (const part of key.split('.')) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
      }
      return typeof cur === 'string' ? cur : undefined;
    };
    return {
      t: (key, locale) => read(packs[locale], key) ?? (fallback !== locale ? read(packs[fallback], key) : undefined) ?? key,
      getLocales: () => Object.keys(packs),
      getTranslations: (locale) => packs[locale] ?? {},
      getDefaultLocale: () => declared.defaultLocale,
      getFallbackLocale: () => fallback,
      getSourceLocale: () => declared.sourceLocale,
    };
  };

  it('an en reader picks no defaultLocale row: the declared label stands (real in-memory service)', () => {
    const i18n = declaredMemory();
    // The defect's precondition, read at the same service: `t()` falls to the zh-CN row.
    expect(i18n.t(objectLabelKey('account'), 'en')).toBe('客户');
    expect(readerLabelsFor(i18n, 'en')!.objectLabel('account')).toBeUndefined();
  });

  it('an en reader picks no defaultLocale row (served adapter shape)', () => {
    const i18n = servedI18n({ defaultLocale: 'zh-CN', sourceLocale: 'en' });
    expect(i18n.t(objectLabelKey('account'), 'en')).toBe('客户');
    expect(readerLabelsFor(i18n, 'en')!.objectLabel('account')).toBeUndefined();
  });

  it('the inbox row keeps its authored object label for an en reader', () => {
    const row = {
      process_name: 'flow:account_approval', current_step: 'manager_review', object_name: 'account',
      process_label: 'Account Approval', step_label: 'Manager Review', current_step_label: 'Manager Review',
      object_label: 'Account',
    };
    localizeRequestLabels(row, readerLabelsFor(servedI18n({ defaultLocale: 'zh-CN', sourceLocale: 'en' }), 'en')!);
    expect(row.object_label).toBe('Account');
  });

  it('CONTROL: a zh-CN reader still reads the zh-CN row', () => {
    expect(readerLabelsFor(declaredMemory(), 'zh-CN')!.objectLabel('account')).toBe('客户');
    expect(readerLabelsFor(servedI18n({ defaultLocale: 'zh-CN', sourceLocale: 'en' }), 'zh-CN')!.objectLabel('account'))
      .toBe('客户');
  });

  it('CONTROL: with no sourceLocale declared, an en reader walks the declared fallback to the zh-CN row', () => {
    expect(readerLabelsFor(servedI18n({ defaultLocale: 'zh-CN' }), 'en')!.objectLabel('account')).toBe('客户');
  });

  it('reads no object label through t(): a service that cannot hand its translations over picks none', () => {
    const tOnly: ReaderLabelI18n = { t: (key) => (key === objectLabelKey('account') ? '客户' : key) };
    expect(readerLabelsFor(tOnly, 'zh-CN')!.objectLabel('account')).toBeUndefined();
  });

  it('picks nothing from a service whose translations throw, and does not throw itself', () => {
    const throwing: ReaderLabelI18n = {
      t: (key) => key,
      getLocales: () => ['zh-CN'],
      getTranslations: () => { throw new Error('translations exploded'); },
    };
    expect(readerLabelsFor(throwing, 'zh-CN')!.objectLabel('account')).toBeUndefined();
  });
});

/**
 * [#35384] The flow's, the approval step's and the position's labels are
 * metadata too, so they are resolved by the spec readers of their keys —
 * `translateFlow` (the flow runner's reading of `flows.<flow>.label`; `/meta`
 * serves a flow document untranslated), `resolveFlowApprovalStepLabel` (the
 * one reading of `flows.<flow>.approvals.<node_id>.label`) and
 * `translatePosition` (what `GET /meta/position` serves) — with `/meta`'s
 * `ResolveOptions`, and never through `t()`.
 *
 * The scenario: an app authored in English (`sourceLocale: 'en'`) that
 * defaults its users to Chinese (`defaultLocale: 'zh-CN'`, declared fallback
 * `zh-CN`) and ships an `en` pack beside the `zh-CN` one, which holds neither
 * label. `t('flows.<flow>.label', 'en')` falls to the `zh-CN` row; an `en` and
 * an `en-US` reader must read the authored label (the stored snapshot). An
 * `en-US` reader is negotiated to the `en` pack first, the authored language.
 * CONTROLS: a `zh-CN` reader reads the `zh-CN` rows, an `en` pack entry is
 * read by an `en` reader, and with no `sourceLocale` declared an `en` reader
 * walks the declared fallback to the `zh-CN` rows.
 */
describe('[#35384] the flow, approval step and position labels in the declared sourceLocale read as authored', () => {
  const EN = { [flowLabelKey('other_flow')]: 'Other flow' };
  const declared = (sourceLocale: string | undefined, en: Record<string, string> = EN) => {
    const i18n = i18nWith({ 'zh-CN': ZH, en });
    i18n.setDefaultLocale('zh-CN');
    i18n.setFallbackLocale('zh-CN');
    if (sourceLocale) i18n.setSourceLocale(sourceLocale);
    // The served adapter's shape (`FileI18nAdapter`): the declared fallback, read back by `getFallbackLocale()`.
    return Object.assign(i18n, { getFallbackLocale: () => 'zh-CN' });
  };
  const served = () => ({
    process_name: 'flow:account_approval', current_step: 'manager_review', object_name: 'account',
    process_label: 'Account Approval', step_label: 'Manager Review', current_step_label: 'Manager Review',
    object_label: 'Account',
  });

  it('the defect\'s precondition: t() answers an en reader with the zh-CN rows', () => {
    const i18n = declared('en');
    expect(i18n.t(flowLabelKey('account_approval'), 'en')).toBe('客户审批');
    expect(i18n.t(approvalStepLabelKey('account_approval', 'manager_review'), 'en')).toBe('经理审核');
    expect(i18n.t(positionLabelKey('crm_sales_manager'), 'en')).toBe('销售经理');
  });

  it('an en-US reader is negotiated to the en pack, the authored language', () => {
    expect(negotiatedReaderLocale(declared('en'), 'en-US')).toBe('en');
  });

  for (const locale of ['en', 'en-US']) {
    it(`an ${locale} reader picks no defaultLocale row: the flow, step and position labels stand as authored`, () => {
      const labels = readerLabelsFor(declared('en'), locale)!;
      expect(labels.flowLabel('account_approval')).toBeUndefined();
      expect(labels.stepLabel('account_approval', 'manager_review')).toBeUndefined();
      expect(labels.positionLabel('crm_sales_manager')).toBeUndefined();
      const row = served();
      localizeRequestLabels(row, labels);
      expect(row.process_label).toBe('Account Approval');
      expect(row.step_label).toBe('Manager Review');
      expect(row.current_step_label).toBe('Manager Review');
    });
  }

  it('CONTROL: a zh-CN reader still reads the zh-CN rows', () => {
    const labels = readerLabelsFor(declared('en'), 'zh-CN')!;
    expect(labels.flowLabel('account_approval')).toBe('客户审批');
    expect(labels.stepLabel('account_approval', 'manager_review')).toBe('经理审核');
    expect(labels.positionLabel('crm_sales_manager')).toBe('销售经理');
  });

  it('CONTROL: an en pack entry is what an en and an en-US reader read', () => {
    const en = {
      [flowLabelKey('account_approval')]: 'Account sign-off',
      [approvalStepLabelKey('account_approval', 'manager_review')]: 'Manager sign-off',
      [positionLabelKey('crm_sales_manager')]: 'Sales lead',
    };
    for (const locale of ['en', 'en-US']) {
      const labels = readerLabelsFor(declared('en', en), locale)!;
      expect(labels.flowLabel('account_approval')).toBe('Account sign-off');
      expect(labels.stepLabel('account_approval', 'manager_review')).toBe('Manager sign-off');
      expect(labels.positionLabel('crm_sales_manager')).toBe('Sales lead');
    }
  });

  it('CONTROL: with no sourceLocale declared, an en reader walks the declared fallback to the zh-CN rows', () => {
    const labels = readerLabelsFor(declared(undefined), 'en')!;
    expect(labels.flowLabel('account_approval')).toBe('客户审批');
    expect(labels.stepLabel('account_approval', 'manager_review')).toBe('经理审核');
    expect(labels.positionLabel('crm_sales_manager')).toBe('销售经理');
  });

  it('reads no label through t(): a service that cannot hand its translations over picks none', () => {
    const tOnly: ReaderLabelI18n = {
      t: (key) => (key === flowLabelKey('f') ? '流程' : key === positionLabelKey('p') ? '岗位'
        : key === approvalStepLabelKey('f', 'n') ? '步骤' : key),
    };
    const labels = readerLabelsFor(tOnly, 'zh-CN')!;
    expect(labels.flowLabel('f')).toBeUndefined();
    expect(labels.stepLabel('f', 'n')).toBeUndefined();
    expect(labels.positionLabel('p')).toBeUndefined();
  });

  it('reads each label once per read', () => {
    let reads = 0;
    const i18n = declared('en');
    const counting: ReaderLabelI18n = {
      t: (key) => key,
      getLocales: () => i18n.getLocales(),
      getTranslations: (code) => { reads += 1; return i18n.getTranslations(code); },
    };
    const labels = readerLabelsFor(counting, 'zh-CN')!;
    labels.flowLabel('account_approval');
    labels.flowLabel('account_approval');
    labels.positionLabel('crm_sales_manager');
    // One bundle for the read, built once: a read of each locale the service holds.
    expect(reads).toBe(2);
  });
});

/**
 * [#35384] A renamed packaged object is named by its rename, as `/meta` names
 * it: the object's served definition is translated with its packaged base as
 * `packagedBase` (ADR-0029 D9.2a), the base read off the engine's registry
 * (`getPackagedObjectBase`, the body the metadata protocol's accessor reads).
 * The bundle's `objects.crm_deal.label` translates the PACKAGED label, so it
 * says nothing about the rename, in any locale.
 *
 * The registry is the real `SchemaRegistry`: a packaged `Opportunity` that a
 * code extension renames `Deal`. The oracle is the call `/meta` makes,
 * `translateMetadataDocument('object', served, bundle, { …resolveOptions,
 * packagedBase })`. CONTROLS: the unrenamed object reads the bundle in every
 * locale, and a registry that cannot answer translates the name alone.
 */
describe('[#35384] a renamed packaged object is named by its rename, as /meta names it', () => {
  const PKG = 'com.acme.crm';
  const PAIR = 'com.acme.crm.custom';
  const engineWith = (renamed: boolean) => {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    registry.registerObject({ name: 'crm_deal', label: 'Opportunity', fields: {} } as never, PKG, undefined, 'own');
    if (renamed) registry.registerObjectExtension({ extend: 'crm_deal', label: 'Deal' } as never, PAIR);
    return { getSchema: (name: string) => registry.getObject(name), registry };
  };
  const i18n = () => {
    const service = i18nWith({
      'zh-CN': { [objectLabelKey('crm_deal')]: '商机' },
      en: { [objectLabelKey('crm_deal')]: 'Opportunity' },
    });
    service.setDefaultLocale('zh-CN');
    service.setFallbackLocale('zh-CN');
    service.setSourceLocale('en');
    return Object.assign(service, { getFallbackLocale: () => 'zh-CN' });
  };
  /** What `GET /meta/object/crm_deal` serves as the label for a request in `locale`. */
  const metaLabel = (engine: ReturnType<typeof engineWith>, locale: string): unknown => {
    const service = i18n();
    const bundle = Object.fromEntries(service.getLocales().map((code) => [code, service.getTranslations(code)]));
    return translateMetadataDocument('object', engine.getSchema('crm_deal'), bundle as never, {
      locale: negotiatedReaderLocale(service, locale),
      fallbackChain: ['zh-CN'],
      defaultLocale: 'en',
      packagedBase: engine.registry.getPackagedObjectBase('crm_deal'),
    }).label;
  };

  it('the fixture: the served label is the rename, the packaged base keeps the old one', () => {
    const engine = engineWith(true);
    expect((engine.getSchema('crm_deal') as { label?: string }).label).toBe('Deal');
    expect((engine.registry.getPackagedObjectBase('crm_deal') as { label?: string }).label).toBe('Opportunity');
  });

  for (const locale of ['en', 'en-US', 'zh-CN']) {
    it(`a ${locale} reader reads the rename, as /meta serves it`, () => {
      const engine = engineWith(true);
      expect(metaLabel(engine, locale)).toBe('Deal');
      expect(readerLabelsFor(i18n(), locale, engine)!.objectLabel('crm_deal')).toBe('Deal');
      const row = { object_name: 'crm_deal', object_label: 'Deal' };
      localizeRequestLabels(row, readerLabelsFor(i18n(), locale, engine)!);
      expect(row.object_label).toBe('Deal');
    });
  }

  it('CONTROL: the unrenamed object reads the bundle, as /meta serves it', () => {
    const engine = engineWith(false);
    expect(readerLabelsFor(i18n(), 'zh-CN', engine)!.objectLabel('crm_deal')).toBe('商机');
    expect(metaLabel(engine, 'zh-CN')).toBe('商机');
    expect(readerLabelsFor(i18n(), 'en', engine)!.objectLabel('crm_deal')).toBe('Opportunity');
  });

  it('CONTROL: a registry that throws is no baseline known, and the read does not throw', () => {
    const engine = engineWith(true);
    const failing = { getSchema: engine.getSchema, registry: { getPackagedObjectBase: () => { throw new Error('registry exploded'); } } };
    expect(readerLabelsFor(i18n(), 'zh-CN', failing)!.objectLabel('crm_deal')).toBe('商机');
    const blind = { getSchema: () => { throw new Error('schema exploded'); } };
    expect(readerLabelsFor(i18n(), 'zh-CN', blind)!.objectLabel('crm_deal')).toBe('商机');
  });
});
