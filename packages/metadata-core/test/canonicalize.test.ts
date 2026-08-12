// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { canonicalize, hashSpec } from '../src/canonicalize.js';

describe('canonicalize', () => {
  it('orders object keys lexicographically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: 1, a: 1, m: 1 })).toBe('{"a":1,"m":1,"z":1}');
  });

  it('is order-independent for objects', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined properties (matching JSON.stringify)', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });

  it('preserves null', () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it('recurses into nested objects', () => {
    expect(canonicalize({ outer: { b: 1, a: 2 } })).toBe('{"outer":{"a":2,"b":1}}');
  });

  it('recurses into nested arrays', () => {
    expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('handles primitives at the root', () => {
    expect(canonicalize('hello')).toBe('"hello"');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });

  it('rejects NaN', () => {
    expect(() => canonicalize(NaN)).toThrow(/NaN/);
  });

  it('rejects Infinity', () => {
    expect(() => canonicalize(Infinity)).toThrow(/Infinity/);
    expect(() => canonicalize(-Infinity)).toThrow(/Infinity/);
  });

  it('rejects BigInt', () => {
    expect(() => canonicalize(BigInt(1))).toThrow(/BigInt/);
  });

  it('rejects functions', () => {
    expect(() => canonicalize(() => 1)).toThrow(/function/);
  });

  it('rejects symbols', () => {
    expect(() => canonicalize(Symbol('x'))).toThrow(/symbol/);
  });

  it('is idempotent: canonicalize(parse(canonicalize(x))) === canonicalize(x)', () => {
    const input = { c: [3, 1, 2], a: { z: true, y: null }, b: 'x' };
    const once = canonicalize(input);
    const twice = canonicalize(JSON.parse(once));
    expect(twice).toBe(once);
  });

  // ─── Property tests ────────────────────────────────────────────────

  const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    leaf: fc.oneof(
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.integer({ min: -1e9, max: 1e9 }),
      // Limit floats to non-NaN/Infinity values
      fc.float({ noNaN: true, noDefaultInfinity: true }),
    ),
    node: fc.oneof(
      { maxDepth: 3 },
      tie('leaf'),
      fc.array(tie('node') as fc.Arbitrary<unknown>, { maxLength: 5 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie('node') as fc.Arbitrary<unknown>, { maxKeys: 5 }),
    ),
  })).node;

  it('property: idempotence over arbitrary JSON-like values', () => {
    fc.assert(
      fc.property(jsonValue, (v) => {
        const once = canonicalize(v);
        const twice = canonicalize(JSON.parse(once));
        return once === twice;
      }),
      { numRuns: 200 },
    );
  });

  it('property: key-order independence', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()),
        (obj) => {
          const keys = Object.keys(obj);
          if (keys.length < 2) return true;
          const reordered: Record<string, unknown> = {};
          for (const k of [...keys].reverse()) reordered[k] = obj[k];
          return canonicalize(obj) === canonicalize(reordered);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('hashSpec', () => {
  it('produces a sha256:<64hex> string', () => {
    const h = hashSpec({ a: 1 });
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is stable across runs', () => {
    expect(hashSpec({ a: 1, b: 2 })).toBe(hashSpec({ b: 2, a: 1 }));
  });

  it('changes when the spec changes', () => {
    expect(hashSpec({ a: 1 })).not.toBe(hashSpec({ a: 2 }));
  });

  it('matches a known-good fixture (regression guard)', () => {
    // If this ever changes, every stored hash in every repository becomes
    // invalid. Treat as a deliberate breaking change.
    expect(hashSpec({})).toBe(
      'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
  });

  it('property: equal canonical form ⇒ equal hash', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.integer()), (obj) => {
        const reordered = Object.fromEntries(Object.entries(obj).reverse());
        return hashSpec(obj) === hashSpec(reordered);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Guarantee 7 (#7856): the hash describes the bytes a value serialises to.
   *
   *     canonicalize(x) === canonicalize(JSON.parse(JSON.stringify(x)))
   *
   * Stated as a property and a table rather than as a list of golden hashes,
   * because the defect was never about any particular value — it was about
   * `normalise` walking own enumerable keys while the disk received
   * `JSON.stringify`'s output. Everything with a `toJSON` diverged; `Date` is
   * simply the instance everybody meets first.
   */
  describe('serialized-form identity (#7856)', () => {
    const roundTrip = (x: unknown): unknown => JSON.parse(JSON.stringify(x));

    class Money {
      constructor(
        private readonly cents: number,
        private readonly currency: string,
      ) {}

      toJSON(): string {
        return `${(this.cents / 100).toFixed(2)} ${this.currency}`;
      }
    }

    const CASES: ReadonlyArray<{ label: string; value: unknown; canonical: string }> = [
      {
        label: 'Date at a key',
        value: { createdAt: new Date('2024-01-01T00:00:00.000Z'), label: 'H' },
        canonical: '{"createdAt":"2024-01-01T00:00:00.000Z","label":"H"}',
      },
      {
        label: 'Date under an array index',
        value: { stamps: [new Date('2020-06-01T12:00:00.000Z')] },
        canonical: '{"stamps":["2020-06-01T12:00:00.000Z"]}',
      },
      {
        label: 'class instance whose toJSON yields a string',
        value: { amount: new Money(1250, 'USD') },
        canonical: '{"amount":"12.50 USD"}',
      },
      {
        label: 'object literal carrying its own toJSON',
        value: { span: { toJSON: () => ({ to: 9, from: 1 }) } },
        canonical: '{"span":{"from":1,"to":9}}',
      },
    ];

    for (const c of CASES) {
      it(`canonicalises to the serialised form — ${c.label}`, () => {
        expect(canonicalize(c.value)).toBe(c.canonical);
        expect(hashSpec(c.value)).toBe(hashSpec(roundTrip(c.value)));
      });
    }

    it('applies toJSON once per position, never re-consulting its result', () => {
      // `JSON.stringify` applies toJSON exactly once per position, so a result
      // that itself carries a toJSON is serialised literally. Matching
      // JSON.stringify IS the contract, so it is asserted against it directly.
      const value = { wrapped: { toJSON: () => ({ inner: { toJSON: () => 'deep' } }) } };
      expect(canonicalize(value)).toBe(JSON.stringify(roundTrip(value)));
    });

    it('leaves a graph with no toJSON byte-identical', () => {
      // The half that makes this a fix rather than a migration: an ordinary
      // spec's canonical form must be exactly what it has always been.
      expect(canonicalize({ b: 1, a: [1, 2, { c: null }], d: 'x' })).toBe(
        '{"a":[1,2,{"c":null}],"b":1,"d":"x"}',
      );
    });

    it('property: hashing is invariant under a JSON round trip', () => {
      fc.assert(
        fc.property(
          fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.jsonValue()),
          (obj) => hashSpec(obj) === hashSpec(roundTrip(obj)),
        ),
        { numRuns: 200 },
      );
    });
  });
});
