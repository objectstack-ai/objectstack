// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33952, ADR-0146 D10] `SchemaRegistry.getPackagedFieldPatchBases(name)`:
 * for each CODE package that patches an object's fields, the packaged base
 * with THAT package's `fieldPatches` applied and no other's, highest
 * precedence first — what the serving layer asks to learn which package wrote
 * a patched slot, so the slot reads that package's own translations.
 *
 * And the read the protocol pairs it with depends on: `registerApp` keeps the
 * package's `translations` on its installed record
 * (`getPackage(id).manifest.translations`), which is why neither
 * `II18nService` nor the runtime had to keep a per-package copy.
 *
 * The packaged/unchanged decision itself stays `getPackagedObjectBase`'s,
 * which never folds a patch in (pinned beside it in
 * `registry-extension-field-patches.test.ts` and `protocol-packaged-object-base.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';
import { ObjectQL } from './engine.js';

const OWNER_PKG = 'com.vendor.crm';
const DEP_PKG = 'com.customer.blackcat';
const MODULE_PKG = 'com.vendor.crm-module';
const OBJ = 'crm_account';

function vendorAccount(): any {
  return {
    name: OBJ,
    label: 'Account',
    fields: {
      registration_number: { name: 'registration_number', type: 'text', label: 'Registration Number', description: 'Company registry id.' },
      tier: {
        name: 'tier',
        type: 'select',
        label: 'Tier',
        options: [
          { value: 'gold', label: 'Gold' },
          { value: 'silver', label: 'Silver' },
        ],
      },
    },
  };
}

function registry(): SchemaRegistry {
  const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  reg.logLevel = 'silent';
  reg.registerObject(vendorAccount(), OWNER_PKG, undefined, 'own');
  return reg;
}

const patch = (reg: SchemaRegistry, pkg: string, fieldPatches: unknown, priority = 200, extra: Record<string, unknown> = {}) =>
  reg.registerObject({ name: OBJ, fieldPatches, ...extra } as any, pkg, undefined, 'extend', priority);

const view = (entries: Array<{ packageId: string; base: any }>) => entries.map((e) => ({
  packageId: e.packageId,
  label: e.base.fields.registration_number.label,
  description: e.base.fields.registration_number.description,
  gold: e.base.fields.tier.options[0].label,
}));

describe('[#33952] getPackagedFieldPatchBases — which code package wrote which patched text', () => {
  it('one entry per patching package, highest precedence first, each carrying only its own patches over the packaged base', () => {
    const reg = registry();
    patch(reg, DEP_PKG, { registration_number: { label: 'Tax ID', description: 'Unified social credit code.' } }, 220);
    patch(reg, MODULE_PKG, { registration_number: { label: 'Company ID' }, tier: { options: { gold: { label: 'Platinum' } } } }, 200);
    // The served fold: the higher package's label wins the slot both patch.
    const served: any = reg.getObject(OBJ);
    expect([served.fields.registration_number.label, served.fields.tier.options[0].label]).toEqual(['Tax ID', 'Platinum']);
    expect(view(reg.getPackagedFieldPatchBases(OBJ) as any)).toEqual([
      { packageId: DEP_PKG, label: 'Tax ID', description: 'Unified social credit code.', gold: 'Gold' },
      { packageId: MODULE_PKG, label: 'Company ID', description: 'Company registry id.', gold: 'Platinum' },
    ]);
    // The packaged base itself is untouched: a patched slot still reads as diverged.
    const base: any = reg.getPackagedObjectBase(OBJ);
    expect(base.fields.registration_number.label).toBe('Registration Number');
  });

  it('adds nothing for a disabled package, an extension of tenant provenance, or an extension that patches nothing', () => {
    const reg = registry();
    reg.installPackage({ id: DEP_PKG, name: 'Blackcat', version: '1.0.0' } as any, 'code');
    patch(reg, DEP_PKG, { registration_number: { label: 'Tax ID' } }, 220);
    patch(reg, 'sys_metadata', { registration_number: { label: 'Tenant label' } }, 300, { _provenance: 'org' });
    patch(reg, MODULE_PKG, undefined, 200, { fields: { extra: { name: 'extra', type: 'text', label: 'Extra' } } });
    expect((reg.getPackagedFieldPatchBases(OBJ) as any[]).map((e) => e.packageId)).toEqual([DEP_PKG]);
    reg.disablePackage(DEP_PKG);
    expect(reg.getPackagedFieldPatchBases(OBJ)).toEqual([]);
  });

  it('answers [] for an object no code package owns and for an unknown name', () => {
    const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
    reg.logLevel = 'silent';
    reg.registerObject({ ...vendorAccount(), _provenance: 'org' }, 'sys_metadata', undefined, 'own');
    patch(reg, DEP_PKG, { registration_number: { label: 'Tax ID' } });
    expect(reg.getPackagedFieldPatchBases(OBJ)).toEqual([]);
    expect(registry().getPackagedFieldPatchBases('nope')).toEqual([]);
  });
});

describe('[#33952] a package installed through registerApp keeps its translations on its record, and the protocol reads them by package', () => {
  const DEP_TRANSLATIONS = [
    { 'zh-CN': { objects: { [OBJ]: { fields: { registration_number: { label: '税号', help: '统一社会信用代码' } } } } } },
  ];

  it('getPackage(id).manifest.translations is the list the package shipped; getPackageTranslationBundle answers it by package', async () => {
    const ql = new ObjectQL();
    (ql.registry as SchemaRegistry).logLevel = 'silent';
    ql.registerApp({
      id: OWNER_PKG, name: 'CRM', version: '1.0.0', objects: [vendorAccount()],
      translations: [{ 'zh-CN': { objects: { [OBJ]: { fields: { registration_number: { label: '注册号' } } } } } }],
    });
    ql.registerApp({
      id: DEP_PKG, name: 'Blackcat', version: '1.0.0',
      objectExtensions: [{ extend: OBJ, fieldPatches: { registration_number: { label: 'Tax ID', description: 'Unified social credit code.' } } }],
      translations: DEP_TRANSLATIONS,
    });
    expect(((ql.registry as SchemaRegistry).getPackage(DEP_PKG)?.manifest as any)?.translations).toEqual(DEP_TRANSLATIONS);

    // The protocol over this registry; no stored rows (the row read finds nothing).
    const engine: any = {
      registry: ql.registry,
      async find() { return []; },
      async findOne(object: string, query: any) { assertEngineFindOnePredicate(object, query); return null; },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
    expect(await protocol.getPackageTranslationBundle(DEP_PKG)).toEqual(DEP_TRANSLATIONS[0]);
    expect(protocol.getPackagedFieldPatchBases(OBJ).map((e: any) => [e.packageId, e.base.fields.registration_number.label]))
      .toEqual([[DEP_PKG, 'Tax ID']]);
  });
});
