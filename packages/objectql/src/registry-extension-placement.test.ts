// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35901] The registry fold applies each object extension's `place` once,
 * after every contributor's fields are merged: a field it adds lands after
 * the member it names, a group it adds after the group it names, a child list
 * of its package after the tab it names. Two packages at one anchor order by
 * priority, then package name, whatever order they registered in. Uninstalling
 * or disabling the package takes its items off and leaves the owner's order
 * as it was. Where the extended object declares no tab list (no field groups),
 * its automatic arrangement stays and the placement is named once in the log
 * (Sales ruling 7073014077: arm (a)). An item that is not the extension's own
 * is skipped, named.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { ObjectQL } from './engine.js';
import { PLACEMENT_ARRANGES_DECLARED_ONLY, applyExtensionPlacements } from './registry-extension-placement.js';

const OWNER_PKG = 'com.vendor.crm';
const EXT_PKG = 'com.acme.contracts';
const OBJ = 'crm_account';

/** The vendor's account: one group whose members come from each field's own `group`. */
function vendorAccount(extra: Record<string, unknown> = {}): any {
  return {
    name: OBJ,
    label: 'Account',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name', group: 'basic' },
      industry: { name: 'industry', type: 'text', label: 'Industry', group: 'basic' },
      phone: { name: 'phone', type: 'text', label: 'Phone', group: 'basic' },
      notes: { name: 'notes', type: 'textarea', label: 'Notes', group: 'more' },
    },
    fieldGroups: [{ key: 'basic', label: 'Basic' }, { key: 'more', label: 'More' }],
    relatedLists: ['crm_contact', 'crm_opportunity'],
    ...extra,
  };
}

const child = (name: string, label: string) => ({
  name,
  label,
  fields: { account_id: { name: 'account_id', type: 'lookup', label: 'Account', reference: OBJ } },
});

function registry(): SchemaRegistry {
  const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  reg.logLevel = 'silent';
  return reg;
}

function withVendor(account: any = vendorAccount(), reg = registry()): SchemaRegistry {
  reg.registerObject(account, OWNER_PKG, undefined, 'own');
  reg.registerObject(child('crm_contact', 'Contact') as any, OWNER_PKG, undefined, 'own');
  reg.registerObject(child('crm_opportunity', 'Opportunity') as any, OWNER_PKG, undefined, 'own');
  return reg;
}

const TAX_ID = { name: 'tax_id', type: 'text', label: 'Tax ID' };

function extend(reg: SchemaRegistry, place: unknown[], options: { pkg?: string; priority?: number; fields?: Record<string, unknown> } = {}): void {
  reg.registerObject(
    { name: OBJ, fields: options.fields ?? { tax_id: TAX_ID }, place } as any,
    options.pkg ?? EXT_PKG,
    undefined,
    'extend',
    options.priority ?? 200,
  );
}

const served = (reg: SchemaRegistry): any => reg.getObject(OBJ);
const groupFields = (body: any, key: string): unknown => body.fieldGroups.find((g: any) => g.key === key)?.fields;

afterEach(() => vi.restoreAllMocks());

describe('#35901 — a field the extension adds lands where it says', () => {
  it('tax_id after industry: in the group, between industry and phone, its group set', () => {
    const reg = withVendor();
    extend(reg, [{ field: 'tax_id', group: 'basic', after: 'industry' }]);
    const body = served(reg);
    expect(groupFields(body, 'basic')).toEqual(['name', 'industry', 'tax_id', 'phone']);
    expect(body.fields.tax_id.group).toBe('basic');
    // The other group, and the order of the object's fields, are untouched.
    expect(groupFields(body, 'more')).toBeUndefined();
    const authored = new Set(['name', 'industry', 'phone', 'notes', 'tax_id']);
    expect(Object.keys(body.fields).filter((f) => authored.has(f))).toEqual(['name', 'industry', 'phone', 'notes', 'tax_id']);
  });

  it('before an anchor, and with no anchor at the end of the group', () => {
    const reg = withVendor();
    extend(reg, [{ field: 'tax_id', group: 'basic', before: 'name' }]);
    expect(groupFields(served(reg), 'basic')).toEqual(['tax_id', 'name', 'industry', 'phone']);

    const end = withVendor();
    extend(end, [{ field: 'tax_id', group: 'more' }]);
    expect(groupFields(served(end), 'more')).toEqual(['notes', 'tax_id']);
  });

  it('a group that lists its members keeps its list and takes the field in it', () => {
    const account = vendorAccount({ fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['phone', 'name', 'industry'] }, { key: 'more', label: 'More' }] });
    const reg = withVendor(account);
    extend(reg, [{ field: 'tax_id', group: 'basic', after: 'name' }]);
    expect(groupFields(served(reg), 'basic')).toEqual(['phone', 'name', 'tax_id', 'industry']);
  });

  it('an anchor the object no longer has puts the field last in the group, named once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const account = vendorAccount();
    delete account.fields.industry;
    const reg = withVendor(account);
    extend(reg, [{ field: 'tax_id', group: 'basic', after: 'industry' }]);
    expect(groupFields(served(reg), 'basic')).toEqual(['name', 'phone', 'tax_id']);
    served(reg);
    reg.foldObjectExtendersOnto(OBJ, account);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("after 'industry'"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`from package "${EXT_PKG}"`);
    expect(lines[0]).toContain('placed last in the group');
  });
});

describe('#35901 — a group the extension adds lands where it says', () => {
  it('after basic, holding the fields it lists; a field placed into it joins it', () => {
    const reg = withVendor();
    extend(
      reg,
      [
        { group: { key: 'tax', label: 'Tax', fields: ['tax_region'] }, after: 'basic' },
        { field: 'tax_id', group: 'tax', before: 'tax_region' },
      ],
      { fields: { tax_id: TAX_ID, tax_region: { name: 'tax_region', type: 'text', label: 'Tax region' } } },
    );
    const body = served(reg);
    expect(body.fieldGroups.map((g: any) => g.key)).toEqual(['basic', 'tax', 'more']);
    expect(groupFields(body, 'tax')).toEqual(['tax_id', 'tax_region']);
  });
});

describe('#35901 — a child list of the extension\'s package lands among the tabs', () => {
  const contract = () => child('acme_contract', 'Contract');

  it('relatedLists [contact, opportunity] + contract after opportunity', () => {
    const reg = withVendor();
    reg.registerObject(contract() as any, EXT_PKG, undefined, 'own');
    extend(reg, [{ list: 'acme_contract', after: 'crm_opportunity' }]);
    expect(served(reg).relatedLists).toEqual(['crm_contact', 'crm_opportunity', 'acme_contract']);
  });

  it('before a tab, with its own title and columns as the object form', () => {
    const reg = withVendor();
    reg.registerObject(contract() as any, EXT_PKG, undefined, 'own');
    extend(reg, [{ list: 'acme_contract.account_id', before: 'crm_opportunity', label: 'Contracts', columns: ['name'] }]);
    expect(served(reg).relatedLists).toEqual([
      'crm_contact',
      { list: 'acme_contract.account_id', label: 'Contracts', columns: ['name'] },
      'crm_opportunity',
    ]);
  });

  it('with no anchor, at the end of the tabs, before a trailing approvals / stream tab', () => {
    const reg = withVendor(vendorAccount({ relatedLists: ['crm_contact', 'sys_approval_request', 'sys_activity'] }));
    extend(reg, [{ list: 'acme_contract' }]);
    expect(served(reg).relatedLists).toEqual(['crm_contact', 'acme_contract', 'sys_approval_request', 'sys_activity']);
  });

  it('the owner already naming the list keeps the owner\'s position', () => {
    const reg = withVendor(vendorAccount({ relatedLists: ['acme_contract', 'crm_contact', 'crm_opportunity'] }));
    extend(reg, [{ list: 'acme_contract', after: 'crm_opportunity' }]);
    expect(served(reg).relatedLists).toEqual(['acme_contract', 'crm_contact', 'crm_opportunity']);
  });
});

describe('#35901 — several packages at one anchor order by priority, then package name', () => {
  const A = 'com.alpha.ext';
  const B = 'com.beta.ext';
  const place = (reg: SchemaRegistry, pkg: string, list: string, priority: number) => {
    reg.registerObject(child(list, list) as any, pkg, undefined, 'own');
    extend(reg, [{ list, after: 'crm_contact' }], { pkg, priority, fields: {} });
  };

  it.each([
    ['alpha first', [A, B]],
    ['beta first', [B, A]],
  ])('equal priority: package name decides (%s)', (_label, order) => {
    const reg = withVendor();
    for (const pkg of order) place(reg, pkg, pkg === A ? 'alpha_list' : 'beta_list', 200);
    expect(served(reg).relatedLists).toEqual(['crm_contact', 'alpha_list', 'beta_list', 'crm_opportunity']);
  });

  it('lower priority first, whatever the names', () => {
    const reg = withVendor();
    place(reg, A, 'alpha_list', 300);
    place(reg, B, 'beta_list', 210);
    expect(served(reg).relatedLists).toEqual(['crm_contact', 'beta_list', 'alpha_list', 'crm_opportunity']);
  });
});

describe('#35901 — uninstalling or disabling the package leaves the owner\'s order as it was', () => {
  const placeAll = (reg: SchemaRegistry) => {
    reg.registerObject(child('acme_contract', 'Contract') as any, EXT_PKG, undefined, 'own');
    extend(reg, [
      { field: 'tax_id', group: 'basic', after: 'industry' },
      { group: { key: 'tax', label: 'Tax' }, after: 'basic' },
      { list: 'acme_contract', after: 'crm_contact' },
    ]);
  };

  it('uninstall: the items go, the owner\'s groups and tabs are as before', () => {
    const before = withVendor();
    const ownerOnly = served(before);
    const reg = withVendor();
    placeAll(reg);
    expect(served(reg).relatedLists).toContain('acme_contract');
    reg.unregisterObjectsByPackage(EXT_PKG);
    const after = served(reg);
    expect(after.relatedLists).toEqual(ownerOnly.relatedLists);
    expect(after.fieldGroups).toEqual(ownerOnly.fieldGroups);
    expect(after.fields.tax_id).toBeUndefined();
  });

  it('disable: the served object carries none of the placements', () => {
    const reg = withVendor();
    reg.installPackage({ id: EXT_PKG, name: EXT_PKG, version: '1.0.0', type: 'app', namespace: 'acme' } as never, 'code');
    placeAll(reg);
    reg.disablePackage(EXT_PKG);
    const body = served(reg);
    expect(body.relatedLists).toEqual(['crm_contact', 'crm_opportunity']);
    expect(body.fieldGroups.map((g: any) => g.key)).toEqual(['basic', 'more']);
    expect(groupFields(body, 'basic')).toBeUndefined();
  });

  it('a body that already carries the placements folds to itself', () => {
    const reg = withVendor();
    placeAll(reg);
    const body = served(reg);
    const refolded = reg.foldObjectExtendersOnto(OBJ, structuredClone(body)) as any;
    expect(refolded.relatedLists).toEqual(body.relatedLists);
    expect(refolded.fieldGroups).toEqual(body.fieldGroups);
  });
});

describe('#35901 — arm (a): where the object declares no arrangement, it stays, and the log says so', () => {
  it('pins the ruled arm', () => {
    expect(PLACEMENT_ARRANGES_DECLARED_ONLY).toBe(true);
  });

  it('no relatedLists: no tab list is made, the note names the object, the package and the FK keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const account = vendorAccount();
    delete account.relatedLists;
    const reg = withVendor(account);
    extend(reg, [{ list: 'acme_contract', after: 'crm_opportunity', label: 'Contracts' }]);
    expect(served(reg).relatedLists).toBeUndefined();
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("places list 'acme_contract'"));
    expect(line).toContain(`object "${OBJ}" from package "${EXT_PKG}"`);
    expect(line).toContain('declares no `relatedLists`');
    expect(line).toContain('`relatedListTitle` / `relatedListColumns`');
  });

  it('no fieldGroups: no group is made, the field keeps its place among the fields, both named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const account = vendorAccount();
    delete account.fieldGroups;
    const reg = withVendor(account);
    extend(reg, [{ field: 'tax_id', group: 'basic', after: 'industry' }, { group: { key: 'tax', label: 'Tax' } }]);
    const body = served(reg);
    expect(body.fieldGroups).toBeUndefined();
    expect(body.fields.tax_id).toEqual(TAX_ID);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('declares no `fieldGroups`'));
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.includes('`tax_id`'))).toContain("after 'industry'");
  });
});

describe('#35901 — an extension places only its own items', () => {
  it('a list whose object another package owns is not placed, named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor(vendorAccount({ relatedLists: ['crm_contact'] }));
    extend(reg, [{ list: 'crm_opportunity', after: 'crm_contact' }]);
    expect(served(reg).relatedLists).toEqual(['crm_contact']);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(`package "${OWNER_PKG}"'s, not a child object this package defines`);
  });

  it('a child not registered (yet) is no verdict: the list is placed', () => {
    const reg = withVendor();
    extend(reg, [{ list: 'acme_later', after: 'crm_contact' }]);
    expect(served(reg).relatedLists).toEqual(['crm_contact', 'acme_later', 'crm_opportunity']);
  });

  it('a group key the object declares is not added again, and a foreign field is not moved', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    extend(reg, [{ group: { key: 'basic', label: 'Mine' } }, { field: 'industry', group: 'more' }]);
    const body = served(reg);
    expect(body.fieldGroups).toEqual(vendorAccount().fieldGroups);
    expect(body.fields.industry.group).toBe('basic');
    const text = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toContain("which is a group \"crm_account\" declares itself");
    expect(text).toContain('`industry` (place[1]), which is not a field this extension adds');
  });
});

describe('#35901 — the manifest loop carries place onto the extension def', () => {
  it('a package\'s objectExtensions entry places its field through ObjectQL.registerApp', () => {
    const ql = new ObjectQL();
    (ql.registry as SchemaRegistry).logLevel = 'silent';
    ql.registerApp({ id: OWNER_PKG, name: 'CRM', version: '1.0.0', objects: [vendorAccount()] });
    ql.registerApp({
      id: EXT_PKG,
      name: 'Contracts',
      version: '1.0.0',
      objectExtensions: [{ extend: OBJ, fields: { tax_id: TAX_ID }, place: [{ field: 'tax_id', group: 'basic', after: 'industry' }] }],
    });
    expect(groupFields(ql.registry.getObject(OBJ), 'basic')).toEqual(['name', 'industry', 'tax_id', 'phone']);
    expect((ql.registry as SchemaRegistry).getObjectExtensionsOf(EXT_PKG)[0].place).toEqual([
      { field: 'tax_id', group: 'basic', after: 'industry' },
    ]);
  });
});

describe('#35901 — applyExtensionPlacements is pure and returns the object by reference when nothing applies', () => {
  it('no placements: same reference, no notes', () => {
    const object = vendorAccount();
    const out = applyExtensionPlacements(object, [], { objectName: OBJ, ownerGroupKeys: new Set(), childPackageOf: () => undefined });
    expect(out.object).toBe(object);
    expect(out.notes).toEqual([]);
  });
});
