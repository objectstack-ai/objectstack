// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26886 — the mark on options resolved from a shared picklist rides the array
 * itself and nothing else: never a JSON key, never on a copy. A copy reads as
 * authored, so a reader of it reports a diagnostic rather than missing one.
 */
import { describe, expect, it } from 'vitest';
import { isResolvedPicklistOptions, markResolvedPicklistOptions } from './resolved-picklist-options.js';

describe('resolved picklist options mark', () => {
  it('marks the array it is given, in place, and only that array', () => {
    const options = [{ label: 'Tech', value: 'tech' }];
    expect(markResolvedPicklistOptions(options)).toBe(options);
    expect(isResolvedPicklistOptions(options)).toBe(true);
    expect(isResolvedPicklistOptions(markResolvedPicklistOptions(options))).toBe(true);
    expect(isResolvedPicklistOptions([{ label: 'Tech', value: 'tech' }])).toBe(false);
    expect(isResolvedPicklistOptions(undefined)).toBe(false);
  });

  it('is invisible to JSON and to key enumeration', () => {
    const options = markResolvedPicklistOptions([{ label: 'Tech', value: 'tech' }]);
    expect(JSON.stringify({ options })).toBe('{"options":[{"label":"Tech","value":"tech"}]}');
    expect(Object.keys(options)).toEqual(['0']);
    expect(Object.getOwnPropertySymbols(options).map((s) => Object.getOwnPropertyDescriptor(options, s)?.enumerable)).toEqual([false]);
  });

  it('does not survive a copy of the array', () => {
    const options = markResolvedPicklistOptions([{ label: 'Tech', value: 'tech' }]);
    expect(isResolvedPicklistOptions(options.map((o) => ({ ...o })))).toBe(false);
    expect(isResolvedPicklistOptions([...options])).toBe(false);
    expect(isResolvedPicklistOptions(JSON.parse(JSON.stringify(options)))).toBe(false);
  });

  it('survives a copy of the field that holds it', () => {
    const field = { picklist: 'industry', options: markResolvedPicklistOptions([{ label: 'Tech', value: 'tech' }]) };
    expect(isResolvedPicklistOptions({ ...field }.options)).toBe(true);
  });
});
