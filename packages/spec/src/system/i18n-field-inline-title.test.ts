// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objects.<child>.fields.<field>.inlineTitle` — the heading of the inline
// child grid a master-detail field draws on its PARENT's form, and the
// translator that overlays it on the served child object.
//
// Before this slot existed, every label of a zh-CN create form was Chinese
// except the inline child-grid headings, which printed the authored
// `inlineTitle` verbatim: the bundle had no key to put them under, so the
// coverage gate had nothing to miss.

import { describe, it, expect } from 'vitest';
import {
  ObjectTranslationDataSchema,
  TranslationDataSchema,
  type TranslationBundle,
} from './translation.zod';
import { translateMetadataDocument, translateObject } from './i18n-resolver';
import { FieldSchema } from '../data/field.zod';

const PACKAGED = {
  name: 'contract_version',
  label: 'Contract Version',
  pluralLabel: 'Versions',
  fields: {
    contract: {
      name: 'contract',
      type: 'master_detail',
      label: 'Contract',
      reference: 'contract',
      inlineEdit: 'grid',
      inlineTitle: 'Versions',
    },
    amendment: {
      name: 'amendment',
      type: 'lookup',
      label: 'Amendment',
      reference: 'amendment',
      inlineEdit: 'grid',
      inlineTitle: 'Amended Versions',
    },
  },
};

const BUNDLE: TranslationBundle = {
  'zh-CN': {
    objects: {
      contract_version: {
        fields: {
          contract: { label: '合同', inlineTitle: '版本' },
        },
      },
    },
  },
};

const clone = <V>(value: V): V => JSON.parse(JSON.stringify(value));
const fieldsOf = (out: unknown) => (out as { fields: Record<string, Record<string, unknown>> }).fields;

describe('FieldTranslationSchema — inlineTitle', () => {
  it('accepts the slot on a field translation, at the bundle and the per-object doors', () => {
    expect(TranslationDataSchema.safeParse(BUNDLE['zh-CN']).success).toBe(true);
    expect(ObjectTranslationDataSchema.safeParse({ fields: { contract: { inlineTitle: '版本' } } }).success).toBe(true);
  });

  it('refuses a non-string heading', () => {
    const result = TranslationDataSchema.safeParse({
      objects: { contract_version: { fields: { contract: { inlineTitle: { 'zh-CN': '版本' } } } } },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]).toMatchObject({
      code: 'invalid_type',
      path: ['objects', 'contract_version', 'fields', 'contract', 'inlineTitle'],
    });
  });
});

describe('translateObject — a field\'s inlineTitle', () => {
  it('serves the translated heading on the child field, through the type dispatch, with no unrecognized key', () => {
    const fields = fieldsOf(translateMetadataDocument('object', clone(PACKAGED), BUNDLE, { locale: 'zh-CN' }));
    expect(fields.contract.inlineTitle).toBe('版本');
    expect(fields.contract.label).toBe('合同');
    const parsed = FieldSchema.safeParse(fields.contract);
    expect(parsed.success ? [] : parsed.error.issues.filter((i) => i.code === 'unrecognized_keys')).toEqual([]);
  });

  it('keeps an untranslated heading as authored — never the child object\'s plural label', () => {
    const fields = fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh-CN' }));
    expect(fields.amendment.inlineTitle).toBe('Amended Versions');
  });

  it('applies the BCP-47 ladder and the fallback chain', () => {
    expect(fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh' })).contract.inlineTitle).toBe('版本');
    expect(fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'fr-FR', fallbackChain: ['zh-CN'] })).contract.inlineTitle)
      .toBe('版本');
  });

  describe('the catalog loses to an explicit override (ADR-0029 D9.2a)', () => {
    it('applies while the served heading still equals the packaged field\'s', () => {
      const fields = fieldsOf(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED }));
      expect(fields.contract.inlineTitle).toBe('版本');
    });

    it('yields to a heading the tenant re-authored, and still translates the field\'s label', () => {
      const served = clone(PACKAGED);
      served.fields.contract.inlineTitle = 'Revisions (ours)';
      const fields = fieldsOf(translateObject(served, BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED }));
      expect(fields.contract.inlineTitle).toBe('Revisions (ours)');
      expect(fields.contract.label).toBe('合同');
    });
  });
});
