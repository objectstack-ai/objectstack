// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { refuseCatchallProtoKey, refuseRecordProtoKey } from './record-proto-key-guard';

/**
 * Isolated pins for the guards themselves, independent of their real
 * consumers (`ObjectSchema.fields`, `AssignmentConfigSchema.assignments` and
 * `AssignmentConfigSchema`'s own catchall — objectstack #17852 / #18847 /
 * #19151). Those files pin each guard wired into a real authoring surface;
 * this file pins the guards' own contracts against minimal schemas so a
 * future change to a consumer schema cannot mask a regression here.
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

/**
 * `refuseCatchallProtoKey` — the sibling for zod's OTHER open-key branch
 * (objectstack#19151). Same mechanism, same refused name, same issue shape;
 * what differs is the parser the message names, and that difference is the
 * reason it is a second wrapper rather than a second call site of the first.
 */
describe('refuseCatchallProtoKey', () => {
  const Open = () => z.object({ known: z.string().optional() }).catchall(z.unknown());
  const Guarded = refuseCatchallProtoKey(Open(), 'a widget config');

  it('refuses a `__proto__` own key with a named, self-locating issue', () => {
    const input = JSON.parse('{"known":"a","__proto__":"2"}');
    const result = Guarded.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    const [issue] = result.error.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['__proto__']);
    expect(issue.message).toContain('a widget config');
    expect(issue.message).toContain('__proto__');
  });

  it('names `.catchall()`, NOT `z.record()` — the two positions drop the key for different reasons', () => {
    // An author sent to the wrong parser looks in the wrong place. This is
    // the whole reason the wrapper is not a relabelled `refuseRecordProtoKey`.
    const catchallMessage = Guarded.safeParse(JSON.parse('{"__proto__":1}')).error!.issues[0]!.message;
    const recordMessage = refuseRecordProtoKey(z.record(z.string(), z.string()), 'things')
      .safeParse(JSON.parse('{"__proto__":"1"}')).error!.issues[0]!.message;
    expect(catchallMessage).toContain('catchall');
    expect(catchallMessage).not.toContain('z.record()');
    expect(recordMessage).toContain('z.record()');
    expect(recordMessage).not.toContain('catchall');
  });

  it('the underlying catchall really would have silently dropped it — the control this guard exists to fail', () => {
    // Proves the defect on the pinned zod rather than from the docblock's
    // quoted excerpt: the unguarded object accepts the document and returns a
    // DIFFERENT one.
    const result = Open().safeParse(JSON.parse('{"known":"a","__proto__":"2"}'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).toEqual(['known']);
  });

  it('leaves an object with no `__proto__` key untouched, catchall keys included', () => {
    const result = Guarded.safeParse({ known: 'a', anything: 1, constructor: 'c', prototype: 'p' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ known: 'a', anything: 1, constructor: 'c', prototype: 'p' });
  });

  it('does not choke on non-object input — the wrapped schema still reports its own type error', () => {
    const result = Guarded.safeParse('nope');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]!.code).toBe('invalid_type');
  });

  it('does not choke on null or an array', () => {
    expect(Guarded.safeParse(null).success).toBe(false);
    expect(Guarded.safeParse([1, 2]).success).toBe(false);
  });

  it('composes with `.optional()` — undefined never runs the guard', () => {
    expect(refuseCatchallProtoKey(Open(), 'a widget config').optional().safeParse(undefined).success).toBe(true);
  });

  it('keeps the wrapped shape readable through the spec walkers\' pipe resolution', () => {
    // `zodShapeOf`/`pipeAuthorableSide` resolve a preprocess pipe to its OUT
    // side; if the guard broke that, a guarded schema would walk "to no
    // shape" and silently stop being governed (the #4488 blind spot).
    const def = (Guarded as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
    expect(def.type).toBe('pipe');
    const out = def.out as z.ZodObject<z.ZodRawShape>;
    expect(Object.keys(out.shape)).toEqual(['known']);
  });
});
