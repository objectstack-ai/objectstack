// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30391 — `pluralLabel` is the plural OF `label`. An object extension that
 * renames the object (`label`) and declares no `pluralLabel` leaves the running
 * plural naming the old label, so the fold (`mergeObjectDefinitions`) takes it
 * off and the object is served as one that declares no `pluralLabel`.
 *
 * What stays: an extension's own plural; the base's plural under an extension
 * that renames nothing (no `label`, or the same one); a plural the tenant
 * authored (the ADR-0029 D9.2a yield, which a tenant-authored `label` also
 * takes); the packaged base the translators compare against.
 *
 * The served answer — `/meta/object` in `en` and `zh-CN`, the catalog's plural
 * included — is pinned in `@objectstack/rest`'s
 * `meta-object-extension-plural-label.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from './registry.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const PARTNER = 'com.partner.crm-ext';

const TASK = {
  name: 'crm_task',
  label: 'Task',
  pluralLabel: 'Tasks',
  fields: { title: { name: 'title', type: 'text', label: 'Title' } },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function registry(): SchemaRegistry {
  const r = new SchemaRegistry({ multiTenant: false });
  r.logLevel = 'silent';
  r.registerObject(clone(TASK) as never, BASE, undefined, 'own');
  return r;
}

const served = (r: SchemaRegistry) => r.getObject('crm_task') as unknown as Record<string, unknown>;
const scalars = (doc: Record<string, unknown>) => ({
  label: doc.label,
  pluralLabel: doc.pluralLabel,
  hasPluralLabel: Object.prototype.hasOwnProperty.call(doc, 'pluralLabel'),
});

describe('#30391 — an extension that renames only label', () => {
  it('is served with the new label and no pluralLabel', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item' }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Work Item', pluralLabel: undefined, hasPluralLabel: false });
  });

  it('leaves the packaged base its plural, which the translators compare against', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item' }, PAIR);
    const base = r.getPackagedObjectBase('crm_task') as unknown as Record<string, unknown>;
    expect(scalars(base)).toEqual({ label: 'Task', pluralLabel: 'Tasks', hasPluralLabel: true });
    expect(base._packageId).toBe(BASE);
  });

  it('is idempotent over an already-folded base', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item' }, PAIR);
    const once = served(r);
    const twice = r.foldObjectExtendersOnto('crm_task', clone(once) as never) as unknown as Record<string, unknown>;
    expect(scalars(twice)).toEqual(scalars(once));
  });
});

describe('#30391 — controls: the plural stays', () => {
  it('an extension that sets pluralLabel is served as set', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item', pluralLabel: 'Work Items' }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Work Item', pluralLabel: 'Work Items', hasPluralLabel: true });
  });

  it('an extension that sets only pluralLabel keeps the label', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', pluralLabel: 'Work Items' }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Task', pluralLabel: 'Work Items', hasPluralLabel: true });
  });

  it('an extension that changes neither keeps the base plural', () => {
    const r = registry();
    r.registerObjectExtension(
      { extend: 'crm_task', fields: { region__c: { name: 'region__c', type: 'text', label: 'Region' } } },
      PAIR,
    );
    expect(scalars(served(r))).toEqual({ label: 'Task', pluralLabel: 'Tasks', hasPluralLabel: true });
  });

  it('an extension that repeats the label it extends renames nothing', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', label: 'Task' }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Task', pluralLabel: 'Tasks', hasPluralLabel: true });
  });

  it('a plural the tenant authored stays under a rename (ADR-0029 D9.2a)', () => {
    const r = registry();
    r.registerObject({ ...clone(TASK), pluralLabel: 'To-dos', _provenance: 'org' } as never, BASE, undefined, 'overlay');
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item' }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Work Item', pluralLabel: 'To-dos', hasPluralLabel: true });
  });

  it('a label the tenant authored makes the extension\'s rename yield, plural and all', () => {
    const r = registry();
    r.registerObject({ ...clone(TASK), label: 'Job', _provenance: 'org' } as never, BASE, undefined, 'overlay');
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item' }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Job', pluralLabel: 'Tasks', hasPluralLabel: true });
  });
});

describe('#30391 — two extenders, in priority order', () => {
  it('a later rename with no plural takes the earlier extender\'s plural off too', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', label: 'Job', pluralLabel: 'Jobs', priority: 150 }, PARTNER);
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item', priority: 250 }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Work Item', pluralLabel: undefined, hasPluralLabel: false });
  });

  it('a later plural is served over an earlier rename', () => {
    const r = registry();
    r.registerObjectExtension({ extend: 'crm_task', label: 'Work Item', priority: 150 }, PARTNER);
    r.registerObjectExtension({ extend: 'crm_task', pluralLabel: 'Work Items', priority: 250 }, PAIR);
    expect(scalars(served(r))).toEqual({ label: 'Work Item', pluralLabel: 'Work Items', hasPluralLabel: true });
  });
});
