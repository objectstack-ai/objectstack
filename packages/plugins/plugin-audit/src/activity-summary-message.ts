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

import { resolveBundleLocale } from '@objectstack/spec/system';

import { enMessages } from './translations/messages.js';
import { ensureJudgedColumnsProjected, isRecord } from './served-fields.js';

/** The `metadata` key a row's summary code rides in. Read and stripped by {@link installActivitySummaryLocale}. */
export const ACTIVITY_SUMMARY_MESSAGE_KEY = 'summary_message';

/** One side of a field change: the writer's text, and the option it matched (a select value). */
export interface ActivitySummaryValue {
  text: string;
  option?: string;
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
  /** The object's registered definition, for its authored labels; `null` when there is none. */
  getObjectDef(objectName: string): any;
}

/** Interpolate one `{{param}}` template, the shared convention (`createMemoryI18n`, FileI18nAdapter). */
function interpolate(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? `{{${name}}}`));
}

/**
 * `locale` with this plugin's ENGLISH catalog answering every `messages.*`
 * key: what the stored sentence falls back to when the write locale has no
 * template. Every other key (object, field and option labels) is still asked
 * of `locale`, as the writer always has.
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

/** An object's label: the locale bundle's, then the authored def label, then the name. */
export function objectLabelIn(locale: ActivitySummaryLocale, objectName: string): string {
  const def = locale.getObjectDef(objectName);
  return (
    locale.translate(`objects.${objectName}.label`) ??
    (typeof def?.label === 'string' && def.label.length > 0 ? def.label : objectName)
  );
}

/**
 * A field's label inside an activity summary: the locale bundle's
 * (`objects.<object>.fields.<field>.label`), then the authored def label, then
 * the machine key. One answer for every branch that names a field.
 */
export function fieldLabelForSummary(
  objectName: string,
  key: string,
  field: any,
  translate: (key: string, params?: Record<string, unknown>) => string | undefined,
): string {
  return (
    translate(`objects.${objectName}.fields.${key}.label`) ??
    (typeof field?.label === 'string' && field.label.length > 0 ? field.label : key)
  );
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
      const items = message.fields.map((key) => fieldLabelForSummary(message.object, key, fields?.[key], translate));
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
          ? (translate(`objects.${message.object}.fields.${field}.options.${value.option}`) ?? value.text)
          : value.text;
      return message.changes
        .map(
          (c) =>
            `${fieldLabelForSummary(message.object, c.field, fields?.[c.field], translate)}: ` +
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
  isRecord(v) && typeof v.text === 'string' && (v.option === undefined || typeof v.option === 'string');

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

/** The slice of `II18nService` a read asks: `t()`, and `getLocales()` to negotiate when offered. */
export interface ActivitySummaryI18n {
  t(key: string, locale: string, params?: Record<string, unknown>): string;
  getLocales?(): unknown;
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
 */
export function readerSummaryLocale(
  service: ActivitySummaryI18n | undefined,
  requested: unknown,
  getObjectDef: (objectName: string) => any,
): ActivitySummaryLocale | undefined {
  if (typeof requested !== 'string' || requested.length === 0) return undefined;
  if (!service || typeof service.t !== 'function') return undefined;
  const locale = negotiatedLocale(service, requested);
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
    getObjectDef,
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
