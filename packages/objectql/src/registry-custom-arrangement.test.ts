// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] The third layer of an installed object's record-page
 * arrangement, over a base + extension package + `.custom` fixture:
 *
 *  1. the base declares its field groups and its tabs;
 *  2. an extension package places what it brings with `place`;
 *  3. where the base's paired `.custom` package writes `fieldGroups` or
 *     `relatedLists`, that key replaces the result of 1–2, whole.
 *
 * The field arrangement is asserted through `deriveFieldGroupLayout`, the one
 * derivation the record page, the create and edit forms and the preview
 * share (ADR-0085 §5), so "shows in the new arrangement" is one reading.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveFieldGroupLayout, ObjectExtensionSchema, ObjectSchema } from '@objectstack/spec/data';
import { SchemaRegistry } from './registry.js';
import { applyCustomArrangement } from './registry-custom-arrangement.js';

const BASE = 'com.vendor.crm';
const PAIR = 'com.vendor.crm.custom';
const EXT = 'com.acme.tax';
const OBJ = 'crm_lead';

/**
 * The vendor's lead. `basic` lists its members (the current spelling);
 * `contact`'s members name it in their own `group` (the older spelling), so
 * every rule is read against both.
 */
function vendorLead(extra: Record<string, unknown> = {}): any {
  return {
    name: OBJ,
    label: 'Lead',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      company: { name: 'company', type: 'text', label: 'Company' },
      status: { name: 'status', type: 'text', label: 'Status' },
      email: { name: 'email', type: 'text', label: 'Email', group: 'contact' },
      phone: { name: 'phone', type: 'text', label: 'Phone', group: 'contact' },
      fax: { name: 'fax', type: 'text', label: 'Fax', group: 'contact' },
    },
    fieldGroups: [
      { key: 'basic', label: 'Basic', fields: ['name', 'company', 'status'] },
      { key: 'contact', label: 'Contact' },
    ],
    relatedLists: ['crm_task', 'crm_event', 'crm_note'],
    ...extra,
  };
}

const child = (name: string, label: string) => ({
  name,
  label,
  fields: { lead_id: { name: 'lead_id', type: 'lookup', label: 'Lead', reference: OBJ } },
});

function registry(): SchemaRegistry {
  const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  reg.logLevel = 'silent';
  return reg;
}

function withBase(lead: any = vendorLead(), reg = registry()): SchemaRegistry {
  reg.registerObject(lead, BASE, undefined, 'own');
  for (const [name, label] of [['crm_task', 'Task'], ['crm_event', 'Event'], ['crm_note', 'Note']]) {
    reg.registerObject(child(name, label) as any, BASE, undefined, 'own');
  }
  return reg;
}

/** The extension package: a field placed into `basic`, and a child list placed after the tasks. */
function withExtensionPackage(reg: SchemaRegistry): SchemaRegistry {
  reg.registerObject(child('acme_audit', 'Audit') as any, EXT, undefined, 'own');
  reg.registerObject(
    {
      name: OBJ,
      fields: { tax_id: { name: 'tax_id', type: 'text', label: 'Tax ID' } },
      place: [{ field: 'tax_id', group: 'basic', after: 'company' }, { list: 'acme_audit', after: 'crm_task' }],
    } as any,
    EXT, undefined, 'extend', 200,
  );
  return reg;
}

const REGION = { name: 'region__c', type: 'text', label: 'Region' };

/** The `.custom` package's extension of the lead: its own field, plus the arrangement keys it writes. */
function customize(reg: SchemaRegistry, arrangement: Record<string, unknown>, options: { pkg?: string; fields?: Record<string, unknown> } = {}): SchemaRegistry {
  reg.registerObject(
    { name: OBJ, fields: options.fields ?? { region__c: REGION }, ...arrangement } as any,
    options.pkg ?? PAIR, undefined, 'extend', 200,
  );
  return reg;
}

const served = (reg: SchemaRegistry): any => reg.getObject(OBJ);

const AUTHORED = new Set(['name', 'company', 'status', 'email', 'phone', 'fax', 'tax_id', 'region__c']);
/** The derived layout as `[group key | null for the trailing bucket, authored members]`. */
const layout = (body: any): Array<[string | null, string[]]> =>
  (deriveFieldGroupLayout(body) ?? [])
    .map((section): [string | null, string[]] => [section.key ?? null, section.fields.filter((f) => AUTHORED.has(f))])
    // The trailing bucket also carries the object's system fields; with no authored member it is not a reading.
    .filter(([key, members]) => key !== null || members.length > 0);

afterEach(() => vi.restoreAllMocks());

describe('ADR-0146 D10 — the fixture, before the `.custom` arrangement (steps 1–2)', () => {
  it('control: the base arrangement with the extension package\'s placements', () => {
    const body = served(withExtensionPackage(withBase()));
    expect(layout(body)).toEqual([
      ['basic', ['name', 'company', 'tax_id', 'status']],
      ['contact', ['email', 'phone', 'fax']],
    ]);
    expect(body.relatedLists).toEqual(['crm_task', 'acme_audit', 'crm_event', 'crm_note']);
  });
});

describe('ADR-0146 D10 — `.custom` fieldGroups replaces the field arrangement whole', () => {
  it('a base field moved to another group and two groups swapped: the layout every surface derives', () => {
    const reg = customize(withBase(), {
      fieldGroups: [
        { key: 'contact', label: 'Reach', fields: ['email', 'phone', 'fax', 'status'] },
        { key: 'basic', label: 'Basic', fields: ['name', 'company', 'region__c'] },
      ],
    });
    const body = served(reg);
    expect(layout(body)).toEqual([
      ['contact', ['email', 'phone', 'fax', 'status']],
      ['basic', ['name', 'company', 'region__c']],
    ]);
    expect(body.fieldGroups.map((g: any) => [g.key, g.label])).toEqual([['contact', 'Reach'], ['basic', 'Basic']]);
    // The served object is one an object parse accepts: no field names a group other than the one listing it.
    expect(ObjectSchema.safeParse({ name: OBJ, fields: body.fields, fieldGroups: body.fieldGroups }).success).toBe(true);
  });

  it('a base field the arrangement does not list shows after the last group, in either spelling', () => {
    // `company` was in `basic` by the group's list, `fax` in `contact` by its own `group`.
    const reg = customize(withBase(), {
      fieldGroups: [
        { key: 'basic', label: 'Basic', fields: ['name', 'status'] },
        { key: 'contact', label: 'Contact', fields: ['email', 'phone'] },
      ],
    });
    const body = served(reg);
    expect(layout(body)).toEqual([
      ['basic', ['name', 'status']],
      ['contact', ['email', 'phone']],
      [null, ['company', 'fax', 'region__c']],
    ]);
    expect(body.fields.fax.group).toBeUndefined();
    expect(body.fields.fax.label).toBe('Fax');
  });

  it('an extension package\'s placed field the arrangement does not list still shows, after the last group', () => {
    const reg = customize(withExtensionPackage(withBase()), {
      fieldGroups: [
        { key: 'basic', label: 'Basic', fields: ['name', 'company', 'status'] },
        { key: 'contact', label: 'Contact', fields: ['email', 'phone', 'fax'] },
      ],
    });
    const body = served(reg);
    expect(layout(body)).toEqual([
      ['basic', ['name', 'company', 'status']],
      ['contact', ['email', 'phone', 'fax']],
      [null, ['tax_id', 'region__c']],
    ]);
    expect(Object.keys(body.fields)).toContain('tax_id');
  });

  it('the arrangement may list any field: the base\'s, another extension\'s, its own', () => {
    const reg = customize(withExtensionPackage(withBase()), {
      fieldGroups: [{ key: 'all', label: 'Everything', fields: ['region__c', 'tax_id', 'name', 'fax'] }],
    });
    expect(layout(served(reg))[0]).toEqual(['all', ['region__c', 'tax_id', 'name', 'fax']]);
  });

  it('its own statements keep the object\'s rule: a field it declares keeps its `group`, a list-less group takes the fields naming it', () => {
    const reg = customize(withBase(), {
      fieldGroups: [
        { key: 'basic', label: 'Basic', fields: ['name'] },
        { key: 'contact', label: 'Contact' },
      ],
    }, { fields: { region__c: { ...REGION, group: 'basic' } } });
    expect(layout(served(reg))).toEqual([
      ['basic', ['name', 'region__c']],
      ['contact', ['email', 'phone', 'fax']],
      [null, ['company', 'status']],
    ]);
  });

  it('a group placing a body table takes no field: a `group` naming it is taken off', () => {
    const reg = customize(withBase(), {
      fieldGroups: [
        { key: 'basic', label: 'Basic', fields: ['name'] },
        { key: 'contact', label: 'Notes', relatedList: 'crm_note' },
      ],
    });
    const body = served(reg);
    expect(body.fieldGroups[1]).toEqual({ key: 'contact', label: 'Notes', relatedList: 'crm_note' });
    expect(body.fields.email.group).toBeUndefined();
    expect(ObjectSchema.safeParse({ name: OBJ, fields: body.fields, fieldGroups: body.fieldGroups }).success).toBe(true);
  });

  it('an empty list is an arrangement with no group: the fields show ungrouped', () => {
    const body = served(customize(withBase(), { fieldGroups: [] }));
    expect(body.fieldGroups).toEqual([]);
    expect(deriveFieldGroupLayout(body)).toBeNull();
  });
});

describe('ADR-0146 D10 — `.custom` relatedLists replaces the tab list whole', () => {
  it('two tabs swapped and one hidden: the order changes, the hidden one is not a tab, and the read says who hides it', () => {
    const reg = customize(withBase(), { relatedLists: ['crm_event', 'crm_task', { list: 'crm_note', hidden: true }] });
    expect(served(reg).relatedLists).toEqual(['crm_event', 'crm_task']);
    expect(reg.getRelatedListsArrangement(OBJ)).toEqual({ packageId: PAIR, hidden: ['crm_note'], unlisted: 'hidden' });
  });

  it('an original tab the list does not name shows last', () => {
    const reg = customize(withBase(), { relatedLists: ['crm_event'] });
    expect(served(reg).relatedLists).toEqual(['crm_event', 'crm_task', 'crm_note']);
  });

  it('…before a trailing approvals / activity-stream run, with the title and columns it had', () => {
    const base = vendorLead({ relatedLists: [{ list: 'crm_task', label: 'To do', columns: ['name'] }, 'crm_event', 'sys_activity'] });
    const reg = customize(withBase(base), { relatedLists: ['crm_event', 'sys_approval_request', 'sys_activity'] });
    expect(served(reg).relatedLists).toEqual([
      'crm_event',
      { list: 'crm_task', label: 'To do', columns: ['name'] },
      'sys_approval_request',
      'sys_activity',
    ]);
  });

  it('an extension package\'s placed list the arrangement does not name still shows, after the listed ones', () => {
    const reg = customize(withExtensionPackage(withBase()), { relatedLists: ['crm_note', 'crm_task'] });
    expect(served(reg).relatedLists).toEqual(['crm_note', 'crm_task', 'acme_audit', 'crm_event']);
  });

  it('the object form travels as written, without `hidden`; an entry left with its name alone is the bare name', () => {
    const reg = customize(withBase(), {
      relatedLists: [{ list: 'crm_note', label: 'Notes', columns: ['name'], hidden: false }, { list: 'crm_task', hidden: false }],
    });
    expect(served(reg).relatedLists).toEqual([{ list: 'crm_note', label: 'Notes', columns: ['name'] }, 'crm_task', 'crm_event']);
  });

  it('a bare child covers every relationship of that child: hidden whole, or carried only where no entry covers it', () => {
    const base = vendorLead({ relatedLists: ['crm_task.lead_id', 'crm_task.converted_lead', 'crm_event', 'crm_note'] });
    const hiddenWhole = customize(withBase(base), { relatedLists: [{ list: 'crm_task', hidden: true }] });
    expect(served(hiddenWhole).relatedLists).toEqual(['crm_event', 'crm_note']);
    // One relationship named: the other is not covered, so it is carried over.
    const one = customize(withBase(base), { relatedLists: ['crm_note', 'crm_task.converted_lead'] });
    expect(served(one).relatedLists).toEqual(['crm_note', 'crm_task.converted_lead', 'crm_task.lead_id', 'crm_event']);
  });

  it('over the AUTOMATIC tab list (the base declares none): the read says every unnamed list still shows', () => {
    const { relatedLists: _none, ...automatic } = vendorLead();
    const reg = customize(withBase(automatic), { relatedLists: ['crm_event', { list: 'crm_note', hidden: true }] });
    expect(served(reg).relatedLists).toEqual(['crm_event']);
    expect(reg.getRelatedListsArrangement(OBJ)).toEqual({ packageId: PAIR, hidden: ['crm_note'], unlisted: 'shown' });
  });

  it('every tab of a declared list hidden: nothing is left to serve, and the read says the list is still a declared one', () => {
    // The owner lists two of its three child lists: `crm_note` is hidden by being left out.
    const base = vendorLead({ relatedLists: ['crm_task', 'crm_event'] });
    const reg = customize(withBase(base), {
      relatedLists: [{ list: 'crm_task', hidden: true }, { list: 'crm_event', hidden: true }],
    });
    expect(served(reg).relatedLists).toEqual([]);
    // An empty list alone reads as "none declared, every list shows". `unlisted: 'hidden'` is what keeps
    // `crm_note` hidden: the record page reads the empty list beside it as a declared one.
    expect(reg.getRelatedListsArrangement(OBJ)).toEqual({ packageId: PAIR, hidden: ['crm_task', 'crm_event'], unlisted: 'hidden' });
  });

  it('…and a one-entry list whose entry is hidden is the same case', () => {
    const reg = customize(withBase(vendorLead({ relatedLists: ['crm_task'] })), { relatedLists: [{ list: 'crm_task', hidden: true }] });
    expect(served(reg).relatedLists).toEqual([]);
    expect(reg.getRelatedListsArrangement(OBJ)).toEqual({ packageId: PAIR, hidden: ['crm_task'], unlisted: 'hidden' });
  });

  it('an empty list hides nothing and reorders nothing', () => {
    const declared = customize(withBase(), { relatedLists: [] });
    expect(served(declared).relatedLists).toEqual(['crm_task', 'crm_event', 'crm_note']);
    expect(declared.getRelatedListsArrangement(OBJ)).toEqual({ packageId: PAIR, hidden: [], unlisted: 'hidden' });
  });
});

describe('ADR-0146 D10 — a key the `.custom` package does not write keeps the result of steps 1–2', () => {
  it('only `relatedLists` written: the field groups are the base\'s with the extension package\'s placements', () => {
    const before = served(withExtensionPackage(withBase()));
    const reg = customize(withExtensionPackage(withBase()), { relatedLists: ['crm_note'] }, { fields: {} });
    const body = served(reg);
    expect(body.fieldGroups).toEqual(before.fieldGroups);
    expect(body.fields).toEqual(before.fields);
    expect(layout(body)).toEqual(layout(before));
  });

  it('only `fieldGroups` written: the tabs are the base\'s with the extension package\'s placements, and nothing is said beside them', () => {
    const before = served(withExtensionPackage(withBase()));
    const reg = customize(withExtensionPackage(withBase()), { fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['name'] }] });
    expect(served(reg).relatedLists).toEqual(before.relatedLists);
    expect(reg.getRelatedListsArrangement(OBJ)).toBeUndefined();
  });
});

describe('ADR-0146 D10 — taking the arrangement away restores steps 1–2', () => {
  const ARRANGEMENT = {
    fieldGroups: [{ key: 'contact', label: 'Reach', fields: ['email', 'name'] }],
    relatedLists: ['crm_note', { list: 'crm_task', hidden: true }],
  };

  it('removing both keys from the `.custom` extension: the object is as it was', () => {
    const before = served(customize(withExtensionPackage(withBase()), {}));
    const reg = customize(withExtensionPackage(withBase()), ARRANGEMENT);
    expect(served(reg).relatedLists).toEqual(['crm_note', 'acme_audit', 'crm_event']);
    customize(reg, {});
    expect(served(reg)).toEqual(before);
    expect(reg.getRelatedListsArrangement(OBJ)).toBeUndefined();
  });

  it('uninstalling the `.custom` package: the object is as it was before the package', () => {
    const before = served(withExtensionPackage(withBase()));
    const reg = customize(withExtensionPackage(withBase()), ARRANGEMENT);
    reg.unregisterObjectsByPackage(PAIR);
    expect(served(reg)).toEqual(before);
    expect(reg.getRelatedListsArrangement(OBJ)).toBeUndefined();
  });

  it('disabling the `.custom` package: the served object carries none of it, and enabling brings it back', () => {
    const before = served(withExtensionPackage(withBase()));
    const reg = withExtensionPackage(withBase());
    reg.installPackage({ id: PAIR, name: PAIR, version: '0.1.0', type: 'app', namespace: 'crm_custom' } as never, 'code');
    customize(reg, ARRANGEMENT);
    const on = served(reg);
    reg.disablePackage(PAIR);
    const off = served(reg);
    expect(off.fieldGroups).toEqual(before.fieldGroups);
    expect(off.relatedLists).toEqual(before.relatedLists);
    expect(layout(off)).toEqual(layout(before));
    expect(reg.getRelatedListsArrangement(OBJ)).toBeUndefined();
    reg.enablePackage(PAIR);
    expect(served(reg)).toEqual(on);
    expect(reg.getRelatedListsArrangement(OBJ)).toEqual({ packageId: PAIR, hidden: ['crm_task'], unlisted: 'hidden' });
  });

  it('a body that already carries the arrangement folds to itself', () => {
    const reg = customize(withExtensionPackage(withBase()), ARRANGEMENT);
    const body = served(reg);
    const refolded = reg.foldObjectExtendersOnto(OBJ, structuredClone(body)) as any;
    expect(refolded.relatedLists).toEqual(body.relatedLists);
    expect(refolded.fieldGroups).toEqual(body.fieldGroups);
    expect(refolded.fields).toEqual(body.fields);
  });
});

describe('ADR-0146 D10 — only a `.custom` package\'s arrangement is applied', () => {
  it('another package\'s `fieldGroups` and `relatedLists` are skipped, each named once, prescribing `place`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = served(withBase());
    const reg = customize(withBase(), {
      fieldGroups: [{ key: 'contact', label: 'Reach', fields: ['email'] }],
      relatedLists: ['crm_note'],
    }, { pkg: EXT, fields: {} });
    const body = served(reg);
    served(reg);
    reg.foldObjectExtendersOnto(OBJ, vendorLead());
    expect(body.fieldGroups).toEqual(before.fieldGroups);
    expect(body.relatedLists).toEqual(before.relatedLists);
    expect(reg.getRelatedListsArrangement(OBJ)).toBeUndefined();
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('is not applied'));
    expect(lines).toHaveLength(2);
    for (const [line, key] of [[lines[0], 'fieldGroups'], [lines[1], 'relatedLists']] as const) {
      expect(line).toContain(`from package "${EXT}"`);
      expect(line).toContain(`\`${key}\``);
      expect(line).toContain('`place`');
    }
  });

  it('a `.custom` package that is not the object\'s pair is skipped and named, beside the pair and alone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const OTHER = 'com.acme.tax.custom';
    // Beside the pair, and folded after it: the pair is served.
    const reg = withBase();
    customize(reg, { relatedLists: ['crm_note'] }, { fields: {} });
    customize(reg, { relatedLists: ['crm_event'] }, { pkg: OTHER, fields: {} });
    expect(served(reg).relatedLists).toEqual(['crm_note', 'crm_task', 'crm_event']);
    expect(reg.getRelatedListsArrangement(OBJ)?.packageId).toBe(PAIR);
    // Alone: nothing is applied, as for any package that is not the pair.
    const before = served(withBase());
    const alone = customize(withBase(), {
      fieldGroups: [{ key: 'contact', label: 'Reach', fields: ['email'] }],
      relatedLists: ['crm_event'],
    }, { pkg: OTHER, fields: {} });
    expect(served(alone).fieldGroups).toEqual(before.fieldGroups);
    expect(served(alone).relatedLists).toEqual(before.relatedLists);
    expect(alone.getRelatedListsArrangement(OBJ)).toBeUndefined();
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('is not the customization package of this object'));
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain(`from package "${OTHER}"`);
      expect(line).toContain(`(that is "${PAIR}")`);
    }
  });
});

describe('ADR-0146 D10 — the pair is the App\'s, chosen by role (an object a module owns)', () => {
  const APP = 'com.hotcrm';
  const MODULE = 'com.hotcrm.sales';
  const APP_PAIR = 'com.hotcrm.custom';
  const MEMBER_PAIR = 'com.hotcrm.sales.custom';
  const OTHER_PAIR = 'com.acme.custom';

  /** The App and the module of it that owns the lead, as the registry holds two installed packages. */
  function hotcrm(): SchemaRegistry {
    const reg = registry();
    reg.installPackage({ id: APP, name: APP, version: '1.0.0', type: 'app', namespace: 'hotcrm' } as never, 'code');
    reg.installPackage({ id: MODULE, name: MODULE, version: '1.0.0', type: 'module', namespace: 'crm', dependencies: { [APP]: '^1.0.0' } } as never, 'code');
    reg.registerObject(vendorLead(), MODULE, undefined, 'own');
    for (const [name, label] of [['crm_task', 'Task'], ['crm_event', 'Event'], ['crm_note', 'Note']]) {
      reg.registerObject(child(name, label) as any, MODULE, undefined, 'own');
    }
    return reg;
  }

  it.each([
    ['the App\'s pair folded first', [APP_PAIR, OTHER_PAIR]],
    ['the App\'s pair folded last', [OTHER_PAIR, APP_PAIR]],
  ])('two writers, %s: the App\'s pair is served and the other is named', (_label, order) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lists: Record<string, unknown[]> = { [APP_PAIR]: ['crm_note'], [OTHER_PAIR]: ['crm_event'] };
    const reg = hotcrm();
    for (const pkg of order) customize(reg, { relatedLists: lists[pkg] }, { pkg, fields: {} });
    expect(served(reg).relatedLists).toEqual(['crm_note', 'crm_task', 'crm_event']);
    expect(reg.getRelatedListsArrangement(OBJ)).toEqual({ packageId: APP_PAIR, hidden: [], unlisted: 'hidden' });
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('is not applied'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`from package "${OTHER_PAIR}"`);
    expect(lines[0]).toContain(`(that is "${APP_PAIR}")`);
  });

  it('a `.custom` id named after the module is not the pair of the module\'s object: the unit is the App', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = served(hotcrm());
    const reg = customize(hotcrm(), { relatedLists: ['crm_event'] }, { pkg: MEMBER_PAIR, fields: {} });
    expect(served(reg).relatedLists).toEqual(before.relatedLists);
    expect(reg.getRelatedListsArrangement(OBJ)).toBeUndefined();
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('is not applied'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`from package "${MEMBER_PAIR}"`);
    expect(lines[0]).toContain(`(that is "${APP_PAIR}")`);
  });

  it('a per-package pair an earlier version created is still read while installed, and the App\'s pair comes first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = (): SchemaRegistry => {
      const reg = hotcrm();
      reg.installPackage({ id: MEMBER_PAIR, name: MEMBER_PAIR, version: '1.0.0' } as never, 'code');
      return reg;
    };
    // Alone, the installed per-package pair is served as it is.
    const alone = customize(legacy(), { relatedLists: ['crm_event'] }, { pkg: MEMBER_PAIR, fields: {} });
    expect(served(alone).relatedLists).toEqual(['crm_event', 'crm_task', 'crm_note']);
    expect(alone.getRelatedListsArrangement(OBJ)?.packageId).toBe(MEMBER_PAIR);
    // Beside the App's pair, whichever folds first, the App's pair is served and the other is named.
    for (const order of [[APP_PAIR, MEMBER_PAIR], [MEMBER_PAIR, APP_PAIR]]) {
      warn.mockClear();
      const lists: Record<string, unknown[]> = { [APP_PAIR]: ['crm_note'], [MEMBER_PAIR]: ['crm_event'] };
      const reg = legacy();
      for (const pkg of order) customize(reg, { relatedLists: lists[pkg] }, { pkg, fields: {} });
      expect(served(reg).relatedLists).toEqual(['crm_note', 'crm_task', 'crm_event']);
      expect(reg.getRelatedListsArrangement(OBJ)?.packageId).toBe(APP_PAIR);
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('one arrangement is served'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`from package "${MEMBER_PAIR}"`);
      expect(lines[0]).toContain(`package "${APP_PAIR}"`);
    }
  });

  it('the App\'s pair alone arranges the module\'s object', () => {
    const reg = customize(hotcrm(), { relatedLists: ['crm_event', { list: 'crm_note', hidden: true }] }, { pkg: APP_PAIR, fields: {} });
    expect(served(reg).relatedLists).toEqual(['crm_event', 'crm_task']);
    expect(reg.getRelatedListsArrangement(OBJ)).toEqual({ packageId: APP_PAIR, hidden: ['crm_note'], unlisted: 'hidden' });
  });
});

describe('ADR-0146 D10 — the pure step', () => {
  it('answers the object by reference when no contributor writes an arrangement key', () => {
    const object = vendorLead();
    const result = applyCustomArrangement(object, [
      { packageId: EXT, ownership: 'extend', priority: 200, definition: { name: OBJ, fields: {} } } as never,
    ], { objectName: OBJ, customizationPairs: () => { throw new Error('the pairs are asked only when a key is written'); } });
    expect(result.object).toBe(object);
    expect(result.notes).toEqual([]);
    expect(result.relatedLists).toBeUndefined();
  });

  it('the arrangement the tests above register is one the schema parses', () => {
    const parsed = ObjectExtensionSchema.safeParse({
      extend: OBJ,
      fields: { region__c: { type: 'text', label: 'Region' } },
      fieldGroups: [
        { key: 'contact', label: 'Reach', fields: ['email', 'phone', 'fax', 'status'] },
        { key: 'basic', label: 'Basic', fields: ['name', 'company', 'region__c'] },
      ],
      relatedLists: ['crm_event', 'crm_task', { list: 'crm_note', hidden: true }],
    });
    expect(parsed.success).toBe(true);
  });
});
