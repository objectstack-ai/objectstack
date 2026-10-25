/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7324 — the parameter types of this package's published functions
 * are themselves published, so a consumer can NAME what it must pass.
 *
 * ## What went wrong, and why one `export` line would have made it worse
 *
 * Two DIFFERENT shapes carried the SAME name `ObjectSchemaLike` in two files
 * of this package, and neither reached the entry:
 *
 *   - `deriveMasterDetail.ts` — `{ name?, fields?: Record<string, any> }`, the
 *     `childSchema` of five functions the entry exports;
 *   - `schemaDefaults.ts` — `{ fields?: Record<string, {defaultValue?, type?,
 *     reference?} | undefined> }`, the `objectSchema` of
 *     `omitServerResolvedDefaults`, which the entry also exports.
 *
 * Re-exporting either under the shared name would have put a name on the
 * package's public surface that already meant something else two files over,
 * with nothing in the name to say which. So each was renamed at its
 * declaration site first: `ChildObjectSchemaLike` and
 * `FieldDefaultsSchemaLike`.
 *
 * ## Why the type-level half is the load-bearing half
 *
 * These are types. `import * as entry` cannot see them at runtime, so "the
 * name is importable" is only assertable by ANNOTATING with it and letting
 * `tsc` judge — this file is compiled by the package's `type-check`
 * (`tsc -p tsconfig.test.json`), which is where the pin actually bites. The
 * runtime `describe` below carries the one fact that IS runtime-visible and is
 * the thing a "widens the public surface" card must not get wrong: a
 * type-only export adds no runtime name.
 *
 * ## The controls
 *
 * `ChildObjectSchemaLike` and `FieldDefaultsSchemaLike` are MUTUALLY
 * ASSIGNABLE as written — measured, `tsc` accepts both directions — but only
 * because the child one's field values are `any`. So assignability cannot tell
 * them apart, and a control built on it would pass no matter which of the two
 * were exported under either name. The controls below are built on the two
 * facts `any` does not erase: the member SETS differ (`name` exists on one
 * only), and one's field value is `any` where the other's is pinned to four
 * members. Export the wrong declaration under either name and
 * `WRONG_ONE_EXPORTED_CONTROL` stops type-checking.
 */

import { describe, expect, it } from 'vitest';
import {
  deriveColumns,
  omitServerResolvedDefaults,
  type ChildObjectSchemaLike,
  type FieldDefaultsSchemaLike,
} from '../index';
import { en } from '@object-ui/i18n';

/** The `en` session's word for a boolean value: what `useBooleanValueLabel`
 *  (`@object-ui/fields`) draws under `en`. The derive functions require one
 *  (objectui#12924). */
const booleanLabel = (value: boolean) => (value ? en.common.yes : en.common.no);

/** Invariant type equality — `Equals<X, X>` is `true`, anything else `false`. */
type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/** `true` only for `any` (the one type that is both a subtype and a supertype of `1 & T`). */
type IsAny<T> = 0 extends 1 & T ? true : false;

type ChildFieldValue = NonNullable<ChildObjectSchemaLike['fields']>[string];
type DefaultsFieldValue = NonNullable<NonNullable<FieldDefaultsSchemaLike['fields']>[string]>;

/**
 * PIN — each published name names the shape it is supposed to name.
 *
 * Every line is a compile-time assertion: the annotation is the test, and the
 * literal on the right is what the type must evaluate to.
 */
const PIN = {
  /** The child schema carries the object's `name`; the defaults one does not. */
  childKeys: true satisfies Equals<keyof ChildObjectSchemaLike, 'name' | 'fields'>,
  defaultsKeys: true satisfies Equals<keyof FieldDefaultsSchemaLike, 'fields'>,
  /** The child one deliberately does not constrain a field value. */
  childFieldValueIsAny: true satisfies IsAny<ChildFieldValue>,
  /**
   * The defaults one pins exactly the three members its rule reads. It pinned
   * four until objectui#11070 round 4 retired `reference_to`: the rule reads
   * the target as `reference` alone.
   */
  defaultsFieldValueIsPinned: false satisfies IsAny<DefaultsFieldValue>,
  defaultsFieldMembers: true satisfies Equals<
    keyof DefaultsFieldValue,
    'defaultValue' | 'type' | 'reference'
  >,
} as const;

/**
 * CONTROL — would fire if the WRONG one of the two were exported.
 *
 * If a future edit publishes one declaration under both names (the
 * "deduplicate them" mistake this card measured its way out of), or swaps
 * which name points at which declaration, `Equals` here becomes `true` or the
 * per-name pins above flip. Assignability would NOT catch either: the two are
 * mutually assignable today, through `any`.
 */
const WRONG_ONE_EXPORTED_CONTROL = false satisfies Equals<
  ChildObjectSchemaLike,
  FieldDefaultsSchemaLike
>;

/**
 * The consumer this card is about: a host with its own form renderer, holding
 * the schema it will pass in an ANNOTATED variable — the thing that was
 * impossible before. If the published name stopped naming the right shape,
 * these annotations would stop compiling.
 */
const consumerHeldDefaultsSchema: FieldDefaultsSchemaLike = {
  fields: {
    created_at: { defaultValue: 'NOW()' },
    owner: { defaultValue: 'current_user', type: 'lookup', reference: 'sys_user' },
    stage: { defaultValue: 'draft' },
  },
};

const consumerHeldChildSchema: ChildObjectSchemaLike = {
  name: 'order_line',
  fields: {
    product: { type: 'lookup', reference: 'product', label: 'Product' },
    qty: { type: 'number', label: 'Qty' },
  },
};

describe('objectui#7324 — published parameter types are nameable', () => {
  it('type-level pins and controls hold (the annotations above are the assertion)', () => {
    expect(PIN.childKeys).toBe(true);
    expect(PIN.defaultsKeys).toBe(true);
    expect(PIN.childFieldValueIsAny).toBe(true);
    expect(PIN.defaultsFieldValueIsPinned).toBe(false);
    expect(PIN.defaultsFieldMembers).toBe(true);
    expect(WRONG_ONE_EXPORTED_CONTROL).toBe(false);
  });

  it('a schema held under the published name flows through the published function', () => {
    const payload = omitServerResolvedDefaults(
      { created_at: '', stage: 'draft', note: 'kept' },
      consumerHeldDefaultsSchema,
    );
    // `created_at` declares a runtime default and arrived empty -> the key is
    // dropped so the producer resolves it. Nothing else moves.
    expect(payload).toEqual({ stage: 'draft', note: 'kept' });
    expect('created_at' in payload).toBe(false);
  });

  it('a child schema held under the published name flows through the published deriver', () => {
    const columns = deriveColumns(consumerHeldChildSchema, { booleanLabel, relationshipField: 'product' });
    expect(columns.map((c) => c.name)).toContain('qty');
    expect(columns.map((c) => c.name)).not.toContain('product');
  });

  it('adds no RUNTIME name to the entry — both additions are type-only', async () => {
    const entry = await import('../index');
    expect(Object.keys(entry)).not.toContain('ChildObjectSchemaLike');
    expect(Object.keys(entry)).not.toContain('FieldDefaultsSchemaLike');
    // The pair #6059 published is still there, unchanged.
    expect(typeof entry.omitServerResolvedDefaults).toBe('function');
    expect(typeof entry.isRequiredInForm).toBe('function');
  });
});
