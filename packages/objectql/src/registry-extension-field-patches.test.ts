// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] An object extension's `fieldPatches` reaches
 * every object read: the manifest loop carries the slot onto the extension
 * def, and `mergeObjectDefinitions` applies it after the additive merges.
 *
 * A vendor package ships `crm_account.industry` labelled "Industry"; a second
 * package patches its display text to "Sector". Every read — the resolved
 * object (list and data doors), the by-name fold onto a MetadataService body
 * and the code layer (`getArtifactItem`) — serves "Sector", while the field's
 * type, requiredness and option VALUES stay the vendor's. Removing the
 * extender serves the vendor's text again; a tenant's own label keeps winning
 * (ADR-0029 D9.2a); two patching extenders resolve by `priority`; a patch
 * reaches the owner's own fields only, never a field an extension adds; and a
 * patch naming what the target lacks is not applied and is named once in the
 * log, never a boot refusal.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { ObjectQL } from './engine.js';

const OWNER_PKG = 'com.vendor.crm';
const EXT_PKG = 'com.acme.crm-display';
const OBJ = 'crm_account';

/** The vendor's declaration — the packaged text a patch changes and an uninstall restores. */
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
        description: 'The industry the account belongs to.',
        inlineHelpText: 'Pick the closest industry.',
        placeholder: 'Select an industry',
        required: true,
        options: [
          { value: 'tech', label: 'Tech' },
          { value: 'retail', label: 'Retail' },
        ],
      },
    },
  };
}

/** The patch the card's first test names: four field keys and one option label. */
const PATCH = {
  industry: {
    label: 'Sector',
    description: 'The market the account sells into.',
    inlineHelpText: 'Pick the closest sector.',
    placeholder: 'Select a sector',
    options: { tech: { label: 'Technology' } },
  },
};

function registry(): SchemaRegistry {
  const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  reg.logLevel = 'silent';
  return reg;
}

function withVendor(reg = registry()): SchemaRegistry {
  reg.registerObject(vendorAccount(), OWNER_PKG, undefined, 'own');
  return reg;
}

function extend(reg: SchemaRegistry, fieldPatches: unknown, pkg = EXT_PKG, priority = 200): void {
  reg.registerObject({ name: OBJ, fieldPatches } as any, pkg, undefined, 'extend', priority);
}

const industryOf = (body: any) => body?.fields?.industry;

/** The vendor field's structure: everything a patch must NOT move. */
const structureOf = (field: any) => ({
  type: field?.type,
  required: field?.required,
  values: (field?.options ?? []).map((o: any) => o.value),
});

afterEach(() => vi.restoreAllMocks());

describe('ADR-0146 D10 — fieldPatches is applied by mergeObjectDefinitions on every object read', () => {
  it('patches label, description, help text, placeholder and one option label; type, required and values stay the vendor\'s', () => {
    const reg = withVendor();
    extend(reg, PATCH);

    const served = industryOf(reg.getObject(OBJ));
    expect(served.label).toBe('Sector');
    expect(served.description).toBe('The market the account sells into.');
    expect(served.inlineHelpText).toBe('Pick the closest sector.');
    expect(served.placeholder).toBe('Select a sector');
    expect(served.options).toEqual([
      { value: 'tech', label: 'Technology' },
      { value: 'retail', label: 'Retail' },
    ]);
    expect(structureOf(served)).toEqual({ type: 'select', required: true, values: ['tech', 'retail'] });
    // The patch is applied, never carried: the served object has no slot of its own.
    expect('fieldPatches' in (reg.getObject(OBJ) as any)).toBe(false);
  });

  it('serves the same text on the list read, the by-name fold onto a MetadataService body, and the code layer', () => {
    const reg = withVendor();
    extend(reg, PATCH);

    const list = reg.getAllObjects().find((o: any) => o.name === OBJ);
    const byName = reg.foldObjectExtendersOnto(OBJ, vendorAccount());
    const code = reg.getArtifactItem<any>('object', OBJ);
    for (const body of [list, byName, code]) {
      expect(industryOf(body).label).toBe('Sector');
      expect(industryOf(body).options[0]).toEqual({ value: 'tech', label: 'Technology' });
    }
    // The fold is idempotent over a body that is already folded (#8027).
    expect(industryOf(reg.foldObjectExtendersOnto(OBJ, reg.getObject(OBJ))).label).toBe('Sector');
  });

  it('does not touch the vendor\'s registered declaration: removing the extender serves the vendor\'s text again', () => {
    const reg = withVendor();
    extend(reg, PATCH);
    expect(industryOf(reg.getObject(OBJ)).label).toBe('Sector');

    reg.unregisterObjectsByPackage(EXT_PKG);

    const served = industryOf(reg.getObject(OBJ));
    expect(served.label).toBe('Industry');
    expect(served.description).toBe('The industry the account belongs to.');
    expect(served.inlineHelpText).toBe('Pick the closest industry.');
    expect(served.placeholder).toBe('Select an industry');
    expect(served.options[0]).toEqual({ value: 'tech', label: 'Tech' });
  });

  it('[ADR-0029 D9.2a] yields to a tenant-authored label and option label, and still applies the keys the tenant left alone', () => {
    const reg = withVendor();
    extend(reg, PATCH);
    const overlay = vendorAccount();
    overlay.fields.industry.label = 'Branche';
    overlay.fields.industry.options[0].label = 'Hightech';
    reg.registerObject({ ...overlay, _provenance: 'org' }, 'sys_metadata', undefined, 'overlay');

    const served = industryOf(reg.getObject(OBJ));
    expect(served.label).toBe('Branche');
    expect(served.options[0]).toEqual({ value: 'tech', label: 'Hightech' });
    // The tenant left these at the vendor's value, so the extension's patch applies.
    expect(served.description).toBe('The market the account sells into.');
    expect(served.placeholder).toBe('Select a sector');
  });

  it('two extenders patching one key: the higher priority wins, whichever registers first', () => {
    for (const order of ['low-first', 'high-first'] as const) {
      const reg = withVendor();
      const low = () => extend(reg, { industry: { label: 'Sector (low)' } }, 'com.acme.low', 210);
      const high = () => extend(reg, { industry: { label: 'Sector (high)' } }, 'com.acme.high', 250);
      if (order === 'low-first') { low(); high(); } else { high(); low(); }
      expect(industryOf(reg.getObject(OBJ)).label).toBe('Sector (high)');
    }
  });

  it('reaches the owner\'s own fields only: a field another extender adds is not patched, at either priority, and is named once', () => {
    for (const [adder, patcher] of [[100, 200], [200, 100]] as const) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const reg = withVendor();
      reg.registerObject(
        { name: OBJ, fields: { region: { name: 'region', type: 'text', label: 'Region' } } } as any,
        'com.acme.region', undefined, 'extend', adder,
      );
      extend(reg, { region: { label: 'Territory' }, industry: { label: 'Sector' } }, EXT_PKG, patcher);

      const served = reg.getObject(OBJ) as any;
      expect(served.fields.region.label, `adder ${adder}, patcher ${patcher}`).toBe('Region');
      // The owner's own field in the same patch still applies.
      expect(industryOf(served).label).toBe('Sector');
      reg.invalidateAll();
      reg.getObject(OBJ);
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('fieldPatches.region'));
      expect(lines, `adder ${adder}, patcher ${patcher}`).toHaveLength(1);
      expect(lines[0]).toContain(EXT_PKG);
      warn.mockRestore();
    }
  });

  it('…and a field the same extension adds in `fields` is not patched either: the extension writes its own field\'s text there', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    reg.registerObject(
      {
        name: OBJ,
        fields: { region: { name: 'region', type: 'text', label: 'Region' } },
        fieldPatches: { region: { label: 'Territory' } },
      } as any,
      EXT_PKG, undefined, 'extend', 200,
    );
    expect((reg.getObject(OBJ) as any).fields.region.label).toBe('Region');
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('fieldPatches.region'))).toHaveLength(1);
  });

  it('judges and patches one spelling: a body with array-spelled `fields` handed to the by-name fold is not patched, and the patch is named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    extend(reg, { industry: { label: 'Sector' } });
    const body = { ...vendorAccount(), fields: Object.values(vendorAccount().fields) };

    const folded = reg.foldObjectExtendersOnto(OBJ, body) as any;
    expect(folded.fields.find((f: any) => f.name === 'industry').label).toBe('Industry');
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('fieldPatches.industry'))).toHaveLength(1);
  });

  it('a patch naming a missing field or option is not applied and is named once in the log — never a boot refusal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    expect(() => extend(reg, {
      no_such_field: { label: 'Ghost' },
      industry: { label: 'Sector', options: { no_such_value: { label: 'Ghost' } } },
    })).not.toThrow();

    const served = reg.getObject(OBJ) as any;
    expect(served.fields.no_such_field).toBeUndefined();
    expect(industryOf(served).label).toBe('Sector');
    expect(industryOf(served).options).toEqual(vendorAccount().fields.industry.options);

    reg.invalidateAll();
    reg.getObject(OBJ);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('fieldPatches'));
    expect(lines.filter((l) => l.includes('no_such_field'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('no_such_value'))).toHaveLength(1);
    expect(lines.every((l) => l.includes(EXT_PKG))).toBe(true);
  });

  it('an extension without a patch folds exactly as before', () => {
    const reg = withVendor();
    reg.registerObject(
      { name: OBJ, label: 'Customer', fields: { tier: { name: 'tier', type: 'text', label: 'Tier' } } } as any,
      EXT_PKG, undefined, 'extend', 200,
    );
    const served = reg.getObject(OBJ) as any;
    expect(served.label).toBe('Customer');
    expect(industryOf(served)).toEqual(vendorAccount().fields.industry);
  });
});

describe('ADR-0146 D10 — the manifest loop carries fieldPatches onto the extension def', () => {
  it('a package\'s objectExtensions entry patches the target through ObjectQL.registerApp', () => {
    const ql = new ObjectQL();
    (ql.registry as SchemaRegistry).logLevel = 'silent';
    ql.registerApp({ id: OWNER_PKG, name: 'CRM', version: '1.0.0', objects: [vendorAccount()] });
    ql.registerApp({
      id: EXT_PKG,
      name: 'CRM display',
      version: '1.0.0',
      objectExtensions: [{ extend: OBJ, fieldPatches: PATCH, priority: 220 }],
    });

    const served = industryOf(ql.registry.getObject(OBJ));
    expect(served.label).toBe('Sector');
    expect(served.options[0]).toEqual({ value: 'tech', label: 'Technology' });
  });
});
