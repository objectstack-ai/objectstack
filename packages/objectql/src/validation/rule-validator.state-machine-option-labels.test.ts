// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `state_machine` rule's BUILT-IN `invalid_transition` sentence names the
 * refused move by the states' option LABELS, in the caller's locale — never by
 * the raw option values a user has never seen.
 *
 * What a client ACTS on is unchanged: `code` stays `invalid_transition` and
 * `constraint: { from, to }` keeps the raw option values (a detail page greys
 * out a move by value, not by label). An author-written `message` is handed
 * over exactly as before — it gains no `{{from}}` / `{{to}}` holes here.
 */

import { describe, it, expect } from 'vitest';
import { evaluateValidationRules } from './rule-validator.js';
import { ValidationError } from './record-validator.js';
// Pay the first transform of the dist-resolved spec at MODULE LOAD, not inside
// a clocked `it()` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/spec';

const failing = (
  schema: any,
  data: Record<string, unknown>,
  opts: Record<string, unknown>,
) => {
  try {
    evaluateValidationRules(schema, data, 'update', opts);
  } catch (e) {
    return (e as ValidationError).fields;
  }
  throw new Error('expected a ValidationError');
};

/** A quote whose status moves draft → presented → accepted, with labelled options. */
const quoteSchema = (message: string, options?: unknown[]) => ({
  fields: {
    status: {
      type: 'select',
      label: 'Status',
      options: options ?? [
        { value: 'draft', label: 'Draft' },
        { value: 'presented', label: 'Presented' },
        { value: 'accepted', label: 'Accepted' },
      ],
    },
  },
  validations: [{
    type: 'state_machine',
    name: 'quote_status_progression',
    message,
    field: 'status',
    transitions: { draft: ['presented'], presented: ['accepted'], accepted: [] },
  }],
});

/** An `II18nService.t`-shaped lookup over a flat `locale|key` map; echoes the key on a miss. */
const service = (entries: Record<string, string>) => (key: string, locale: string) =>
  entries[`${locale}|${key}`] ?? key;

describe('state_machine invalid_transition — the built-in sentence names option labels', () => {
  it('names the states by their declared option labels; constraint keeps the raw values', () => {
    const [err] = failing(quoteSchema(''), { status: 'draft' }, { previous: { status: 'presented' } });
    expect(err.message).toBe('Invalid transition for Status: Presented → Draft');
    expect(err.code).toBe('invalid_transition');
    expect(err.constraint).toEqual({ from: 'presented', to: 'draft' });
    expect(err.label).toBe('Status');
  });

  it('names the states by their TRANSLATED option labels under a non-English locale', () => {
    const translate = service({
      'zh-CN|objects.quote.fields.status.label': '状态',
      'zh-CN|objects.quote.fields.status.options.presented': '已提交',
      'zh-CN|objects.quote.fields.status.options.draft': '草稿',
    });
    const [err] = failing(quoteSchema(''), { status: 'draft' }, {
      previous: { status: 'presented' },
      messages: { locale: 'zh-CN', objectName: 'quote', translate },
    });
    expect(err.message).toBe('状态不允许从 已提交 变更为 草稿');
    expect(err.constraint).toEqual({ from: 'presented', to: 'draft' });
  });

  it('falls back to the picklist\'s translated option label for a picklist-bound field', () => {
    const schema = quoteSchema('');
    (schema.fields.status as any).picklist = 'quote_status';
    const translate = service({
      // A field-level entry is the more specific and wins …
      'zh-CN|objects.quote.fields.status.options.draft': '草稿',
      // … and the shared list answers for an option the field does not translate.
      'zh-CN|picklists.quote_status.options.draft': 'WRONG — the field entry wins',
      'zh-CN|picklists.quote_status.options.presented': '已提交',
    });
    const [err] = failing(schema, { status: 'draft' }, {
      previous: { status: 'presented' },
      messages: { locale: 'zh-CN', objectName: 'quote', translate },
    });
    expect(err.message).toBe('Status不允许从 已提交 变更为 草稿');
  });

  it('falls back to the declared label, then the raw value, when a translation or a label is missing', () => {
    const options = [
      { value: 'draft' }, // no label at all
      { value: 'presented', label: 'Presented' },
      'accepted', // a bare scalar option
    ];
    const translate = service({});
    const [err] = failing(quoteSchema('', options), { status: 'draft' }, {
      previous: { status: 'presented' },
      messages: { locale: 'zh-CN', objectName: 'quote', translate },
    });
    expect(err.message).toBe('Status不允许从 Presented 变更为 draft');
    expect(err.constraint).toEqual({ from: 'presented', to: 'draft' });

    const [bare] = failing(quoteSchema('', options), { status: 'presented' }, { previous: { status: 'accepted' } });
    expect(bare.message).toBe('Invalid transition for Status: accepted → Presented');
  });

  it('survives a throwing i18n service — the declared label stands, a 400 never becomes a 500', () => {
    const [err] = failing(quoteSchema(''), { status: 'draft' }, {
      previous: { status: 'presented' },
      messages: { locale: 'zh-CN', objectName: 'quote', translate: () => { throw new Error('i18n exploded'); } },
    });
    expect(err.message).toBe('Status不允许从 Presented 变更为 Draft');
  });

  it('leaves an author-written message exactly as written — no holes are filled in it', () => {
    const authored = 'Cannot move a quote from {{from}} to {{to}}.';
    const [err] = failing(quoteSchema(authored), { status: 'draft' }, { previous: { status: 'presented' } });
    expect(err.message).toBe(authored);
    expect(err.code).toBe('invalid_transition');
    expect(err.constraint).toEqual({ from: 'presented', to: 'draft' });
  });
});
