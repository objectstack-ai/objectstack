// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { refuseRecordProtoKey } from './record-proto-key-guard';

/**
 * Isolated pin for the guard itself, independent of either real consumer
 * (`ObjectSchema.fields`, `AssignmentConfigSchema.assignments` — objectstack
 * #17852 / #18847). Those two files pin the guard wired into a real
 * authoring surface; this file pins the guard's own contract against a
 * minimal record so a future change to either consumer schema cannot mask a
 * regression here.
 *
 * These assertions are BEHAVIOUR pins, not a zod-version pin (as ordered):
 * `packages/spec/package.json` pins `zod` at `^4.4.3`, and a bump inside
 * that range must not silently change what gets refused.
 */
describe('refuseRecordProtoKey', () => {
  const Guarded = refuseRecordProtoKey(z.record(z.string(), z.string()), 'things');

  it('refuses a `__proto__` own key with a named, self-locating issue', () => {
    // JSON.parse is what makes `__proto__` an OWN enumerable key — an object
    // literal's `{ __proto__: ... }` sets the actual prototype instead and
    // never reaches the record's open-key loop as a key at all.
    const input = JSON.parse('{"a":"1","__proto__":"2"}');
    const result = Guarded.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    const [issue] = result.error.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['__proto__']);
    // Named: which slot, which key.
    expect(issue.message).toContain('`things`');
    expect(issue.message).toContain('__proto__');
  });

  it('refuses a record that is `__proto__` ALONE — no sibling key masks the drop', () => {
    const input = JSON.parse('{"__proto__":"2"}');
    const result = Guarded.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('the underlying record really would have silently dropped it — the control this guard exists to fail', () => {
    // Same key type, no guard: proves the defect is real on the pinned zod,
    // not merely asserted from the docblock's quoted source excerpt.
    const Unguarded = z.record(z.string(), z.string());
    const input = JSON.parse('{"a":"1","__proto__":"2"}');
    const result = Unguarded.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Reflect.ownKeys(result.data)).toEqual(['a']);
  });

  it('leaves an ordinary record with no `__proto__` key untouched', () => {
    const result = Guarded.safeParse({ a: '1', b: '2' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ a: '1', b: '2' });
  });

  it('does not choke on non-object input — the record schema still reports its own type error', () => {
    const result = Guarded.safeParse('nope');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]!.code).toBe('invalid_type');
  });

  it('does not choke on null or an array', () => {
    expect(Guarded.safeParse(null).success).toBe(false);
    expect(Guarded.safeParse([1, 2]).success).toBe(false);
  });

  it('composes with `.optional()` the same way the raw record does — undefined never runs the guard', () => {
    const OptionalGuarded = refuseRecordProtoKey(z.record(z.string(), z.string()), 'things').optional();
    expect(OptionalGuarded.safeParse(undefined).success).toBe(true);
  });

  it('preserves the inner schema\'s own error option (`{ error }` still fires for its own cases)', () => {
    const WithCustomError = refuseRecordProtoKey(
      z.record(z.string(), z.string(), {
        error: (issue) => (Array.isArray(issue.input) ? 'no arrays here' : undefined),
      }),
      'things',
    );
    const result = WithCustomError.safeParse(['nope']);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]!.message).toBe('no arrays here');
  });
});
