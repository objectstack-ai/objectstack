import { describe, it, expect } from 'vitest';
import { coerceToSafeValue } from './index';

describe('coerceToSafeValue — reference / lookup values', () => {
  // The two JSON-STRING cases that used to live here pinned the shape-based
  // `JSON.parse` branch, which objectui#7246 removed: this helper is reached by
  // every text-like cell, so it may not decide a value's type by looking at its
  // characters (a `code` field holding `{"ok": true}` rendered `[Object]`).
  // Their scenario — objectui#1426's unresolved external-id reference — did not
  // go away; it moved to the reference-TYPED renderer that can actually resolve
  // it, and is pinned as the CONTROL case in
  // `__tests__/textCellJsonText-7246.test.tsx`. Replaced rather than respelled:
  // what they asserted is now the wrong answer at this seam.
  it('returns a JSON-shaped STRING verbatim — shape is not a type', () => {
    expect(coerceToSafeValue('{"externalId":"Website Relaunch"}')).toBe(
      '{"externalId":"Website Relaunch"}',
    );
    expect(coerceToSafeValue('[{"name":"A"},{"externalId":"B"}]')).toBe(
      '[{"name":"A"},{"externalId":"B"}]',
    );
  });

  it('extracts a label from a reference object, name > label > externalId > id', () => {
    expect(coerceToSafeValue({ externalId: 'X' })).toBe('X');
    expect(coerceToSafeValue({ name: 'N', externalId: 'X' })).toBe('N');
    expect(coerceToSafeValue({ label: 'L', externalId: 'X' })).toBe('L');
    expect(coerceToSafeValue({ id: 'id1' })).toBe('id1');
  });

  it('joins a real ARRAY of references into labels', () => {
    // The array case still coerces — an array VALUE (not a string that looks
    // like one) is the shape that actually reaches a cell.
    expect(coerceToSafeValue([{ name: 'A' }, { externalId: 'B' }])).toBe('A, B');
  });

  it('leaves plain strings and non-JSON-looking strings untouched', () => {
    expect(coerceToSafeValue('Website Relaunch')).toBe('Website Relaunch');
    expect(coerceToSafeValue('{not valid json')).toBe('{not valid json');
    expect(coerceToSafeValue('hello')).toBe('hello');
  });

  it('passes through primitives and null/undefined', () => {
    expect(coerceToSafeValue(42)).toBe(42);
    expect(coerceToSafeValue(true)).toBe(true);
    expect(coerceToSafeValue(null)).toBe(null);
    expect(coerceToSafeValue(undefined)).toBe(undefined);
  });
});
