// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0158 U4, L3; Open item 8, ruled A] `unitConfig` — which unit a
 * quantity is in, or that a `text` field holds a unit code.
 *
 * Three doors, one per half, the way `currencyConfig` is judged
 * (`currency-config-record-mode.test.ts`):
 *
 *  - `UnitConfigSchema` judges one config: `unitMode` is required with no
 *    default; `fixed` takes exactly one standard code (U1, exact uppercase),
 *    `record` a one-field pointer and an optional `unitDimension`, `code` (the
 *    standalone marker of Open item 8) an optional `unitDimension`; every
 *    other key is refused, the L3 alias rows answering with the canonical key;
 *  - `FieldSchema` judges which field type carries which mode: `fixed` and
 *    `record` on a `number`, `code` on a `text`, nothing on any other type
 *    (a `formula` or `summary` has no unit reader yet, U8);
 *  - `ObjectSchema` judges what a `record` pointer names: another declared
 *    `text` field, one segment, carrying no marker of its own, and two
 *    quantities sharing it declare one `unitDimension`.
 *
 * `standardUnitOf` (N4) is the one membership lookup: own keys, exact case.
 *
 * Key-vs-value: a refusal is asserted as a full `safeParse` failure at the
 * located path, and every control as a full `safeParse` success.
 */

import { describe, expect, it } from 'vitest';
import { FieldSchema, UnitConfigSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { STANDARD_UNITS, standardUnitOf } from './standard-units';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };

function issuesOf(r: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  return r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message, keys: i.keys }));
}

/** Where each issue points: its path, and for a refused key the key under it (`unrecognized_keys`). */
function locations(issues: Issue[]): PropertyKey[][] {
  return issues.flatMap((i) => (i.code === 'unrecognized_keys' ? (i.keys ?? []).map((k) => [...i.path, k]) : [i.path]));
}

const quantity = (unitConfig: unknown, over: Record<string, unknown> = {}) =>
  ({ name: 'weight', label: 'Weight', type: 'number', unitConfig, ...over });

function material(fields: Record<string, unknown>): Record<string, unknown> {
  return { name: 'material', label: 'Material', fields };
}

const UOM = { type: 'text', label: 'Unit' } as const;
const RECORD = { unitMode: 'record', unitField: 'uom' } as const;

describe('`standardUnitOf`: the one membership lookup of the standard unit table (N4)', () => {
  it('answers a standard code with its entry', () => {
    expect(standardUnitOf('KGM')).toEqual({ dimension: 'mass', ratio: '1' });
    expect(standardUnitOf('H87')).toEqual({ dimension: 'count', ratio: '1' });
    expect(standardUnitOf('XBX')).toEqual({ dimension: 'package' });
  });

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'an inherited name `%s` is never a member',
    (name) => {
      // A naive `in` lookup would admit it: the table is a plain object.
      expect(name in STANDARD_UNITS).toBe(true);
      expect(standardUnitOf(name)).toBeUndefined();
    },
  );

  it.each(['kgm', ' KGM', 'KGM ', 'C62', 'EA', 'HAR', 'BOX_12', '', 5, null, undefined])(
    '`%s` is not a member: exact uppercase, U2 and active codes only, strings only',
    (code) => {
      expect(standardUnitOf(code)).toBeUndefined();
    },
  );

  it('a `fixed` unit admits exactly the codes the lookup admits', () => {
    for (const code of Object.keys(STANDARD_UNITS)) {
      expect(UnitConfigSchema.safeParse({ unitMode: 'fixed', unit: code }).success, code).toBe(true);
    }
    for (const code of ['toString', 'kgm', 'C62', 'BOX_12']) {
      expect(UnitConfigSchema.safeParse({ unitMode: 'fixed', unit: code }).success, code).toBe(false);
    }
  });
});

describe('`UnitConfigSchema`: one config', () => {
  it('parses `fixed` with a standard code, `record` with a pointer and a dimension, `code` alone', () => {
    expect(UnitConfigSchema.safeParse({ unitMode: 'fixed', unit: 'KGM' }).success).toBe(true);
    expect(UnitConfigSchema.safeParse({ unitMode: 'record', unitField: 'uom' }).success).toBe(true);
    expect(UnitConfigSchema.safeParse({ unitMode: 'record', unitField: 'uom', unitDimension: 'mass' }).success).toBe(true);
    expect(UnitConfigSchema.safeParse({ unitMode: 'code' }).success).toBe(true);
    expect(UnitConfigSchema.safeParse({ unitMode: 'code', unitDimension: 'package' }).success).toBe(true);
  });

  it('refuses a config with no `unitMode`: no default, the platform does not guess a unit', () => {
    const issues = issuesOf(UnitConfigSchema.safeParse({ unit: 'KGM' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['unitMode']);
    expect(issues[0]!.message).toContain('unitMode');
  });

  it.each([
    [{ unitMode: 'fixed' }, ['unit']],
    [{ unitMode: 'fixed', unit: 'kgm' }, ['unit']],
    [{ unitMode: 'fixed', unit: 'BOX_12' }, ['unit']],
    [{ unitMode: 'fixed', unit: 'KGM', unitField: 'uom' }, ['unitField']],
    [{ unitMode: 'fixed', unit: 'KGM', unitDimension: 'mass' }, ['unitDimension']],
    [{ unitMode: 'record' }, ['unitField']],
    [{ unitMode: 'record', unitField: '' }, ['unitField']],
    [{ unitMode: 'record', unitField: 'uom', unit: 'KGM' }, ['unit']],
    [{ unitMode: 'record', unitField: 'uom', unitDimension: 'weight' }, ['unitDimension']],
    [{ unitMode: 'code', unit: 'KGM' }, ['unit']],
    [{ unitMode: 'code', unitField: 'uom' }, ['unitField']],
  ])('refuses %j at %j (L3 cross-refusals)', (config, path) => {
    const issues = issuesOf(UnitConfigSchema.safeParse(config));
    expect(issues.length).toBeGreaterThan(0);
    expect(locations(issues)).toContainEqual(path);
  });

  it('a lower-case standard code is refused with its exact spelling named, never folded', () => {
    const [issue] = issuesOf(UnitConfigSchema.safeParse({ unitMode: 'fixed', unit: 'kgm' }));
    expect(issue!.message).toContain("'KGM'");
  });

  it('`C62` and `EA` are refused naming the piece, `H87` (U2)', () => {
    for (const unit of ['C62', 'EA']) {
      const [issue] = issuesOf(UnitConfigSchema.safeParse({ unitMode: 'fixed', unit }));
      expect(issue!.path).toEqual(['unit']);
      expect(issue!.message).toContain('H87');
    }
  });

  it.each([
    [{ unitMode: 'fixed', defaultUnit: 'KGM' }, 'defaultUnit', 'unit'],
    [{ unitMode: 'fixed', uom: 'KGM' }, 'uom', 'unit'],
    [{ unitMode: 'fixed', unitCode: 'KGM' }, 'unitCode', 'unit'],
    [{ unitMode: 'record', field: 'uom' }, 'field', 'unitField'],
    [{ unitMode: 'record', codeField: 'uom' }, 'codeField', 'unitField'],
    [{ unitMode: 'record', unitField: 'uom', dimension: 'mass' }, 'dimension', 'unitDimension'],
  ])('the L3 alias row answers %j with the canonical key (`%s` → `%s`), never accepting the alias', (config, alias, canonical) => {
    const issues = issuesOf(UnitConfigSchema.safeParse(config));
    const hit = issues.find((i) => i.path[i.path.length - 1] === alias || i.message.includes(`\`${alias}\``));
    expect(hit, JSON.stringify(issues)).toBeDefined();
    expect(hit!.message).toContain(canonical);
  });

  it('`mode` is answered with `unitMode`', () => {
    const issues = issuesOf(UnitConfigSchema.safeParse({ mode: 'fixed', unit: 'KGM' }));
    expect(issues.some((i) => i.message.includes('unitMode'))).toBe(true);
  });
});

describe('`FieldSchema`: which type carries which mode', () => {
  it('`fixed` and `record` parse on a `number`; `code` parses on a `text`', () => {
    expect(FieldSchema.safeParse(quantity({ unitMode: 'fixed', unit: 'KGM' })).success).toBe(true);
    expect(FieldSchema.safeParse(quantity(RECORD)).success).toBe(true);
    expect(FieldSchema.safeParse({ name: 'base_uom', label: 'Base unit', type: 'text', unitConfig: { unitMode: 'code' } }).success).toBe(true);
  });

  it('a `number` declaring `unitConfig` needs no `scale` (Open item 6, first half)', () => {
    const r = FieldSchema.safeParse(quantity({ unitMode: 'fixed', unit: 'KGM' }));
    expect(r.success).toBe(true);
    expect(FieldSchema.safeParse(quantity({ unitMode: 'fixed', unit: 'KGM' }, { scale: 3 })).success).toBe(true);
  });

  it('refuses `code` on a `number`, at `unitConfig.unitMode`', () => {
    const issues = issuesOf(FieldSchema.safeParse(quantity({ unitMode: 'code' })));
    expect(issues.map((i) => i.path)).toEqual([['unitConfig', 'unitMode']]);
  });

  it.each(['fixed', 'record'] as const)('refuses `%s` on a `text`, at `unitConfig.unitMode`', (unitMode) => {
    const config = unitMode === 'fixed' ? { unitMode, unit: 'KGM' } : { unitMode, unitField: 'uom' };
    const issues = issuesOf(FieldSchema.safeParse({ name: 'uom', label: 'Unit', type: 'text', unitConfig: config }));
    expect(issues.map((i) => i.path)).toEqual([['unitConfig', 'unitMode']]);
  });

  it.each([
    { type: 'currency' },
    { type: 'formula', expression: 'a * 2' },
    { type: 'select', options: [{ label: 'A', value: 'a' }] },
    { type: 'boolean' },
  ])('refuses `unitConfig` on a `%j` field, at `unitConfig`: nothing reads it there', (over) => {
    const issues = issuesOf(FieldSchema.safeParse({ name: 'f', label: 'F', ...over, unitConfig: { unitMode: 'fixed', unit: 'KGM' } }));
    expect(issues.map((i) => i.path)).toContainEqual(['unitConfig']);
  });

  it('refuses a unit code field that also declares a `valueDomain`: two vocabularies for one column, not an empty one', () => {
    const issues = issuesOf(FieldSchema.safeParse({
      name: 'uom', label: 'Unit', type: 'text', valueDomain: 'iso_4217_currency', unitConfig: { unitMode: 'code' },
    }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['unitConfig']]]);
    expect(issues[0]!.message).toContain("`valueDomain: 'iso_4217_currency'`, another vocabulary. One column holds one kind of code");
    // The two lists are not disjoint (`MMK` is a standard unit and an ISO 4217 code), so the refusal never says
    // that nothing satisfies both.
    expect(standardUnitOf('MMK')).toBeDefined();
    expect(issues[0]!.message).not.toContain('no value could satisfy both');
  });

  it.each(['unit', 'uom', 'unitCode', 'dimension'])('a bare `%s` key on the field is refused with guidance', (key) => {
    const issues = issuesOf(FieldSchema.safeParse({ name: 'weight', label: 'Weight', type: 'number', [key]: 'KGM' }));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.message.includes('unitConfig') || i.message.includes('dimensions'))).toBe(true);
  });
});

describe('`ObjectSchema`: what a `record` pointer names', () => {
  it('parses a quantity pointing at a declared `text` sibling, and two quantities sharing it with one dimension', () => {
    const r = ObjectSchema.safeParse(material({
      uom: UOM,
      weight: { type: 'number', unitConfig: { ...RECORD, unitDimension: 'mass' } },
      tare: { type: 'number', unitConfig: { ...RECORD, unitDimension: 'mass' } },
      gross: { type: 'number', unitConfig: RECORD },
      base_uom: { type: 'text', unitConfig: { unitMode: 'code', unitDimension: 'count' } },
    }));
    expect(issuesOf(r)).toEqual([]);
  });

  it.each([
    ['names no declared field', { weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'unit_code' } } }],
    ['names itself', { weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'weight' } } }],
    ['names a non-text field', { uom: { type: 'lookup', reference: 'unit' }, weight: { type: 'number', unitConfig: RECORD } }],
    ['is a path: a child cannot follow its parent\'s unit yet', {
      header: { type: 'master_detail', reference: 'order' },
      weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'header.uom' } },
    }],
    ['names a field carrying its own marker: the pointer is the declaration', {
      uom: { type: 'text', unitConfig: { unitMode: 'code' } },
      weight: { type: 'number', unitConfig: RECORD },
    }],
  ])('refuses a pointer that %s, at `fields.weight.unitConfig.unitField`', (_why, fields) => {
    const issues = issuesOf(ObjectSchema.safeParse(material(fields)));
    expect(issues.map((i) => i.path)).toContainEqual(['fields', 'weight', 'unitConfig', 'unitField']);
  });

  it.each(['iso_4217_currency', 'iso_3166_alpha2', 'iana_time_zone'])(
    'refuses a pointer into a `text` field that declares `valueDomain: %s`, at `fields.weight.unitConfig.unitField`, and offers no such field as a candidate',
    (valueDomain) => {
      const r = ObjectSchema.safeParse(material({
        uom: UOM,
        cur: { type: 'text', label: 'Currency', valueDomain },
        weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'cur' } },
      }));
      expect(r.success).toBe(false);
      const issues = issuesOf(r);
      expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['fields', 'weight', 'unitConfig', 'unitField']]]);
      expect(issues[0]!.message).toContain(`\`weight.unitConfig.unitField\` names \`cur\`, a \`text\` field that declares \`valueDomain: '${valueDomain}'\`, another vocabulary`);
      expect(issues[0]!.message).toContain('A field a quantity points at carries no marker of its own');
      expect(issues[0]!.message).toContain('candidates: `uom`.');
      // The control: the same quantity pointed at the plain `text` sibling parses.
      expect(issuesOf(ObjectSchema.safeParse(material({
        uom: UOM,
        cur: { type: 'text', label: 'Currency', valueDomain },
        weight: { type: 'number', unitConfig: RECORD },
      })))).toEqual([]);
    },
  );

  it('the path refusal says the parent path is reserved, and a lookup pointer is refused as no text field', () => {
    const [path] = issuesOf(ObjectSchema.safeParse(material({
      header: { type: 'master_detail', reference: 'order' },
      weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'header.uom' } },
    })));
    expect(path!.message).toContain("cannot follow its parent's unit yet");
  });

  it('refuses two quantities sharing one unit field with different dimensions, at the second one\'s `unitDimension`', () => {
    const issues = issuesOf(ObjectSchema.safeParse(material({
      uom: UOM,
      weight: { type: 'number', unitConfig: { ...RECORD, unitDimension: 'mass' } },
      length: { type: 'number', unitConfig: { ...RECORD, unitDimension: 'length' } },
    })));
    expect(issues.map((i) => i.path)).toEqual([['fields', 'length', 'unitConfig', 'unitDimension']]);
    expect(issues[0]!.message).toContain('`weight`');
  });
});
