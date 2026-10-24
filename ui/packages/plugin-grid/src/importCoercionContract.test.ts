/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Gates on the Import Wizard's mirror of the server's import-coercion
 * contract (`import-coerce.ts` in the framework) — objectui#3017.
 *
 * `REFERENCE_IMPORT_TYPES` is derived from the same spec constant the server
 * derives from, so the two ends share one source. The boolean token table has
 * no spec export yet (objectstack#4173), so it cannot be derived — the pinned
 * inventory below is the tripwire that makes edits deliberate instead of
 * silent. When the spec starts publishing the table, replace the local sets
 * with the import and delete the inventory.
 */

import { describe, it, expect } from 'vitest';
import { REFERENCE_VALUE_TYPES } from '@objectstack/spec/data';
import {
  BOOLEAN_FALSE_IMPORT_TOKENS,
  BOOLEAN_IMPORT_TOKENS,
  BOOLEAN_TRUE_IMPORT_TOKENS,
  IMPORT_TEMPORAL_YEARS,
  REFERENCE_IMPORT_TYPES,
  isIdentityEmail,
  isImportableDateCell,
  isImportableTimeCell,
  isRecordEmail,
} from './importCoercionContract';

describe('BOOLEAN_IMPORT_TOKENS (server BOOL_TRUE/BOOL_FALSE mirror)', () => {
  it('pins the token inventory — edits must be checked against the server table', () => {
    // Deliberate second statement: if this fails you edited the wizard's
    // boolean vocabulary. Verify the server's BOOL_TRUE/BOOL_FALSE in
    // import-coerce.ts accepts the same tokens before re-pinning, or the
    // preview will flag cells the server takes (or wave through cells it
    // rejects as `invalid_boolean`).
    expect([...BOOLEAN_TRUE_IMPORT_TOKENS].sort()).toEqual(
      ['true', 't', 'yes', 'y', '1', 'on', '是', '对', '✓', '√'].sort(),
    );
    expect([...BOOLEAN_FALSE_IMPORT_TOKENS].sort()).toEqual(
      ['false', 'f', 'no', 'n', '0', 'off', '否', '错', '✗', '×'].sort(),
    );
  });

  it('true and false tokens are disjoint — one token, one verdict', () => {
    for (const token of BOOLEAN_TRUE_IMPORT_TOKENS) {
      expect(BOOLEAN_FALSE_IMPORT_TOKENS.has(token), `'${token}' is both truthy and falsy`).toBe(false);
    }
  });

  it('every token survives the lookup normalization (trim + lowercase)', () => {
    // validateValue checks `value.trim().toLowerCase()` against the set — a
    // token stored with case or whitespace could never match anything.
    for (const token of BOOLEAN_IMPORT_TOKENS) {
      expect(token, `'${token}' is not trim/lowercase-normalized`).toBe(token.trim().toLowerCase());
      expect(token.length).toBeGreaterThan(0);
    }
  });

  it('the combined set is exactly the union of the two verdict sets', () => {
    expect(BOOLEAN_IMPORT_TOKENS.size).toBe(
      BOOLEAN_TRUE_IMPORT_TOKENS.size + BOOLEAN_FALSE_IMPORT_TOKENS.size,
    );
    for (const token of [...BOOLEAN_TRUE_IMPORT_TOKENS, ...BOOLEAN_FALSE_IMPORT_TOKENS]) {
      expect(BOOLEAN_IMPORT_TOKENS.has(token)).toBe(true);
    }
  });
});

describe('REFERENCE_IMPORT_TYPES (derived from spec REFERENCE_VALUE_TYPES)', () => {
  it('is spec plus the generic reference alias, nothing else', () => {
    for (const type of REFERENCE_VALUE_TYPES) {
      expect(REFERENCE_IMPORT_TYPES.has(type)).toBe(true);
    }
    expect(REFERENCE_IMPORT_TYPES.has('reference')).toBe(true);
    // Also implies 'reference' ∉ REFERENCE_VALUE_TYPES today — if the spec
    // starts including it, this fails so the local alias can be retired.
    expect(REFERENCE_IMPORT_TYPES.size).toBe(REFERENCE_VALUE_TYPES.size + 1);
  });

  it('is not vacuous — the types the legacy-fallback refusal exists for are still covered', () => {
    // The per-row create fallback stores raw cell text verbatim; if a member
    // vanished from the spec set, the wizard would silently stop refusing to
    // fall back for that type and corrupt relation fields. Fail loudly and
    // make the vocabulary change a deliberate review.
    for (const type of ['lookup', 'master_detail', 'user', 'tree', 'reference']) {
      expect(REFERENCE_IMPORT_TYPES.has(type), `'${type}' no longer covered — spec vocabulary moved?`).toBe(true);
    }
  });
});

describe('isImportableDateCell (server parseDateCell mirror, objectui#11889)', () => {
  // The grammar lives in `@objectstack/core`'s `import-coerce.ts`
  // (`readIsoTemporalCell`, `readYearFirstCell`) and the years in its
  // `SUPPORTED_TEMPORAL_YEARS`; the spec publishes neither, so these
  // inventories are the tripwire. If one fails you changed what the preview
  // takes: check `parseDateCell` and the engine's write validation take the
  // same cells before re-pinning, or the import button miscounts.

  it('pins the supported years', () => {
    expect(IMPORT_TEMPORAL_YEARS).toEqual({
      date: { first: 1, last: 9999 },
      datetime: { first: 1000, last: 9999 },
    });
  });

  it('takes the ISO 8601 shapes, the export shape and the year-first date', () => {
    const taken = [
      '2026-07-15', ' 2026-07-15 ', '2024-02-29', '2026-07-15T10:00', '2026-07-15T10:00:30.250',
      '2026-07-15 10:00', '2026-07-15 10:00:30', '2026-07-15T10:00:00Z', '2026-07-15T10:00+08:00',
      '2026-07-15T10:00+0800', '2026-07-15T24:00Z', '2026/7/15', '2026/07/15', '2026-7-15',
      '2026/7/15 9:00', '2026/08/01 06:00:00', '2026-07-15 9:00',
    ];
    for (const cell of taken) {
      expect(isImportableDateCell(cell, 'date'), `date ${cell}`).toBe(true);
      expect(isImportableDateCell(cell, 'datetime'), `datetime ${cell}`).toBe(true);
    }
  });

  it('refuses a locale or prose spelling, an impossible day or clock, and a misplaced zone', () => {
    const refused = [
      '07/15/2026', 'July 15, 2026', '1/2/26', '15 July 2026', '15/07/2026', '26/7/15', '2026', '20260715', 'abc',
      '2026-02-29', '2026-02-30', '2026-04-31', '2026/2/30', '2026-13-01', '2026-07-15 24:00', '2026-07-15T23:60',
      '2026-07-15T24:01Z', '2026-07-15T24:00:00.5Z', '2026-07-15T10:00+24:00', '2026-07-15T10:00+08:60',
      '2026-07-15 10:00Z', '2026-07-15t10:00z', '2026/7-15', '2026/7/15T9:00', '2026/7/15 9:00Z', '+010000-01-01',
    ];
    for (const cell of refused) {
      expect(isImportableDateCell(cell, 'date'), `date ${cell}`).toBe(false);
      expect(isImportableDateCell(cell, 'datetime'), `datetime ${cell}`).toBe(false);
    }
  });

  it('refuses a year outside the kind\'s supported years, reading a zoned cell in UTC', () => {
    expect(isImportableDateCell('0500-07-15', 'date')).toBe(true);
    expect(isImportableDateCell('0500-07-15', 'datetime')).toBe(false);
    expect(isImportableDateCell('0000-06-15', 'date')).toBe(false);
    expect(isImportableDateCell('1000-01-01', 'datetime')).toBe(true);
    expect(isImportableDateCell('1000-01-01T00:00:00+08:00', 'datetime')).toBe(false);
    expect(isImportableDateCell('9999-12-31T23:59:59-01:00', 'date')).toBe(false);
    expect(isImportableDateCell('9999-12-31', 'datetime')).toBe(true);
  });

  it('reads a zoned ISO cell exactly where the V8 Date.parse the server runs on reads one', () => {
    // The mirror computes the instant with the UTC setters so that a browser's
    // own date parser does not decide the verdict. The tests run on Node, the
    // server's engine, so this keeps that arithmetic honest.
    const clocks = ['00:00', '10:00:30', '10:00:30.250', '23:59:59', '23:60', '23:59:60', '24:00', '24:00:00.000', '24:00:00.001', '25:00'];
    const zones = ['Z', '+08:00', '+0800', '-01:00', '+23:59', '+24:00', '+08:60', '-00:00'];
    for (const clock of clocks) {
      for (const zone of zones) {
        const cell = `2026-07-15T${clock}${zone}`;
        expect(isImportableDateCell(cell, 'datetime'), cell).toBe(!Number.isNaN(Date.parse(cell)));
      }
    }
  });
});

describe('isImportableTimeCell (server parseDateCell time mirror, objectui#11913)', () => {
  // `parseDateCell(cell, 'time')` in `@objectstack/core`'s `import-coerce.ts`
  // asks `readTimeOfDayCell` (core's comparand rule: the spec's
  // `ClockTimeValueSchema`, or an ISO day or instant), then `readYearFirstCell`.
  // Core is not a dependency of this package, so these inventories are the
  // tripwire. Each verdict below was read from core 17.7.0's `parseDateCell`.
  // If one fails you changed what the preview takes: check that function takes
  // the same cells before re-pinning, or the import button miscounts.

  it('takes a wall clock, an ISO day or instant, and the year-first form', () => {
    const taken = [
      '10:00', ' 10:00 ', '00:00', '23:59', '09:30:15', '23:59:59.5', '10:00:00.123456', '2026-07-15', '0000-06-15',
      '2026-07-15T10:00', '2026-07-15T10:00:00Z', '2026-07-15T10:00+08:00', '2026-07-15T10:00+0800', '2026-07-15 10:00',
      '2026-07-15 24:00', '2026-07-15T24:00Z', '2026/7/15', '2026-7-15 9:00', '2026/08/01 06:00:00',
    ];
    for (const cell of taken) expect(isImportableTimeCell(cell), cell).toBe(true);
  });

  it('refuses the card cells, a clock the spec does not read, and an instant with no four-digit UTC year', () => {
    const refused = [
      '25:00', 'abc', '10:00Z', '9am', '9:00', '24:00', '23:60', '10:00+08:00', '10:00 AM', '10.00', '1000', '{now}',
      '2026-07-15 10:00Z', '2026/7/15 24:00', '2026/7/15T9:00', '2026-02-30', '07/15/2026', '2026-07-15T24:01Z',
      '9999-12-31T24:00Z', '+010000-01-01T10:00:00Z', '0000-01-01T00:30:00+01:00',
    ];
    for (const cell of refused) expect(isImportableTimeCell(cell), cell).toBe(false);
  });

  it('reads an ISO instant exactly where the V8 Date.parse the server runs on reads one', () => {
    // A `T` cell with a zone is parsed as written, and one without a zone with
    // a `Z` appended (core's `readsAsInstant`). Its time survives only when the
    // instant's UTC year has four digits (`keepsTimeOfDay`).
    const clocks = ['00:00', '10:00:30.250', '23:59:59', '23:60', '24:00', '24:00:00.001', '25:00'];
    const zones = ['', 'Z', '+08:00', '+0800', '-01:00', '+24:00'];
    for (const day of ['2026-07-15', '0000-01-01', '9999-12-31']) {
      for (const clock of clocks) {
        for (const zone of zones) {
          const cell = `${day}T${clock}${zone}`;
          const ms = Date.parse(zone === '' ? `${cell}Z` : cell);
          const year = Number.isNaN(ms) ? undefined : new Date(ms).getUTCFullYear();
          expect(isImportableTimeCell(cell), cell).toBe(year !== undefined && year >= 0 && year <= 9999);
        }
      }
    }
  });
});

describe('isIdentityEmail (user import endpoint mirror, objectui#11913)', () => {
  // `resolveRowIdentity` in plugin-auth's `admin-import-users.ts` refuses a row
  // with `INVALID_EMAIL` unless `isLikelyEmail` takes its trimmed email cell,
  // and when `isPlaceholderEmail` does. Neither is published to this package,
  // so this inventory is the tripwire. If it fails, check the 17.7.0 functions
  // take the same cells before re-pinning.

  it('takes a plain ASCII address', () => {
    for (const email of ['ada@example.com', 'a@b.co', 'first.last+tag@sub.example.org', `${'a'.repeat(249)}@x.co`]) {
      expect(isIdentityEmail(email), email).toBe(true);
    }
  });

  it('refuses a non-ASCII or placeholder address, a malformed one, and one past 254 characters', () => {
    const refused = [
      '735431496@柴仟.com', 'é@x.com', 'u-abc@placeholder.invalid', 'U-ABC@Placeholder.Invalid',
      'a@b', 'a@b.', 'a@.b', '@b.c', 'a@', 'a@@b.c', 'a b@c.d', `${'a'.repeat(250)}@x.co`,
    ];
    for (const email of refused) expect(isIdentityEmail(email), email).toBe(false);
  });

  it('is not a stricter record rule: each takes an address the other refuses', () => {
    // So the preview reads an identity email column by this rule INSTEAD of
    // `isRecordEmail`; asking both would mark `a@b..c`, which the endpoint takes.
    expect(isIdentityEmail('a@b..c')).toBe(true);
    expect(isRecordEmail('a@b..c')).toBe(false);
    expect(isIdentityEmail('735431496@柴仟.com')).toBe(false);
    expect(isRecordEmail('735431496@柴仟.com')).toBe(true);
  });
});
