// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objects.<object>._relatedLists.<list>.label` reaches the titles an
 * extension brings, read through the `/meta` read's real options: the SERVED
 * object (the registry fold has spliced an extension's list placement and the
 * paired `.custom` package's arrangement into `relatedLists`) translated
 * against `packagedBase: getPackagedObjectBase(name)`, as
 * `packagedObjectBaseOf` in `@objectstack/rest` hands it. A code extender's
 * placed entry is part of that base (#36528), so its title reads the
 * deployment catalog; a `.custom` title diverges from the base and reads the
 * pair's translations (`pairBundle`).
 */

import { describe, it, expect } from 'vitest';
import { translateMetadataDocument, type TranslationBundle } from '@objectstack/spec/system';
import { SchemaRegistry } from './registry.js';

const BASE = 'com.vendor.crm';
const PAIR = 'com.vendor.crm.custom';
const EXT = 'com.acme.tax';
const OBJ = 'crm_lead';

const child = (name: string, label: string) => ({
  name,
  label,
  fields: { lead_id: { name: 'lead_id', type: 'lookup', label: 'Lead', reference: OBJ } },
});

function withBase(): SchemaRegistry {
  const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  reg.logLevel = 'silent';
  reg.registerObject({
    name: OBJ,
    label: 'Lead',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    relatedLists: [{ list: 'crm_task', label: 'Tasks' }, 'crm_note'],
  } as never, BASE, undefined, 'own');
  for (const [name, label] of [['crm_task', 'Task'], ['crm_note', 'Note']]) {
    reg.registerObject(child(name, label) as never, BASE, undefined, 'own');
  }
  return reg;
}

const BUNDLE: TranslationBundle = {
  'zh-CN': {
    objects: {
      crm_lead: {
        _relatedLists: {
          crm_task: { label: '任务' },
          crm_note: { label: '备注' },
          acme_audit: { label: '审计' },
        },
      },
    },
  },
};

/** The pair's own translations: what `pairTranslationBundleOf` hands the read for the `.custom` text. */
const PAIR_BUNDLE: TranslationBundle = {
  'zh-CN': { objects: { crm_lead: { _relatedLists: { crm_note: { label: '笔记' } } } } },
};

/** The `/meta` object read's translation, with the options `meta-item-read-gate` builds. */
const read = (served: unknown, packagedBase: unknown, pairBundle?: TranslationBundle) =>
  translateMetadataDocument('object', served as never, BUNDLE, {
    locale: 'zh-CN',
    packagedBase,
    ...(pairBundle !== undefined ? { pairBundle } : {}),
  } as never);

const titles = (body: unknown) =>
  ((body as { relatedLists: unknown[] }).relatedLists).map((e) => (typeof e === 'string' ? e : (e as { label?: string }).label));

describe('_relatedLists over the served (folded) parent', () => {
  it('translates the title an extension package\'s list placement brings, beside the owner\'s', () => {
    const reg = withBase();
    reg.registerObject(child('acme_audit', 'Audit') as never, EXT, undefined, 'own');
    reg.registerObject(
      { name: OBJ, place: [{ list: 'acme_audit', after: 'crm_task', label: 'Audit trail' }] } as never,
      EXT, undefined, 'extend', 200,
    );
    const served = reg.getObject(OBJ);
    expect(titles(served)).toEqual(['Tasks', 'Audit trail', 'crm_note']);
    const packagedBase = reg.getPackagedObjectBase(OBJ);
    expect(titles(packagedBase)).toEqual(['Tasks', 'Audit trail', 'crm_note']);
    expect(titles(read(served, packagedBase))).toEqual(['任务', '审计', 'crm_note']);
  });

  it('leaves the placed title untranslated once a tenant renames it (diverged from the packaged base)', () => {
    const reg = withBase();
    reg.registerObject(child('acme_audit', 'Audit') as never, EXT, undefined, 'own');
    reg.registerObject(
      { name: OBJ, place: [{ list: 'acme_audit', after: 'crm_task', label: 'Audit trail' }] } as never,
      EXT, undefined, 'extend', 200,
    );
    const served = reg.getObject(OBJ) as { relatedLists: unknown[] };
    const renamed = { ...served, relatedLists: served.relatedLists.map((e) =>
      (typeof e === 'object' && (e as { list?: string }).list === 'acme_audit' ? { ...(e as object), label: 'Audit log' } : e)) };
    expect(titles(read(renamed, reg.getPackagedObjectBase(OBJ)))).toEqual(['任务', 'Audit log', 'crm_note']);
  });

  it('translates the title the paired `.custom` arrangement gives a list', () => {
    const reg = withBase();
    reg.registerObject(
      { name: OBJ, relatedLists: [{ list: 'crm_note', label: 'Notes' }, 'crm_task'] } as never,
      PAIR, undefined, 'extend', 200,
    );
    const served = reg.getObject(OBJ);
    expect(titles(served)).toEqual(['Notes', 'crm_task']);
    const packagedBase = reg.getPackagedObjectBase(OBJ);
    // The arrangement is the customization layer: never part of the packaged base.
    expect(titles(packagedBase)).toEqual(['Tasks', 'crm_note']);
    expect(titles(read(served, packagedBase, PAIR_BUNDLE))).toEqual(['笔记', 'crm_task']);
  });
});
