// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit tests for the pure helpers on the export path:
 *
 * - {@link exportContentDisposition} — the download's suggested filename: how
 *   it is named and sanitized, and (#8484) which clock its timestamp reads.
 * - {@link toArgb} (hex → exceljs ARGB) and {@link cellFontColor} (select/radio
 *   option colour for one cell). Both are pure and return `undefined` whenever
 *   a cell should stay unstyled, so the export never emits an invalid workbook.
 * - {@link buildFieldMetaMap} — the presentation-only metadata copy (#6536).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  toArgb,
  cellFontColor,
  exportContentDisposition,
  formatCellValue,
  buildFieldMetaMap,
  type ExportFieldMeta,
} from './export-format';

/**
 * The NAMING half of the header: label selection, sanitization, RFC 5987
 * encoding, zero-padding. Every case here passes `undefined` for the business
 * timezone, so all of them also ride the #8484 process-local fallback path.
 *
 * Their expected stamps did NOT move when #8484 landed, and that is the point
 * rather than an oversight: `NOW` is built from LOCAL calendar components
 * (`new Date(2026, 6, 14, …)`), so the local getters read back the same
 * components under every host zone. Pinning `20260714-153045` is therefore a
 * host-zone-independent statement that "no resolved timezone ⇒ process-local"
 * — the very fallback #8484 preserves. What moved is the ARITY: the timezone
 * now sits between `ext` and the injected clock, so a caller that forgets it
 * gets a type error rather than a silently re-timed filename.
 *
 * These cases cannot, however, tell process-local apart from UTC on a UTC
 * runner (CI's default for this package — `packages/rest` is not in the skewed
 * -zone job). The clock describe below owns that distinction and controls `TZ`
 * itself to make it real.
 */
describe('exportContentDisposition', () => {
  const NOW = new Date(2026, 6, 14, 15, 30, 45); // 2026-07-14 15:30:45 local

  it('uses the localized label in filename* and the API name as ASCII fallback', () => {
    expect(exportContentDisposition('contracts', '合同', 'xlsx', undefined, NOW)).toBe(
      `attachment; filename="contracts-20260714-153045.xlsx"; filename*=UTF-8''${encodeURIComponent('合同-20260714-153045.xlsx')}`,
    );
  });

  it('falls back to the API name when no label is available', () => {
    expect(exportContentDisposition('contracts', undefined, 'csv', undefined, NOW)).toBe(
      `attachment; filename="contracts-20260714-153045.csv"; filename*=UTF-8''contracts-20260714-153045.csv`,
    );
  });

  it('sanitizes hostile characters in both names', () => {
    const header = exportContentDisposition('a/b', '合 同: v2?', 'csv', undefined, NOW);
    expect(header).toContain('filename="a_b-20260714-153045.csv"');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('合 同_ v2-20260714-153045.csv')}`);
  });

  it('percent-encodes RFC 5987 non-attr-chars that encodeURIComponent leaves alone', () => {
    const header = exportContentDisposition('obj', "a'b(c)", 'csv', undefined, NOW);
    expect(header).toContain("filename*=UTF-8''a%27b%28c%29-20260714-153045.csv");
  });

  it('zero-pads date and time parts', () => {
    const early = new Date(2026, 0, 5, 9, 8, 7);
    expect(exportContentDisposition('obj', undefined, 'json', undefined, early)).toContain(
      'filename="obj-20260105-090807.json"',
    );
  });
});

/**
 * The CLOCK half (#8484): which zone the `-YYYYMMDD-HHMMSS` stamp is read in.
 *
 * The defect these pin: after #8373 moved the export's CELLS onto the business
 * timezone, the filename was the last export surface still on the process
 * clock — so a container at `TZ=UTC` serving an Asia/Shanghai tenant downloaded
 * `orders-20260731-220000.csv` whose first row read `2026-08-01 06:00:00`. The
 * name and the contents disagreed by a day, and at a month boundary by a month.
 *
 * ⚠️ The fallback here is the OPPOSITE of the cell path's and must stay that
 * way: no resolved timezone ⇒ **process-local**, never UTC. Each surface keeps
 * its own historical output (the cells were hardcoded UTC; this filename has
 * always been process-local), so "UTC is the safe default" would in fact
 * re-time the filename of every deployment that sets a host `TZ` but resolves
 * no business timezone. The `TZ`-controlled cases below exist so that inversion
 * cannot be quietly reversed later while the suite stays green.
 */
describe("exportContentDisposition — the stamp's clock (#8484)", () => {
  /** 2026-08-01 02:00 UTC = 10:00 in +08, and still 2026-07-31 22:00 in -04. */
  const INSTANT = new Date('2026-08-01T02:00:00Z');

  const stampOf = (header: string) => /filename="orders-([\d-]+)\.csv"/.exec(header)?.[1];

  it('reads the resolved business timezone, not the process clock', () => {
    expect(stampOf(exportContentDisposition('orders', undefined, 'csv', 'Asia/Shanghai', INSTANT)))
      .toBe('20260801-100000');
  });

  it('crosses the day AND month boundary with the zone, like the cells do', () => {
    // The issue's own scenario, mirrored: west of UTC the same instant is still
    // the previous month. A stamp that stayed on the host clock could not move.
    expect(stampOf(exportContentDisposition('orders', undefined, 'csv', 'America/New_York', INSTANT)))
      .toBe('20260731-220000');
  });

  it('agrees with the datetime cells the same export streams', () => {
    // The whole defect was the two surfaces disagreeing, so pin them together
    // rather than trusting each in isolation.
    const tz = 'Asia/Shanghai';
    const cell = formatCellValue(INSTANT.toISOString(), { name: 'created', type: 'datetime' }, tz);
    expect(cell).toBe('2026-08-01 10:00:00');
    expect(stampOf(exportContentDisposition('orders', undefined, 'csv', tz, INSTANT)))
      .toBe('20260801-100000');
  });

  /**
   * The fallback cases own a non-UTC PROCESS zone for their duration.
   *
   * Without that, every assertion below would be vacuously green on a UTC
   * runner — process-local and UTC are the same stamp there, so flipping the
   * fallback to UTC would pass. Mutating `process.env.TZ` is what makes the
   * distinction observable on any host; Node re-reads it per call, so even a
   * `Date` built earlier reports the new zone.
   */
  describe('with a skewed process zone', () => {
    const ORIGINAL_TZ = process.env.TZ;

    beforeEach(() => { process.env.TZ = 'Asia/Shanghai'; });
    afterEach(() => {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    });

    it('actually took the skewed zone (guards every case below from passing vacuously)', () => {
      // The same assert-the-axis-is-real discipline CI applies to its skewed
      // -zone job: if the zone silently failed to take, say so here rather than
      // letting the fallback pins below succeed for the wrong reason.
      expect(INSTANT.getHours()).toBe(10);
    });

    it('⛔ keeps PROCESS-LOCAL when no timezone resolves — does NOT fall back to UTC', () => {
      const stamp = stampOf(exportContentDisposition('orders', undefined, 'csv', undefined, INSTANT));
      expect(stamp).toBe('20260801-100000'); // the host's +08 wall clock
      expect(stamp).not.toBe('20260801-020000'); // what a UTC fallback would emit
    });

    it('keeps process-local when the resolved zone is not one the platform knows', () => {
      // An unresolvable zone is a MISSING zone, not a reason to switch clocks.
      expect(stampOf(exportContentDisposition('orders', undefined, 'csv', 'Not/AZone', INSTANT)))
        .toBe('20260801-100000');
    });

    it('honours an explicitly resolved UTC over the host zone', () => {
      // `'UTC'` is a RESOLVED business timezone, not a missing one — the one
      // case where the stamp is UTC on purpose, and the reason the fallback
      // above cannot simply be spelled as "default to UTC".
      expect(stampOf(exportContentDisposition('orders', undefined, 'csv', 'UTC', INSTANT)))
        .toBe('20260801-020000');
    });
  });
});

describe('toArgb', () => {
  it('expands 3-digit hex to opaque ARGB', () => {
    expect(toArgb('#3ab')).toBe('FF33AABB');
    expect(toArgb('abc')).toBe('FFAABBCC'); // leading # optional
  });

  it('prefixes 6-digit hex with the opaque alpha, upper-cased', () => {
    expect(toArgb('#e11d48')).toBe('FFE11D48');
    expect(toArgb('E11D48')).toBe('FFE11D48');
  });

  it('returns undefined for anything that is not plain hex', () => {
    for (const bad of ['', '  ', '#12', '#12345', '#1234567', 'red', 'rgb(1,2,3)', '#gggggg', null, undefined, 42, {}]) {
      expect(toArgb(bad as unknown)).toBeUndefined();
    }
  });
});

describe('cellFontColor', () => {
  const priority: ExportFieldMeta = {
    name: 'priority', type: 'select', label: '优先级',
    options: [{ label: '高', value: 'high', color: '#e11d48' }, { label: '低', value: 'low', color: '#3ab' }],
  };

  it('resolves the matched select option colour to ARGB', () => {
    expect(cellFontColor('high', priority)).toBe('FFE11D48');
    expect(cellFontColor('low', priority)).toBe('FF33AABB');
  });

  it('works for radio the same as select', () => {
    const radio: ExportFieldMeta = { ...priority, type: 'radio' };
    expect(cellFontColor('high', radio)).toBe('FFE11D48');
  });

  it('returns undefined when the cell should stay unstyled', () => {
    // No/blank value.
    expect(cellFontColor(null, priority)).toBeUndefined();
    expect(cellFontColor(undefined, priority)).toBeUndefined();
    // Value has no matching option.
    expect(cellFontColor('urgent', priority)).toBeUndefined();
    // Matched option carries no colour.
    const noColor: ExportFieldMeta = { name: 'p', type: 'select', options: [{ label: 'X', value: 'x' }] };
    expect(cellFontColor('x', noColor)).toBeUndefined();
    // Non-option field type is never coloured, even with a hex-looking value.
    const text: ExportFieldMeta = { name: 't', type: 'text' };
    expect(cellFontColor('#e11d48', text)).toBeUndefined();
    // Missing metadata entirely.
    expect(cellFontColor('high', undefined)).toBeUndefined();
    // Multiselect is out of scope (ambiguous single font colour for many values).
    const multi: ExportFieldMeta = { ...priority, type: 'multiselect' };
    expect(cellFontColor('high', multi)).toBeUndefined();
  });
});

/**
 * `buildFieldMetaMap` builds PRESENTATION metadata only (#6536).
 *
 * The eight constraint keys (`required` / `system` / `readonly` / `hasDefault` /
 * `min` / `max` / `minLength` / `maxLength`) were retired under ADR-0049 once
 * #4633 ruling D (PR #6532) replaced the import dry run's hand-copied pre-check
 * mirror with `DataProtocol.validateData` — the engine reads the object's own
 * schema, so nothing consulted the copies any more.
 *
 * WHY THE ASSERTION IS AN EXACT KEY SET, and not eight `not.toHaveProperty`
 * calls: a removal is only observable as ABSENCE, and absence has no natural
 * red. Pinning the whole set is what gives this test a direction — restore any
 * retired key to the builder and it goes red on an unexpected key, drop a
 * surviving presentation key and it goes red on a missing one. Written as
 * per-key absence checks it could only ever catch the first of those, and it
 * would stay green against a NINTH constraint key added later, which is exactly
 * the drift ADR-0049 is about.
 *
 * Note these are the keys `buildFieldMetaMap` WRITES, so every one is present
 * on every entry even when its value is `undefined` — the builder assigns each
 * unconditionally rather than omitting it.
 */
describe('buildFieldMetaMap — presentation keys only (#6536)', () => {
  const PRESENTATION_KEYS = [
    'displayField', 'label', 'multiple', 'name', 'options', 'reference', 'type',
  ];

  /** One field declaring every retired constraint key alongside the presentation ones. */
  const FIELD = {
    name: 'amount',
    type: 'number',
    label: '金额',
    reference: 'contracts',
    displayField: 'title',
    multiple: false,
    // The eight retired keys — still legal on a field definition, since the
    // ENGINE reads them off the object schema. They must not travel into the
    // export/import metadata copy.
    required: true,
    system: true,
    readonly: true,
    defaultValue: 0, // the input `hasDefault` used to be derived from
    min: 1,
    max: 99,
    minLength: 2,
    maxLength: 20,
  };

  it('stores exactly the presentation keys — object-map `fields` shape', () => {
    const meta = buildFieldMetaMap({ fields: { amount: FIELD } }).get('amount')!;
    expect(Object.keys(meta).sort()).toEqual(PRESENTATION_KEYS);
  });

  it('stores exactly the presentation keys — array `fields` shape', () => {
    const meta = buildFieldMetaMap({ fields: [FIELD] }).get('amount')!;
    expect(Object.keys(meta).sort()).toEqual(PRESENTATION_KEYS);
  });

  it('still carries the presentation values it is built for', () => {
    const meta = buildFieldMetaMap({ fields: { amount: FIELD } }).get('amount')!;
    expect(meta).toEqual({
      name: 'amount',
      type: 'number',
      label: '金额',
      options: undefined,
      reference: 'contracts',
      displayField: 'title',
      multiple: false,
    });
  });
});
