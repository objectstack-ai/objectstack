// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26167] An activity summary in the READER's language.
 *
 * ## What was wrong
 *
 * The CRUD mirror (`audit-writers.ts`) composes `sys_activity.summary` once,
 * at write time, in the workspace default locale (framework#3039), and the
 * object and field labels inside it are translated at that same moment. Every
 * reader was then served that one sentence: an English-default workspace
 * showed `Created Contract "…"` to a zh-CN reader forever, a workspace that
 * switched language kept every older row in the old one, and two colleagues
 * with different languages read the same row in one of them.
 *
 * ## What a row stores now
 *
 * Beside the sentence, the mirror records the sentence as a CODE: which
 * template it is and its parameters ({@link ActivitySummaryMessage}), in the
 * row's `metadata` under {@link ACTIVITY_SUMMARY_MESSAGE_KEY}. The object is
 * stored by NAME and each field by KEY, so their labels are resolved for each
 * reader. A value inside a field-change summary is stored as the text the
 * writer rendered (a referenced record's title is the record's own datum, the
 * same in every language) plus, for a select value, the option it matched, so
 * its option label is resolved for each reader too.
 *
 * `summary` itself is unchanged: the sentence the writer has always stored,
 * for every reader of the column that is not served through the read below.
 * The `metadata` slot follows the approvals precedent (the `admin_rescue`
 * note's code rides on the request's snapshot), so no column, object schema or
 * spec contract moves.
 *
 * ## Who renders it
 *
 * {@link installActivitySummaryLocale}: an engine middleware on `sys_activity`
 * that, on a read whose `ExecutionContext.locale` is set, re-composes each
 * row's `summary` from its stored code in that locale. The locale is the
 * door's already-resolved one (the request's `Accept-Language`, else the
 * `localization` settings), negotiated against the locales the `i18n` service
 * holds by `resolveBundleLocale`, the one negotiation rule; the text is
 * `II18nService.t()`. ⛔ Nothing here is a second way to do that: it is the
 * sequence `plugin-approvals`'s `reader-locale-labels.ts` uses.
 *
 * [#35384] The object, field and option LABELS inside the sentence are
 * metadata `/meta` serves, so they are not read through `t()`: the reader's
 * object definition is put in its language by `translateObject`
 * (`@objectstack/spec/system`) over every locale the service holds, with the
 * metadata route's `ResolveOptions` (the reader's locale, the DECLARED
 * fallback chain, and the authored language — the declared `sourceLocale`,
 * else `defaultLocale`), and every label is read off that definition. So a
 * reader in a deployment's declared `sourceLocale` reads the labels as
 * authored, never the `defaultLocale` row `t()` falls back to; `t()` carries
 * the `messages.*` templates.
 *
 * The writer composes the stored sentence through the SAME function
 * ({@link composeActivitySummary}), bound to the write locale, with the English
 * catalog as its fallback, so the stored text and a reader's text can never be
 * two spellings of one template.
 *
 * ## What stays as stored
 *
 * Nothing is re-composed when the read carries no locale, when no `i18n`
 * service is registered, when the reader's locale has no template for the code,
 * or when composing throws — the stored sentence stands. A row written before
 * this change carries no code and is served as written (no migration, no
 * backfill). A fired milestone's summary carries no code either: its template
 * is the author's sentence and is never translated (#7290).
 */

import {
  resolveBundleLocale,
  translateObject,
  type ResolveOptions,
  type TranslationBundle,
} from '@objectstack/spec/system';

import { enMessages } from './translations/messages.js';
import { ensureJudgedColumnsProjected, isRecord } from './served-fields.js';

/** The `metadata` key a row's summary code rides in. Read and stripped by {@link installActivitySummaryLocale}. */
export const ACTIVITY_SUMMARY_MESSAGE_KEY = 'summary_message';

/**
 * One side of a field change: the writer's text, and the option it matched (a
 * select value) — or, for a yes/no field that declares no option words, the
 * boolean itself, worded per locale by `messages.activityValueTrue` /
 * `messages.activityValueFalse`.
 */
export interface ActivitySummaryValue {
  text: string;
  option?: string;
  boolean?: boolean;
}

/** The catalogue key a boolean value is worded by. */
function booleanMessageKey(value: boolean): 'activityValueTrue' | 'activityValueFalse' {
  return value ? 'activityValueTrue' : 'activityValueFalse';
}

/** A boolean value in this plugin's ENGLISH catalogue: the writer's text, and every locale's floor. */
export function englishBooleanWord(value: boolean): string {
  const word = (enMessages as Record<string, unknown>)[booleanMessageKey(value)];
  return typeof word === 'string' ? word : String(value);
}

/** A field change inside a `fieldChanges` summary. */
export interface ActivitySummaryFieldChange {
  field: string;
  from: ActivitySummaryValue;
  to: ActivitySummaryValue;
}

/**
 * The code of a summary. `key` names a `messages.*` template of this plugin's
 * catalog, except `fieldChanges`, the tracked-change diff (ADR-0052 §5b.1),
 * which has no template of its own. `object` is the object's NAME.
 */
export type ActivitySummaryMessage =
  | { key: 'activityCreated' | 'activityDeleted' | 'activityUpdated'; object: string; label: string }
  | { key: 'activityUpdatedFields'; object: string; label: string; fields: string[]; more: number }
  | { key: 'fieldChanges'; object: string; changes: ActivitySummaryFieldChange[] };

/** One language a summary is composed in. */
export interface ActivitySummaryLocale {
  /** A bundle key in this locale, interpolated; `undefined` on any miss. */
  translate(key: string, params?: Record<string, unknown>): string | undefined;
  /** The locale a list is joined in; `undefined` joins in English. */
  locale: string | undefined;
  /**
   * The object's definition its labels are read off, `null` when there is
   * none: the authored one for the writer, and [#35384] for a reader the one
   * `translateObject` put in the reader's language.
   */
  getObjectDef(objectName: string): any;
}

/** Interpolate one `{{param}}` template, the shared convention (`createMemoryI18n`, FileI18nAdapter). */
function interpolate(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? `{{${name}}}`));
}

/**
 * `locale` with this plugin's ENGLISH catalog answering every `messages.*`
 * key: what the stored sentence falls back to when the write locale has no
 * template. Every other key is still asked of `locale`, and the labels are
 * still read off `locale`'s definitions ([#35384] never a `t()` key).
 */
export function withEnglishMessages(locale: ActivitySummaryLocale): ActivitySummaryLocale {
  return {
    translate: (key, params) => {
      if (!key.startsWith('messages.')) return locale.translate(key, params);
      const template = (enMessages as Record<string, unknown>)[key.slice('messages.'.length)];
      return typeof template === 'string' ? interpolate(template, params) : undefined;
    },
    locale: undefined,
    getObjectDef: locale.getObjectDef,
  };
}

/**
 * An object's label: the definition's ({@link ActivitySummaryLocale.getObjectDef},
 * in the reader's language for a reader), then the name.
 */
export function objectLabelIn(locale: ActivitySummaryLocale, objectName: string): string {
  const def = locale.getObjectDef(objectName);
  return typeof def?.label === 'string' && def.label.length > 0 ? def.label : objectName;
}

/**
 * A field's label inside an activity summary: the definition's (in the
 * reader's language for a reader), then the machine key. One answer for every
 * branch that names a field.
 */
export function fieldLabelForSummary(key: string, field: any): string {
  return typeof field?.label === 'string' && field.label.length > 0 ? field.label : key;
}

/** A select value's option label on the definition's field, `undefined` when the field declares none for it. */
function optionLabelOn(field: any, option: string): string | undefined {
  const options: unknown = field?.options;
  if (!Array.isArray(options)) return undefined;
  for (const candidate of options) {
    if (candidate && typeof candidate === 'object' && String((candidate as { value?: unknown }).value) === option) {
      const label = (candidate as { label?: unknown }).label;
      return typeof label === 'string' && label.length > 0 ? label : undefined;
    }
  }
  return undefined;
}

/** A locale's conjunction list ("A, B, and C" / "A、B和C"); `", "` where `Intl` cannot answer. */
export function listJoinerFor(locale: string | undefined): (items: string[]) => string {
  // `Intl.ListFormat` is ES2021; this package compiles against the ES2020 lib,
  // so the constructor is probed rather than assumed (as `plugin-auth`'s
  // invitation role label does).
  const ListFormat = (Intl as unknown as { ListFormat?: IntlListFormatConstructor }).ListFormat;
  try {
    if (ListFormat) {
      const format = new ListFormat(locale ?? 'en', { type: 'conjunction' });
      return (items) => format.format(items);
    }
  } catch {
    // A tag `Intl` refuses (a tenant's own locale spelling) still gets a list.
  }
  return (items) => items.join(', ');
}

type IntlListFormatConstructor = new (
  locale: string,
  options: { type: 'conjunction' },
) => { format(list: readonly string[]): string };

/**
 * The summary `message` reads as in `locale`, or `undefined` when that locale
 * has no template for it. A locale whose bundle answers only the field-less
 * `activityUpdated` (an app's own locale, written before the named-field
 * template existed) gets that localized frame for a named-field code, never an
 * English one with its field names.
 */
export function composeActivitySummary(
  message: ActivitySummaryMessage,
  locale: ActivitySummaryLocale,
): string | undefined {
  const { translate } = locale;
  switch (message.key) {
    case 'activityCreated':
    case 'activityDeleted':
    case 'activityUpdated':
      return translate(`messages.${message.key}`, {
        object: objectLabelIn(locale, message.object),
        label: message.label,
      });
    case 'activityUpdatedFields': {
      const frame = { object: objectLabelIn(locale, message.object), label: message.label };
      if (translate('messages.activityUpdatedFields', { ...frame, fields: '' }) === undefined) {
        return translate('messages.activityUpdated', frame);
      }
      const fields = locale.getObjectDef(message.object)?.fields;
      const items = message.fields.map((key) => fieldLabelForSummary(key, fields?.[key]));
      if (message.more > 0) {
        items.push(
          translate('messages.activityMoreFields', { count: message.more }) ??
            interpolate(enMessages.activityMoreFields as string, { count: message.more }),
        );
      }
      return translate('messages.activityUpdatedFields', { ...frame, fields: listJoinerFor(locale.locale)(items) });
    }
    case 'fieldChanges': {
      const fields = locale.getObjectDef(message.object)?.fields;
      const valueIn = (field: string, value: ActivitySummaryValue): string =>
        value.option !== undefined
          ? (optionLabelOn(fields?.[field], value.option) ?? value.text)
          : typeof value.boolean === 'boolean'
            ? (translate(`messages.${booleanMessageKey(value.boolean)}`) ?? value.text)
            : value.text;
      return message.changes
        .map(
          (c) =>
            `${fieldLabelForSummary(c.field, fields?.[c.field])}: ` +
            `${valueIn(c.field, c.from)} → ${valueIn(c.field, c.to)}`,
        )
        .join('; ');
    }
  }
}

/** The stored sentence for `message`: the write locale's, else the English catalog's. */
export function composeStoredSummary(message: ActivitySummaryMessage, locale: ActivitySummaryLocale): string {
  return composeActivitySummary(message, locale) ?? composeActivitySummary(message, withEnglishMessages(locale)) ?? '';
}

const SINGLE_TEMPLATE_KEYS: ReadonlySet<string> = new Set(['activityCreated', 'activityDeleted', 'activityUpdated']);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
const isValue = (v: unknown): v is ActivitySummaryValue =>
  isRecord(v) &&
  typeof v.text === 'string' &&
  (v.option === undefined || typeof v.option === 'string') &&
  (v.boolean === undefined || typeof v.boolean === 'boolean');

/** A stored code, or `null` for anything this version cannot compose (it then stays as stored). */
export function readActivitySummaryMessage(value: unknown): ActivitySummaryMessage | null {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.object !== 'string') return null;
  if (SINGLE_TEMPLATE_KEYS.has(value.key)) {
    return typeof value.label === 'string' ? (value as ActivitySummaryMessage) : null;
  }
  if (value.key === 'activityUpdatedFields') {
    return typeof value.label === 'string' && isStringList(value.fields) && typeof value.more === 'number'
      ? (value as ActivitySummaryMessage)
      : null;
  }
  if (value.key === 'fieldChanges') {
    const changes = value.changes;
    return Array.isArray(changes) &&
      changes.every((c) => isRecord(c) && typeof c.field === 'string' && isValue(c.from) && isValue(c.to))
      ? (value as ActivitySummaryMessage)
      : null;
  }
  return null;
}

/**
 * The slice of `II18nService` a read asks: `t()`, `getLocales()` to negotiate
 * when offered, and [#35384] the members the labels are resolved by, as the
 * metadata route reads them.
 */
export interface ActivitySummaryI18n {
  t(key: string, locale: string, params?: Record<string, unknown>): string;
  getLocales?(): unknown;
  getTranslations?(locale: string): unknown;
  getFallbackLocale?(): string | undefined;
  getSourceLocale?(): string | undefined;
  getDefaultLocale?(): string;
}

/**
 * [#35384] What the metadata route (`GET /meta/object/:name`) translates an
 * object definition with, for a request in `locale`: the bundle — every locale
 * `service` holds, keyed by locale (`translationBundleOf` in rest) — and the
 * `ResolveOptions` that route builds (`metaTranslateOptions` in rest): the
 * request's locale, the DECLARED fallback chain (`getFallbackLocale()`), and
 * the authored language — the declared `sourceLocale` (`getSourceLocale()`),
 * else `defaultLocale` (`getDefaultLocale()`). Each getter is
 * feature-detected; a service that declares none gets none. The locale is
 * the negotiated one, as objectql's refusal labels hand `translateObject`.
 *
 * `undefined` — the authored labels stand — for a service that cannot hand its
 * translations over (no `getLocales` / `getTranslations`). A throwing service
 * is the caller's to survive.
 */
function labelTranslationOf(
  service: ActivitySummaryI18n,
  locale: string,
): { bundle: TranslationBundle | undefined; options: ResolveOptions } | undefined {
  if (typeof service.getLocales !== 'function' || typeof service.getTranslations !== 'function') return undefined;
  const locales = service.getLocales();
  if (!Array.isArray(locales)) return undefined;
  const bundle: Record<string, unknown> = {};
  for (const code of locales) {
    if (typeof code !== 'string' || code.length === 0) continue;
    const data = service.getTranslations(code);
    if (data && typeof data === 'object') bundle[code] = data;
  }
  const fallback = typeof service.getFallbackLocale === 'function' ? service.getFallbackLocale() : undefined;
  const source = typeof service.getSourceLocale === 'function' ? service.getSourceLocale() : undefined;
  const authored = typeof source === 'string' && source.length > 0
    ? source
    : typeof service.getDefaultLocale === 'function' ? service.getDefaultLocale() : undefined;
  const options: ResolveOptions = {
    locale,
    ...(typeof fallback === 'string' && fallback.length > 0 ? { fallbackChain: [fallback] } : {}),
    ...(typeof authored === 'string' && authored.length > 0 ? { defaultLocale: authored } : {}),
  };
  return { bundle: Object.keys(bundle).length > 0 ? (bundle as TranslationBundle) : undefined, options };
}

/**
 * The locale `service` can ANSWER in, for the locale the reader asked for:
 * `resolveBundleLocale` over what `getLocales()` reports. The requested tag
 * passes through untouched when there is nothing to negotiate against.
 */
function negotiatedLocale(service: ActivitySummaryI18n, requested: string): string {
  if (typeof service.getLocales !== 'function') return requested;
  let available: unknown;
  try {
    available = service.getLocales();
  } catch {
    return requested;
  }
  if (!Array.isArray(available) || available.length === 0) return requested;
  const offered: Record<string, true> = {};
  for (const code of available) {
    if (typeof code === 'string' && code.length > 0) offered[code] = true;
  }
  return resolveBundleLocale(offered, requested) ?? requested;
}

/**
 * The language a reader whose `ExecutionContext.locale` is `requested` reads
 * in, or `undefined` when this read can compose nothing: no locale, or no
 * service with a `t()`.
 *
 * [#35384] Its `getObjectDef` answers the definition `translateObject` put in
 * the reader's language ({@link labelTranslationOf}), built once per object
 * for the read; the authored definition when there is nothing to translate
 * with, or the translator throws.
 */
export function readerSummaryLocale(
  service: ActivitySummaryI18n | undefined,
  requested: unknown,
  getObjectDef: (objectName: string) => any,
): ActivitySummaryLocale | undefined {
  if (typeof requested !== 'string' || requested.length === 0) return undefined;
  if (!service || typeof service.t !== 'function') return undefined;
  const locale = negotiatedLocale(service, requested);
  let translation: { value: ReturnType<typeof labelTranslationOf> } | undefined;
  const definitions = new Map<string, any>();
  const translatedObjectDef = (objectName: string): any => {
    if (definitions.has(objectName)) return definitions.get(objectName);
    const def = getObjectDef(objectName);
    let served = def;
    if (def && typeof def === 'object') {
      try {
        translation ??= { value: labelTranslationOf(service, locale) };
        if (translation.value) {
          served = translateObject({ ...def, name: objectName }, translation.value.bundle, translation.value.options);
        }
      } catch {
        // A misbehaving i18n service must not fail the read: the authored labels stand.
      }
    }
    definitions.set(objectName, served);
    return served;
  };
  return {
    translate: (key, params) => {
      try {
        const text = service.t(key, locale, params);
        // `II18nService.t` echoes the key back on a miss.
        return typeof text === 'string' && text.length > 0 && text !== key ? text : undefined;
      } catch {
        // A misbehaving i18n service must not fail the read: the stored text stands.
        return undefined;
      }
    },
    locale,
    getObjectDef: translatedObjectDef,
  };
}

/** Parse a stored `metadata` value: a JSON object, or `null` for anything else. */
function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Overlay `row.summary` with its stored code composed in `locale`, in place,
 * and — for a caller who is not the system — drop the code from the served
 * `metadata`: its parameters are parent field values (the record label, a
 * changed value), and the field redaction judges the text columns, not this
 * slot. A row whose `summary` the projection did not ask for is not given one.
 */
export function localizeActivityRow(
  row: Record<string, unknown>,
  locale: ActivitySummaryLocale | undefined,
  stripCode: boolean,
): void {
  const metadata = parseMetadata(row.metadata);
  if (!metadata || !(ACTIVITY_SUMMARY_MESSAGE_KEY in metadata)) return;
  if (locale && 'summary' in row) {
    const message = readActivitySummaryMessage(metadata[ACTIVITY_SUMMARY_MESSAGE_KEY]);
    if (message) {
      try {
        const text = composeActivitySummary(message, locale);
        if (text) row.summary = text;
      } catch {
        // Composing must never fail the read: the stored sentence stands.
      }
    }
  }
  if (stripCode) {
    delete metadata[ACTIVITY_SUMMARY_MESSAGE_KEY];
    row.metadata = isRecord(row.metadata) ? metadata : JSON.stringify(metadata);
  }
}

/** The engine slice the summary middleware registers on. */
export interface ActivitySummaryEngine {
  registerMiddleware?(
    fn: (ctx: any, next: () => Promise<void>) => Promise<void>,
    options?: { object?: string },
  ): void;
  getSchema?(objectName: string): unknown;
}

/**
 * Install the `sys_activity` summary middleware. `getI18n` is resolved on every
 * read: the i18n service may register after this plugin. Register it AFTER the
 * field redaction (`installActivityFieldRedaction`), so it runs inside it: the
 * summary is composed from the row as stored, and the redaction then judges
 * the composed text by the same declared sources the stored one had.
 */
export function installActivitySummaryLocale(
  engine: ActivitySummaryEngine,
  getI18n: () => ActivitySummaryI18n | undefined,
): void {
  if (typeof engine.registerMiddleware !== 'function') return;
  const getObjectDef = (objectName: string): any => {
    try {
      return typeof engine.getSchema === 'function' ? engine.getSchema(objectName) : null;
    } catch {
      return null;
    }
  };
  engine.registerMiddleware(
    async (ctx, next) => {
      if (ctx.operation !== 'find' && ctx.operation !== 'findOne') return next();
      const added = ensureJudgedColumnsProjected(ctx.ast, ['summary'], ['metadata']);
      await next();
      const list = (Array.isArray(ctx.result) ? ctx.result : ctx.result ? [ctx.result] : []) as unknown[];
      const locale = readerSummaryLocale(getI18n(), ctx.context?.locale, getObjectDef);
      const stripCode = !!ctx.context && !ctx.context.isSystem;
      for (const row of list) {
        if (!isRecord(row)) continue;
        localizeActivityRow(row, locale, stripCode);
        for (const col of added) delete row[col];
      }
    },
    { object: 'sys_activity' },
  );
}
