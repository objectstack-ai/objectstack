// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objects.<child>.fields.<field>.relatedListTitle` — the title of the related
// list a lookup / master-detail field draws on its PARENT's record page, and
// the translator that overlays it on the served child object.
//
// Before this slot existed, a self-lookup (a contract renewed from a contract)
// drew its related list under the child object's label on a zh-CN record page
// (「合同」 beside the contract itself), and an authored `relatedListTitle`
// printed in the authoring language: the bundle had no key to put it under.

import { describe, it, expect } from 'vitest';
import {
  ObjectTranslationDataSchema,
  TranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import { translateMetadataDocument, translateObject } from './i18n-resolver';
import { FieldSchema } from '../data/field.zod';

/** A lookup from an object back to itself, plus a second one with no entry. */
const PACKAGED = {
  name: 'contract',
  label: 'Contract',
  pluralLabel: 'Contracts',
  fields: {
    renewed_from: {
      name: 'renewed_from',
      type: 'lookup',
      label: 'Renewed From',
      reference: 'contract',
      relatedListTitle: 'Renewals',
    },
    amended_from: {
      name: 'amended_from',
      type: 'lookup',
      label: 'Amended From',
      reference: 'contract',
      relatedListTitle: 'Amendments',
    },
  },
};

const BUNDLE: TranslationBundle = {
  'zh-CN': {
    objects: {
      contract: {
        label: '合同',
        fields: {
          renewed_from: { label: '续签自', relatedListTitle: '续签合同' },
        },
      },
    },
  },
};

const clone = <V>(value: V): V => JSON.parse(JSON.stringify(value));
const fieldsOf = (out: unknown) => (out as { fields: Record<string, Record<string, unknown>> }).fields;

describe('FieldTranslationSchema — relatedListTitle', () => {
  it('accepts the slot on a field translation, at the bundle and the per-object doors', () => {
    expect(TranslationDataSchema.safeParse(BUNDLE['zh-CN']).success).toBe(true);
    expect(ObjectTranslationDataSchema.safeParse({ fields: { renewed_from: { relatedListTitle: '续签合同' } } }).success)
      .toBe(true);
  });

  it('refuses a non-string title', () => {
    const result = TranslationDataSchema.safeParse({
      objects: { contract: { fields: { renewed_from: { relatedListTitle: { 'zh-CN': '续签合同' } } } } },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]).toMatchObject({
      code: 'invalid_type',
      path: ['objects', 'contract', 'fields', 'renewed_from', 'relatedListTitle'],
    });
  });
});

describe('translateObject — a field\'s relatedListTitle', () => {
  it('serves the translated title on the child field, through the type dispatch, with no unrecognized key', () => {
    const out = translateMetadataDocument('object', clone(PACKAGED), BUNDLE, { locale: 'zh-CN' });
    const fields = fieldsOf(out);
    expect(fields.renewed_from.relatedListTitle).toBe('续签合同');
    expect(fields.renewed_from.label).toBe('续签自');
    // The object's own label is translated too: the title is not it.
    expect((out as { label: string }).label).toBe('合同');
    const parsed = FieldSchema.safeParse(fields.renewed_from);
    expect(parsed.success ? [] : parsed.error.issues.filter((i) => i.code === 'unrecognized_keys')).toEqual([]);
  });

  it('keeps an untranslated title as authored — never the child object\'s label', () => {
    const fields = fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh-CN' }));
    expect(fields.amended_from.relatedListTitle).toBe('Amendments');
  });

  it('serves an entry on a field that authors no title, as inlineTitle does, and adds nothing without one', () => {
    const doc = clone(PACKAGED) as { fields: Record<string, Record<string, unknown>> };
    delete doc.fields.renewed_from.relatedListTitle;
    delete doc.fields.amended_from.relatedListTitle;
    const fields = fieldsOf(translateObject(doc as typeof PACKAGED, BUNDLE, { locale: 'zh-CN' }));
    expect(fields.renewed_from.relatedListTitle).toBe('续签合同');
    // No entry and no authored title: no key, so the console keeps today's
    // child-label title.
    expect('relatedListTitle' in fields.amended_from).toBe(false);
  });

  it('applies the BCP-47 ladder and the fallback chain', () => {
    expect(fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh' })).renewed_from.relatedListTitle)
      .toBe('续签合同');
    expect(
      fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'fr-FR', fallbackChain: ['zh-CN'] })).renewed_from
        .relatedListTitle,
    ).toBe('续签合同');
  });

  describe('the catalog loses to an explicit override (ADR-0029 D9.2a)', () => {
    it('applies while the served title still equals the packaged field\'s', () => {
      const fields = fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED }));
      expect(fields.renewed_from.relatedListTitle).toBe('续签合同');
    });

    it('yields to a title the tenant re-authored, and still translates the field\'s label', () => {
      const served = clone(PACKAGED);
      served.fields.renewed_from.relatedListTitle = 'Renewals (ours)';
      const fields = fieldsOf(translateObject(served, BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED }));
      expect(fields.renewed_from.relatedListTitle).toBe('Renewals (ours)');
      expect(fields.renewed_from.label).toBe('续签自');
    });
  });
});
