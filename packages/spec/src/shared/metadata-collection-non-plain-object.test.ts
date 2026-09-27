// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `normalizeMetadataCollection` reads ONLY a plain object as the map form.
 *
 * ## What was wrong
 *
 * The map-form branch tested `typeof value === 'object'`, so a `Set`, a `Map`
 * or a `Date` was read as a map too. `Object.entries` of any of them is `[]`,
 * and normalization runs before the schema parse, so the strict `defineStack`
 * door saw a valid empty array and ACCEPTED the stack with every authored
 * entry (e.g. its permission-set grants) gone.
 *
 * ## What is pinned
 *
 * A composed artifact is complete or it is refused. For every key that accepts
 * the map form (derived from `MAP_SUPPORTED_FIELDS`, never transcribed), a
 * non-plain object reaches the strict parse unchanged and is refused with the
 * ordinary strict envelope: `STACK_SCHEMA_INVALID`, `status: 422`, a zod issue
 * rooted at the key expecting an array. The controls: the same key authored as
 * a plain-object map — a literal, a null-prototype object, and a plain object
 * from another realm — is still normalized.
 */
import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { normalizeMetadataCollection, MAP_SUPPORTED_FIELDS } from './metadata-collection.zod';
import { defineStack } from '../stack.zod';

type Envelope = Error & {
  code?: string;
  status?: number;
  issues?: ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; expected?: string }>;
};

/** The thrown value, or `null` when the stack is accepted. */
function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const manifest = { id: 'com.example.a', name: 'a', version: '1.0.0', type: 'app' as const };

class Holder {
  rep = { label: 'Rep' };
}

const NON_PLAIN: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a Set', () => new Set([{ name: 'rep', label: 'Rep' }])],
  ['a Map', () => new Map([['rep', { label: 'Rep' }]])],
  ['a Date', () => new Date(0)],
  ['a class instance', () => new Holder()],
];

describe('normalizeMetadataCollection — only a plain object is the map form', () => {
  for (const [label, make] of NON_PLAIN) {
    it(`${label} is returned unchanged, never read as an empty map`, () => {
      const value = make();
      expect(normalizeMetadataCollection(value)).toBe(value);
    });
  }

  it('control: an object literal is normalized with key → name', () => {
    expect(normalizeMetadataCollection({ rep: { label: 'Rep' } })).toEqual([{ name: 'rep', label: 'Rep' }]);
  });

  it('control: a null-prototype object is normalized with key → name', () => {
    const map = Object.assign(Object.create(null), { rep: { label: 'Rep' } });
    expect(normalizeMetadataCollection(map)).toEqual([{ name: 'rep', label: 'Rep' }]);
  });

  it('control: a plain object from another realm is normalized with key → name', () => {
    const map = runInNewContext('({ rep: { label: "Rep" } })');
    expect(Object.getPrototypeOf(map)).not.toBe(Object.prototype);
    expect(normalizeMetadataCollection(map)).toEqual([{ name: 'rep', label: 'Rep' }]);
  });
});

describe('strict defineStack refuses a non-plain object for a map-form collection key', () => {
  it('covers every map-form key the normalizer declares (the list is the census)', () => {
    expect(MAP_SUPPORTED_FIELDS).toContain('permissions');
    expect(MAP_SUPPORTED_FIELDS.length).toBeGreaterThanOrEqual(20);
  });

  for (const key of MAP_SUPPORTED_FIELDS) {
    for (const [label, make] of NON_PLAIN) {
      it(`'${key}': ${label} is refused with STACK_SCHEMA_INVALID / 422 at the key — never accepted as []`, () => {
        const err = refusal(() => defineStack({ manifest, [key]: make() } as never));
        expect(err, `'${key}' given ${label} was accepted`).not.toBeNull();
        expect(err!.code).toBe('STACK_SCHEMA_INVALID');
        expect(err!.status).toBe(422);
        expect(err!.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'invalid_type', path: [key], expected: 'array' }),
          ]),
        );
      });
    }
  }

  it("control: 'permissions' authored as a plain-object map is accepted with its entry", () => {
    const stack = defineStack({
      manifest,
      permissions: { rep: { label: 'Rep', objects: {} } },
    } as never);
    expect(stack.permissions?.map((p) => p.name)).toEqual(['rep']);
  });
});
