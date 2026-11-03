// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28858, ADR-0146 D10] An `extend` that `getObject` folds to a legacy
 * `<ns>__<name>` key never opens a second object entry.
 *
 * A vendor package still ships its Case under the legacy key `crm__case`
 * (the published `ObjectSchema` accepts the name), so `getObject('case')`
 * folds to it. A second package extends it as `extend: 'case'`. The
 * extension is filed under the key the object is registered under, its field
 * lands on the vendor's object, no owner-less `case` entry opens beside it,
 * and the spelling is named once at `warn`. Never a boot refusal (AGENTS.md
 * *Startup registry reads*). The `object_extension` item door still refuses
 * the folded spelling at save (#28853, pinned in `@objectstack/runtime`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { ObjectQL } from './engine.js';

const VENDOR = 'com.vendor.crm';
const EXT = 'com.acme.case-region';
const LEGACY_KEY = 'crm__case';
const SHORT = 'case';

const vendorCase = () => ({
  name: LEGACY_KEY,
  label: 'Case',
  fields: { subject: { name: 'subject', type: 'text', label: 'Subject' } },
});

const region = { region: { name: 'region', type: 'text', label: 'Region' } };

function registry(): SchemaRegistry {
  const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  reg.logLevel = 'silent';
  return reg;
}

const spellingLines = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`'${LEGACY_KEY}'`) && l.includes(EXT));

afterEach(() => vi.restoreAllMocks());

describe('#28858 — an extension whose `extend` folds to a legacy key lands on the object it folds to', () => {
  it('a manifest objectExtensions entry: the field is on the vendor\'s object, no second entry opens, named once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ql = new ObjectQL();
    (ql.registry as SchemaRegistry).logLevel = 'silent';
    ql.registerApp({ id: VENDOR, name: 'CRM', version: '1.0.0', objects: [vendorCase()] });
    ql.registerApp({
      id: EXT, name: 'Case region', version: '1.0.0',
      objectExtensions: [{ extend: SHORT, fields: region }],
    });

    const reg = ql.registry as SchemaRegistry;
    expect(Object.keys((reg.getObject(LEGACY_KEY) as any).fields)).toEqual(expect.arrayContaining(['subject', 'region']));
    expect(reg.getObjectContributors(SHORT)).toEqual([]);
    expect(reg.getObjectContributors(LEGACY_KEY).map((c) => [c.packageId, c.ownership]))
      .toEqual([[VENDOR, 'own'], [EXT, 'extend']]);
    expect(reg.getAllObjects().map((o) => o.name).filter((n) => n === SHORT || n === LEGACY_KEY)).toEqual([LEGACY_KEY]);
    // The short name still reads the one object, with the field.
    expect(Object.keys((reg.getObject(SHORT) as any).fields)).toContain('region');

    // Re-reading and re-registering name it no more than once.
    reg.invalidateAll();
    reg.getObject(LEGACY_KEY);
    ql.registerApp({ id: EXT, name: 'Case region', version: '1.0.0', objectExtensions: [{ extend: SHORT, fields: region }] });
    const lines = spellingLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`'${SHORT}'`);
  });

  it('registerObjectExtension (the stored row\'s verb) files under the resolved key and answers it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = registry();
    reg.registerObject(vendorCase() as any, VENDOR, undefined, 'own');

    const filed = reg.registerObjectExtension({ extend: SHORT, fields: region, _provenance: 'org' }, EXT);

    expect(filed).toBe(LEGACY_KEY);
    expect(reg.getObjectContributors(SHORT)).toEqual([]);
    expect(Object.keys((reg.getObject(LEGACY_KEY) as any).fields)).toContain('region');
    expect(spellingLines(warn)).toHaveLength(1);
    // The withdrawal the row delete makes reaches the same entry.
    expect(reg.withdrawObjectExtension(SHORT, EXT)).toBe(true);
    expect(Object.keys((reg.getObject(LEGACY_KEY) as any).fields)).not.toContain('region');
  });

  it('control: an extension spelled with the registered key registers as before, with no warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = registry();
    reg.registerObject(vendorCase() as any, VENDOR, undefined, 'own');

    expect(reg.registerObjectExtension({ extend: LEGACY_KEY, fields: region }, EXT)).toBe(LEGACY_KEY);
    expect(Object.keys((reg.getObject(LEGACY_KEY) as any).fields)).toContain('region');
    expect(reg.getObjectContributors(SHORT)).toEqual([]);
    expect(spellingLines(warn)).toEqual([]);
  });

  it('control: an object registered under the exact name keeps its extensions, even beside a legacy key that shares the short name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = registry();
    reg.registerObject(vendorCase() as any, VENDOR, undefined, 'own');
    reg.registerObject({ name: SHORT, label: 'Support case', fields: { title: { name: 'title', type: 'text', label: 'Title' } } } as any, 'com.other.support', undefined, 'own');

    expect(reg.registerObjectExtension({ extend: SHORT, fields: region }, EXT)).toBe(SHORT);
    expect(reg.getObjectContributors(SHORT).map((c) => c.ownership)).toEqual(['own', 'extend']);
    expect(Object.keys((reg.getObject(LEGACY_KEY) as any).fields)).not.toContain('region');
    expect(spellingLines(warn)).toEqual([]);
  });
});
