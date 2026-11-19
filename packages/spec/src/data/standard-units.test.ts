// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  ORGANIZATION_UNIT_CODE_PATTERN,
  STANDARD_UNITS,
  UNIT_DIMENSIONS,
  UNIT_DIMENSION_BASE_CODES,
  type StandardUnit,
} from './standard-units';
import { ValueDomainSchema } from '../shared/value-domain.zod';

/**
 * ADR-0158 U1, U2 and U3's namespace, with the membership its Open item 1
 * settles. The table is closed, so its membership is pinned by name: a code
 * added or dropped is an amendment of the ADR, and this list moves with it.
 */
const has = (code: string): boolean => Object.prototype.hasOwnProperty.call(STANDARD_UNITS, code);
const orgCode = new RegExp(ORGANIZATION_UNIT_CODE_PATTERN);

describe('STANDARD_UNITS — the closed standard unit table (ADR-0158 U1)', () => {
  it('holds exactly the settled membership, per dimension', () => {
    const byDimension: Record<string, string[]> = {};
    for (const [code, unit] of Object.entries(STANDARD_UNITS)) (byDimension[unit.dimension] ??= []).push(code);
    for (const codes of Object.values(byDimension)) codes.sort();
    expect(byDimension).toEqual({
      mass: ['GRM', 'KGM', 'LBR', 'MGM', 'ONZ', 'TNE'],
      length: ['CMT', 'FOT', 'INH', 'KMT', 'MMT', 'MTR', 'YRD'],
      area: ['CMK', 'FTK', 'MMK', 'MTK'],
      volume: ['GLL', 'LTR', 'MLT', 'MTQ'],
      time: ['DAY', 'HUR', 'MIN', 'SEC', 'WEE'],
      count: ['DZN', 'H87', 'PR'],
      package: ['XBE', 'XBG', 'XBO', 'XBX', 'XCR', 'XCS', 'XCT', 'XDR', 'XPK', 'XPX', 'XRO', 'XSA'],
    });
    expect(Object.keys(STANDARD_UNITS)).toHaveLength(41);
  });

  it('admits the piece as H87 and refuses its near-synonyms C62 and EA (U2)', () => {
    expect(STANDARD_UNITS.H87).toEqual({ dimension: 'count', ratio: '1' });
    expect(has('C62')).toBe(false);
    expect(has('EA')).toBe(false);
  });

  it('leaves out the deprecated hectare and the inexact month and year', () => {
    for (const code of ['HAR', 'MON', 'ANN']) expect(has(code), code).toBe(false);
  });

  it('is closed: a lowercase spelling, an unknown code and an inherited name are not members', () => {
    for (const code of ['kgm', 'Kgm', 'ZZZ', 'constructor', 'toString', '__proto__']) expect(has(code), code).toBe(false);
    expect(Object.isFrozen(STANDARD_UNITS)).toBe(true);
  });

  it('keys every code in exact uppercase, at most three letters or digits (the Recommendation 20 code shape)', () => {
    for (const code of Object.keys(STANDARD_UNITS)) expect(code, code).toMatch(/^[A-Z0-9]{2,3}$/);
  });

  it('is not a value domain: the 2026-09-02 vocabulary keeps its three members', () => {
    expect([...ValueDomainSchema.options].sort()).toEqual(['iana_time_zone', 'iso_3166_alpha2', 'iso_4217_currency']);
  });
});

describe('dimensions and ratios (ADR-0158 Open item 1)', () => {
  const ratioDimensions = UNIT_DIMENSIONS.filter((d) => d !== 'package');

  it('names seven dimensions, and a base unit for each but package', () => {
    expect([...UNIT_DIMENSIONS]).toEqual(['mass', 'length', 'area', 'volume', 'time', 'count', 'package']);
    expect(Object.keys(UNIT_DIMENSION_BASE_CODES).sort()).toEqual([...ratioDimensions].sort());
    expect(UNIT_DIMENSION_BASE_CODES).toEqual({
      mass: 'KGM', length: 'MTR', area: 'MTK', volume: 'MTQ', time: 'SEC', count: 'H87',
    });
  });

  it('gives every base unit its own dimension and the ratio 1', () => {
    for (const [dimension, code] of Object.entries(UNIT_DIMENSION_BASE_CODES)) {
      expect(STANDARD_UNITS[code], code).toEqual({ dimension, ratio: '1' });
    }
  });

  it('carries a ratio on every ratio dimension and none on a package code', () => {
    for (const [code, unit] of Object.entries(STANDARD_UNITS) as Array<[string, StandardUnit & { ratio?: unknown }]>) {
      if (unit.dimension === 'package') {
        expect(code, code).toMatch(/^X/);
        expect('ratio' in unit, code).toBe(false);
      } else {
        expect(typeof unit.ratio, code).toBe('string');
      }
    }
  });

  it('spells every ratio as a positive decimal string, at most 12 places, no trailing zero — never a float', () => {
    for (const [code, unit] of Object.entries(STANDARD_UNITS)) {
      if (unit.dimension === 'package') continue;
      expect(unit.ratio, code).toMatch(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{0,11}[1-9])?$/);
      expect(Number(unit.ratio) > 0, code).toBe(true);
    }
  });

  it('holds the exact definitions where Recommendation 20 prints a rounded factor', () => {
    // 1/16 of the 1959 pound, and 231 cubic inches of the 1959 inch, by exact
    // decimal arithmetic. Recommendation 20 prints 2.834 952 × 10⁻² kg and
    // 3.785 412 × 10⁻³ m³.
    expect(STANDARD_UNITS.LBR).toEqual({ dimension: 'mass', ratio: '0.45359237' });
    expect(STANDARD_UNITS.ONZ).toEqual({ dimension: 'mass', ratio: '0.028349523125' });
    expect(STANDARD_UNITS.INH).toEqual({ dimension: 'length', ratio: '0.0254' });
    expect(STANDARD_UNITS.GLL).toEqual({ dimension: 'volume', ratio: '0.003785411784' });
  });
});

describe('ORGANIZATION_UNIT_CODE_PATTERN — the organization code namespace (ADR-0158 U3)', () => {
  it('admits a code of at least four characters, or one containing an underscore', () => {
    for (const code of ['BOX12', 'JIN1', 'BAG_25KG', 'A_B', 'AB_', 'A_', 'P_1', '1234', 'X'.repeat(32)]) {
      expect(orgCode.test(code), code).toBe(true);
    }
  });

  it('refuses a short code with no underscore, a lowercase or spaced code, and an over-long one', () => {
    for (const code of ['KGM', 'XBX', 'AB', 'A', '', 'jin1', 'Box12', 'BAG 25', 'BAG-25', '_ABC', '__', 'X'.repeat(33)]) {
      expect(orgCode.test(code), code).toBe(false);
    }
  });

  it('can never match a standard code, so an organization code never collides with one', () => {
    for (const code of Object.keys(STANDARD_UNITS)) expect(orgCode.test(code), code).toBe(false);
  });
});
