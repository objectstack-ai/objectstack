// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The label table a mail template's `option` holes read
 *
 * `{{ stage | option:opportunity.stage }}` prints a select field's stored
 * value as its option's label, in the RECIPIENT's language (ruling F on the
 * option-label card, parameter 3). `@objectstack/formula`'s `option`
 * formatter only reads a table it is handed (`OptionLabelTable`, keyed by the
 * hole's `object.field`); this module is where the mail renderer builds that
 * table, once per send, before the synchronous render of its three faces.
 *
 * ## One translation path
 *
 * The labels are the ones the object's metadata is served with in the
 * recipient's locale: the SERVED object's declared `options` (a
 * picklist-bound field carries its resolved list there), with the translation
 * bundle laid over them by `translateObject` (`@objectstack/spec/system`) —
 * the function behind `GET /meta/object/:name`, built from the i18n service
 * with the same locale options. It is the path `@objectstack/objectql`'s
 * `readerOptionLabels` (`formula-option-labels.ts`) gives a formula's
 * `label()`, step for step; that module is not reachable from here
 * (`@objectstack/objectql` is only this package's dev dependency), so the
 * steps are taken through the same two published functions, `translateObject`
 * and `declaresOptions`, and `option-label-table.test.ts` holds the two
 * answers equal. ⛔ No translation key is spelled here.
 *
 * ## Which locale
 *
 * The send's own `locale` — the recipient's, which the messaging channels
 * resolve per recipient and hand to `sendTemplate` / `renderTemplate`. Never an
 * execution context's: a scheduled flow runs as the system, with no reader,
 * and still mails each recipient in their own language. A send that names no
 * locale gets the DECLARED labels.
 *
 * ## Refusals
 *
 * Judged against the deployment's served objects with
 * `judgeMailHoleGrammar(face, { objects, liveUniverse: true })`, the sentences
 * the authoring doors show: an object no one serves, a field the object does
 * not have, a field with no options — and, decided here, a field whose served
 * option list is EMPTY, which has no option to label a value with either.
 * Each is `TEMPLATE_INVALID` and refuses the whole send, before any face is
 * rendered.
 */

import { declaresOptions, judgeMailHoleGrammar, mailHolePattern, parseMailHole } from '@objectstack/formula';
import type { OptionLabelTable } from '@objectstack/formula';
import { translateObject, type ObjectFieldLike, type TranslationBundle } from '@objectstack/spec/system';

/** The slice of `II18nService` the labels are translated through — what the metadata route reads. */
export interface OptionLabelI18n {
  getLocales?: () => string[];
  getTranslations?: (locale: string) => Record<string, unknown>;
  getFallbackLocale?: () => string | undefined;
  getDefaultLocale?: () => string | undefined;
}

/**
 * Where a send's option labels come from, resolved at each send (a service
 * registered after the email plugin is seen): the served object by name
 * (`IDataEngine.getObject`, the registry's answer — what
 * `GET /meta/object/:name` serves before translation) and the i18n service.
 */
export interface OptionLabelSources {
  getObject: (name: string) => unknown;
  i18n?: OptionLabelI18n;
}

/** The `object.field` keys the `option` holes of `faces` name, in first-seen order. */
export function optionHoleKeys(faces: ReadonlyArray<string | null | undefined>): Array<{ key: string; object: string; field: string }> {
  const seen = new Map<string, { key: string; object: string; field: string }>();
  for (const face of faces) {
    if (typeof face !== 'string' || face === '') continue;
    for (const m of face.matchAll(mailHolePattern())) {
      const ref = parseMailHole(m[2], m[0])?.optionField;
      if (!ref) continue;
      const key = `${ref.object}.${ref.field}`;
      if (!seen.has(key)) seen.set(key, { key, object: ref.object, field: ref.field });
    }
  }
  return [...seen.values()];
}

/** The fields of a served object, by name, when it carries a fields map. */
function fieldsOf(schema: unknown): Record<string, ObjectFieldLike> | undefined {
  const fields = (schema as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  return fields as Record<string, ObjectFieldLike>;
}

/** Stored value (as text) → label, read off one field's option list. */
function labelsOf(def: ObjectFieldLike | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const option of Array.isArray(def?.options) ? def.options : []) {
    if (!option || typeof option !== 'object' || option.value === undefined || option.value === null) continue;
    if (typeof option.label === 'string' && option.label.length > 0) labels[String(option.value)] = option.label;
  }
  return labels;
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
 * The option-declaring fields of `schema`, translated into `locale` as the
 * object is served in it. No locale, no i18n service, or one holding no
 * translations: the declared fields. A misbehaving service never fails the
 * send — the declared labels stand, as `readerOptionLabels` answers.
 */
function servedOptionFields(
  name: string,
  optionFields: Record<string, ObjectFieldLike>,
  locale: string | undefined,
  i18n: OptionLabelI18n | undefined,
): Record<string, ObjectFieldLike> {
  if (!locale || !i18n || Object.keys(optionFields).length === 0) return optionFields;
  try {
    const bundle = bundleOf(i18n);
    if (!bundle) return optionFields;
    const fallback = typeof i18n.getFallbackLocale === 'function' ? i18n.getFallbackLocale() : undefined;
    const defaultLocale = typeof i18n.getDefaultLocale === 'function' ? i18n.getDefaultLocale() : undefined;
    const translated = translateObject({ name, fields: optionFields }, bundle, {
      locale,
      ...(typeof fallback === 'string' && fallback.length > 0 ? { fallbackChain: [fallback] } : {}),
      ...(typeof defaultLocale === 'string' && defaultLocale.length > 0 ? { defaultLocale } : {}),
    });
    const fields = fieldsOf(translated);
    return fields ?? optionFields;
  } catch {
    return optionFields;
  }
}

/**
 * The label table the `option` holes of `faces` read, in `locale` (the
 * recipient's; `undefined` ⇒ the declared labels), or `undefined` when no face
 * has an `option` hole. Throws `TEMPLATE_INVALID: …` when a hole names an
 * object the deployment does not serve, a field that object does not have, or
 * a field with no options (none declared, or an empty list).
 */
export function buildOptionLabelTable(
  faces: ReadonlyArray<string | null | undefined>,
  locale: string | undefined,
  sources: OptionLabelSources,
): OptionLabelTable | undefined {
  const keys = optionHoleKeys(faces);
  if (keys.length === 0) return undefined;

  // The served object of every name a hole gives, judged as the live universe:
  // a name nothing serves is unknown here, whatever its prefix.
  const schemas = new Map<string, { name: string; fields: Record<string, ObjectFieldLike> }>();
  const objects = new Map<string, ReadonlyMap<string, boolean>>();
  for (const { object } of keys) {
    if (objects.has(object)) continue;
    const schema = sources.getObject(object);
    const fields = schema === undefined || schema === null ? undefined : fieldsOf(schema);
    if (!fields) continue;
    const servedName = (schema as { name?: unknown }).name;
    schemas.set(object, { name: typeof servedName === 'string' && servedName ? servedName : object, fields });
    // An option list with no option in it labels nothing: judged as a field
    // with no options, so the send is refused rather than print every value
    // as stored under a formatter that promises a label.
    objects.set(object, new Map(Object.entries(fields).map(([field, def]) => [
      field,
      declaresOptions(def) && Object.keys(labelsOf(def)).length > 0,
    ])));
  }
  for (const face of faces) {
    if (typeof face !== 'string' || face === '') continue;
    const [finding] = judgeMailHoleGrammar(face, { objects, liveUniverse: true });
    if (finding) throw new Error(`TEMPLATE_INVALID: ${finding.refusal.message}`);
  }

  const table: Record<string, Record<string, string>> = {};
  const translatedBy = new Map<string, Record<string, ObjectFieldLike>>();
  for (const { key, object, field } of keys) {
    const schema = schemas.get(object)!;
    let served = translatedBy.get(object);
    if (!served) {
      const optionFields: Record<string, ObjectFieldLike> = {};
      for (const [name, def] of Object.entries(schema.fields)) if (declaresOptions(def)) optionFields[name] = def;
      served = servedOptionFields(schema.name, optionFields, locale, sources.i18n);
      translatedBy.set(object, served);
    }
    table[key] = labelsOf(served[field]);
  }
  return table;
}
