/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form-field keys objectui#12130 measured, on the authoring faces.
 *
 * The runtime half lives in `examples/schema-catalog/test/` (this package is
 * "Zero deps. No React", so it cannot render): the census there records every
 * key of a `form` `fields[]` entry that a reader asks for by name, and the
 * effects file beside it renders each one with and without. The keys this
 * card declares on `FormFieldSchema` and `FormField` are the ones that were
 * read, changed what their widget does, and were refused by the strict face.
 * This file pins the faces:
 *
 *   1. each declared key parses on the strict face, and a misspelled sibling
 *      is still refused by name at the same path;
 *   2. each is judged by its declared type on both faces, and the tolerant
 *      face keeps the value instead of stripping it;
 *   3. the keys measured NOT to work stay refused by name on the strict face:
 *      `defaultValue` and `defaultChecked`, which no reader asks for and
 *      neither of which becomes the field's value, and the snake_case second
 *      spellings of five declared keys;
 *   4. the TypeScript face carries each spec member and each field metadata
 *      member by reference (type-level, read by `tsc -p tsconfig.test.json`
 *      only — vitest does not typecheck).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { FormField } from '../form.js';
import type { Field as SpecField } from '@objectstack/spec/data';
import { AnyComponentSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; keys?: string[]; errors?: Issue[][] };

const issuesOf = (schema: z.ZodType, doc: unknown): Issue[] | null => {
  const result = schema.safeParse(doc);
  return result.success ? null : (result.error.issues as unknown as Issue[]);
};

/** Every `unrecognized_keys` finding in the issue tree, union arms included, as `path.key`. */
const undeclared = (issues: Issue[] | null, prefix: PropertyKey[] = []): string[] => {
  const out: string[] = [];
  for (const issue of issues ?? []) {
    const at = [...prefix, ...issue.path];
    if (issue.code === 'unrecognized_keys') for (const k of issue.keys ?? []) out.push([...at, k].map(String).join('.'));
    for (const arm of issue.errors ?? []) out.push(...undeclared(arm, at));
  }
  return [...new Set(out)];
};

const form = (field: Record<string, unknown>) => ({ type: 'form', fields: [{ name: 'f', label: 'F', ...field }] });

/** Each declared key on an entry of a type whose widget reads it (the census names those types). */
const DECLARED: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['language', { type: 'code', language: 'python' }],
  ['maxSize', { type: 'file', maxSize: 1048576 }],
  ['capture', { type: 'file', capture: 'environment' }],
  ['crop', { type: 'image', crop: false }],
  ['defaultName', { type: 'avatar', defaultName: 'Ada Lovelace' }],
  ['allowCreate', { type: 'lookup', reference: 'account', allowCreate: false }],
  ['descriptionField', { type: 'lookup', reference: 'account', descriptionField: 'industry' }],
  ['displayField', { type: 'lookup', reference: 'account', displayField: 'title' }],
  ['idField', { type: 'lookup', reference: 'position', idField: 'name' }],
  ['lookupColumns', { type: 'lookup', reference: 'account', lookupColumns: ['name', { field: 'email', label: 'Email' }] }],
  ['lookupFilters', { type: 'lookup', reference: 'account', lookupFilters: [{ field: 'status', operator: 'eq', value: 'active' }] }],
  ['lookupPageSize', { type: 'lookup', reference: 'account', lookupPageSize: 25 }],
  ['picker', { type: 'user', reference: 'sys_user', picker: 'search' }],
  ['subtitle', { type: 'user', reference: 'sys_user', picker: 'search', subtitle: ['email'] }],
  ['avatarField', { type: 'user', reference: 'sys_user', picker: 'search', avatarField: 'photo' }],
  ['step', { type: 'number', step: 0.5 }],
  ['className', { type: 'input', className: 'w-48' }],
];

/* ── 1. accepted on the strict face; a misspelling beside it is not ─────── */

describe('the field keys objectui#12130 measured parse on the strict face', () => {
  it.each(DECLARED)('`fields[].%s` parses; a misspelled sibling is refused at the field', (key, field) => {
    expect(issuesOf(StrictAnyComponentSchema, form(field))).toBeNull();
    expect(undeclared(issuesOf(StrictAnyComponentSchema, form({ ...field, [`${key}x`]: 1 }))))
      .toEqual([`fields.0.${key}x`]);
  });
});

/* ── 2. judged by the declared type, kept by the tolerant face ──────────── */

describe('each declared key is judged by its declared type (objectui#12130)', () => {
  const fieldsOf = (doc: unknown) => {
    const parsed = AnyComponentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    return (parsed.data as { fields: Record<string, unknown>[] }).fields;
  };

  it.each(DECLARED)('the tolerant face keeps `fields[].%s` instead of stripping it', (key, field) => {
    expect(fieldsOf(form(field))[0][key]).toEqual(field[key]);
  });

  const WRONG: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['language', { type: 'code', language: 3 }],
    ['maxSize', { type: 'file', maxSize: 0 }],
    ['capture', { type: 'file', capture: 'front' }],
    ['crop', { type: 'image', crop: 'no' }],
    ['defaultName', { type: 'avatar', defaultName: 7 }],
    ['allowCreate', { type: 'lookup', allowCreate: 'yes' }],
    ['descriptionField', { type: 'lookup', descriptionField: ['industry'] }],
    ['displayField', { type: 'lookup', displayField: { field: 'title' } }],
    ['idField', { type: 'lookup', idField: 1 }],
    ['lookupColumns', { type: 'lookup', lookupColumns: [{ label: 'no field' }] }],
    ['lookupFilters', { type: 'lookup', lookupFilters: [{ field: 'status', operator: 'equals', value: 'active' }] }],
    ['lookupPageSize', { type: 'lookup', lookupPageSize: -10 }],
    ['picker', { type: 'user', picker: 'table' }],
    ['subtitle', { type: 'user', subtitle: 'email' }],
    ['avatarField', { type: 'user', avatarField: ['photo'] }],
    // HTML's `'any'`: the spec's `step` is a number, so this is refused on the
    // tolerant face too, which kept it before objectui#12130 declared `step`.
    ['step', { type: 'number', step: 'any' }],
    ['className', { type: 'input', className: ['w-48'] }],
  ];

  it.each(WRONG)('a wrong `fields[].%s` value is refused at that key, on both faces', (key, field) => {
    for (const schema of [AnyComponentSchema, StrictAnyComponentSchema]) {
      const paths = (issuesOf(schema, form(field)) ?? []).map((i) => i.path.map(String).join('.'));
      expect(paths.some((p) => p.startsWith(`fields.0.${key}`)), `${key} on ${schema === AnyComponentSchema ? 'tolerant' : 'strict'}`)
        .toBe(true);
    }
  });
});

/* ── 3. the keys measured not to work stay refused ──────────────────────── */

describe('the keys objectui#12130 measured not to work stay refused by name (objectui#12130)', () => {
  // No reader asks for either key, and neither becomes the field's value: the
  // box stays unchecked, the payload carries no value (the effects pins).
  // A form's initial values are `FormSchema.defaultValues`.
  const NOT_HONORED: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['defaultChecked', { type: 'checkbox', defaultChecked: true }],
    ['defaultChecked', { type: 'switch', defaultChecked: true }],
    ['defaultValue', { type: 'input', defaultValue: 'preset' }],
    ['defaultValue', { type: 'textarea', defaultValue: 'preset' }],
    ['defaultValue', { type: 'text', defaultValue: 'preset' }],
    ['defaultValue', { type: 'select', options: [{ label: 'B', value: 'b' }], defaultValue: 'b' }],
  ];

  it.each(NOT_HONORED)('`fields[].%s` is refused by name (%j)', (key, field) => {
    expect(undeclared(issuesOf(StrictAnyComponentSchema, form(field)))).toEqual([`fields.0.${key}`]);
  });

  it('CONTROL: the same values seeded through `defaultValues` parse', () => {
    expect(issuesOf(StrictAnyComponentSchema, {
      ...form({ type: 'checkbox' }),
      defaultValues: { f: true },
    })).toBeNull();
  });

  // The snake_case second spellings of keys this card declares camelCase.
  // `allow_create`, `lookup_columns` and `lookup_page_size` are no longer read
  // by any widget (objectui#12157 retired the `lookup` widget's reads of them);
  // `reference_field` and `avatar_field` still are (the census ledger records
  // the reads). `avatar_field` is the `lookup` and `user` widgets' first read
  // of the search picker's `avatarField`, which this face declares camelCase
  // only.
  const SECOND_SPELLINGS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['allow_create', { type: 'lookup', allow_create: false }],
    ['lookup_columns', { type: 'lookup', lookup_columns: ['name'] }],
    ['lookup_page_size', { type: 'lookup', lookup_page_size: 25 }],
    ['reference_field', { type: 'lookup', reference_field: 'title' }],
    ['avatar_field', { type: 'user', picker: 'search', avatar_field: 'photo' }],
  ];

  it.each(SECOND_SPELLINGS)('the second spelling `fields[].%s` is refused by name', (key, field) => {
    expect(undeclared(issuesOf(StrictAnyComponentSchema, form(field)))).toEqual([`fields.0.${key}`]);
  });
});

/* ── 4. type level: the TypeScript face carries the members by reference ── */

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Each member is a named, typed member — not the index signature's `any`. */
export type assertionChannelMembersAreTyped = Expect<Equal<
  IsAny<FormField['language'] | FormField['maxSize'] | FormField['capture'] | FormField['crop']
    | FormField['defaultName'] | FormField['allowCreate'] | FormField['descriptionField'] | FormField['displayField']
    | FormField['idField'] | FormField['lookupColumns'] | FormField['lookupFilters'] | FormField['lookupPageSize']
    | FormField['picker'] | FormField['subtitle'] | FormField['avatarField'] | FormField['step']
    | FormField['className']>,
  false
>>;

/** The spec's `FieldSchema` members, by reference. */
export type assertionSpecMembersByReference = [
  Expect<Equal<FormField['language'], SpecField['language']>>,
  Expect<Equal<FormField['maxSize'], SpecField['maxSize']>>,
  Expect<Equal<FormField['allowCreate'], SpecField['allowCreate']>>,
  Expect<Equal<FormField['descriptionField'], SpecField['descriptionField']>>,
  Expect<Equal<FormField['displayField'], SpecField['displayField']>>,
  Expect<Equal<FormField['lookupColumns'], SpecField['lookupColumns']>>,
  Expect<Equal<FormField['lookupFilters'], SpecField['lookupFilters']>>,
  Expect<Equal<FormField['lookupPageSize'], SpecField['lookupPageSize']>>,
  Expect<Equal<FormField['step'], SpecField['step']>>,
];

/**
 * The rest as their widgets read them. `idField` / `picker` / `subtitle` were
 * the field metadata types' members by reference until objectui#12242 moved
 * them off that authoring face; this entry declares them itself now.
 */
export type assertionLocalMembers = [
  Expect<Equal<FormField['idField'], string | undefined>>,
  Expect<Equal<FormField['picker'], 'search' | 'default' | undefined>>,
  Expect<Equal<FormField['subtitle'], string[] | undefined>>,
  Expect<Equal<FormField['capture'], 'environment' | 'user' | false | undefined>>,
  Expect<Equal<FormField['crop'], boolean | undefined>>,
  Expect<Equal<FormField['defaultName'], string | undefined>>,
  Expect<Equal<FormField['avatarField'], string | undefined>>,
  Expect<Equal<FormField['className'], string | undefined>>,
];
