/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Data pillar — API view.
 *
 * A truthful, schema-derived REST reference for the selected object. The
 * platform auto-generates five CRUD endpoints per object under
 * `/api/v1/data/<object>` (list / create / get / update / delete) — the same
 * set the classic Studio's API Console surfaces, here scoped to the one object
 * you're looking at so the context is already pinned.
 *
 * Deliberately read-only / reference-only: live execution + auth (choosing a
 * token, impersonating a role, actually firing a write) is a cross-object,
 * cross-cutting concern that belongs in a global Developer console, not on a
 * per-object tab. This panel derives its example body from the object's DRAFT
 * fields, so it stays in sync with unpublished schema edits: each value is one
 * the write path accepts for that field's type (objectui#11803), and the
 * copied cURL carries the `Authorization` header the call needs.
 */

import React from 'react';
import { Copy, Check } from 'lucide-react';
import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  COMPUTED_VALUE_TYPES,
  FILE_REFERENCE_TYPES,
  INSTANT_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
  isMultiValueField,
  type FieldType,
} from '@objectstack/spec/data';
import type { ValueDomain } from '@objectstack/spec/shared';
import { readFields } from '../metadata-admin/previews/object-fields-io.js';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const METHOD_STYLE: Record<Method, string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  POST: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  PATCH: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  DELETE: 'bg-destructive/15 text-destructive',
};

type FieldDef = Readonly<Record<string, unknown>>;

/**
 * How many fields the example body shows before it lists the rest by name.
 * Required fields are exempt: every one of them is always in the body, because
 * a create that leaves one out is refused. The cap only bounds how many
 * OPTIONAL fields join them, so the example stays short enough to read.
 */
const EXAMPLE_FIELD_CAP = 8;

/** The sample for a plain string value (`STRING_VALUE_TYPES`, free-form options). */
const TEXT_SAMPLE = 'string';

/**
 * String types whose written value the server also checks for FORMAT (the
 * email / url / phone checks of the record write path), so `"string"` would be
 * refused. Each sample is written to pass that check.
 */
const FORMATTED_TEXT_SAMPLE: Partial<Record<FieldType, string>> = {
  email: 'user@example.com',
  url: 'https://example.com',
  phone: '+1 555 0100',
};

/**
 * A member of each standard value domain a `text` field may declare
 * (`valueDomain`): the write path refuses a value outside the domain.
 */
const VALUE_DOMAIN_SAMPLE: Record<ValueDomain, string> = {
  iana_time_zone: 'UTC',
  iso_4217_currency: 'USD',
  iso_3166_alpha2: 'US',
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Fit a string sample inside the field's declared `minLength` / `maxLength`. */
function fitLength(sample: string, def: FieldDef): string {
  const min = finiteNumber(def.minLength);
  const max = finiteNumber(def.maxLength);
  let out = sample;
  if (min !== undefined && out.length < min) out = out.padEnd(min, 'x');
  if (max !== undefined && out.length > max) out = out.slice(0, Math.max(0, max));
  return out;
}

/** A string value for a `STRING_VALUE_TYPES` field. */
function textSampleFor(type: string, def: FieldDef): string {
  const domain = typeof def.valueDomain === 'string' ? def.valueDomain : undefined;
  if (domain !== undefined && domain in VALUE_DOMAIN_SAMPLE) {
    return VALUE_DOMAIN_SAMPLE[domain as ValueDomain];
  }
  return fitLength(FORMATTED_TEXT_SAMPLE[type as FieldType] ?? TEXT_SAMPLE, def);
}

/** `0`, moved inside the field's declared `min` / `max` when it lies outside. */
function numberSampleFor(def: FieldDef): number {
  const min = finiteNumber(def.min);
  const max = finiteNumber(def.max);
  let n = 0;
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
}

/**
 * The code of the field's first declared option. Read the way the spec's value
 * contract reads option codes: an option object's `value`, or a bare option.
 */
function firstOptionCode(def: FieldDef): string | undefined {
  const options = def.options;
  if (!Array.isArray(options) || options.length === 0) return undefined;
  const first: unknown = options[0];
  if (first !== null && typeof first === 'object') {
    const value = (first as { value?: unknown }).value;
    return value === undefined || value === null ? undefined : String(value);
  }
  return first === undefined || first === null ? undefined : String(first);
}

/**
 * One example value in the STORED form the record write path accepts for this
 * field's type: the value classes of `@objectstack/spec`'s field-value
 * contract (`valueSchemaFor(def, 'stored')`), not a guess per type name.
 */
function exampleElementFor(type: string, def: FieldDef): unknown {
  if (STRING_VALUE_TYPES.has(type)) return textSampleFor(type, def);
  if (NUMERIC_VALUE_TYPES.has(type)) return numberSampleFor(def);
  if (BOOLEAN_VALUE_TYPES.has(type)) return true;
  if (CALENDAR_DATE_TYPES.has(type)) return '2024-01-01';
  if (INSTANT_TYPES.has(type)) return '2024-01-01T00:00:00Z';
  if (CLOCK_TIME_TYPES.has(type)) return '09:00';
  // A declared option's code; `tags` and an option type with no options yet
  // take free-form strings.
  if (SINGLE_OPTION_TYPES.has(type) || MULTI_OPTION_TYPES.has(type)) {
    return firstOptionCode(def) ?? TEXT_SAMPLE;
  }
  // A reference stores the related record's id; a media field the id of an
  // uploaded file (`sys_file`), never an inline object or a URL.
  if (REFERENCE_VALUE_TYPES.has(type)) return 'related_record_id';
  if (FILE_REFERENCE_TYPES.has(type)) return 'file_id';
  switch (type) {
    case 'location':
      return { lat: 37.7749, lng: -122.4194 };
    case 'address':
      return { street: '1 Main St', city: 'Springfield', postalCode: '12345', country: 'US' };
    case 'json':
    case 'composite':
    case 'record':
      return {};
    case 'repeater':
      return [];
    case 'vector':
      return [0, 0, 0];
    default:
      return TEXT_SAMPLE;
  }
}

/** The example value for one field: an array of one element when the field is multi-valued. */
function exampleValueFor(def: FieldDef): unknown {
  const type = String(def.type);
  const element = exampleElementFor(type, def);
  return isMultiValueField({ type, multiple: def.multiple === true }) ? [element] : element;
}

/**
 * An example create body from the object's writable draft fields, in the order
 * an author needs them: every required field first, then optional fields up to
 * {@link EXAMPLE_FIELD_CAP} — the object's own fields before the ones the
 * platform adds (`system: true`, such as `owner_id`, which the platform fills
 * in when it is left out). Computed, read-only and hidden fields are skipped.
 * `omitted` names the optional fields left out, so the panel can say so.
 */
function buildExampleBody(fields: unknown): { body: Record<string, unknown>; omitted: string[] } {
  const writable = readFields(fields).entries.filter(({ def }) => {
    if (COMPUTED_VALUE_TYPES.has(String(def.type))) return false;
    return def.readonly !== true && def.hidden !== true;
  });
  const required = writable.filter(({ def }) => def.required === true);
  const optional = [
    ...writable.filter(({ def }) => def.required !== true && def.system !== true),
    ...writable.filter(({ def }) => def.required !== true && def.system === true),
  ];
  const room = Math.max(0, EXAMPLE_FIELD_CAP - required.length);
  const shown = [...required, ...optional.slice(0, room)];
  // `Object.fromEntries` defines own properties, so a field named `__proto__`
  // (a legal field name) is kept rather than swallowed by assignment.
  const body = Object.fromEntries(shown.map(({ name, def }) => [name, exampleValueFor(def)]));
  return { body, omitted: optional.slice(room).map(({ name }) => name) };
}

export function ObjectApiPanel({
  name,
  draft,
}: {
  name: string;
  draft: Record<string, unknown>;
}) {
  const locale = useMetadataLocale();
  const [copied, setCopied] = React.useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-host';
  const base = `/api/v1/data/${name}`;
  const { body: exampleBody, omitted } = React.useMemo(() => buildExampleBody(draft.fields), [draft.fields]);
  const bodyJson = JSON.stringify(exampleBody, null, 2);

  const endpoints: Array<{ id: string; method: Method; path: string; desc: string; body?: boolean }> = [
    { id: 'list', method: 'GET', path: base, desc: t('engine.studio.api.list', locale) },
    { id: 'create', method: 'POST', path: base, desc: t('engine.studio.api.create', locale), body: true },
    { id: 'get', method: 'GET', path: `${base}/{id}`, desc: t('engine.studio.api.get', locale) },
    { id: 'update', method: 'PATCH', path: `${base}/{id}`, desc: t('engine.studio.api.update', locale), body: true },
    { id: 'delete', method: 'DELETE', path: `${base}/{id}`, desc: t('engine.studio.api.delete', locale) },
  ];

  const curlFor = (ep: (typeof endpoints)[number]) => {
    const lines = [`curl -X ${ep.method} '${origin}${ep.path}'`, `  -H 'Authorization: Bearer <token>'`];
    if (ep.body) {
      lines.push(`  -H 'Content-Type: application/json'`);
      lines.push(`  -d '${JSON.stringify(exampleBody)}'`);
    }
    return lines.join(' \\\n');
  };

  const copy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <p className="text-[11px] leading-5 text-muted-foreground">{t('engine.studio.api.subtitle', locale)}</p>

      <div className="flex flex-col gap-2">
        {endpoints.map((ep) => (
          <div key={ep.id} className="rounded-lg border">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className={'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ' + METHOD_STYLE[ep.method]}>
                {ep.method}
              </span>
              <code className="min-w-0 flex-1 truncate text-[12px]">{ep.path}</code>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{ep.desc}</span>
              <button
                type="button"
                onClick={() => copy(ep.id, curlFor(ep))}
                title={t('engine.studio.api.copyCurl', locale)}
                className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
              >
                {copied === ep.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copied === ep.id ? t('engine.studio.api.copied', locale) : 'cURL'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {Object.keys(exampleBody).length > 0 && (
        <div className="rounded-lg border">
          <header className="border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            {t('engine.studio.api.body', locale)}
          </header>
          <pre className="overflow-auto px-3 py-2 text-[11px] leading-5">{bodyJson}</pre>
          {omitted.length > 0 && (
            <p className="border-t px-3 py-1.5 text-[11px] leading-5 text-muted-foreground">
              {tFormat('engine.studio.api.bodyOmitted', locale, { fields: omitted.join(', ') })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
