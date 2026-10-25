/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/types` <-> `@objectstack/spec` symbol-collision ratchets
 * (objectui#7265, the `@object-ui/types` slice of the `check:spec-symbols`
 * DEBT burn-down).
 *
 * Two names in `zod/objectql.zod.ts` were declared under names
 * `@objectstack/spec/ui` already owns, and the slice sent them down DIFFERENT
 * routes because their sites are different things:
 *
 *   - `UserFilterFieldSchema` is the spec's own concept under the spec's own
 *     name, so it is now DERIVED from it. Four of its six members flow in by
 *     reference; two carry a divergence that is confined to them.
 *   - `UserFiltersSchema` is a declared DIALECT of the spec's container, so it
 *     went to the gate's ALLOW map with its reason instead. Binding it would
 *     422 metadata that renders today.
 *
 * ## What this file is for, and why an assertion here is not decoration
 *
 * A waiver and a derivation fail in opposite directions and both fail QUIETLY:
 *
 *   - A DERIVATION stops being one the moment somebody re-types a member "just
 *     to add a description". The copy passes every value comparison it used to
 *     pass (the gate's own header makes this point: reference identity is the
 *     only check that tells a re-export from a fork), so the members that are
 *     supposed to come from the spec are asserted to be the spec's OWN NODES,
 *     not merely to look like them.
 *   - A WAIVER stops being honest the moment the divergence it excuses goes
 *     away upstream. So each of the three divergences behind the
 *     `UserFiltersSchema` entry is probed in BOTH directions -- the spec
 *     accepting what this mirror refuses, and this mirror accepting what the
 *     spec refuses. A one-directional probe stays green when the spec converges
 *     on us, which is exactly the day the waiver should be spent.
 *
 * ## The version these were measured against
 *
 * The seeding card asserted identity against `@objectstack/spec@17.2.0`; the
 * `@object-ui/core` slice of the same card had to re-measure against the
 * RESOLVED pin before it could bind, because byte-identical is a statement
 * about a VERSION, not a property. Everything here is measured against whatever
 * version the workspace actually resolves -- these probes read the installed
 * spec rather than a transcribed shape, so a bump moves the readings with it
 * instead of leaving a stale sentence behind.
 *
 * ## The type-level lines below really are compiled
 *
 * `packages/types/tsconfig.test.json` takes `src/**\/*.test.ts` by glob and is
 * chained from this package's `type-check` script, so a `type _x = Assert<...>`
 * here is checked from the moment it is written. That has not always been true
 * of type assertions in this repo -- `spec-derived-unions.test.ts` built its
 * whole contract on checks nothing ever ran (objectstack#4074) -- which is why
 * the runtime probes below never delegate a claim to a type line alone.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  UserFilterFieldSchema as SpecUserFilterFieldSchema,
  UserFiltersSchema as SpecUserFiltersSchema,
} from '@objectstack/spec/ui';

import { ListViewSchema } from '../zod/objectql.zod.js';

/* ------------------------------------------------------------------------- *
 * Reaching the two mirror nodes.
 *
 * Both are MODULE-LOCAL: `zod/objectql.zod.ts` exports neither, which is the
 * whole reason rule 1 had to drop its `export` filter to see them at all. They
 * are reached the way a consumer reaches them -- down the published
 * `ListViewSchema` -- so these probes are about the surface this package
 * actually ships, not about a private binding.
 * ------------------------------------------------------------------------- */

/**
 * The minimum structural view these probes need. Spelled out rather than reached
 * for with `any`, so a slot that stops being an object schema is a COMPILE
 * error here instead of an `undefined` that quietly parses nothing.
 */
interface ProbeObject {
  shape: Record<string, unknown>;
  safeParse: (value: unknown) => { success: boolean; data?: unknown };
}
interface ProbeArray {
  element: ProbeObject;
}

/** Peel one `.optional()` wrapper, the only wrapper on the path below. */
const inner = (node: unknown): unknown => {
  const cur = node as { unwrap?: () => unknown };
  return typeof cur?.unwrap === 'function' ? cur.unwrap() : node;
};

const asObject = (node: unknown): ProbeObject => inner(node) as ProbeObject;
const asArray = (node: unknown): ProbeArray => inner(node) as ProbeArray;

/** The enum members of a `z.enum(...)`, read off the node rather than restated. */
const enumMembers = (node: unknown): string[] =>
  Object.keys((inner(node) as { _zod?: { def?: { entries?: Record<string, unknown> } } })._zod?.def?.entries ?? {}).sort();

const SpecFieldShape = (SpecUserFilterFieldSchema as unknown as ProbeObject).shape;
const MirrorUserFilters = asObject((ListViewSchema as unknown as ProbeObject).shape.userFilters);
const MirrorUserFilterField = asArray(MirrorUserFilters.shape.fields).element;

describe('the probe path itself resolves', () => {
  it('reaches two object schemas, not `undefined`', () => {
    // Without this, every "the mirror rejects X" assertion below could pass on
    // a node that does not exist: `undefined?.safeParse` would throw, but a
    // WRONG object schema would not, and a renamed slot is exactly the silent
    // way this file would stop measuring anything.
    expect(Object.keys(MirrorUserFilters.shape).sort()).toEqual(
      ['allowAddTab', 'element', 'fields', 'showAllRecords', 'tabs'],
    );
    expect(Object.keys(MirrorUserFilterField.shape).sort()).toEqual(
      ['defaultValues', 'field', 'label', 'options', 'showCount', 'type'],
    );
  });
});

/* ========================================================================= *
 * 1. `UserFilterFieldSchema` -- BOUND to the spec
 * ========================================================================= */

/**
 * The four members that flow in by reference, and the two that deliberately do
 * not. Written as one table so the split is a single readable fact rather than
 * six scattered assertions.
 */
const DERIVED_MEMBERS = ['field', 'type', 'showCount', 'defaultValues'] as const;
const DIVERGENT_MEMBERS = ['label', 'options'] as const;

describe('UserFilterFieldSchema is DERIVED from the spec, not copied', () => {
  it('the spec still owns the name -- the collision this route answers is real', () => {
    // If the spec ever stops exporting it, the derivation is still correct code
    // but this file is no longer a spec-symbol ratchet, and the ledger entry it
    // replaced would have been retired for a different reason.
    expect(typeof SpecUserFilterFieldSchema.safeParse).toBe('function');
  });

  it.each(DERIVED_MEMBERS)('`%s` is the spec\'s OWN node, by reference', (key) => {
    // Reference identity, not shape equality: a faithful hand copy passes every
    // value comparison, which is precisely how this name ended up in the ledger.
    expect(MirrorUserFilterField.shape[key]).toBe(SpecFieldShape[key]);
  });

  it.each(DIVERGENT_MEMBERS)('`%s` is NOT the spec\'s node -- the divergence is real', (key) => {
    // The other half of the same measurement. If one of these ever becomes
    // reference-equal, the site's documented divergence has silently gone away
    // and the comment explaining it is now false.
    expect(MirrorUserFilterField.shape[key]).not.toBe(SpecFieldShape[key]);
  });

  it('carries the spec\'s key set exactly -- no local key, no dropped key', () => {
    expect(Object.keys(MirrorUserFilterField.shape).sort()).toEqual(
      Object.keys(SpecFieldShape).sort(),
    );
  });

  it('tracks the spec\'s control-type vocabulary rather than restating it', () => {
    expect(enumMembers(MirrorUserFilterField.shape.type)).toEqual(enumMembers(SpecFieldShape.type));
    // Lit control: the reader found real members. Without it an empty `entries`
    // on both sides would read as agreement.
    expect(enumMembers(MirrorUserFilterField.shape.type).length).toBeGreaterThan(1);
  });
});

describe('UserFilterFieldSchema: the two confined divergences, both directions', () => {
  it('`label` stays a plain string here and is an i18n union in the spec', () => {
    const i18n = { field: 'status', label: { en: 'Status' } };
    // The mirror refuses it BECAUSE @object-ui/plugin-list renders this key as
    // a React child (`f.label || f.field`), where a record is not a translated
    // label, it is "Objects are not valid as a React child".
    expect(MirrorUserFilterField.safeParse(i18n).success).toBe(false);
    expect(SpecUserFilterFieldSchema.safeParse(i18n).success).toBe(true);

    // ...and both still take the plain string, so the divergence is about the
    // union arm and nothing else.
    const plain = { field: 'status', label: 'Status' };
    expect(MirrorUserFilterField.safeParse(plain).success).toBe(true);
    expect(SpecUserFilterFieldSchema.safeParse(plain).success).toBe(true);
  });

  it('`options[]` keeps this package\'s element, which does not close the shape', () => {
    const extra = { field: 'status', options: [{ label: 'A', value: 'a', icon: 'x' }] };
    expect(MirrorUserFilterField.safeParse(extra).success).toBe(true);
    expect(SpecUserFilterFieldSchema.safeParse(extra).success).toBe(false);

    const shared = { field: 'status', options: [{ label: 'A', value: 'a', color: '#dc2626' }] };
    expect(MirrorUserFilterField.safeParse(shared).success).toBe(true);
    expect(SpecUserFilterFieldSchema.safeParse(shared).success).toBe(true);
  });

  it('the object STRIPS unknown keys where the spec REJECTS them', () => {
    // The third divergence, and the one the derivation had to restore by hand
    // with `.strip()`: inheriting the spec's `.strict()` would have turned a key
    // an author writes today into a 422 as a side effect of a burn-down.
    const stray = { field: 'status', widget: 'chips' };
    const mirrored = MirrorUserFilterField.safeParse(stray);
    expect(mirrored.success).toBe(true);
    expect(mirrored.data).toEqual({ field: 'status' });
    expect(SpecUserFilterFieldSchema.safeParse(stray).success).toBe(false);
  });
});

/* ========================================================================= *
 * 2. `UserFiltersSchema` -- a DECLARED DIALECT, waived in the gate's ALLOW map
 * ========================================================================= */

describe('UserFiltersSchema is a dialect: the three divergences the waiver excuses', () => {
  it('1a. `element` refuses the spec\'s `toggle` (ADR-0053)', () => {
    const toggle = { element: 'toggle' };
    expect(MirrorUserFilters.safeParse(toggle).success).toBe(false);
    // The spec deliberately KEEPS `toggle` so shipped configs keep rendering
    // (ADR-0047 3.4a) -- the divergence is about what may be AUTHORED here.
    expect(SpecUserFiltersSchema.safeParse(toggle).success).toBe(true);
  });

  it('1b. `element` is REQUIRED here and defaulted in the spec', () => {
    const omitted = { fields: [{ field: 'status' }] };
    expect(MirrorUserFilters.safeParse(omitted).success).toBe(false);
    const spec = SpecUserFiltersSchema.safeParse(omitted);
    expect(spec.success).toBe(true);
    expect((spec as { data: { element?: string } }).data.element).toBe('dropdown');
  });

  it('2. `tabs` accepts the legacy preset dialect the spec\'s strict tab rejects', () => {
    const legacy = {
      element: 'tabs',
      tabs: [{ id: 'tab-1', label: 'Active', filters: [['status', '=', 'active']], default: true }],
    };
    // `normalizeTabPresets` (@object-ui/plugin-list) still normalises this shape
    // at runtime, so binding the spec's `ViewTabSchema` here would 422 metadata
    // that renders today.
    expect(MirrorUserFilters.safeParse(legacy).success).toBe(true);
    expect(SpecUserFiltersSchema.safeParse(legacy).success).toBe(false);

    // The canonical shape passes on both sides -- the dialect is additive, not
    // a replacement, and that is what makes the waiver bounded.
    const canonical = {
      element: 'tabs',
      tabs: [{ name: 'active', label: 'Active', filter: [{ field: 'status', operator: 'equals', value: 'active' }] }],
    };
    expect(MirrorUserFilters.safeParse(canonical).success).toBe(true);
    expect(SpecUserFiltersSchema.safeParse(canonical).success).toBe(true);
  });

  it('3. the container STRIPS unknown keys where the spec REJECTS them', () => {
    const stray = { element: 'tabs', tabBar: { position: 'top' } };
    expect(MirrorUserFilters.safeParse(stray).success).toBe(true);
    expect(SpecUserFiltersSchema.safeParse(stray).success).toBe(false);
  });

  it('...and it is NOT a spec node, so the waiver still excuses a real local declaration', () => {
    expect(MirrorUserFilters).not.toBe(SpecUserFiltersSchema);
  });
});

/* ========================================================================= *
 * 3. The type level
 * ========================================================================= */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type SpecField = z.input<typeof SpecUserFilterFieldSchema>;
type MirrorFilters = NonNullable<z.input<typeof ListViewSchema>['userFilters']>;
type MirrorField = NonNullable<MirrorFilters['fields']>[number];

/** Positive control: `Equal` can answer `true`, on a member that IS shared. */
type _fieldIsTheSpecs = Assert<Equal<MirrorField['field'], SpecField['field']>>;

/**
 * The `label` divergence, at the type level. This reds the day the spec narrows
 * `label` back to a plain string -- at which point the divergence is spent and
 * the `.extend()` override at the site should go.
 */
type _labelIsStillNarrowerThanTheSpecs = Assert<Equal<Equal<MirrorField['label'], SpecField['label']>, false>>;
type _labelIsAPlainString = Assert<Equal<MirrorField['label'], string | undefined>>;

/** `toggle` is unreachable in this package's authoring vocabulary (ADR-0053). */
type _elementIsAuthoringOnly = Assert<Equal<MirrorFilters['element'], 'dropdown' | 'tabs'>>;

describe('the type-level lines above are compiled, not commentary', () => {
  it('is checked by `tsc -p tsconfig.test.json` via this package\'s type-check', () => {
    // Nothing to assert at runtime: the four aliases above are the assertion,
    // and the project that compiles them is named in this file's header. This
    // case exists so the file states out loud WHERE that check lives -- the
    // failure mode objectstack#4074 recorded was a type contract nothing ran.
    const compiled: _fieldIsTheSpecs = true;
    expect(compiled).toBe(true);
  });
});
