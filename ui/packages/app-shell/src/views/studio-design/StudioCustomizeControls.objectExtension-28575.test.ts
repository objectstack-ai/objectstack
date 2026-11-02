// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28575 (ADR-0146 D10) — the pure pieces the Data pillar writes a
 * base object's extension with, each pinned on its own:
 *
 *  - the `__c` suffix, appended once;
 *  - the extension body read from a stored document: no `_` keys, `extend` set;
 *  - the fold: patches applied, the extension's fields laid over by name (the
 *    draft winning, so a published field shows once), a removed published
 *    field left out;
 *  - the base's own field names;
 *  - an edit routed: a new field whole into `fields`, a whitelisted change on
 *    a base field into `fieldPatches`, a non-whitelisted change dropped;
 *  - a cleared patch value held as '' in the buffer and dropped on save.
 */

import { describe, expect, it } from 'vitest';
import {
  baseOwnedFieldNames,
  extensionBodyForSave,
  extensionFieldName,
  foldObjectExtension,
  objectExtensionBodyOf,
  routeFoldedFieldsEdit,
} from './StudioCustomizeControls.js';

const OBJECT = 'crm_account';
const served = {
  name: OBJECT,
  fields: {
    name: { type: 'text', label: 'Account Name', required: true },
    industry: { type: 'select', label: 'Industry', options: [{ value: 'technology', label: 'Technology' }] },
  },
};

describe('the extension field name (#28575)', () => {
  it('appends `__c` once, and leaves an empty name empty', () => {
    expect(extensionFieldName('region')).toBe('region__c');
    expect(extensionFieldName('region__c')).toBe('region__c');
    expect(extensionFieldName('')).toBe('');
  });
});

describe('the extension body of a stored document (#28575)', () => {
  it('strips the envelope keys and names the extended object', () => {
    expect(objectExtensionBodyOf({ _packageId: 'p', _version: 3, fields: { a__c: { type: 'text' } } }, OBJECT)).toEqual({
      extend: OBJECT,
      fields: { a__c: { type: 'text' } },
    });
    expect(objectExtensionBodyOf(null, OBJECT)).toBeNull();
  });
});

describe('the fold of an object with its extension (#28575)', () => {
  it('applies patches and appends the extension’s fields', () => {
    const folded = foldObjectExtension(served, {
      extend: OBJECT,
      fields: { region__c: { type: 'text', label: 'Region' } },
      fieldPatches: { name: { label: 'Company' }, industry: { options: { technology: { label: 'Tech' } } } },
    });
    const fields = folded.fields as Record<string, Record<string, unknown>>;
    expect(Object.keys(fields)).toEqual(['name', 'industry', 'region__c']);
    expect(fields.name).toEqual({ type: 'text', label: 'Company', required: true });
    expect(fields.industry!.options).toEqual([{ value: 'technology', label: 'Tech' }]);
  });

  it('shows a published field the draft still declares once, the draft winning', () => {
    const withPublished = { ...served, fields: { ...served.fields, region__c: { type: 'text', label: 'Region' } } };
    const folded = foldObjectExtension(
      withPublished,
      { extend: OBJECT, fields: { region__c: { type: 'text', label: 'Region (edited)' } } },
      new Set(['region__c']),
    );
    const fields = folded.fields as Record<string, Record<string, unknown>>;
    expect(Object.keys(fields)).toEqual(['name', 'industry', 'region__c']);
    expect(fields.region__c!.label).toBe('Region (edited)');
  });

  it('leaves out a published field the draft removed, and counts only the base’s fields as base-owned', () => {
    const withPublished = { ...served, fields: { ...served.fields, region__c: { type: 'text', label: 'Region' } } };
    const ext = { extend: OBJECT };
    const published = new Set(['region__c']);
    expect(Object.keys(foldObjectExtension(withPublished, ext, published).fields as object)).toEqual(['name', 'industry']);
    expect([...baseOwnedFieldNames(withPublished, ext, published)]).toEqual(['name', 'industry']);
  });
});

describe('an edit of the folded fields, routed (#28575)', () => {
  const baseOwned = new Set(['name', 'industry']);

  it('writes a whitelisted change on a base field into its patch, and drops a non-whitelisted one', () => {
    const after = {
      ...served.fields,
      name: { type: 'text', label: 'Company', required: false, description: 'Who' },
    };
    expect(routeFoldedFieldsEdit({ before: served.fields, after, baseOwned, ext: { extend: OBJECT } })).toEqual({
      extend: OBJECT,
      fieldPatches: { name: { label: 'Company', description: 'Who' } },
    });
  });

  it('declares a field that is not the base’s whole in `fields`', () => {
    const after = { ...served.fields, region__c: { type: 'text', label: 'Region' } };
    expect(routeFoldedFieldsEdit({ before: served.fields, after, baseOwned, ext: { extend: OBJECT } })).toEqual({
      extend: OBJECT,
      fields: { region__c: { type: 'text', label: 'Region' } },
    });
  });

  it('writes an option label by its stored value', () => {
    const after = {
      ...served.fields,
      industry: { type: 'select', label: 'Industry', options: [{ value: 'technology', label: 'Tech' }] },
    };
    expect(routeFoldedFieldsEdit({ before: served.fields, after, baseOwned, ext: { extend: OBJECT } })).toEqual({
      extend: OBJECT,
      fieldPatches: { industry: { options: { technology: { label: 'Tech' } } } },
    });
  });

  it('holds a cleared label as \'\' while editing, and drops it on save so the package’s text comes back', () => {
    const ext = { extend: OBJECT, fieldPatches: { name: { label: 'Company' } } };
    const before = foldObjectExtension(served, ext).fields;
    const after = { ...(before as object), name: { type: 'text', label: '', required: true } };
    const routed = routeFoldedFieldsEdit({ before, after, baseOwned, ext });
    expect(routed).toEqual({ extend: OBJECT, fieldPatches: { name: { label: '' } } });
    expect(extensionBodyForSave(routed)).toEqual({ extend: OBJECT });
    expect(
      extensionBodyForSave({
        extend: OBJECT,
        fieldPatches: { name: { label: 'Company', description: '' }, industry: { options: { technology: { label: '' } } } },
      }),
    ).toEqual({ extend: OBJECT, fieldPatches: { name: { label: 'Company' } } });
  });
});
