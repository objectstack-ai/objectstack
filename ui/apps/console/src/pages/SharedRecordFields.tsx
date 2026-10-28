// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SharedRecordFields — the read-only field list a share link to a non-chat
 * record renders (objectstack#26767), in place of the raw JSON dump it showed.
 *
 * What it draws from is exactly what the resolve answer carries: the record's
 * own keys, after the server stripped the link's redacted fields. ⛔ It never
 * adds a key the record does not carry, and never fetches anything to widen it.
 *
 * Why no field labels or field types. The resolve answer is `{ record, link,
 * redactFields }` on both producers — no object schema. The one door to that
 * schema, `GET /meta/object/:name`, refuses an anonymous caller, and this page's
 * visitor is anonymous by design (its requests carry no bearer token). So the
 * label is the record key humanized, and the value is formatted by its JSON
 * shape: an ISO date or date-time string through the console's one date-display
 * path, a number through its one number-display path, a boolean as Yes / No,
 * and an array or object as short text — never raw JSON.
 *
 * System fields are shown, not hidden: the record detail view's notion of a
 * framework-managed column (`isSystemManagedField`, `@object-ui/types`) only
 * orders them after the business fields, the way the detail view keeps
 * provenance out of the leading rows.
 */

import { formatDate, formatDateTime, formatDisplayNumber, humanizeLabel } from '@object-ui/core';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { isSystemManagedField } from '@object-ui/types';

/** An empty value's face — the date-display path's own placeholder. */
const EMPTY = '—';

/** How deep a nested value is spelled out before it is elided. */
const MAX_DEPTH = 2;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

type Translate = ReturnType<typeof useObjectTranslation>['t'];

function formatString(value: string, locale: string): string {
  if (value === '') return EMPTY;
  if (DATE_ONLY.test(value)) {
    const text = formatDate(value, undefined, { locale });
    return text === EMPTY ? value : text;
  }
  if (DATE_TIME.test(value)) {
    const text = formatDateTime(value, { locale });
    return text === EMPTY ? value : text;
  }
  return value;
}

/** One value as display text, by its JSON shape. */
function formatValue(value: unknown, locale: string, t: Translate, depth = 0): string {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === 'string') return formatString(value, locale);
  if (typeof value === 'number') return Number.isFinite(value) ? formatDisplayNumber(value, { locale }) : String(value);
  if (typeof value === 'boolean') {
    return value ? t('common.yes', { defaultValue: 'Yes' }) : t('common.no', { defaultValue: 'No' });
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY;
    if (depth >= MAX_DEPTH) return '…';
    return value.map((item) => formatValue(item, locale, t, depth + 1)).join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return EMPTY;
    if (depth >= MAX_DEPTH) return '…';
    return entries.map(([k, v]) => `${humanizeLabel(k)}: ${formatValue(v, locale, t, depth + 1)}`).join('; ');
  }
  return String(value);
}

export interface SharedRecordFieldsProps {
  /** The record as the resolve answer carried it, redacted fields already stripped. */
  record: Record<string, unknown>;
}

export function SharedRecordFields({ record }: SharedRecordFieldsProps) {
  const { t } = useObjectTranslation();
  const locale = useDisplayLocale();
  const keys = Object.keys(record);

  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('common.noData', { defaultValue: 'No data' })}</p>;
  }

  const business = keys.filter((key) => !isSystemManagedField(key));
  const system = keys.filter((key) => isSystemManagedField(key));

  const rows = (group: string[]) =>
    group.map((key) => (
      <div key={key} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[minmax(8rem,1fr)_2fr] sm:gap-4">
        <dt className="text-xs font-medium text-muted-foreground">{humanizeLabel(key)}</dt>
        <dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          {formatValue(record[key], locale, t)}
        </dd>
      </div>
    ));

  return (
    <div className="rounded-md border bg-card px-4">
      {business.length > 0 && <dl className="divide-y">{rows(business)}</dl>}
      {system.length > 0 && (
        <dl data-testid="shared-record-system-fields" className={business.length > 0 ? 'divide-y border-t' : 'divide-y'}>
          {rows(system)}
        </dl>
      )}
    </div>
  );
}
