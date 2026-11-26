// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37607 — the curated page, report and dashboard inspectors render
 * the bundled spec form through this console's `metadataForms` overlay, and
 * that overlay named a select's rows but not its options: under zh-CN the page
 * Type, the page Record action and the report and dashboard Default Period
 * selects listed English choices beside Chinese labels.
 *
 * The option names now ride in the same overlay (`options: { <value>: … }`,
 * the slot `resolveMetadataFormLabels` reads). They are copied from the
 * platform's canonical zh-CN pack, the one `/api/v1/meta/types` localizes the
 * same forms with, so this file pins:
 *
 *  1. the copies cannot drift from the pack: each option map in
 *     `ZH_CN_SPEC_FORMS` equals the pack's map byte for byte, and every option
 *     each of the four selects renders under zh-CN reads the pack's name (the
 *     dashboard's map lives in `./metadata-form-i18n.ts`, so it is pinned
 *     through the form it renders);
 *  2. the pack names options on no fifth row of these forms, so a new one is
 *     copied here rather than missed;
 *  3. per form, one zh-CN option name reaches the form the inspector renders;
 *  4. CONTROL: under en the same option keeps the spec's English.
 */

import { describe, it, expect } from 'vitest';
import type { TranslationData } from '@objectstack/spec/system';
import type { FormViewSpec } from './SchemaForm.js';
import { getPageForm } from './page-schema.js';
import { getReportForm } from './report-schema.js';
import { getDashboardForm } from './dashboard-schema.js';
import { ZH_CN_SPEC_FORMS } from './metadata-form-zh-cn.js';

type FormsTable = NonNullable<TranslationData['metadataForms']>;

// The platform pack, read from the checkout's source (a data-only module whose
// one import is type-only). The specifier is built at run time so neither the
// type checker nor the bundler treats it as a dependency of this package.
const PLATFORM_PACK = new URL(
  '../../../../../../packages/platform-objects/src/apps/translations/zh-CN.metadata-forms.generated.ts',
  import.meta.url,
).href;
const { zhCNMetadataForms: platform } = (await import(/* @vite-ignore */ PLATFORM_PACK)) as {
  zhCNMetadataForms: FormsTable;
};

/** Every `[type, fieldPath, options]` row of a forms table that names options. */
function optionRows(table: FormsTable): Array<[string, string, Record<string, unknown>]> {
  const rows: Array<[string, string, Record<string, unknown>]> = [];
  for (const [type, entry] of Object.entries(table)) {
    for (const [path, field] of Object.entries((entry as any)?.fields ?? {})) {
      const options = (field as any)?.options;
      if (options && typeof options === 'object') rows.push([type, path, options]);
    }
  }
  return rows;
}

/** The option list of the field at `path` (dot path from the form root). */
function optionsAt(form: FormViewSpec | undefined, path: string): Array<{ value: unknown; label?: unknown }> {
  const [head, ...rest] = path.split('.');
  for (const section of form?.sections ?? []) {
    for (const field of (section.fields ?? []) as any[]) {
      if (typeof field === 'string' || field?.field !== head) continue;
      let node = field;
      for (const seg of rest) node = (node?.fields ?? []).find((c: any) => typeof c !== 'string' && c?.field === seg);
      if (Array.isArray(node?.options)) return node.options;
    }
  }
  throw new Error(`no options at ${path}`);
}

const labelOf = (form: FormViewSpec | undefined, path: string, value: string) =>
  optionsAt(form, path).find((o) => o.value === value)?.label;

/** The four selects the platform pack names options for, on these forms. */
const ROWS: Array<[type: string, path: string, form: (locale: string) => FormViewSpec | undefined]> = [
  ['page', 'type', getPageForm],
  ['page', 'interfaceConfig.recordAction', getPageForm],
  ['report', 'dateRange.defaultRange', getReportForm],
  ['dashboard', 'dateRange.defaultRange', getDashboardForm],
];

describe('#37607 — curated inspectors name a select’s options under zh-CN', () => {
  it('the spec-forms table copies exactly the platform pack’s option maps, byte for byte', () => {
    const rows = optionRows(ZH_CN_SPEC_FORMS);
    expect(rows.map(([type, path]) => `${type}:${path}`).sort()).toEqual(
      ['page:type', 'page:interfaceConfig.recordAction', 'report:dateRange.defaultRange'].sort(),
    );
    for (const [type, path, options] of rows) {
      const source = (platform as any)[type]?.fields?.[path]?.options;
      expect(source, `${type}.${path} has no options in the platform pack`).toBeDefined();
      expect(JSON.stringify(options), `${type}.${path}`).toBe(JSON.stringify(source));
    }
  });

  it('the platform pack names options on no other row of these forms', () => {
    const named = ['page', 'report', 'dashboard', 'view'].flatMap((type) =>
      optionRows({ [type]: (platform as any)[type] } as FormsTable).map(([t, path]) => `${t}:${path}`),
    );
    expect(named.sort()).toEqual(ROWS.map(([type, path]) => `${type}:${path}`).sort());
  });

  it.each(ROWS)('%s %s: every zh-CN option reads the platform pack’s name', (type, path, form) => {
    const source = (platform as any)[type].fields[path].options as Record<string, string>;
    const offered = optionsAt(form('zh-CN'), path);
    expect(offered.length).toBeGreaterThan(0);
    for (const option of offered) {
      expect(source[String(option.value)], `${type}.${path} option ${String(option.value)}`).toBeDefined();
      expect(option.label, `${type}.${path} option ${String(option.value)}`).toBe(source[String(option.value)]);
    }
  });

  it('one named zh-CN option per form', () => {
    expect(labelOf(getPageForm('zh-CN'), 'type', 'record')).toBe('记录页');
    expect(labelOf(getPageForm('zh-CN'), 'interfaceConfig.recordAction', 'drawer')).toBe('抽屉（右侧预览）');
    expect(labelOf(getReportForm('zh-CN'), 'dateRange.defaultRange', 'this_quarter')).toBe('本季度');
    expect(labelOf(getDashboardForm('zh-CN'), 'dateRange.defaultRange', 'last_30_days')).toBe('近 30 天');
  });

  it('CONTROL — under en the same options keep the spec’s English', () => {
    expect(labelOf(getPageForm('en-US'), 'type', 'record')).toBe('Record page');
    expect(labelOf(getReportForm('en-US'), 'dateRange.defaultRange', 'this_quarter')).toBe('This quarter');
    expect(labelOf(getDashboardForm('en-US'), 'dateRange.defaultRange', 'last_30_days')).toBe('Last 30 days');
  });
});
