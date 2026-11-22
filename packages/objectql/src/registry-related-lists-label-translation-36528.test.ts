// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objects.<object>._relatedLists.<list>.label` reaches the titles an
 * extension brings, because `translateObject` reads the SERVED object: the
 * registry fold has already spliced an extension's list placement (`place`,
 * with its `label`) and the paired `.custom` package's arrangement
 * (`relatedLists`, ADR-0146 D10) into the parent's `relatedLists`, so the
 * per-request translation of the read overlays them as it does the owner's.
 */

import { describe, it, expect } from 'vitest';
import { translateObject, type TranslationBundle } from '@objectstack/spec/system';
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
    expect(titles(translateObject(served as never, BUNDLE, { locale: 'zh-CN' }))).toEqual(['任务', '审计', 'crm_note']);
  });

  it('translates the title the paired `.custom` arrangement gives a list', () => {
    const reg = withBase();
    reg.registerObject(
      { name: OBJ, relatedLists: [{ list: 'crm_note', label: 'Notes' }, 'crm_task'] } as never,
      PAIR, undefined, 'extend', 200,
    );
    const served = reg.getObject(OBJ);
    expect(titles(served)).toEqual(['Notes', 'crm_task']);
    expect(titles(translateObject(served as never, BUNDLE, { locale: 'zh-CN' }))).toEqual(['备注', 'crm_task']);
  });
});
