// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The option labels a formula's `label()` reads (#26608)
 *
 * `label(record.<field>)` (`@objectstack/formula`) turns a select field's
 * stored value into the label a reader reads, so a record name composed in a
 * formula — `'v' + string(record.version_no) + ' · ' + label(record.kind)` —
 * reads `v2 · 清稿` to a zh-CN reader and `v2 · Clean` to an en-US one. The
 * function reads DATA only (`EvalContext.optionLabels`); this module is where
 * the engine builds that data for one read.
 *
 * ## One translation path
 *
 * The labels are the ones the object's metadata is served with: the declared
 * `options` of each field, with the translation bundle laid over them by
 * `translateObject` (`@objectstack/spec/system`) — the function behind
 * `GET /meta/object/:name`, whose answer the console's select control renders.
 * The bundle is built from the i18n service exactly as the metadata route
 * builds it, and the same locale options go with it. So the label a formula
 * prints is the label the select control shows the same reader, field-level
 * entry first and a shared picklist's entry after it, by construction rather
 * than by a second lookup that agrees today. ⛔ No key is spelled here.
 *
 * ## Which locale
 *
 * The read's own: `ExecutionContext.locale`, which the request's
 * `Accept-Language` sets (the console sends its display language on every
 * call). A read with no locale — a system or programmatic read — gets the
 * DECLARED labels, as the metadata route serves an untranslated document when
 * no locale is in play.
 *
 * A STORED expression (a non-formula field with an `expression`) always gets
 * the declared labels: its value is computed once, on the write, and stored for
 * every later reader and for search, so it must not depend on which locale the
 * writer happened to use.
 *
 * ## Only when a formula asks
 *
 * Building the map reads the whole translation bundle, so it is built only for
 * a plan in which some formula calls `label(`; every other read pays one
 * source scan per formula and nothing else.
 */

import { translateObject, type ObjectFieldLike, type TranslationBundle } from '@objectstack/spec/system';
import { declaresOptions, type EvalOptionLabels } from '@objectstack/formula';

/** The slice of `II18nService` the labels are translated through — what the metadata route reads. */
export interface OptionLabelI18n {
  getLocales?: () => string[];
  getTranslations?: (locale: string) => Record<string, unknown>;
  getFallbackLocale?: () => string | undefined;
  getDefaultLocale?: () => string | undefined;
}

/** The slice of a formula plan entry this module reads: its expression. */
interface PlannedExpression {
  readonly expression: unknown;
}

/** A call of `label(` in a CEL source — CEL has no comments, so a call is spelled this way or not at all. */
const LABEL_CALL = /\blabel\s*\(/;

/** Does any formula of `plan` call `label()`? */
export function planCallsOptionLabel(plan: ReadonlyArray<PlannedExpression>): boolean {
  return plan.some((entry) => {
    const expr = entry.expression as { source?: unknown } | string | undefined;
    const source = typeof expr === 'string' ? expr : expr?.source;
    return typeof source === 'string' && LABEL_CALL.test(source);
  });
}

/**
 * The fields of `schema` that declare options, as `translateObject` takes them.
 * "Declares options" is `@objectstack/formula`'s `declaresOptions`, the same
 * predicate `@objectstack/lint`'s formula pass refuses `label()` by (#28659),
 * so the door refuses exactly the fields this map leaves out.
 */
function optionFields(schema: unknown): Record<string, ObjectFieldLike> {
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  const out: Record<string, ObjectFieldLike> = {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return out;
  for (const [name, def] of Object.entries(fields as Record<string, ObjectFieldLike>)) {
    if (declaresOptions(def)) out[name] = def;
  }
  return out;
}

/** Field → stored value (as text) → label, read off option lists. */
function labelMap(fields: Record<string, ObjectFieldLike> | ObjectFieldLike[] | undefined): EvalOptionLabels {
  const map: Record<string, Record<string, string>> = {};
  if (!fields || Array.isArray(fields)) return map;
  for (const [name, def] of Object.entries(fields)) {
    const labels: Record<string, string> = {};
    for (const option of Array.isArray(def?.options) ? def.options : []) {
      if (!option || typeof option !== 'object' || option.value === undefined || option.value === null) continue;
      if (typeof option.label === 'string' && option.label.length > 0) labels[String(option.value)] = option.label;
    }
    map[name] = labels;
  }
  return map;
}

/**
 * The bundle the metadata route translates with — every locale the service
 * holds, keyed by locale — or `undefined` when the service holds none.
 */
function bundleOf(i18n: OptionLabelI18n): TranslationBundle | undefined {
  if (typeof i18n.getLocales !== 'function' || typeof i18n.getTranslations !== 'function') return undefined;
  const bundle: Record<string, unknown> = {};
  for (const locale of i18n.getLocales()) {
    const data = i18n.getTranslations(locale);
    if (data && typeof data === 'object') bundle[locale] = data;
  }
  return Object.keys(bundle).length > 0 ? (bundle as TranslationBundle) : undefined;
}

/**
 * The DECLARED option labels of `schema` — what a stored expression's
 * `label()` reads — or `undefined` when no formula of `plan` calls `label()`.
 */
export function declaredOptionLabels(
  schema: unknown,
  plan: ReadonlyArray<PlannedExpression>,
): EvalOptionLabels | undefined {
  if (!planCallsOptionLabel(plan)) return undefined;
  return labelMap(optionFields(schema));
}

/**
 * The option labels of `schema` in `locale`, translated as the object's
 * metadata is served in that locale — or `undefined` when no formula of `plan`
 * calls `label()`.
 *
 * No locale, no i18n service, or a service holding no translations: the
 * declared labels. A misbehaving service never fails the read — the declared
 * labels stand, as the validation-message path keeps a write from failing on
 * the same service.
 */
export function readerOptionLabels(
  schema: unknown,
  plan: ReadonlyArray<PlannedExpression>,
  locale: string | undefined,
  i18n: OptionLabelI18n | undefined,
): EvalOptionLabels | undefined {
  if (!planCallsOptionLabel(plan)) return undefined;
  const fields = optionFields(schema);
  const name = (schema as { name?: unknown } | undefined)?.name;
  if (!locale || !i18n || typeof name !== 'string' || Object.keys(fields).length === 0) return labelMap(fields);
  try {
    const bundle = bundleOf(i18n);
    if (!bundle) return labelMap(fields);
    const fallback = typeof i18n.getFallbackLocale === 'function' ? i18n.getFallbackLocale() : undefined;
    const defaultLocale = typeof i18n.getDefaultLocale === 'function' ? i18n.getDefaultLocale() : undefined;
    const translated = translateObject({ name, fields }, bundle, {
      locale,
      ...(typeof fallback === 'string' && fallback.length > 0 ? { fallbackChain: [fallback] } : {}),
      ...(typeof defaultLocale === 'string' && defaultLocale.length > 0 ? { defaultLocale } : {}),
    });
    return labelMap(translated.fields);
  } catch {
    return labelMap(fields);
  }
}
