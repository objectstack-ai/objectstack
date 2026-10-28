// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SharedRecordFields — the read-only field list a share link to a non-chat
 * record renders (objectstack#26767), in place of the raw JSON dump it showed.
 *
 * What it draws from is exactly what the resolve answer carries: the record's
 * own keys, after the server stripped the link's redacted fields. ⛔ It never
 * adds a key the record does not carry, and never fetches anything to widen it.
 *
 * Labels and types come from the resolve answer's `fields` projection
 * (objectstack#27121), and from nowhere else. The one door to the object
 * schema, `GET /meta/object/:name`, refuses an anonymous caller, and this
 * page's visitor is anonymous by design (its requests carry no bearer token),
 * so the server projects the display facts of exactly the fields `record`
 * carries — a redacted field is absent from both. ⛔ Nothing here fetches.
 *
 * - The label is the field's authored `label`; a key with no `fields` entry
 *   (or an answer from a server that predates the projection) keeps the record
 *   key humanized.
 * - The value goes through the record detail view's own read-only cell
 *   renderer for its type, but only a renderer measured to draw from the value
 *   and the projected field alone: see {@link NO_FETCH_CELL_RENDERERS}.
 * - Every other value is formatted by its JSON shape: an ISO date or date-time
 *   string through the console's one date-display path, a number through its
 *   one number-display path, a boolean as Yes / No (the detail view's
 *   read-only word), and an array or object as short text — never raw JSON.
 *   That includes a lookup: its value is the stored id, and the target's name
 *   is not served to an anonymous visitor, so the id is what shows.
 *
 * System fields are shown, not hidden: the record detail view's notion of a
 * framework-managed column (`isSystemManagedField`, `@object-ui/types`) only
 * orders them after the business fields, the way the detail view keeps
 * provenance out of the leading rows.
 */

import type * as React from 'react';
import { formatDate, formatDateTime, formatDisplayNumber, humanizeLabel } from '@object-ui/core';
import {
  CurrencyCellRenderer,
  getCellRenderer,
  SelectCellRenderer,
  type CellRendererProps,
} from '@object-ui/fields';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { isSystemManagedField, type FieldMetadata } from '@object-ui/types';
import type { SharedFieldDisplay } from './shared-record-shape';

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

/**
 * The detail view's read-only cell renderers this page may draw with — matched
 * by renderer IDENTITY, the way the detail view matches its own boolean and
 * text faces, so a host that registered its own face for a type (one that may
 * read records) is never picked up here.
 *
 * Each was read for what it touches: `SelectCellRenderer` draws the option's
 * authored label and colour from `field.options`; `CurrencyCellRenderer`
 * resolves its code with `resolveFieldCurrency` from the field's
 * `currencyConfig` and the tenant default the localization context holds
 * (none on this page). Neither fetches. ⛔ Never add `LookupCellRenderer` or
 * `UserCellRenderer`: both read the referenced record through the data source,
 * which an anonymous visitor cannot.
 */
const NO_FETCH_CELL_RENDERERS: ReadonlySet<React.FC<CellRendererProps>> = new Set([
  SelectCellRenderer,
  CurrencyCellRenderer,
]);

/** The detail view's renderer for `field`'s type, when it is one this page may use. */
function noFetchRendererOf(field: SharedFieldDisplay | undefined): React.FC<CellRendererProps> | undefined {
  if (!field?.type) return undefined;
  const renderer = getCellRenderer(field.type);
  return NO_FETCH_CELL_RENDERERS.has(renderer) ? renderer : undefined;
}

export interface SharedRecordFieldsProps {
  /** The record as the resolve answer carried it, redacted fields already stripped. */
  record: Record<string, unknown>;
  /** The resolve answer's display projection, keyed by field name; absent from an older server. */
  fields?: Record<string, SharedFieldDisplay>;
}

export function SharedRecordFields({ record, fields }: SharedRecordFieldsProps) {
  const { t } = useObjectTranslation();
  const locale = useDisplayLocale();
  const keys = Object.keys(record);

  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('common.noData', { defaultValue: 'No data' })}</p>;
  }

  const business = keys.filter((key) => !isSystemManagedField(key));
  const system = keys.filter((key) => isSystemManagedField(key));

  const rows = (group: string[]) =>
    group.map((key) => {
      const field = fields?.[key];
      const Renderer = noFetchRendererOf(field);
      return (
        <div key={key} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[minmax(8rem,1fr)_2fr] sm:gap-4">
          <dt className="text-xs font-medium text-muted-foreground">{field?.label || humanizeLabel(key)}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
            {Renderer ? (
              <Renderer value={record[key]} field={{ name: key, ...field } as unknown as FieldMetadata} />
            ) : (
              formatValue(record[key], locale, t)
            )}
          </dd>
        </div>
      );
    });

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
