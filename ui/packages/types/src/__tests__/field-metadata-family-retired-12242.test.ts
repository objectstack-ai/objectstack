/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12242 — the field metadata members `@objectstack/spec`'s
 * `FieldSchema` refuses retire on this file's `?: never` convention (the one
 * `GridFieldMetadata` uses for `min_rows`), and the two type values it refuses
 * become the spec's.
 *
 * One ordinary pin per member, not an enumeration over the family:
 *
 *  - a FRESH annotated literal carrying the retired key is refused at compile
 *    time (`@ts-expect-error`, checked by this package's `type-check` through
 *    `tsconfig.test.json`);
 *  - where the member has a spec twin, the twin is declared BY REFERENCE and
 *    an annotated literal carrying it compiles;
 *  - the runtime half reads the installed spec, so "the spec refuses it" and
 *    "the spec accepts the twin" are re-derived on every run, each behind an
 *    accepting control.
 *
 * The second round (maintainer ruling A on the card) takes the positions the
 * first round kept:
 *
 *  - `mobile_fullscreen`, `idField`, `picker` and `subtitle` MOVE off the field
 *    metadata types: each is a key a host writes onto a widget's carrier, so it
 *    is typed where its producer and consumer meet (`LongTextCarrierHandoff`
 *    in `@object-ui/fields`; the form entry, `FormField`, for the three picker
 *    keys). A fresh annotated literal carrying one is refused here.
 *  - `pattern`, `pattern_message` and `validate` RETIRE as `never` tombstones:
 *    the spec's regex check is the object's `format` validation rule.
 *  - `GeolocationFieldMetadata` leaves the `FieldMetadata` union: `geolocation`
 *    is not a spec `FieldType`.
 *
 * `dueLike` was deliberately NOT moved: `@objectstack/spec` declared it on
 * `FieldSchema` before it reached the installed release. Now that it has, it
 * is typed by reference beside `settledWhen` (objectui#12297), pinned in
 * `field-metadata-deadline-by-reference-12297.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { FieldSchema, ObjectSchema, type Field as SpecField } from '@objectstack/spec/data';
import type {
  AutoNumberFieldMetadata,
  BaseFieldMetadata,
  CurrencyFieldMetadata,
  DateFieldMetadata,
  DateTimeFieldMetadata,
  FieldMetadata,
  LocationFieldMetadata,
  LookupFieldMetadata,
  ObjectFieldMetadata,
  TextareaFieldMetadata,
  TextFieldMetadata,
  UserFieldMetadata,
  VectorFieldMetadata,
} from '../field-types.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// ── The spec twins, declared by reference ────────────────────────────────────

export type assertionTwinsByReference = [
  Expect<Equal<BaseFieldMetadata['visibleWhen'], SpecField['visibleWhen']>>,
  Expect<Equal<CurrencyFieldMetadata['currencyConfig'], SpecField['currencyConfig']>>,
];

/** The type values are the spec's `FieldType` spellings. */
export type assertionTypeValues = [
  Expect<Equal<AutoNumberFieldMetadata['type'], 'autonumber'>>,
  Expect<Equal<ObjectFieldMetadata['type'], 'json'>>,
];

export const _visibleWhen: TextFieldMetadata = {
  type: 'text',
  name: 'po_number',
  visibleWhen: "record.type == 'invoice'",
};

export const _visibleWhenEnvelope: TextFieldMetadata = {
  type: 'text',
  name: 'po_number',
  visibleWhen: { dialect: 'cel', source: "record.type == 'invoice'" },
};

export const _currencyConfig: CurrencyFieldMetadata = {
  type: 'currency',
  name: 'amount',
  currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' },
};

export const _autonumber: AutoNumberFieldMetadata = { type: 'autonumber', name: 'invoice_no', format: 'INV-{0000}' };

export const _json: ObjectFieldMetadata = { type: 'json', name: 'settings' };

// ── Each retired member, refused on a fresh literal ─────────────────────────

export const _visibleOn: TextFieldMetadata = {
  type: 'text',
  name: 'po_number',
  // @ts-expect-error — objectui#12242: `visible_on` is retired; write `visibleWhen`
  visible_on: { field: 'type', operator: '=', value: 'invoice' },
};

export const _filterable: TextFieldMetadata = {
  type: 'text',
  name: 'po_number',
  // @ts-expect-error — objectui#12242: `filterable` is retired, with no replacement key
  filterable: true,
};

export const _currency: CurrencyFieldMetadata = {
  type: 'currency',
  name: 'amount',
  // @ts-expect-error — objectui#12242: `currency` is retired; write `currencyConfig`
  currency: 'USD',
};

export const _dateMin: DateFieldMetadata = {
  type: 'date',
  name: 'close_date',
  // @ts-expect-error — objectui#12242: `min_date` is retired, with no replacement key
  min_date: '2024-01-01',
};

export const _dateMax: DateFieldMetadata = {
  type: 'date',
  name: 'close_date',
  // @ts-expect-error — objectui#12242: `max_date` is retired, with no replacement key
  max_date: '2030-12-31',
};

export const _dateTimeMin: DateTimeFieldMetadata = {
  type: 'datetime',
  name: 'starts_at',
  // @ts-expect-error — objectui#12242: `min_date` is retired, with no replacement key
  min_date: '2024-01-01T00:00:00Z',
};

export const _dateTimeMax: DateTimeFieldMetadata = {
  type: 'datetime',
  name: 'starts_at',
  // @ts-expect-error — objectui#12242: `max_date` is retired, with no replacement key
  max_date: '2030-12-31T23:59:59Z',
};

export const _defaultZoom: LocationFieldMetadata = {
  type: 'location',
  name: 'office',
  // @ts-expect-error — objectui#12242: `default_zoom` is retired, with no replacement key
  default_zoom: 12,
};

export const _startingNumber: AutoNumberFieldMetadata = {
  type: 'autonumber',
  name: 'invoice_no',
  // @ts-expect-error — objectui#12242: `starting_number` is retired, with no replacement key
  starting_number: 1000,
};

export const _schema: ObjectFieldMetadata = {
  type: 'json',
  name: 'settings',
  // @ts-expect-error — objectui#12242: `schema` is retired; declare a `json_schema` validation rule on the object
  schema: { type: 'object' },
};

export const _normalize: VectorFieldMetadata = {
  type: 'vector',
  name: 'embedding',
  // @ts-expect-error — objectui#12242: `normalize` is retired, with no replacement key
  normalize: true,
};

export const _autoNumberType: AutoNumberFieldMetadata = {
  // @ts-expect-error — objectui#12242: the type value is `autonumber`
  type: 'auto_number',
  name: 'invoice_no',
};

export const _objectType: ObjectFieldMetadata = {
  // @ts-expect-error — objectui#12242: the type value is `json`
  type: 'object',
  name: 'settings',
};

// ── Round two: the host-written keys leave the authoring face ───────────────

export const _mobileFullscreen: TextareaFieldMetadata = {
  type: 'textarea',
  name: 'body',
  // @ts-expect-error — objectui#12242: `mobile_fullscreen` is host-written; it is typed on `LongTextCarrierHandoff` in `@object-ui/fields`
  mobile_fullscreen: true,
};

export const _idField: LookupFieldMetadata = {
  type: 'lookup',
  name: 'approver',
  reference: 'sys_position',
  // @ts-expect-error — objectui#12242: `idField` is picker configuration; a form entry declares it (`FormField.idField`)
  idField: 'name',
};

export const _picker: UserFieldMetadata = {
  type: 'user',
  name: 'owner_id',
  // @ts-expect-error — objectui#12242: `picker` is picker configuration; a form entry declares it (`FormField.picker`)
  picker: 'search',
};

export const _subtitle: UserFieldMetadata = {
  type: 'user',
  name: 'owner_id',
  // @ts-expect-error — objectui#12242: `subtitle` is picker configuration; a form entry declares it (`FormField.subtitle`)
  subtitle: ['email'],
};

/** Not readable off the authoring face at all: the base no longer names it. */
export type assertionMovedOffTheBase = [
  Expect<Equal<'mobile_fullscreen' extends keyof BaseFieldMetadata ? true : false, false>>,
  Expect<Equal<'idField' extends keyof LookupFieldMetadata ? true : false, false>>,
  Expect<Equal<'picker' extends keyof UserFieldMetadata ? true : false, false>>,
  Expect<Equal<'subtitle' extends keyof UserFieldMetadata ? true : false, false>>,
];

// ── Round two: the field-level regex keys retire as `never` ─────────────────

export type assertionRegexTombstones = [
  Expect<Equal<TextFieldMetadata['pattern'], undefined>>,
  Expect<Equal<TextFieldMetadata['pattern_message'], undefined>>,
  Expect<Equal<BaseFieldMetadata['validate'], undefined>>,
];

export const _pattern: TextFieldMetadata = {
  type: 'text',
  name: 'sku',
  // @ts-expect-error — objectui#12242: `pattern` is retired; declare a `format` validation rule on the object
  pattern: '^[A-Z]{3}-[0-9]{4}$',
};

export const _patternMessage: TextFieldMetadata = {
  type: 'text',
  name: 'sku',
  // @ts-expect-error — objectui#12242: `pattern_message` is retired; the `format` rule carries the message
  pattern_message: 'SKU must look like ABC-1234',
};

export const _validate: TextFieldMetadata = {
  type: 'text',
  name: 'sku',
  // @ts-expect-error — objectui#12242: `validate` is retired; declare a `validations[]` rule on the object
  validate: (value: unknown) => typeof value === 'string',
};

// ── Round two: `geolocation` is not a member of the union ───────────────────

export const _geolocation: FieldMetadata = {
  // @ts-expect-error — objectui#12242: `geolocation` is not a spec field type; the spec's map point is `location`
  type: 'geolocation',
  name: 'site',
};

/** CONTROL for the row above: the spec's map-point type is a member. */
export const _location: FieldMetadata = { type: 'location', name: 'site' };

// ── The installed spec: what the type follows ────────────────────────────────

/** The `unrecognized_keys` issue naming `key`, if the parse refused it by name. */
function refusedByName(res: ReturnType<typeof FieldSchema.safeParse>, key: string): boolean {
  if (res.success) return false;
  return res.error.issues.some(
    (i) => i.code === 'unrecognized_keys' && ((i as { keys?: string[] }).keys ?? []).includes(key),
  );
}

/** The `invalid_value` issue at `type`, if the parse refused the type value. */
function typeRefused(res: ReturnType<typeof FieldSchema.safeParse>): boolean {
  if (res.success) return false;
  return res.error.issues.some((i) => i.code === 'invalid_value' && i.path.join('.') === 'type');
}

describe('installed @objectstack/spec — the members the type retires (objectui#12242)', () => {
  it('CONTROLS — a minimal field of each type parses, and a nonsense key is refused by name', () => {
    for (const type of ['text', 'currency', 'date', 'datetime', 'location', 'autonumber', 'json', 'vector']) {
      expect(FieldSchema.safeParse({ type, name: 'f' }).success, type).toBe(true);
    }
    expect(refusedByName(FieldSchema.safeParse({ type: 'text', name: 'f', zzz_not_a_real_key: 1 }), 'zzz_not_a_real_key')).toBe(true);
  });

  it.each([
    ['text', 'visible_on', { field: 'type', operator: '=', value: 'invoice' }],
    ['text', 'filterable', true],
    ['currency', 'currency', 'USD'],
    ['date', 'min_date', '2024-01-01'],
    ['date', 'max_date', '2030-12-31'],
    ['datetime', 'min_date', '2024-01-01T00:00:00Z'],
    ['datetime', 'max_date', '2030-12-31T23:59:59Z'],
    ['location', 'default_zoom', 12],
    ['autonumber', 'starting_number', 1000],
    ['json', 'schema', { type: 'object' }],
    ['vector', 'normalize', true],
  ] as const)('on a `%s` field the spec refuses `%s` by name', (type, key, value) => {
    expect(refusedByName(FieldSchema.safeParse({ type, name: 'f', [key]: value }), key)).toBe(true);
  });

  it('the spec suggests `visibleWhen` for `visible_on`, and accepts it in both wire shapes', () => {
    const snake = FieldSchema.safeParse({ type: 'text', name: 'f', visible_on: "record.a == 'b'" });
    expect(!snake.success && snake.error.issues.some((i) => i.message.includes('`visibleWhen`'))).toBe(true);
    expect(FieldSchema.safeParse(_visibleWhen).success).toBe(true);
    expect(FieldSchema.safeParse(_visibleWhenEnvelope).success).toBe(true);
  });

  it('the spec accepts `currencyConfig`, the fixed-currency declaration that replaces `currency`', () => {
    expect(FieldSchema.safeParse(_currencyConfig).success).toBe(true);
  });

  it.each([
    ['textarea', 'mobile_fullscreen', true],
    ['lookup', 'idField', 'name'],
    ['user', 'picker', 'search'],
    ['user', 'subtitle', ['email']],
    ['text', 'pattern', '^[A-Z]{3}-[0-9]{4}$'],
    ['text', 'pattern_message', 'SKU must look like ABC-1234'],
    ['text', 'validate', { required: true }],
  ] as const)('round two — on a `%s` field the spec refuses `%s` by name', (type, key, value) => {
    const base = type === 'lookup' ? { reference: 'sys_position' } : {};
    // CONTROL: the same field without the key parses.
    expect(FieldSchema.safeParse({ type, name: 'f', ...base }).success, type).toBe(true);
    expect(refusedByName(FieldSchema.safeParse({ type, name: 'f', ...base, [key]: value }), key)).toBe(true);
  });

  it('round two — the spec refuses `geolocation` at `type`, and accepts `location`', () => {
    expect(typeRefused(FieldSchema.safeParse({ type: 'geolocation', name: 'f' }))).toBe(true);
    expect(FieldSchema.safeParse(_location).success).toBe(true);
  });

  it("round two — a regex check is the object's `format` rule: the object parses with it, and refuses the field-level key", () => {
    const sku = { type: 'text', label: 'SKU', maxLength: 8 };
    const format = {
      type: 'format',
      name: 'sku_format',
      field: 'sku',
      regex: '^[A-Z]{3}-[0-9]{4}$',
      message: 'SKU must look like ABC-1234',
    };
    expect(ObjectSchema.safeParse({ name: 'product', label: 'Product', fields: { sku }, validations: [format] }).success).toBe(true);
    const fieldLevel = ObjectSchema.safeParse({ name: 'product', label: 'Product', fields: { sku: { ...sku, pattern: format.regex } } });
    expect(fieldLevel.success).toBe(false);
    expect(
      !fieldLevel.success && fieldLevel.error.issues.some(
        (i) => i.code === 'unrecognized_keys' && ((i as { keys?: string[] }).keys ?? []).includes('pattern'),
      ),
    ).toBe(true);
  });

  it('the spec refuses `auto_number` and `object` at `type`, and accepts `autonumber` and `json`', () => {
    expect(typeRefused(FieldSchema.safeParse({ type: 'auto_number', name: 'f' }))).toBe(true);
    expect(typeRefused(FieldSchema.safeParse({ type: 'object', name: 'f' }))).toBe(true);
    expect(FieldSchema.safeParse(_autonumber).success).toBe(true);
    expect(FieldSchema.safeParse(_json).success).toBe(true);
  });
});
