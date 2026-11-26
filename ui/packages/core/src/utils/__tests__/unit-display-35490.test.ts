/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35490 (ADR-0158 R1 display): which unit a quantity is in and
 * what it displays as, resolved once for every face.
 */

import { describe, it, expect } from 'vitest';
import {
  declaresQuantityUnit,
  pickRowForOrganization,
  quantityUnitCode,
  quantityUnitReadField,
  resolveQuantityUnit,
  shownQuantityUnitReads,
  declaresUnitCode,
  quantityUnitCodePointers,
  unitPickerOptions,
  withUnitCodePointer,
} from '../unit-display';

const FIXED = { type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } };
const RECORD = { type: 'number', unitConfig: { unitMode: 'record', unitField: 'unit_code' } };
const CODE = { type: 'text', unitConfig: { unitMode: 'code' } };

describe('quantityUnitCode — which code a value is in', () => {
  it('reads a fixed unit from the field, whatever the record', () => {
    expect(quantityUnitCode(FIXED, { unit_code: 'GRM' })).toBe('KGM');
    expect(quantityUnitCode(FIXED)).toBe('KGM');
  });

  it("reads a record-mode unit from the record's unit field, exactly as stored", () => {
    expect(quantityUnitCode(RECORD, { unit_code: 'BOX_12' })).toBe('BOX_12');
    expect(quantityUnitCode(RECORD, { unit_code: 'kgm' })).toBe('kgm');
  });

  it('answers none for a blank code, or a caller with no record', () => {
    expect(quantityUnitCode(RECORD, { unit_code: '' })).toBeUndefined();
    expect(quantityUnitCode(RECORD, { unit_code: '  ' })).toBeUndefined();
    expect(quantityUnitCode(RECORD, { unit_code: null })).toBeUndefined();
    expect(quantityUnitCode(RECORD)).toBeUndefined();
  });

  it("reads a unit-code field's own value (Open item 8)", () => {
    expect(quantityUnitCode(CODE, {}, 'H87')).toBe('H87');
  });

  it('answers none for a field with no unit, or a declaration on another type', () => {
    expect(quantityUnitCode({ type: 'number' }, { unit_code: 'KGM' })).toBeUndefined();
    expect(quantityUnitCode({ type: 'currency', unitConfig: { unitMode: 'fixed', unit: 'KGM' } })).toBeUndefined();
    expect(quantityUnitCode({ type: 'text', unitConfig: { unitMode: 'fixed', unit: 'KGM' } })).toBeUndefined();
  });

  it('names the sibling a projection must fetch, under record mode only', () => {
    expect(quantityUnitReadField(RECORD)).toBe('unit_code');
    expect(quantityUnitReadField(FIXED)).toBeUndefined();
    expect(quantityUnitReadField(CODE)).toBeUndefined();
    expect(declaresQuantityUnit(FIXED) && declaresQuantityUnit(RECORD) && declaresQuantityUnit(CODE)).toBe(true);
    expect(declaresQuantityUnit({ type: 'number' })).toBe(false);
  });
});

describe("pickRowForOrganization — the record's organization's row, never the first one returned", () => {
  const rows = [
    { code: 'KGM', decimal_places: 3, organization_id: 'org_a' },
    { code: 'KGM', decimal_places: 0, organization_id: 'org_b' },
  ];

  it("picks the record's organization under the group posture, wherever its row sits", () => {
    expect(pickRowForOrganization(rows, 'KGM', { organization_id: 'org_b' })?.decimal_places).toBe(0);
    expect(pickRowForOrganization(rows, 'KGM', { organization_id: 'org_a' })?.decimal_places).toBe(3);
    expect(pickRowForOrganization([...rows].reverse(), 'KGM', { organization_id: 'org_a' })?.decimal_places).toBe(3);
  });

  it("answers none for an organization with no row, rather than another organization's", () => {
    expect(pickRowForOrganization(rows, 'KGM', { organization_id: 'org_c' })).toBeUndefined();
  });

  it('answers none when the organization is unknown and two organizations have a row', () => {
    expect(pickRowForOrganization(rows, 'KGM', {})).toBeUndefined();
    expect(pickRowForOrganization(rows, 'KGM')).toBeUndefined();
  });

  it('answers the only row when the organization is unknown (the isolated posture reads one)', () => {
    expect(pickRowForOrganization([rows[0]], 'KGM', {})?.decimal_places).toBe(3);
  });

  it('matches a record and a row that both carry no organization (the single posture)', () => {
    const single = [{ code: 'KGM', decimal_places: 2, organization_id: null }];
    expect(pickRowForOrganization(single, 'KGM', { organization_id: null })?.decimal_places).toBe(2);
    expect(pickRowForOrganization(single, 'KGM', { organization_id: 'org_a' })).toBeUndefined();
  });
});

describe('resolveQuantityUnit — label and decimal places, in the order of lookup', () => {
  const catalog = {
    organizationUnits: [
      { code: 'BOX_12', label: 'Box of 12', decimal_places: 0, retired: false, organization_id: 'org_a' },
      { code: 'JIN1', label: 'Jin', decimal_places: 2, retired: true, organization_id: 'org_a' },
    ],
    standardUnitSettings: [{ code: 'GRM', decimal_places: 3, organization_id: 'org_a' }],
  };
  const rec = { organization_id: 'org_a' };

  it("gives a standard code the platform label and its organization's setting", () => {
    expect(resolveQuantityUnit('GRM', catalog, rec, 'g')).toEqual({ code: 'GRM', standard: true, label: 'g', decimals: 3 });
  });

  it('gives a standard code with no setting no decimal places of its own', () => {
    expect(resolveQuantityUnit('KGM', catalog, rec, 'kg')).toEqual({ code: 'KGM', standard: true, label: 'kg' });
  });

  it("gives an organization code its own row's label and decimal places", () => {
    expect(resolveQuantityUnit('BOX_12', catalog, rec)).toEqual({ code: 'BOX_12', standard: false, label: 'Box of 12', decimals: 0 });
  });

  it('shows a deleted (retired) organization unit as the bare code (L1)', () => {
    expect(resolveQuantityUnit('JIN1', catalog, rec)).toEqual({ code: 'JIN1', standard: false });
  });

  it('shows an organization unit the reader cannot read as the bare code (an external member)', () => {
    const { organizationUnits: _withheld, ...unread } = catalog;
    expect(resolveQuantityUnit('BOX_12', unread, rec)).toEqual({ code: 'BOX_12', standard: false });
  });

  it("does not take another organization's unit row", () => {
    expect(resolveQuantityUnit('BOX_12', catalog, { organization_id: 'org_b' })).toEqual({ code: 'BOX_12', standard: false });
  });

  it('ignores a decimal-places value outside 0..12', () => {
    const odd = { standardUnitSettings: [{ code: 'GRM', decimal_places: 13, organization_id: 'org_a' }] };
    expect(resolveQuantityUnit('GRM', odd, rec, 'g')).toEqual({ code: 'GRM', standard: true, label: 'g' });
  });
});

describe('shownQuantityUnitReads — what a projection fetches for shown quantity columns', () => {
  const fields = { qty: RECORD, weight: FIXED, unit_code: { type: 'text' }, name: { type: 'text' } };

  it("asks for a record-mode quantity's code field and the row's organization", () => {
    expect(shownQuantityUnitReads(['name', 'qty'], fields)).toEqual(['unit_code', 'organization_id']);
  });

  it('asks for the organization alone for a fixed-unit quantity', () => {
    expect(shownQuantityUnitReads([{ field: 'weight' }], fields)).toEqual(['organization_id']);
  });

  it('asks for nothing when no shown column draws a unit, or the quantity is hidden', () => {
    expect(shownQuantityUnitReads(['name'], fields)).toEqual([]);
    expect(shownQuantityUnitReads([{ field: 'qty', hidden: true }], fields)).toEqual([]);
  });
});

describe('the unit picker (ADR-0158 Open item 8, objectstack#37471)', () => {
  const catalog = {
    organizationUnits: [
      { code: 'BOX_12', label: 'Box of 12', dimension: 'package', retired: false, organization_id: 'org_a' },
      { code: 'JIN1', label: 'Jin', dimension: 'mass', retired: false, organization_id: 'org_a' },
      { code: 'OLD1', label: 'Old', dimension: 'mass', retired: true, organization_id: 'org_a' },
      { code: 'BAG_B', label: 'Bag', dimension: 'package', retired: false, organization_id: 'org_b' },
    ],
  };
  const names: Record<string, string> = { KGM: 'kilogram', GRM: 'gram' };
  const label = (code: string) => names[code];

  it("offers the record's organization's non-retired units first, then every standard code, storing codes", () => {
    const options = unitPickerOptions(catalog, { organization_id: 'org_a' }, label);
    const own = options.filter((o) => !o.standard).map((o) => `${o.code}=${o.label}`);
    expect(own).toEqual(['BOX_12=Box of 12', 'JIN1=Jin']);
    expect(options.findIndex((o) => o.standard)).toBe(2);
    expect(options).toContainEqual({ code: 'KGM', label: 'kilogram', standard: true });
    // A standard code with no name in the reader's language shows its code.
    expect(options).toContainEqual({ code: 'H87', label: 'H87', standard: true });
  });

  it("restricts every unit to the field's unitDimension", () => {
    const options = unitPickerOptions(catalog, { organization_id: 'org_a' }, label, { unitMode: 'code', unitDimension: 'mass' });
    expect(options.filter((o) => !o.standard).map((o) => o.code)).toEqual(['JIN1']);
    expect(options.map((o) => o.code)).toContain('GRM');
    expect(options.map((o) => o.code)).not.toContain('H87');
  });

  it('offers every readable organization unit when the record names no organization', () => {
    expect(unitPickerOptions(catalog, {}, label).filter((o) => !o.standard).map((o) => o.code)).toEqual(['BOX_12', 'JIN1', 'BAG_B']);
  });

  it("names the unit field a record-mode quantity points at, with the quantity's dimension", () => {
    const pointers = quantityUnitCodePointers([
      { name: 'qty', type: 'number', unitConfig: { unitMode: 'record', unitField: 'unit_code', unitDimension: 'mass' } },
      { name: 'w', type: 'number', unitConfig: { unitMode: 'record', unitField: 'w_unit' } },
      { name: 'kg', type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
    ]);
    expect([...pointers]).toEqual([['unit_code', { unitDimension: 'mass' }], ['w_unit', {}]]);
  });

  it('stamps the pointer on a copy, and never over a declared unitConfig', () => {
    const field = { name: 'unit_code', type: 'text' };
    const stamped = withUnitCodePointer(field, { unitDimension: 'mass' });
    expect(stamped).toEqual({ name: 'unit_code', type: 'text', unitConfig: { unitMode: 'code', unitDimension: 'mass' } });
    expect(field).not.toHaveProperty('unitConfig');
    expect(declaresUnitCode(stamped)).toBe(true);
    const declared = { type: 'text', unitConfig: { unitMode: 'code' } };
    expect(withUnitCodePointer(declared, { unitDimension: 'mass' })).toBe(declared);
    expect(withUnitCodePointer(field, undefined)).toBe(field);
  });
});
