/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7243 — the one `colorField` ladder gantt / calendar / timeline share.
 *
 * Rungs 1 and 2 live here; the last rung stays with each caller because each
 * has a different right answer for "neither an option colour nor a literal"
 * (gantt derives a semantic hex, calendar hashes onto its class palette,
 * timeline draws its default marker). The renderer-side fixtures pinning that
 * split are `ObjectGantt.colorFieldLadder-7243.test.tsx`,
 * `ObjectCalendar.colorFieldLadder-7243.test.tsx` and
 * `ObjectTimeline.colorFieldLadder-7243.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFieldColorMap,
  createFieldColorResolver,
  isColorLiteral,
} from '../record-color.js';

const STATUS_FIELD = {
  name: 'status',
  type: 'select',
  options: [
    { value: 'open', label: 'Open', color: '#7c3aed' },
    { value: 'done', label: 'Done', color: '#059669' },
    { value: 'archived', label: 'Archived' },
  ],
};

describe('buildFieldColorMap', () => {
  it('keys by the option VALUE only', () => {
    expect(buildFieldColorMap(STATUS_FIELD)).toEqual({ open: '#7c3aed', done: '#059669' });
  });

  it('is empty for a field with no options, and for no field at all', () => {
    expect(buildFieldColorMap({ name: 'accent', type: 'text' } as any)).toEqual({});
    expect(buildFieldColorMap(undefined)).toEqual({});
    expect(buildFieldColorMap(null)).toEqual({});
    expect(buildFieldColorMap({ options: 'nope' } as any)).toEqual({});
  });

  it('skips options with no colour, no value, or a non-string colour', () => {
    expect(
      buildFieldColorMap({
        options: [
          { value: 'a' },
          { value: 'b', color: '' },
          { value: 'c', color: 123 },
          { color: '#fff' },
          null,
          'plain',
          { value: 'd', color: '#fff' },
        ],
      } as any),
    ).toEqual({ d: '#fff' });
  });

  it('stringifies non-string option values so a numeric picklist still resolves', () => {
    expect(buildFieldColorMap({ options: [{ value: 1, color: '#111' }] } as any)).toEqual({
      '1': '#111',
    });
  });
});

describe('isColorLiteral', () => {
  it('accepts 3-, 6- and 8-digit hex', () => {
    expect(isColorLiteral('#abc')).toBe(true);
    expect(isColorLiteral('#AABBCC')).toBe(true);
    // The deliberate widening: `plugin-calendar` already accepted this
    // spelling, `plugin-timeline` did not. The narrow spelling was the only
    // one under which a valid CSS colour could fall through to a DERIVED
    // colour in the gantt.
    expect(isColorLiteral('#aabbccdd')).toBe(true);
  });

  it('accepts rgb() and hsl() forms', () => {
    expect(isColorLiteral('rgb(1, 2, 3)')).toBe(true);
    expect(isColorLiteral('rgba(1, 2, 3, 0.5)')).toBe(true);
    expect(isColorLiteral('hsl(1 2% 3%)')).toBe(true);
  });

  it('rejects stored values that merely look like words', () => {
    expect(isColorLiteral('open')).toBe(false);
    expect(isColorLiteral('in_progress')).toBe(false);
    expect(isColorLiteral('#12')).toBe(false);
    expect(isColorLiteral('#1234567')).toBe(false);
    expect(isColorLiteral('bg-blue-500')).toBe(false);
  });
});

describe('createFieldColorResolver', () => {
  const resolve = createFieldColorResolver(STATUS_FIELD);

  it('rung 1: the value takes its own option colour', () => {
    expect(resolve('open')).toBe('#7c3aed');
    expect(resolve('done')).toBe('#059669');
  });

  it('rung 1 wins over rung 2 — an option colour is never re-derived', () => {
    const r = createFieldColorResolver({ options: [{ value: '#000000', color: '#7c3aed' }] });
    expect(r('#000000')).toBe('#7c3aed');
  });

  it('rung 2: a colour literal in a plain field passes through', () => {
    const r = createFieldColorResolver({ name: 'accent', type: 'text' } as any);
    expect(r('#123456')).toBe('#123456');
    expect(r('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });

  it('returns undefined for a value the field does not colour — the caller owns the last rung', () => {
    // An option with no `color` is exactly as unresolved as an unknown value:
    // both hand the decision back to the caller.
    expect(resolve('archived')).toBeUndefined();
    expect(resolve('nonesuch')).toBeUndefined();
  });

  it('returns undefined for empty values rather than a colour for ""', () => {
    expect(resolve(undefined)).toBeUndefined();
    expect(resolve(null)).toBeUndefined();
    expect(resolve('')).toBeUndefined();
  });

  it('resolves a numeric stored value against a numeric picklist', () => {
    const r = createFieldColorResolver({ options: [{ value: 1, color: '#111' }] });
    expect(r(1)).toBe('#111');
    expect(r('1')).toBe('#111');
  });

  it('works with no field definition at all — literals still resolve, options cannot', () => {
    const r = createFieldColorResolver(undefined);
    expect(r('#abc')).toBe('#abc');
    expect(r('open')).toBeUndefined();
  });
});
