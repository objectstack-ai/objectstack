// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The zh-CN labels the metadata `SchemaForm` gives a raw schema field, and the
 * zh test they key on — moved here verbatim from `./i18n.ts`, which re-exports
 * all three.
 *
 * A leaf with no imports on purpose: the Pending changes sheet names a changed
 * property the way the inspector labels its row (`preview/changeKeyLabels.ts`),
 * and that sheet sits on the console's EAGER graph, where `./i18n.ts` and the
 * Studio string namespace it imports must not be carried.
 */

/** Whether a locale resolves to Chinese (the only non-English catalog). */
export function isZhLocale(locale?: string): boolean {
  return (locale ?? '').toLowerCase().startsWith('zh');
}

/**
 * Generic zh-CN labels for raw JSON-Schema fields the metadata SchemaForm
 * renders without a client `fieldSpec.label` — chiefly the flow edge/node
 * sub-forms (Source / Target / Condition / …). Names here have one unambiguous
 * meaning across metadata types, so the zh label is universally correct; English
 * (and any name not listed) keeps the schema's own title. Applied only as a
 * fallback UNDER `fieldSpec.label`, so curated top-level forms are untouched.
 */
const SCHEMA_FIELD_LABEL_ZH: Record<string, string> = {
  id: 'ID',
  name: '名称',
  label: '标签',
  type: '类型',
  description: '描述',
  source: '源节点',
  target: '目标节点',
  condition: '条件',
  isDefault: '默认',
  nodes: '节点',
  edges: '连线',
  config: '配置',
  outputVariable: '输出变量',
};

/** zh-CN help text for the unambiguous (edge-specific) raw schema fields. */
const SCHEMA_FIELD_HELP_ZH: Record<string, string> = {
  source: '源节点 ID',
  target: '目标节点 ID',
  condition: '用于分支的 CEL 布尔表达式',
  isDefault: '当没有其他条件匹配时,将此连线标记为默认路径',
};

/** Localized label for a raw schema field (falls back to the schema title). */
export function translateSchemaFieldLabel(
  name: string,
  fallback: string | undefined,
  locale?: string,
): string | undefined {
  if (isZhLocale(locale)) {
    const v = SCHEMA_FIELD_LABEL_ZH[name];
    if (v) return v;
  }
  return fallback;
}

/** Localized help for a raw schema field (falls back to the schema description). */
export function translateSchemaFieldHelp(
  name: string,
  fallback: string | undefined,
  locale?: string,
): string | undefined {
  if (isZhLocale(locale)) {
    const v = SCHEMA_FIELD_HELP_ZH[name];
    if (v) return v;
  }
  return fallback;
}
