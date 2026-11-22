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
  translateDashboard,
  translateDataset,
  TRANSLATABLE_METADATA_TYPES,
} from './i18n-resolver';
// The fixture is PARSED by the authoring schema rather than hand-shaped, so a
// translator reading a member the schema does not carry cannot pass here.
import { ReportSchema } from '../ui/report.zod';
import { resolveI18nLabel } from '../ui/i18n-label-resolver';

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
    expect(result.error!.issues[0]).toMatchObject({ code: 'invalid_type', path: ['reports', 'opps_by_stage'] });
  });

  it('renames the singular spelling onto the group, and `name` / `title` onto `label`', () => {
    const issueOf = (result: { success: boolean; error?: { issues: any[] } }) => {
      expect(result.success).toBe(false);
      return result.error!.issues[0];
    };
    for (const result of [
      TranslationDataSchema.safeParse({ report: { r: { label: 'x' } } }),
      TranslationItemSchema.safeParse({ locale: 'en', report: { r: { label: 'x' } } }),
    ]) {
      const issue = issueOf(result);
      expect(issue).toMatchObject({ code: 'unrecognized_keys', keys: ['report'], path: [] });
      expect(issue.message).toContain('`report` → `reports`');
    }
    for (const key of ['title', 'name']) {
      const issue = issueOf(TranslationDataSchema.safeParse({ reports: { r: { [key]: 'x' } } }));
      expect(issue).toMatchObject({ code: 'unrecognized_keys', keys: [key], path: ['reports', 'r'] });
      expect(issue.message).toContain(`\`${key}\` → \`label\``);
    }
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

/**
 * objectstack#36373 — the console's report and dashboard panels edit a name or
 * a widget title in the CURRENT language: an edit made while the box showed a
 * bundle translation of a plain-string source stores the inline locale map
 * `{ default: SOURCE, LANG: EDIT }`. These pins hold the precedence that makes
 * that edit visible without moving any other locale.
 */
describe('an inline locale map entry for the requested locale beats the catalog (objectstack#36373)', () => {
  const multi: TranslationBundle = {
    'zh-CN': { reports: { opps_by_stage: { label: '各阶段商机', description: '按阶段汇总的商机' } } },
    'ja-JP': { reports: { opps_by_stage: { label: 'ステージ別商談' } } },
  };
  const packagedBase = () => report();
  // The shape the panel writes for a zh-CN edit of the plain-string source.
  const editedInZh = () => ({
    ...report(),
    label: { default: 'Opportunities by Stage', 'zh-CN': '各阶段商机（本公司）' },
  });

  it('serves the zh-CN entry to a zh-CN reader, not the bundle translation', () => {
    const out = translateReport(editedInZh(), multi, { locale: 'zh-CN', packagedBase: packagedBase() }) as any;
    expect(out.label).toEqual({ default: 'Opportunities by Stage', 'zh-CN': '各阶段商机（本公司）' });
    // The description, untouched by the edit, still reads its translation.
    expect(out.description).toBe('按阶段汇总的商机');
  });

  it('keeps the English source byte-identical for a reader in the source language', () => {
    const out = translateReport(editedInZh(), multi, { locale: 'en', packagedBase: packagedBase() }) as any;
    expect(out.label.default).toBe(packagedBase().label);
  });

  it('a third locale still reads its own bundle translation, never the zh-CN entry or `default`', () => {
    const out = translateReport(editedInZh(), multi, { locale: 'ja-JP', packagedBase: packagedBase() }) as any;
    expect(out.label).toBe('ステージ別商談');
  });

  it('a base-language entry answers a regional request (`zh` for `zh-CN`)', () => {
    const edited = { ...report(), label: { default: 'Opportunities by Stage', zh: '各阶段（本公司）' } };
    const out = translateReport(edited, multi, { locale: 'zh-CN', packagedBase: packagedBase() }) as any;
    expect(out.label).toEqual(edited.label);
  });

  it('control: a map equal to the package\'s own map changes nothing — the bundle still answers', () => {
    const shipped = { default: 'Opportunities by Stage', 'zh-CN': '旧的内联译文' };
    const base = { ...report(), label: shipped };
    const served = { ...report(), label: { ...shipped } };
    const out = translateReport(served, multi, { locale: 'zh-CN', packagedBase: base }) as any;
    expect(out.label).toBe('各阶段商机');
  });

  it('control: with no packaged base the catalog answers, as the string rule does — the panel\'s edit is not served (owed: L2 7078881267 S2)', () => {
    const out = translateReport(editedInZh(), multi, { locale: 'zh-CN' }) as any;
    expect(out.label).toBe('各阶段商机');
  });

  it('a dashboard widget title follows the same rule', () => {
    const bundle: TranslationBundle = {
      'zh-CN': { dashboards: { exec: { widgets: { rev: { title: '按行业收入' } } } } },
      'ja-JP': { dashboards: { exec: { widgets: { rev: { title: '業種別売上' } } } } },
    };
    const base = { name: 'exec', label: 'Executive', widgets: [{ id: 'rev', title: 'Revenue by Industry' }] };
    const edited = {
      ...base,
      widgets: [{ id: 'rev', title: { default: 'Revenue by Industry', 'zh-CN': '各行业收入（本公司）' } }],
    };
    const zh = translateDashboard(edited as any, bundle, { locale: 'zh-CN', packagedBase: base }) as any;
    expect(zh.widgets[0].title).toEqual(edited.widgets[0].title);
    const ja = translateDashboard(edited as any, bundle, { locale: 'ja-JP', packagedBase: base }) as any;
    expect(ja.widgets[0].title).toBe('業種別売上');
    // Unedited: the bundle answers, as before.
    const plain = translateDashboard(base as any, bundle, { locale: 'zh-CN', packagedBase: base }) as any;
    expect(plain.widgets[0].title).toBe('按行业收入');
  });

  // ─── L2 7078881267 M1: rank 1 of ruling record 6631250894 holds ──────────
  it('a translation the paired `.custom` package ships still answers first (ruling 6631250894 rank 1)', () => {
    const pairBundle: TranslationBundle = { 'zh-CN': { reports: { opps_by_stage: { label: '成对包的译文' } } } };
    const out = translateReport(editedInZh(), multi, { locale: 'zh-CN', packagedBase: packagedBase(), pairBundle }) as any;
    expect(out.label).toBe('成对包的译文');
  });

  it('a pair with no entry for the slot leaves the map, and the base\'s translation never answers', () => {
    const pairBundle: TranslationBundle = { 'zh-CN': { reports: { opps_by_stage: { description: '成对包的说明' } } } };
    const out = translateReport(editedInZh(), multi, { locale: 'zh-CN', packagedBase: packagedBase(), pairBundle }) as any;
    expect(out.label).toEqual(editedInZh().label);
    expect(resolveI18nLabel(out.label, 'zh-CN')).toBe('各阶段商机（本公司）');
  });

  it('a widget title: the pair answers first, then the entry, never the base\'s translation', () => {
    const bundle: TranslationBundle = { 'zh-CN': { dashboards: { exec: { widgets: { rev: { title: '按行业收入' } } } } } };
    const base = { name: 'exec', label: 'Executive', widgets: [{ id: 'rev', title: 'Revenue by Industry' }] };
    const edited = { ...base, widgets: [{ id: 'rev', title: { default: 'Revenue by Industry', 'zh-CN': '各行业收入（本公司）' } }] };
    const pairBundle: TranslationBundle = { 'zh-CN': { dashboards: { exec: { widgets: { rev: { title: '成对包的标题' } } } } } };
    const withPair = translateDashboard(edited as any, bundle, { locale: 'zh-CN', packagedBase: base, pairBundle }) as any;
    expect(withPair.widgets[0].title).toBe('成对包的标题');
    const emptyPair: TranslationBundle = { 'zh-CN': { dashboards: { exec: { label: '高管' } } } };
    const noEntry = translateDashboard(edited as any, bundle, { locale: 'zh-CN', packagedBase: base, pairBundle: emptyPair }) as any;
    expect(noEntry.widgets[0].title).toEqual(edited.widgets[0].title);
  });

  // ─── L2 7079950960 S3: the pair speaks for the requested locale only ─────
  it('a pair translation for a fallback locale does not outrank the map\'s own entry', () => {
    const pairBundle: TranslationBundle = { en: { reports: { opps_by_stage: { label: 'Pipeline by stage (pair)' } } } };
    const out = translateReport(editedInZh(), multi, {
      locale: 'zh-CN', fallbackChain: ['en'], packagedBase: packagedBase(), pairBundle,
    }) as any;
    expect(out.label).toEqual(editedInZh().label);
    expect(resolveI18nLabel(out.label, 'zh-CN')).toBe('各阶段商机（本公司）');
  });

  it('a pair translation for a sibling region (zh-TW) does not answer a zh-CN request over the zh-CN entry', () => {
    const pairBundle: TranslationBundle = { 'zh-TW': { reports: { opps_by_stage: { label: '各階段商機（成對包）' } } } };
    const out = translateReport(editedInZh(), multi, { locale: 'zh-CN', packagedBase: packagedBase(), pairBundle }) as any;
    expect(out.label).toEqual(editedInZh().label);
  });

  it('a widget title: a fallback-locale pair translation leaves the zh-CN entry', () => {
    const bundle: TranslationBundle = { 'zh-CN': { dashboards: { exec: { widgets: { rev: { title: '按行业收入' } } } } } };
    const base = { name: 'exec', label: 'Executive', widgets: [{ id: 'rev', title: 'Revenue by Industry' }] };
    const edited = { ...base, widgets: [{ id: 'rev', title: { default: 'Revenue by Industry', 'zh-CN': '各行业收入（本公司）' } }] };
    const pairBundle: TranslationBundle = { en: { dashboards: { exec: { widgets: { rev: { title: 'Revenue (pair)' } } } } } };
    const out = translateDashboard(edited as any, bundle, { locale: 'zh-CN', fallbackChain: ['en'], packagedBase: base, pairBundle }) as any;
    expect(out.widgets[0].title).toEqual(edited.widgets[0].title);
  });

  it('control: a re-authored plain string still reads the pair along the chain, as before', () => {
    const pairBundle: TranslationBundle = { en: { reports: { opps_by_stage: { label: 'Pipeline by stage (pair)' } } } };
    const edited = { ...report(), label: 'Pipeline by stage (ours)' };
    const out = translateReport(edited, multi, { locale: 'zh-CN', fallbackChain: ['en'], packagedBase: packagedBase(), pairBundle }) as any;
    expect(out.label).toBe('Pipeline by stage (pair)');
  });

  // ─── L2 7078881267 S1: the gate picks the entry the writer and reader pick ─
  describe('the entry for a locale is the one the panel writes and the reader shows', () => {
    const scripts: TranslationBundle = {
      ...multi,
      'zh-TW': { reports: { opps_by_stage: { label: '各階段商機' } } },
    };

    it('a zh-TW request over { default, zh } reads its Traditional bundle text, never the Simplified entry', () => {
      const edited = { ...report(), label: { default: 'Opportunities by Stage', zh: '各阶段（本公司）' } };
      const out = translateReport(edited, scripts, { locale: 'zh-TW', packagedBase: packagedBase() }) as any;
      expect(out.label).toBe('各階段商機');
    });

    it('a zh-TW request over { default, zh, zh-HK } gates on the zh-HK entry the reader shows', () => {
      const edited = {
        ...report(),
        label: { default: 'Opportunities by Stage', zh: '各阶段（本公司）', 'zh-HK': '各階段（本公司）' },
      };
      const out = translateReport(edited, scripts, { locale: 'zh-TW', packagedBase: packagedBase() }) as any;
      expect(out.label).toEqual(edited.label);
      expect(resolveI18nLabel(out.label, 'zh-TW')).toBe('各階段（本公司）');
      // The Simplified entry alone, equal to the base's own, is no statement about zh-TW.
      const sameHk = { ...report(), label: { ...edited.label } };
      const base = { ...report(), label: { ...edited.label } };
      expect((translateReport(sameHk, scripts, { locale: 'zh-TW', packagedBase: base }) as any).label).toBe('各階段商機');
    });

    it('a bare-zh session reads the zh-CN entry its own edit replaced', () => {
      const edited = { ...report(), label: { default: 'Opportunities by Stage', 'zh-CN': '各阶段商机（本公司）' } };
      const out = translateReport(edited, multi, { locale: 'zh', packagedBase: packagedBase() }) as any;
      expect(out.label).toEqual(edited.label);
      expect(resolveI18nLabel(out.label, 'zh')).toBe('各阶段商机（本公司）');
    });
  });

  it('scope control: a dataset member\'s inline map still loses to the bundle (ADR-0149)', () => {
    const bundle: TranslationBundle = {
      'zh-CN': { datasets: { pipeline: { dimensions: { stage: { label: '阶段' } } } } },
    };
    const base = { name: 'pipeline', object: 'opp', dimensions: [{ name: 'stage', label: 'Stage' }], measures: [] };
    const edited = {
      ...base,
      dimensions: [{ name: 'stage', label: { default: 'Stage', 'zh-CN': '销售阶段（本公司）' } }],
    };
    const out = translateDataset(edited as any, bundle, { locale: 'zh-CN', packagedBase: base }) as any;
    expect(out.dimensions[0].label).toBe('阶段');
  });
});
