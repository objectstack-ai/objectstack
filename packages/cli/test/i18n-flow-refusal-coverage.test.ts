// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#22450 — a refused `end` node's message joins the flow bucket.
//
// An `end` node declaring `outcome: 'refused'` carries a `message` the person
// who started the run reads in place of a completion. The bundle now has a key
// for it (`flows.<flow>.refusals.<node_id>.message`) and the engine reads that
// key in the run's locale before it renders the holes. These pins are the CLI
// half: the walker scaffolds the key, the coverage gate demands it, and the
// key the walker writes is the very address the engine asks for
// (`flowRefusalMessageKey`), so the two cannot drift.
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
import { TranslationDataSchema, flowRefusalMessageKey } from '@objectstack/spec/system';

const REFUSAL = 'Qualification approval comes first: {{ record.name }} is held.';

/** hotcrm's measured shape: a refusal on the start leg, before the first screen. */
const quoteGeneration = {
  name: 'quote_generation',
  label: 'Generate Quote',
  type: 'screen',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'get_held', type: 'decision', label: 'Held?' },
    { id: 'refuse_held', type: 'end', label: 'Quote Refused', config: { outcome: 'refused', message: REFUSAL } },
    { id: 'screen_1', type: 'screen', label: 'Quote', config: { title: 'Quote' } },
    { id: 'done', type: 'end', label: 'Done', config: { outcome: 'completed' } },
  ],
  edges: [],
};

const refusalEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'flows' && e.path[2] === 'refusals');

describe('what the walker harvests from a refusing `end` node (#22450)', () => {
  it('emits the message of the refused end only, keyed as the engine reads it, seeded with the template', () => {
    const entries = refusalEntries({ flows: [quoteGeneration] });

    expect(entries.map((e) => e.path.join('.'))).toEqual([flowRefusalMessageKey('quote_generation', 'refuse_held')]);
    // The seed is the authored TEMPLATE, holes and all: the translator keeps them.
    expect(entries[0]).toMatchObject({ sourceValue: REFUSAL, inline: REFUSAL, source: 'flow' });
  });

  it('reaches a refusing `end` nested in an ADR-0031 region', () => {
    const flow = {
      name: 'bulk_check',
      label: 'Bulk Check',
      nodes: [
        {
          id: 'guard', type: 'try_catch', label: 'Guard',
          config: {
            try: { nodes: [{ id: 'nested_refusal', type: 'end', label: 'No', config: { outcome: 'refused', message: 'Refused.' } }] },
            catch: { nodes: [] },
          },
        },
      ],
    };
    expect(refusalEntries({ flows: [flow] }).map((e) => e.path.join('.'))).toEqual([
      'flows.bulk_check.refusals.nested_refusal.message',
    ]);
  });
});

describe('the coverage gate demands the refusal (#22450)', () => {
  const tree = (flows?: Record<string, unknown>) => ({
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    flows: [quoteGeneration],
    translations: [{ 'zh-CN': { ...(flows ? { flows } : {}) } }],
  });
  const zhRefusals = (config: any) =>
    computeI18nCoverage(config).issues.filter((i) => i.locale === 'zh-CN' && i.key.includes('.refusals.'));

  it('reports the untranslated refusal in the flow bucket', () => {
    const issues = zhRefusals(tree());
    expect(issues.map((i) => i.key)).toEqual(['flows.quote_generation.refusals.refuse_held.message']);
    expect(issues[0]!.source).toBe('flow');
  });

  it('goes quiet once it is translated', () => {
    const issues = zhRefusals(tree({
      quote_generation: { refusals: { refuse_held: { message: '须先完成资格审批:{{ record.name }} 已被暂缓。' } } },
    }));
    expect(issues).toEqual([]);
  });
});

describe('the skeleton `os i18n extract` writes (#22450)', () => {
  const result = extractTranslations({ flows: [quoteGeneration] }, { locales: ['en', 'zh-CN'] });

  it('writes the template into the default locale and an empty slot into the others', () => {
    expect((result.bundles.en as any).flows.quote_generation.refusals).toEqual({ refuse_held: { message: REFUSAL } });
    expect((result.bundles['zh-CN'] as any).flows.quote_generation.refusals).toEqual({ refuse_held: { message: '' } });
  });

  it('parses through the schema it is written for, in every locale', () => {
    for (const [locale, bundle] of Object.entries(result.bundles)) {
      expect(TranslationDataSchema.safeParse(bundle).success, `skeleton for ${locale}`).toBe(true);
    }
  });
});
