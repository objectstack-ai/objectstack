// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#22507 — a screen field's option labels and the flow's terminal
// toasts join the flow bucket.
//
// The `flows` face now keys `…fields.<field>.options.<value>` (each option by
// its value read as text) and `flows.<flow>.successMessage` / `.errorMessage`.
// These pins are the CLI half: the walker scaffolds exactly the keys
// `translateFlow` reads — the option keys through the same key function — the
// coverage gate demands them, and the skeleton parses.
//
// The ledger mock is `i18n-flow-screen-coverage.test.ts`'s, for its reason:
// these pins measure the bucket itself, whatever the shipped ledger says next.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/lint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@objectstack/lint')>()),
  authorWarnedProperties: () => new Set<string>(),
}));

import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema, translateFlow } from '@objectstack/spec/system';

/** hotclm's measured shape, trimmed: a select over strings, one over a number and a boolean, both toasts. */
const contractIntake = {
  name: 'contract_intake',
  label: 'Launch Contract',
  type: 'screen',
  successMessage: 'Contract launched.',
  errorMessage: 'Contract launch failed.',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'details', type: 'screen', label: 'Contract details',
      config: {
        title: 'Contract details',
        fields: [
          { name: 'our_entity', label: 'Our signing entity', type: 'select', options: [{ value: 'hq', label: 'Head office' }, { value: 'apac', label: 'APAC subsidiary' }] },
          { name: 'tier', label: 'Tier', type: 'select', options: [{ value: 1, label: 'Tier 1' }, { value: true, label: 'Yes' }] },
        ],
      },
    },
  ],
  edges: [],
};

/** A flow with no screen: only its failure toast is drawn (by a launch host), never its completion toast. */
const nightlySync = {
  name: 'nightly_sync',
  label: 'Nightly Sync',
  type: 'autolaunched',
  successMessage: 'Synced.',
  errorMessage: 'Sync failed.',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }],
  edges: [],
};

const keysOf = (config: any, match: (path: string[]) => boolean) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'flows' && match(e.path)).map((e) => e.path.join('.'));

describe('what the walker harvests for the toasts and the option labels (#22507)', () => {
  it('emits each option label keyed by its value read as text, seeded with the authored label', () => {
    const entries = collectExpectedEntries({ flows: [contractIntake] })
      .filter((e) => e.path[0] === 'flows' && e.path.includes('options'));
    expect(entries.map((e) => e.path.join('.'))).toEqual([
      'flows.contract_intake.screens.details.fields.our_entity.options.hq',
      'flows.contract_intake.screens.details.fields.our_entity.options.apac',
      'flows.contract_intake.screens.details.fields.tier.options.1',
      'flows.contract_intake.screens.details.fields.tier.options.true',
    ]);
    expect(entries[0]).toMatchObject({ sourceValue: 'Head office', inline: 'Head office', source: 'flow' });
  });

  it('emits the completion toast for a flow with a screen, and the failure toast for every flow', () => {
    const toast = (path: string[]) => path.length === 3 && (path[2] === 'successMessage' || path[2] === 'errorMessage');
    expect(keysOf({ flows: [contractIntake, nightlySync] }, toast)).toEqual([
      'flows.contract_intake.successMessage',
      'flows.contract_intake.errorMessage',
      'flows.nightly_sync.errorMessage',
    ]);
  });

  it('emits no toast key for a flow that authors none — a bundle cannot add one', () => {
    const { successMessage: _s, errorMessage: _e, ...silent } = contractIntake;
    expect(keysOf({ flows: [silent] }, (path) => path.length === 3 && path[2] !== 'label')).toEqual([]);
  });

  it('writes exactly the keys `translateFlow` reads — the skeleton, filled, translates every option and toast', () => {
    const result = extractTranslations({ flows: [contractIntake] }, { locales: ['en', 'zh-CN'] });
    const zh = (result.bundles['zh-CN'] as any).flows.contract_intake;
    // Fill every empty slot the skeleton offers, then resolve through the spec.
    zh.successMessage = '合同已发起。';
    zh.errorMessage = '合同发起失败。';
    for (const field of Object.values(zh.screens.details.fields) as any[]) {
      for (const key of Object.keys(field.options)) field.options[key] = `译:${key}`;
    }
    const out: any = translateFlow(contractIntake as any, { 'zh-CN': { flows: { contract_intake: zh } } }, { locale: 'zh-CN' });
    expect(out.successMessage).toBe('合同已发起。');
    expect(out.errorMessage).toBe('合同发起失败。');
    const fields = out.nodes[1].config.fields;
    expect(fields[0].options.map((o: any) => o.label)).toEqual(['译:hq', '译:apac']);
    expect(fields[1].options.map((o: any) => o.label)).toEqual(['译:1', '译:true']);
  });
});

describe('the coverage gate demands them (#22507)', () => {
  const tree = (flows?: Record<string, unknown>) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    flows: [contractIntake],
    translations: [{ 'zh-CN': { ...(flows ? { flows } : {}) } }],
  });
  const zhNew = (config: any) =>
    computeI18nCoverage(config).issues
      .filter((i) => i.locale === 'zh-CN' && (i.key.includes('.options.') || /Message$/.test(i.key)))
      .map((i) => [i.key, i.source]);

  it('reports each untranslated option and toast in the flow bucket', () => {
    expect(zhNew(tree())).toEqual([
      ['flows.contract_intake.successMessage', 'flow'],
      ['flows.contract_intake.errorMessage', 'flow'],
      ['flows.contract_intake.screens.details.fields.our_entity.options.hq', 'flow'],
      ['flows.contract_intake.screens.details.fields.our_entity.options.apac', 'flow'],
      ['flows.contract_intake.screens.details.fields.tier.options.1', 'flow'],
      ['flows.contract_intake.screens.details.fields.tier.options.true', 'flow'],
    ]);
  });

  it('goes quiet once they are translated', () => {
    expect(zhNew(tree({
      contract_intake: {
        successMessage: '合同已发起。',
        errorMessage: '合同发起失败。',
        screens: {
          details: {
            fields: {
              our_entity: { options: { hq: '总部', apac: '亚太子公司' } },
              tier: { options: { '1': '一级', true: '是' } },
            },
          },
        },
      },
    }))).toEqual([]);
  });
});

describe('the skeleton `os i18n extract` writes (#22507)', () => {
  const result = extractTranslations({ flows: [contractIntake] }, { locales: ['en', 'zh-CN'] });

  it('writes the authored text into the default locale and empty slots into the others', () => {
    const en = (result.bundles.en as any).flows.contract_intake;
    const zh = (result.bundles['zh-CN'] as any).flows.contract_intake;
    expect(en.successMessage).toBe('Contract launched.');
    expect(en.screens.details.fields.tier.options).toEqual({ '1': 'Tier 1', true: 'Yes' });
    expect(zh.errorMessage).toBe('');
    expect(zh.screens.details.fields.our_entity.options).toEqual({ hq: '', apac: '' });
  });

  it('parses through the schema it is written for, in every locale', () => {
    for (const [locale, bundle] of Object.entries(result.bundles)) {
      const parsed = TranslationDataSchema.safeParse(bundle);
      expect(parsed.success, `skeleton for ${locale}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });
});
