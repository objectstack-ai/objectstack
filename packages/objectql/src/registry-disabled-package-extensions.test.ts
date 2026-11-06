// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry';

/**
 * A DISABLED package's `extend` contributions (its `objectExtensions`) are
 * withheld from every served fold of the object they extend, and kept at the
 * storage layer.
 *
 * "Disabled" has one meaning: hidden, refused on the data plane, data kept.
 * The package's objects, flows, navigation and actions already followed it;
 * its extensions of ANOTHER package's object stayed on the served object, so
 * `/meta/object`, `/data` and the record page kept showing a disabled module's
 * fields. The served readers pinned here are the three folds every object read
 * ends in: {@link SchemaRegistry.resolveObject} (`getObject` /
 * `getAllObjects`), the per-package fold `getAllObjects(id, options)`, and
 * {@link SchemaRegistry.foldObjectExtendersOnto} (the protocol's by-name read
 * over a metadata-service body). The storage readers (`getStorageObject` /
 * `getAllStorageObjects`, read by schema sync) keep every contribution, so a
 * disable never takes a column away from the values it keeps.
 *
 * The runtime pin `packages/runtime/src/domains/packages-disable-module-extension-fields.test.ts`
 * drives the same behaviour through the real doors.
 */
describe('a disabled package\'s objectExtensions', () => {
  const APP_PKG = 'com.qa.ext.app';
  const MODULE_PKG = 'com.qa.ext.orders';
  const OTHER_PKG = 'com.qa.ext.scoring';
  const OBJECT = 'qe_account';

  const manifest = (id: string, type: string) =>
    ({ id, name: id, version: '1.0.0', type, namespace: 'qe', ...(type === 'module' ? { dependencies: { [APP_PKG]: '^1.0.0' } } : {}) }) as any;

  const ownerBody = () => ({
    name: OBJECT,
    label: 'Account',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    validations: [{ name: 'qe_name_required', type: 'script', severity: 'error', message: 'Name', condition: 'record.name == ""' }],
  });
  const moduleExtension = () => ({
    name: OBJECT,
    fields: {
      qe_credit: { name: 'qe_credit', type: 'number', label: 'Credit' },
      // Also declared by the other, enabled extension: kept.
      qe_shared: { name: 'qe_shared', type: 'text', label: 'Shared' },
    },
    validations: [{ name: 'qe_credit_positive', type: 'script', severity: 'error', message: 'Credit', condition: 'record.qe_credit < 0' }],
    indexes: [{ fields: ['qe_credit'] }],
  });
  const otherExtension = () => ({
    name: OBJECT,
    fields: {
      qe_score: { name: 'qe_score', type: 'number', label: 'Score' },
      qe_shared: { name: 'qe_shared', type: 'text', label: 'Shared' },
    },
  });

  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    (registry as any).logLevel = 'silent';
    registry.installPackage(manifest(APP_PKG, 'app'), 'code');
    registry.installPackage(manifest(MODULE_PKG, 'module'), 'code');
    registry.installPackage(manifest(OTHER_PKG, 'module'), 'code');
    registry.registerObject(ownerBody() as any, APP_PKG, 'qe', 'own');
    registry.registerObject(moduleExtension() as any, MODULE_PKG, 'qe', 'extend');
    registry.registerObject(otherExtension() as any, OTHER_PKG, 'qe', 'extend');
  });

  const fieldsOf = (body: any): string[] => Object.keys(body?.fields ?? {}).filter((f) => f.startsWith('qe_') || f === 'name').sort();
  const rulesOf = (body: any): string[] => (body?.validations ?? []).map((r: any) => r.name).sort();
  const indexedOf = (body: any): string[] => (body?.indexes ?? []).flatMap((i: any) => i.fields ?? []);

  const SERVED: ReadonlyArray<{ label: string; read: (r: SchemaRegistry) => any }> = [
    { label: 'getObject', read: (r) => r.getObject(OBJECT) },
    { label: 'getAllObjects', read: (r) => r.getAllObjects().find((o) => o.name === OBJECT) },
    { label: 'getAllObjects with a per-package fold', read: (r) => r.getAllObjects(APP_PKG, { withoutExtensionsOf: 'com.qa.ext.none' }).find((o) => o.name === OBJECT) },
    { label: 'foldObjectExtendersOnto an unfolded base', read: (r) => r.foldObjectExtendersOnto(OBJECT, ownerBody()) },
  ];

  for (const { label, read } of SERVED) {
    it(`${label}: an enabled package's extension is folded (the control)`, () => {
      const body = read(registry);
      expect(fieldsOf(body)).toEqual(['name', 'qe_credit', 'qe_score', 'qe_shared']);
      expect(rulesOf(body)).toEqual(['qe_credit_positive', 'qe_name_required']);
      expect(indexedOf(body)).toContain('qe_credit');
    });

    it(`${label}: a disabled package's fields, rules and indexes are withheld; a field a kept layer also declares stays`, () => {
      read(registry); // a fold cached while enabled is not served after the disable
      registry.disablePackage(MODULE_PKG);
      const body = read(registry);
      expect(fieldsOf(body)).toEqual(['name', 'qe_score', 'qe_shared']);
      expect(rulesOf(body)).toEqual(['qe_name_required']);
      expect(indexedOf(body)).not.toContain('qe_credit');
    });

    it(`${label}: re-enabling the package folds its extension again`, () => {
      registry.disablePackage(MODULE_PKG);
      read(registry);
      registry.enablePackage(MODULE_PKG);
      expect(fieldsOf(read(registry))).toEqual(['name', 'qe_credit', 'qe_score', 'qe_shared']);
    });
  }

  it('the storage layer keeps every contribution while the package is disabled', () => {
    registry.disablePackage(MODULE_PKG);
    for (const body of [registry.getStorageObject(OBJECT), registry.getAllStorageObjects().find((o) => o.name === OBJECT)]) {
      expect(fieldsOf(body)).toEqual(['name', 'qe_credit', 'qe_score', 'qe_shared']);
      expect(rulesOf(body)).toEqual(['qe_credit_positive', 'qe_name_required']);
      expect(indexedOf(body)).toContain('qe_credit');
      expect((body as any)._packageId).toBe(APP_PKG);
    }
    // …and it IS the served fold while nothing is disabled.
    registry.enablePackage(MODULE_PKG);
    expect(registry.getStorageObject(OBJECT)).toBe(registry.getObject(OBJECT));
  });

  it('a base that already carries the withheld members (a folded metadata-service body) has them taken off', () => {
    const folded = registry.getObject(OBJECT);
    registry.disablePackage(MODULE_PKG);
    expect(indexedOf(folded), 'precondition: the folded base carries the withheld index').toContain('qe_credit');
    const body = registry.foldObjectExtendersOnto(OBJECT, structuredClone(folded));
    expect(fieldsOf(body)).toEqual(['name', 'qe_score', 'qe_shared']);
    expect(rulesOf(body)).toEqual(['qe_name_required']);
    expect(indexedOf(body)).not.toContain('qe_credit');
  });

  it('a tenant overlay saved from a served read does not keep a disabled package\'s field on the served object', () => {
    const served = structuredClone(registry.getObject(OBJECT)) as any;
    registry.registerObject({ ...served, label: 'Customer', _provenance: 'org' }, APP_PKG, 'qe', 'overlay');
    expect(fieldsOf(registry.getObject(OBJECT))).toContain('qe_credit');
    registry.disablePackage(MODULE_PKG);
    const body = registry.getObject(OBJECT) as any;
    expect(body.label).toBe('Customer');
    expect(fieldsOf(body)).toEqual(['name', 'qe_score', 'qe_shared']);
    expect(indexedOf(body)).not.toContain('qe_credit');
    expect(fieldsOf(registry.getStorageObject(OBJECT))).toContain('qe_credit');
  });

  it('withholds the extension of a package whose row lands disabled after the object was already folded', () => {
    const LATE = 'com.qa.ext.late';
    registry.registerObject({ name: OBJECT, fields: { qe_late: { name: 'qe_late', type: 'text' } } } as any, LATE, 'qe', 'extend');
    // Unknown package: enabled. Folded and cached so.
    expect(fieldsOf(registry.getObject(OBJECT))).toContain('qe_late');
    registry.setInitialDisabledPackageIds([LATE]);
    registry.installPackage(manifest(LATE, 'module'), 'code');
    expect(registry.isPackageDisabled(LATE), 'precondition: the row landed disabled').toBe(true);
    expect(fieldsOf(registry.getObject(OBJECT))).not.toContain('qe_late');
  });

  it('a disabled package that OWNS the object still serves it whole to the readers that reach it (the object itself is refused elsewhere)', () => {
    registry.disablePackage(APP_PKG);
    expect(fieldsOf(registry.getObject(OBJECT))).toEqual(['name', 'qe_credit', 'qe_score', 'qe_shared']);
  });
});

/**
 * [#30756] `getAllObjects(undefined, { asEnabled })`: the fold the enable of a
 * DISABLED package would leave, which the enable door's pre-check reads. That
 * package's extension is folded in; every other disabled package's stays
 * withheld; the registry's own state does not move; and the option changes
 * nothing for a package that is not disabled, or when it is unset.
 */
describe('[#30756] the asEnabled fold', () => {
  const APP_PKG = 'com.qa.asen.app';
  const MODULE_PKG = 'com.qa.asen.orders';
  const OTHER_PKG = 'com.qa.asen.scoring';
  const OBJECT = 'qa_account';
  const manifest = (id: string, type: string) =>
    ({ id, name: id, version: '1.0.0', type, namespace: 'qa', ...(type === 'module' ? { dependencies: { [APP_PKG]: '^1.0.0' } } : {}) }) as any;

  let registry: SchemaRegistry;
  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    (registry as any).logLevel = 'silent';
    registry.installPackage(manifest(APP_PKG, 'app'), 'code');
    registry.installPackage(manifest(MODULE_PKG, 'module'), 'code');
    registry.installPackage(manifest(OTHER_PKG, 'module'), 'code');
    registry.registerObject({
      name: OBJECT, label: 'Account', fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    } as any, APP_PKG, 'qa', 'own');
    registry.registerObject({
      name: OBJECT,
      fields: { qa_credit: { name: 'qa_credit', type: 'number', label: 'Credit' } },
      validations: [{ name: 'qa_credit_positive', type: 'script', severity: 'error', message: 'Credit', condition: 'record.qa_credit < 0' }],
    } as any, MODULE_PKG, 'qa', 'extend');
    registry.registerObject({
      name: OBJECT,
      fields: { qa_score: { name: 'qa_score', type: 'number', label: 'Score' } },
      validations: [{ name: 'qa_score_capped', type: 'script', severity: 'error', message: 'Score', condition: 'record.qa_score > 10' }],
    } as any, OTHER_PKG, 'qa', 'extend');
  });

  const served = (options?: { asEnabled?: string }) => registry.getAllObjects(undefined, options).find((o) => o.name === OBJECT) as any;
  const fieldsOf = (body: any): string[] => Object.keys(body?.fields ?? {}).filter((f) => f.startsWith('qa_') || f === 'name').sort();
  const rulesOf = (body: any): string[] => (body?.validations ?? []).map((r: any) => r.name).sort();

  it('folds the named disabled package in, keeps every other disabled package withheld, and moves no state', () => {
    registry.disablePackage(MODULE_PKG);
    registry.disablePackage(OTHER_PKG);
    const body = served({ asEnabled: MODULE_PKG });
    expect(fieldsOf(body)).toEqual(['name', 'qa_credit']);
    expect(rulesOf(body)).toEqual(['qa_credit_positive']);
    expect(registry.isPackageDisabled(MODULE_PKG)).toBe(true);
    expect(fieldsOf(registry.getObject(OBJECT)), 'the served fold is unchanged by the read').toEqual(['name']);
  });

  it('control: unset, or naming a package that is not disabled, the fold is today\'s, byte for byte', () => {
    registry.disablePackage(MODULE_PKG);
    const today = JSON.stringify(served());
    expect(JSON.stringify(served({}))).toBe(today);
    expect(JSON.stringify(served({ asEnabled: OTHER_PKG }))).toBe(today);
    expect(JSON.stringify(served({ asEnabled: 'com.qa.asen.unknown' }))).toBe(today);
    expect(fieldsOf(served({ asEnabled: OTHER_PKG }))).toEqual(['name', 'qa_score']);
  });
});
