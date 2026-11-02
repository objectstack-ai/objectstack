// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28835] A field name that two contributors of one object both declare in
 * `fields` is named once at the fold, with the definition it serves.
 *
 * `mergeObjectDefinitions` spreads `fields`, so when two extensions of one
 * object both add `x`, or an extension's `fields` redeclares a field the owner
 * declares, the last contribution the fold applies wins: ascending `priority`,
 * and at equal priority the one registered last. That stays the answer (the
 * served definition is not changed here); the fold now says so, once per
 * object, field and set of packages, in the style of the field-patch miss
 * report. `fieldPatches` is not a declaration, and a `.custom` pair's `__c`
 * field never shares a name with a dependent's plain one.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SchemaRegistry } from './registry.js';

const OWNER_PKG = 'com.vendor.crm';
const DEP_A = 'com.acme.crm-territory';
const DEP_B = 'com.globex.crm-regions';
const OBJ = 'crm_account';

function vendorAccount(): any {
  return {
    name: OBJ,
    label: 'Account',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      industry: {
        name: 'industry',
        type: 'select',
        label: 'Industry',
        options: [
          { value: 'tech', label: 'Tech' },
          { value: 'retail', label: 'Retail' },
        ],
      },
    },
  };
}

function withVendor(): SchemaRegistry {
  const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  reg.logLevel = 'silent';
  reg.registerObject(vendorAccount(), OWNER_PKG, undefined, 'own');
  return reg;
}

function extendWith(reg: SchemaRegistry, pkg: string, body: Record<string, unknown>, priority = 200): void {
  reg.registerObject({ name: OBJ, ...body } as any, pkg, undefined, 'extend', priority);
}

const regionOf = (pkg: string) => ({ name: 'region', type: 'text', label: `Region (${pkg})` });

/** The fold's lines about a field declared more than once. */
function redeclaredLines(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('is declared in `fields` by'));
}

/** Every read the fold serves, three times over, with the cache dropped between. */
function readEverywhere(reg: SchemaRegistry): void {
  for (let i = 0; i < 3; i += 1) {
    reg.invalidateAll();
    reg.getObject(OBJ);
    reg.foldObjectExtendersOnto(OBJ, vendorAccount());
    reg.getArtifactItem('object', OBJ);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#28835 — a field two contributors declare in `fields` is named once at the fold, with the definition served', () => {
  it('two dependents both add `region` at equal priority: the one registered last is served, and one line names both and the served one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    extendWith(reg, DEP_A, { fields: { region: regionOf(DEP_A) } });
    extendWith(reg, DEP_B, { fields: { region: regionOf(DEP_B) } });

    const served = reg.getObject(OBJ) as any;
    expect(served.fields.region).toEqual(regionOf(DEP_B));
    readEverywhere(reg);

    const lines = redeclaredLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`Field "region" of object "${OBJ}"`);
    expect(lines[0]).toContain(`extensions from "${DEP_A}", "${DEP_B}"`);
    expect(lines[0]).toContain(`the definition served is the one from "${DEP_B}"`);
    expect(lines[0]).not.toContain(OWNER_PKG);
  });

  it('…by priority, not registration order: the higher-priority dependent registered first is the one served and named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    extendWith(reg, DEP_A, { fields: { region: regionOf(DEP_A) } }, 300);
    extendWith(reg, DEP_B, { fields: { region: regionOf(DEP_B) } }, 200);

    expect((reg.getObject(OBJ) as any).fields.region).toEqual(regionOf(DEP_A));
    const lines = redeclaredLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`extensions from "${DEP_B}", "${DEP_A}"`);
    expect(lines[0]).toContain(`the definition served is the one from "${DEP_A}"`);
  });

  it('an extension redeclaring a field the owner declares: the extension\'s definition is served, and one line names the owner, the extension and the served one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    const takeover = { name: 'industry', type: 'text', label: 'Industry (free text)' };
    extendWith(reg, DEP_A, { fields: { industry: takeover } });

    expect((reg.getObject(OBJ) as any).fields.industry).toEqual(takeover);
    readEverywhere(reg);

    const lines = redeclaredLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`Field "industry" of object "${OBJ}"`);
    expect(lines[0]).toContain(`the owner "${OWNER_PKG}" and by extensions from "${DEP_A}"`);
    expect(lines[0]).toContain(`the definition served is the one from "${DEP_A}"`);
  });

  it('the owner and two extensions on one field: one line naming all three in fold order', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    extendWith(reg, DEP_A, { fields: { industry: { name: 'industry', type: 'text', label: 'A' } } });
    extendWith(reg, DEP_B, { fields: { industry: { name: 'industry', type: 'text', label: 'B' } } });

    expect((reg.getObject(OBJ) as any).fields.industry.label).toBe('B');
    const lines = redeclaredLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`the owner "${OWNER_PKG}" and by extensions from "${DEP_A}", "${DEP_B}"`);
    expect(lines[0]).toContain(`the definition served is the one from "${DEP_B}"`);
  });

  it('two `.custom` pairs (one base depending on the other) both adding `region__c`: named like any two extensions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    extendWith(reg, `${OWNER_PKG}.custom`, { fields: { region__c: { name: 'region__c', type: 'text', label: 'One' } } });
    extendWith(reg, `${DEP_A}.custom`, { fields: { region__c: { name: 'region__c', type: 'text', label: 'Two' } } });

    expect((reg.getObject(OBJ) as any).fields.region__c.label).toBe('Two');
    const lines = redeclaredLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`the definition served is the one from "${DEP_A}.custom"`);
  });

  it('a second registry names the same collision again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 2; i += 1) {
      const reg = withVendor();
      extendWith(reg, DEP_A, { fields: { region: regionOf(DEP_A) } });
      extendWith(reg, DEP_B, { fields: { region: regionOf(DEP_B) } });
      readEverywhere(reg);
    }
    expect(redeclaredLines(warn)).toHaveLength(2);
  });

  describe('controls: nothing is named', () => {
    it('one extension adding a field of its own', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = withVendor();
      extendWith(reg, DEP_A, { fields: { region: regionOf(DEP_A) } });
      readEverywhere(reg);
      expect((reg.getObject(OBJ) as any).fields.region).toEqual(regionOf(DEP_A));
      expect(redeclaredLines(warn)).toEqual([]);
    });

    it('a pair\'s `__c` field beside a dependent\'s plain field of the same stem', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = withVendor();
      extendWith(reg, `${OWNER_PKG}.custom`, { fields: { region__c: { name: 'region__c', type: 'text', label: 'Mine' } } });
      extendWith(reg, DEP_A, { fields: { region: regionOf(DEP_A) } });
      readEverywhere(reg);
      const served = reg.getObject(OBJ) as any;
      expect(served.fields.region__c.label).toBe('Mine');
      expect(served.fields.region).toEqual(regionOf(DEP_A));
      expect(redeclaredLines(warn)).toEqual([]);
    });

    it('a `fieldPatches` entry of an owner field, beside an extension adding a field', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = withVendor();
      extendWith(reg, DEP_A, { fieldPatches: { industry: { label: 'Sector' } } });
      extendWith(reg, DEP_B, { fields: { region: regionOf(DEP_B) }, fieldPatches: { industry: { label: 'Market' } } });
      readEverywhere(reg);
      expect((reg.getObject(OBJ) as any).fields.industry.label).toBe('Market');
      expect(redeclaredLines(warn)).toEqual([]);
    });

    it('a base that already carries the extensions\' fields (a folded body handed back to the fold)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = withVendor();
      extendWith(reg, DEP_A, { fields: { region: regionOf(DEP_A) } });
      const folded = reg.getObject(OBJ) as any;
      reg.foldObjectExtendersOnto(OBJ, structuredClone(folded));
      reg.foldObjectExtendersOnto(OBJ, structuredClone(folded));
      expect(redeclaredLines(warn)).toEqual([]);
    });
  });
});
