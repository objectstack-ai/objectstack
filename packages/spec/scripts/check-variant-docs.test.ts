// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The variant/doc gate's ledger key, pinned on fixture unions.
 *
 * The gate's end-to-end verdict runs as `check:variant-docs` against the real
 * schemas. What that run cannot show is whether the key still MOVES when an
 * arm's variants move: a walker that silently skipped one arm shape keys the
 * union on the arms it can read, stays green, and never sends anyone back to
 * the doc. A `z.enum` arm was that shape — its members sit in the def's
 * `entries`, not in `values` where a literal keeps its one value.
 *
 * So the assertions are about DISCRIMINATION: a union with one enum arm and one
 * literal arm keys on every member of both, and adding a member to the enum
 * arm gives a different key.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { armVariants, unionKey } from './check-variant-docs.mts';

const enumAndLiteral = (members: [string, ...string[]]) =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(members), object: z.string() }),
    z.object({ kind: z.literal('nav'), app: z.string() }),
  ]);

describe('check-variant-docs unionKey', () => {
  it('keys a union with an enum arm on every enum member plus the literal arm', () => {
    const u = unionKey(enumAndLiteral(['field', 'flow']));
    expect(u?.disc).toBe('kind');
    expect(u?.key).toBe('kind:field|flow|nav');
    expect([...(u?.variants ?? [])].sort()).toEqual(['field', 'flow', 'nav']);
  });

  it('moves the key when the enum arm gains a member', () => {
    const before = unionKey(enumAndLiteral(['field', 'flow']))?.key;
    const after = unionKey(enumAndLiteral(['field', 'flow', 'page']))?.key;
    expect(after).toBe('kind:field|flow|nav|page');
    expect(after).not.toBe(before);
  });

  it('keys a literal-only union as before (control)', () => {
    const u = unionKey(z.discriminatedUnion('type', [
      z.object({ type: z.literal('b') }),
      z.object({ type: z.literal('a') }),
    ]));
    expect(u?.key).toBe('type:a|b');
  });

  it('answers null for a schema that is not a discriminated union', () => {
    expect(unionKey(z.object({ kind: z.enum(['a', 'b']) }))).toBeNull();
    expect(unionKey(z.union([z.string(), z.number()]))).toBeNull();
  });
});

describe('check-variant-docs armVariants', () => {
  it('reads an enum built from an object by its values, not its keys', () => {
    expect(armVariants(z.enum({ Field: 'field', Flow: 'flow' })).sort()).toEqual(['field', 'flow']);
  });

  it('reads a literal arm by its value', () => {
    expect(armVariants(z.literal('nav'))).toEqual(['nav']);
  });

  it('answers no values for a field that is neither a literal nor an enum', () => {
    expect(armVariants(z.string())).toEqual([]);
    expect(armVariants(undefined)).toEqual([]);
  });
});
