// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The standard unit table — ADR-0158 U1 and U2, membership settled by its
 * Open item 1.
 *
 * A closed, checked-in table of UN/ECE Recommendation 20 common codes. Each
 * code carries its DIMENSION and its RATIO to that dimension's base unit;
 * package codes (Recommendation 21, admitted through the Recommendation 20
 * annex with the `X` prefix) carry the `package` dimension and no ratio. The
 * table is three things at once (U1): the build-time oracle for a fixed-unit
 * field, the source of truth for standard codes, and a pure conversion table.
 *
 * It is a separate table, the way `CURRENCY_FRACTION_DIGITS` is
 * (`./currency-fraction-digits.ts`), and NOT a member of `ValueDomainSchema`:
 * the value-domain vocabulary of 2026-09-02 stays closed (U1). Organization
 * units live in the `sys_unit` object (U3), never here, and an organization
 * code cannot collide with a code of this table: see
 * {@link ORGANIZATION_UNIT_CODE_PATTERN}.
 *
 * ## The ratio, as arithmetic
 *
 * `1 CODE = ratio × BASE`, where BASE is {@link UNIT_DIMENSION_BASE_CODES} of
 * the code's dimension. So GRM's ratio `0.001` says 1 gram = 0.001 kilogram,
 * and a quantity in grams is converted to the base unit by MULTIPLYING it by
 * the ratio. A base code's own ratio is `1`.
 *
 * Every ratio is a decimal STRING with at most 12 places and no trailing
 * zero, never a JavaScript number: a float cannot hold 0.45359237 or
 * 0.028349523125 exactly, and U7 R2 rules ratios "decimal, scale 12, never
 * float". Every ratio below is exact by definition; none is rounded.
 *
 * ## Membership (ADR-0158 Open item 1)
 *
 * Seven dimensions, kept small on purpose: mass, length, area, volume and
 * time (the coherent SI units are their bases), count (base: piece, `H87`,
 * U2) and package. A code earns its place by being one an order line, a
 * bill of material or a delivery note actually writes; the table widens by an
 * amendment of ADR-0158, never by a reader's convenience.
 *
 * - **U2.** The piece is `H87`. Its near-synonyms `C62` ("one") and `EA`
 *   ("each") are NOT members, and no row may add them back.
 * - **Active codes only.** No code whose Recommendation 20 status is `D`
 *   (deprecated) or `X` (deleted). Hectare (`HAR`) is the one common code
 *   this excludes: Recommendation 20 marks it deprecated.
 * - **Exact ratios only.** Month (`MON`) and year (`ANN`) are left out:
 *   Recommendation 20 defines them through a 365.25-day year, which no
 *   calendar month or year equals, so a ratio would convert a quantity to a
 *   number nobody means. A quantity in months stays an organization unit or
 *   a package-like count until a ruling says otherwise.
 * - **Affine units** such as degrees Celsius are not members (U7 R2 excludes
 *   them from ratio conversion).
 *
 * ## Sources, per ratio
 *
 * | Source | Codes |
 * |:---|:---|
 * | SI prefixes (SI Brochure, 9th edition, 2019, Table 7) | GRM, MGM, MMT, CMT, KMT, CMK, MMK, MLT |
 * | Units accepted for use with the SI (SI Brochure, 9th edition, Table 8) | TNE, LTR, MIN, HUR, DAY |
 * | International yard and pound (1959): yard = 0.9144 m, pound = 0.45359237 kg | LBR, INH (1/36 yd), FOT (1/3 yd), YRD, FTK (1 ft²), ONZ (1/16 lb) |
 * | United States gallon = 231 cubic inches | GLL |
 * | Recommendation 20's own factor | WEE (7 days), PR (2), DZN (12) |
 *
 * Where Recommendation 20 prints a ROUNDED factor, the exact definition wins
 * and is what the table holds: ONZ (Rec 20: 2.834 952 × 10⁻² kg; exact:
 * 0.028349523125) and GLL (Rec 20: 3.785 412 × 10⁻³ m³; exact:
 * 0.003785411784). Every other factor here equals Recommendation 20's.
 *
 * ## Provenance — read, not recalled
 *
 * Codes, names, statuses and factors were read on 2026-11-19 from the
 * Recommendation 20 annex as published in the `datasets/unece-units-of-measure`
 * mirror (data package version 17.0, `data/units-of-measure.csv`, its
 * `Status` and `ConversionFactor` columns), and the package codes from the
 * Peppol BIS Billing 3.0 code list `UNECERec20` ("Recommendation 20, including
 * Recommendation 21 codes - prefixed with X", Revision 11e). Each package code
 * below carries the Recommendation 21 name in its comment.
 */

/**
 * The closed dimension vocabulary of the standard unit table (ADR-0158 Open
 * item 1). `package` is the dimension of the Recommendation 21 package codes,
 * which take no ratio; every other dimension has a base unit
 * ({@link UNIT_DIMENSION_BASE_CODES}).
 */
export const UNIT_DIMENSIONS = ['mass', 'length', 'area', 'volume', 'time', 'count', 'package'] as const;

/** One of {@link UNIT_DIMENSIONS}. */
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

/** A dimension whose units convert by ratio: every dimension but `package`. */
export type RatioUnitDimension = Exclude<UnitDimension, 'package'>;

/**
 * The base unit of each ratio dimension: the code whose ratio is `1`, and the
 * unit a ratio converts into (`1 CODE = ratio × BASE`). The five measured
 * dimensions take the coherent SI unit; count takes the piece (U2).
 */
export const UNIT_DIMENSION_BASE_CODES: Readonly<Record<RatioUnitDimension, string>> = Object.freeze({
  mass: 'KGM',
  length: 'MTR',
  area: 'MTK',
  volume: 'MTQ',
  time: 'SEC',
  count: 'H87',
});

/**
 * One entry of {@link STANDARD_UNITS}: a ratio dimension with its ratio to the
 * dimension's base unit (a decimal string, at most 12 places), or the
 * `package` dimension with no ratio.
 */
export type StandardUnit =
  | { readonly dimension: RatioUnitDimension; readonly ratio: string }
  | { readonly dimension: 'package' };

/**
 * The standard unit table (ADR-0158 U1, U2; membership: Open item 1). Keyed
 * by the Recommendation 20 common code, in exact uppercase. Closed: a code
 * absent here is not a standard unit (an organization adds its own through
 * `sys_unit`, U3).
 */
export const STANDARD_UNITS: Readonly<Record<string, StandardUnit>> = Object.freeze({
  // Mass. Base: kilogram.
  KGM: { dimension: 'mass', ratio: '1' }, // kilogram
  GRM: { dimension: 'mass', ratio: '0.001' }, // gram
  MGM: { dimension: 'mass', ratio: '0.000001' }, // milligram
  TNE: { dimension: 'mass', ratio: '1000' }, // tonne (metric ton)
  LBR: { dimension: 'mass', ratio: '0.45359237' }, // pound
  ONZ: { dimension: 'mass', ratio: '0.028349523125' }, // ounce (avoirdupois)

  // Length. Base: metre.
  MTR: { dimension: 'length', ratio: '1' }, // metre
  MMT: { dimension: 'length', ratio: '0.001' }, // millimetre
  CMT: { dimension: 'length', ratio: '0.01' }, // centimetre
  KMT: { dimension: 'length', ratio: '1000' }, // kilometre
  INH: { dimension: 'length', ratio: '0.0254' }, // inch
  FOT: { dimension: 'length', ratio: '0.3048' }, // foot
  YRD: { dimension: 'length', ratio: '0.9144' }, // yard

  // Area. Base: square metre.
  MTK: { dimension: 'area', ratio: '1' }, // square metre
  CMK: { dimension: 'area', ratio: '0.0001' }, // square centimetre
  MMK: { dimension: 'area', ratio: '0.000001' }, // square millimetre
  FTK: { dimension: 'area', ratio: '0.09290304' }, // square foot

  // Volume. Base: cubic metre.
  MTQ: { dimension: 'volume', ratio: '1' }, // cubic metre
  LTR: { dimension: 'volume', ratio: '0.001' }, // litre
  MLT: { dimension: 'volume', ratio: '0.000001' }, // millilitre
  GLL: { dimension: 'volume', ratio: '0.003785411784' }, // gallon (US)

  // Time. Base: second.
  SEC: { dimension: 'time', ratio: '1' }, // second
  MIN: { dimension: 'time', ratio: '60' }, // minute
  HUR: { dimension: 'time', ratio: '3600' }, // hour
  DAY: { dimension: 'time', ratio: '86400' }, // day
  WEE: { dimension: 'time', ratio: '604800' }, // week

  // Count. Base: piece (U2).
  H87: { dimension: 'count', ratio: '1' }, // piece
  PR: { dimension: 'count', ratio: '2' }, // pair
  DZN: { dimension: 'count', ratio: '12' }, // dozen

  // Package (Recommendation 21 through the Recommendation 20 annex). No ratio:
  // how many pieces a box holds is the item's, read by R2 through a
  // suite-supplied factor (U7 R2), never the code's.
  XBG: { dimension: 'package' }, // Bag
  XBE: { dimension: 'package' }, // Bundle
  XBO: { dimension: 'package' }, // Bottle, non-protected, cylindrical
  XBX: { dimension: 'package' }, // Box
  XCT: { dimension: 'package' }, // Carton
  XCS: { dimension: 'package' }, // Case
  XCR: { dimension: 'package' }, // Crate
  XDR: { dimension: 'package' }, // Drum
  XPK: { dimension: 'package' }, // Package
  XPX: { dimension: 'package' }, // Pallet
  XRO: { dimension: 'package' }, // Roll
  XSA: { dimension: 'package' }, // Sack
});

/**
 * The organization unit code namespace (ADR-0158 U3), as a regular-expression
 * source: uppercase letters, digits and underscores, starting with a letter or
 * a digit, at most 32 characters, and EITHER at least 4 characters long OR
 * containing an underscore.
 *
 * Every Recommendation 20 common code is at most three letters and digits with
 * no underscore, so no standard code, in this table or added to it later, can
 * match: an organization code never collides with one. `sys_unit` refuses a
 * code outside this pattern on every write.
 */
export const ORGANIZATION_UNIT_CODE_PATTERN =
  '^(?:[A-Z0-9][A-Z0-9_]{3,31}|[A-Z0-9](?:_[A-Z0-9_]?|[A-Z0-9]_))$';
