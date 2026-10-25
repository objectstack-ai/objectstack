/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RowColorConfig } from '@object-ui/types';
import { useRowColor } from '../useRowColor';

/**
 * objectui#6295 — `useRowColor` reached two plain object literals with a bare
 * index, and both inherit `Object.prototype`. The two halves fail differently,
 * so they are pinned separately below:
 *
 *   :67  `config.colors[value]`, where `value` comes from RECORD DATA. An
 *        inherited member is a function, `if (!color)` passes it (truthy), and
 *        `colorToClass` calls `.startsWith` on it — a TypeError thrown inside
 *        the row-className resolver during render. LOUD: the grid crashes, and
 *        the trigger is data, not metadata.
 *
 *   :52  `COLOR_TO_CLASS[lower]`, one call deeper, where `lower` comes from the
 *        AUTHORED colour value. This one never threw: it returned the inherited
 *        member, so a function left the resolver as the row's `className` and
 *        reached React as a class attribute. QUIET, and the same defect.
 *
 * Shape mirrors `packages/plugin-detail/src/headerColor.ts` (objectui#6178 /
 * PR objectui#6294), which guarded the analogous lookup one package over.
 */

/** Render the hook and hand back the row-className resolver it produces. */
function resolverFor(config: RowColorConfig) {
  return renderHook(() => useRowColor(config)).result.current;
}

/**
 * The names every plain object literal inherits from `Object.prototype`.
 *
 * All of them reach the `:67` read, which indexes the authored map with the
 * record value VERBATIM.
 */
const INHERITED_MEMBERS: string[] = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__proto__',
];

/**
 * The subset that reaches the `:52` read — and the reason this list is SHORTER
 * than the one above, which is easy to "helpfully" expand back into ghost
 * assertions.
 *
 * `colorToClass` lower-cases before indexing (`color.toLowerCase().trim()`), so
 * `toString` arrives as `tostring`, `valueOf` as `valueof`, and so on — none of
 * which is an inherited member. Only the two names that are ALREADY lower-case
 * survive the transform and actually hit `Object.prototype`. Measured against
 * unmodified `main`: the six camelCase names return `undefined` there too, so
 * asserting them here would assert nothing.
 */
const LOWERCASE_INHERITED_MEMBERS: string[] = ['constructor', '__proto__'];

/**
 * The degenerate control. `open` -> the green tint is the fixture that proves
 * the guard did not simply switch ordinary lookups off; it is asserted first,
 * and it is green both before and after the fix.
 */
const CONTROL_CONFIG: RowColorConfig = {
  field: 'status',
  colors: { open: 'green', closed: 'red', urgent: 'bg-red-200' },
};

describe('useRowColor — ordinary lookups still work (degenerate control)', () => {
  it('resolves an authored colour name to its Tailwind class', () => {
    const resolve = resolverFor(CONTROL_CONFIG);
    // Each name resolves to its tint (objectui#12375); its light half names
    // the colour, so two names give two different classes.
    expect(resolve({ status: 'open' })).toContain('[--os-row-tint:var(--color-green-100)]');
    expect(resolve({ status: 'closed' })).toContain('[--os-row-tint:var(--color-red-100)]');
  });

  it('passes a value that is already a bg-* class through untouched', () => {
    expect(resolverFor(CONTROL_CONFIG)({ status: 'urgent' })).toBe('bg-red-200');
  });

  it('returns undefined for a value the author did not declare', () => {
    expect(resolverFor(CONTROL_CONFIG)({ status: 'archived' })).toBeUndefined();
  });
});

describe('useRowColor — record data naming an Object.prototype member (:67, the loud half)', () => {
  it('does not throw when a record colour field holds `constructor`', () => {
    // The exact chain the card reproduced. Before the fix this threw
    // `TypeError: color.startsWith is not a function`.
    const resolve = resolverFor(CONTROL_CONFIG);
    expect(() => resolve({ status: 'constructor' })).not.toThrow();
    expect(resolve({ status: 'constructor' })).toBeUndefined();
  });

  it.each(INHERITED_MEMBERS)('resolves to undefined for a record value of %s', (member) => {
    expect(resolverFor(CONTROL_CONFIG)({ status: member })).toBeUndefined();
  });

  it('is inert even when the author declared no colours at all', () => {
    // The authored map does not have to mention the value for the crash: the
    // inherited member is found whether or not anything was declared.
    const resolve = resolverFor({ field: 'status', colors: {} });
    for (const member of INHERITED_MEMBERS) {
      expect(() => resolve({ status: member })).not.toThrow();
      expect(resolve({ status: member })).toBeUndefined();
    }
  });
});

describe('useRowColor — COLOR_TO_CLASS cannot emit an inherited member (:52, the quiet half)', () => {
  it.each(LOWERCASE_INHERITED_MEMBERS)(
    'returns undefined when the authored colour value is %s',
    (member) => {
      const resolve = resolverFor({ field: 'status', colors: { open: member } });
      expect(resolve({ status: 'open' })).toBeUndefined();
    },
  );

  it('never hands back a non-string as the row className', () => {
    // The property that matters at the call site: `getRowClassName(row)` feeds
    // `rowClassName` in ObjectGrid, so anything but a string or undefined is a
    // class attribute React should never have been handed.
    for (const member of LOWERCASE_INHERITED_MEMBERS) {
      const cls = resolverFor({ field: 'status', colors: { open: member } })({ status: 'open' });
      expect(cls === undefined || typeof cls === 'string').toBe(true);
      expect(typeof cls).not.toBe('function');
    }
  });
});
