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
import { fieldPatchTargetRefusals } from '@objectstack/metadata-core';

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

describe('#28809 — an option patch is judged against the owner\'s declared options, at the fold as at the doors', () => {
  const TAKEOVER_PKG = 'com.acme.industry-takeover';

  /**
   * `crm_account.industry` taken over through `fields`: the owner's two
   * options, the second relabelled, plus `finance`, which the owner does not
   * declare — or, with `dropRetail`, the owner's `tech` alone.
   */
  const takenOverIndustry = ({ dropRetail = false } = {}) => ({
    ...vendorAccount().fields.industry,
    options: dropRetail
      ? [{ value: 'tech', label: 'Tech' }]
      : [
        { value: 'tech', label: 'Tech' },
        { value: 'retail', label: 'Retail stores' },
        { value: 'finance', label: 'Finance' },
      ],
  });

  function takeOver(reg: SchemaRegistry, priority: number, opts: { dropRetail?: boolean } = {}): void {
    reg.registerObject(
      { name: OBJ, fields: { industry: takenOverIndustry(opts) } } as any,
      TAKEOVER_PKG, undefined, 'extend', priority,
    );
  }

  /**
   * What the install door (`getObjectOwner(name).definition`) and `os validate`
   * (the composed stack's declared object) both ask: the one judge, against the
   * owner's declaration. The fold must answer the same.
   */
  const doorRefusals = (reg: SchemaRegistry, objectExtensions: unknown[]) =>
    fieldPatchTargetRefusals(objectExtensions, (name) => reg.getObjectOwner(name)?.definition).map((r) => r.path);

  const optionLabel = (body: any, value: string) =>
    industryOf(body).options.find((o: any) => o.value === value)?.label;

  const patchLines = (warn: ReturnType<typeof vi.spyOn>, needle: string) =>
    warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(needle));

  it('another extension adds an option by redeclaring the owner field: a patch of that option is not applied, and is named once — as the door and os validate refuse it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    takeOver(reg, 100);
    const patch = { industry: { options: { finance: { label: 'Banking' } } } };
    extend(reg, patch, EXT_PKG, 200);

    expect(doorRefusals(reg, [{ extend: OBJ, fieldPatches: patch }]))
      .toEqual(['objectExtensions[0].fieldPatches.industry.options.finance']);
    const served = reg.getObject(OBJ) as any;
    // The takeover itself still serves: the option exists, with its own label.
    expect(optionLabel(served, 'finance')).toBe('Finance');
    reg.invalidateAll();
    reg.getObject(OBJ);
    const lines = patchLines(warn, 'fieldPatches.industry.options.finance');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(EXT_PKG);
  });

  it('…and the same extension redeclaring the field and patching its added option is not applied either, and is named once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    const entry = {
      fields: { industry: takenOverIndustry() },
      fieldPatches: { industry: { options: { finance: { label: 'Banking' } } } },
    };
    reg.registerObject({ name: OBJ, ...entry } as any, EXT_PKG, undefined, 'extend', 200);

    expect(doorRefusals(reg, [{ extend: OBJ, ...entry }]))
      .toEqual(['objectExtensions[0].fieldPatches.industry.options.finance']);
    expect(optionLabel(reg.getObject(OBJ), 'finance')).toBe('Finance');
    expect(patchLines(warn, 'fieldPatches.industry.options.finance')).toHaveLength(1);
  });

  it('control: the patcher folded BEFORE the redeclaring extension (lower priority) — not applied and named, as on main', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    takeOver(reg, 200);
    extend(reg, { industry: { options: { finance: { label: 'Banking' } } } }, EXT_PKG, 100);

    expect(optionLabel(reg.getObject(OBJ), 'finance')).toBe('Finance');
    expect(patchLines(warn, 'fieldPatches.industry.options.finance')).toHaveLength(1);
  });

  it('control: a patch of an option the owner declares still applies onto the redeclared field, and nothing is named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    takeOver(reg, 100);
    const patch = { industry: { label: 'Sector', options: { tech: { label: 'Technology' }, retail: { label: 'Shops' } } } };
    extend(reg, patch, EXT_PKG, 200);

    expect(doorRefusals(reg, [{ extend: OBJ, fieldPatches: patch }])).toEqual([]);
    const served = reg.getObject(OBJ) as any;
    expect(industryOf(served).label).toBe('Sector');
    expect(optionLabel(served, 'tech')).toBe('Technology');
    expect(optionLabel(served, 'retail')).toBe('Shops');
    expect(optionLabel(served, 'finance')).toBe('Finance');
    expect(patchLines(warn, 'fieldPatches')).toEqual([]);
  });

  it('residual, pinned as measured: an owner option an earlier extension\'s redeclaration dropped — the judge admits the patch, the fold has no such option to relabel, nothing is applied and nothing is named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = withVendor();
    takeOver(reg, 100, { dropRetail: true });
    const patch = { industry: { label: 'Sector', options: { retail: { label: 'Shops' } } } };
    extend(reg, patch, EXT_PKG, 200);

    // The door and os validate admit it: `retail` is in the owner's declaration.
    expect(doorRefusals(reg, [{ extend: OBJ, fieldPatches: patch }])).toEqual([]);
    const served = reg.getObject(OBJ) as any;
    // The takeover's options are served as the takeover declares them; the
    // patch's field key still applies.
    expect(industryOf(served).options).toEqual([{ value: 'tech', label: 'Tech' }]);
    expect(industryOf(served).label).toBe('Sector');
    reg.invalidateAll();
    reg.getObject(OBJ);
    expect(patchLines(warn, 'fieldPatches')).toEqual([]);
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
