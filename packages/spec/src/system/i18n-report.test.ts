// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `reports.<name>.…` — the report translation group, and the translator that
// overlays it on the served `report` document.
//
// Before this group existed, an app authored in one language listed every
// report in that language on the console's report index: the bundle had no
// key for a report, so `os validate` refused one (`reports` was a retired
// object-first dialect key) and `os i18n check` could not report the gap.

import { describe, it, expect } from 'vitest';
import {
  LEGACY_OBJECT_FIRST_KEYS,
  TranslationDataSchema,
  TranslationItemSchema,
  PlatformTranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import {
  translateMetadataDocument,
  translateReport,
  TRANSLATABLE_METADATA_TYPES,
} from './i18n-resolver';
// The fixture is PARSED by the authoring schema rather than hand-shaped, so a
// translator reading a member the schema does not carry cannot pass here.
import { ReportSchema } from '../ui/report.zod';

const report = () => ReportSchema.parse({
  name: 'opps_by_stage',
  label: 'Opportunities by Stage',
  description: 'Summary of opportunities grouped by stage',
  type: 'summary',
  dataset: 'pipeline',
  rows: ['stage'],
  values: ['amount'],
}) as any;

const bundle: TranslationBundle = {
  'zh-CN': {
    reports: { opps_by_stage: { label: '各阶段商机', description: '按阶段汇总的商机' } },
  },
};

describe('TranslationDataSchema — reports', () => {
  it('accepts the group at all three doors — bundle entry, platform bundle and registered item', () => {
    expect(TranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(PlatformTranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(TranslationItemSchema.safeParse({ locale: 'zh-CN', ...bundle['zh-CN'] }).success).toBe(true);
  });

  it('is no longer a retired object-first key, so the authored-row sync loads a row that carries it', () => {
    // `authored-translation-sync` skips every stored row carrying one of these
    // keys; a declared group on that list would never load from Studio.
    expect(LEGACY_OBJECT_FIRST_KEYS).not.toContain('reports');
  });

  it('closes the face at `label` and `description`', () => {
    for (const door of [TranslationDataSchema, PlatformTranslationDataSchema]) {
      const result = door.safeParse({ reports: { opps_by_stage: { dataset: 'pipeline' } } });
      expect(result.success).toBe(false);
      expect(result.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
    }
    const item = TranslationItemSchema.safeParse({ locale: 'en', reports: { opps_by_stage: { rows: ['stage'] } } });
    expect(item.success).toBe(false);
    expect(item.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('refuses a bare string per report — the value is an object of `label` / `description`', () => {
    const result = TranslationDataSchema.safeParse({ reports: { opps_by_stage: '各阶段商机' } });
    expect(result.success).toBe(false);
  });

  it('renames the singular spelling onto the group, and `name` / `title` onto `label`', () => {
    expect(() => TranslationDataSchema.parse({ report: { r: { label: 'x' } } })).toThrow(/reports/);
    expect(() => TranslationItemSchema.parse({ locale: 'en', report: { r: { label: 'x' } } })).toThrow(/reports/);
    expect(() => TranslationDataSchema.parse({ reports: { r: { title: 'x' } } })).toThrow(/label/);
    expect(() => TranslationDataSchema.parse({ reports: { r: { name: 'x' } } })).toThrow(/label/);
  });
});

describe('translateReport', () => {
  it('is registered in the dispatch table, so the REST boundary follows', () => {
    // `TRANSLATABLE_METADATA_TYPES` is DERIVED from the dispatch table and
    // `@objectstack/rest` reads it: `GET /meta/report` (list and item) is
    // localized with nothing else to remember.
    expect(TRANSLATABLE_METADATA_TYPES.has('report')).toBe(true);
  });

  it('overlays the label and the description', () => {
    const out = translateMetadataDocument('report', report(), bundle, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('各阶段商机');
    expect(out.description).toBe('按阶段汇总的商机');
    // Identity and the selection ride through untouched.
    expect(out.name).toBe('opps_by_stage');
    expect(out.dataset).toBe('pipeline');
    expect(out.values).toEqual(['amount']);
  });

  it('keeps an unaddressed description as authored', () => {
    const partial: TranslationBundle = { 'zh-CN': { reports: { opps_by_stage: { label: '各阶段商机' } } } };
    const out = translateReport(report(), partial, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('各阶段商机');
    expect(out.description).toBe('Summary of opportunities grouped by stage');
  });

  it('reads the report group only — a dashboard of the same name translates nothing here', () => {
    const shared: TranslationBundle = { 'zh-CN': { dashboards: { opps_by_stage: { label: '仪表盘' } } } };
    const doc = report();
    expect(translateReport(doc, shared, { locale: 'zh-CN' })).toBe(doc);
  });

  it('applies the BCP-47 ladder and the fallback chain', () => {
    expect((translateReport(report(), bundle, { locale: 'zh' }) as any).label).toBe('各阶段商机');
    expect((translateReport(report(), bundle, { locale: 'fr-FR', fallbackChain: ['zh-CN'] }) as any).label)
      .toBe('各阶段商机');
  });

  it('leaves an inline locale map intact when the bundle does not address it', () => {
    const inline = ReportSchema.parse({
      name: 'leads_by_source',
      label: { en: 'Leads by Source', 'zh-CN': '线索来源' },
      type: 'summary',
      dataset: 'leads',
      values: ['n'],
    }) as any;
    expect(translateReport(inline, bundle, { locale: 'zh-CN' })).toBe(inline);
  });

  it('does not mutate the input, and returns the same reference when nothing matched', () => {
    const doc = report();
    const before = JSON.parse(JSON.stringify(doc));
    translateReport(doc, bundle, { locale: 'zh-CN' });
    expect(doc).toEqual(before);
    expect(translateReport(doc, bundle, { locale: 'ja-JP' })).toBe(doc);
    expect(translateReport(doc, undefined, { locale: 'zh-CN' })).toBe(doc);
    const anonymous = { label: 'x' } as any;
    expect(translateReport(anonymous, bundle, { locale: 'zh-CN' })).toBe(anonymous);
  });

  describe('the catalog loses to an explicit override (ADR-0029 D9.2a)', () => {
    const packagedBase = () => report();

    it('applies while the served strings still equal the packaged ones', () => {
      const out = translateReport(report(), bundle, { locale: 'zh-CN', packagedBase: packagedBase() }) as any;
      expect(out.label).toBe('各阶段商机');
      expect(out.description).toBe('按阶段汇总的商机');
    });

    it('yields to a label an org re-authored, and still translates the unedited description', () => {
      const edited = { ...report(), label: 'Pipeline by stage (ours)' };
      const out = translateReport(edited, bundle, { locale: 'zh-CN', packagedBase: packagedBase() }) as any;
      expect(out.label).toBe('Pipeline by stage (ours)');
      expect(out.description).toBe('按阶段汇总的商机');
    });

    it('returns the same reference when both strings were re-authored', () => {
      const edited = { ...report(), label: 'Ours', description: 'Our description' };
      expect(translateReport(edited, bundle, { locale: 'zh-CN', packagedBase: packagedBase() })).toBe(edited);
    });

    it('applies with no base supplied — a runtime-authored report has none', () => {
      const edited = { ...report(), label: 'Pipeline by stage (ours)' };
      expect((translateReport(edited, bundle, { locale: 'zh-CN' }) as any).label).toBe('各阶段商机');
    });
  });
});
