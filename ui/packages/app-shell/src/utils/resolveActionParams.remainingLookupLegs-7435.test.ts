/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ THE REMAINING DECLARED LOOKUP LEGS REACH THE PICKER — objectui#7435,
 * second slice (`lookupColumns`, `lookupPageSize`).
 *
 * ## The defect, stated as what the author saw
 *
 * `resolveActionParams`' picker group read the resolved object-schema field def
 * in `snake_case` ONLY for these two keys. `field` there is a `getObjectSchema`
 * / `useMetadata()` document, which serves the spelling `@objectstack/spec`
 * declares — so a field declaring `lookupColumns` / `lookupPageSize` had both
 * values silently dropped and the action param's record picker rendered with
 * default columns and a default page size. Nothing warned: the resolver read
 * keys that were not there. The first slice repaired `displayField` /
 * `descriptionField` / `lookupFilters` the same way.
 *
 * ## What each case asserts, and why it is the resolved VALUE
 *
 * Two exits are read, never "the resolver ran":
 *
 *   1. `ActionParamDef` — what this resolver EMITS.
 *   2. the field object `paramToField()` hands `ActionParamDialog`, which is
 *      what `LookupField` actually consumes. A value that reaches (1) but is
 *      dropped at (2) is not a fix, and only the second exit can say so.
 *      ⭐ That bag spelled these two members `lookup_columns` /
 *      `lookup_page_size` until objectui#12157, which retired `LookupField`'s
 *      snake reads and moved this emit to the spec's `lookupColumns` /
 *      `lookupPageSize` in the same change.
 *
 * Camel and snake fixtures carry DIFFERENT values on every key, so no assertion
 * can be satisfied by the wrong leg.
 *
 * ## Measured, on the pin this tree resolves
 *
 * `@objectstack/spec@17.4.0`. `FieldSchema.safeParse` over a minimal lookup def
 * ACCEPTS `lookupColumns` and `lookupPageSize` and REJECTS `lookup_columns` /
 * `lookup_page_size` with `unrecognized_keys`. Controls lit in the same run:
 * the minimal def ACCEPTED, `zzz_not_a_real_key` REJECTED. {@link contract}
 * re-runs that reading here, so the claim is checkable rather than quoted.
 *
 * ## ⛔ Why `dependsOn` — the third declared key of this slice — is NOT here
 *
 * It keeps its snake-only read, and the reason is MEASURED, not contractual:
 * `FieldSchema` does declare `dependsOn`. Adding the camel leg was built and
 * rendered before being refused — a field-backed lookup param whose def carries
 * the declared spelling then renders `lookup-trigger-gated` and DISABLED, where
 * the same def renders an enabled trigger today, with an otherwise identical
 * lookup enabled beside it in both runs. The gate never lifts, because
 * `ActionParamDialog` supplies `dependentValues` only to
 * `CASCADE_OPTION_WIDGET_TYPES` and `lookup` is not a member. So the declared
 * leg would trade a config-loss bug for an unusable picker.
 *
 * ⛔ That absence is NOT re-pinned here — it is already pinned, with a keystroke
 * witness, by `views/ActionParamDialog.lookupDependsOnReach-8672.test.tsx` (leg
 * A for the permanent gate, leg C for the `undefined` this read produces). A
 * second copy of a pin is how two pins drift. Which disposition applies is
 * objectui#8672's ruling to make.
 */
import { describe, it, expect } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import {
  resolveActionParams,
  type ResolveActionParamsContext,
  type RawActionParam,
} from '@object-ui/fields';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { paramToField } from './paramToField';

/** The camel column list — kept by reference so identity is assertable. */
const CAMEL_COLUMNS = [{ field: 'name' }, { field: 'email' }];
/** The snake column list — a DIFFERENT array, so the wrong leg cannot pass. */
const SNAKE_COLUMNS = [{ field: 'legacy_name' }];

/** Page sizes differ between the two dialects for the same reason. */
const CAMEL_PAGE_SIZE = 25;
const SNAKE_PAGE_SIZE = 5;

/**
 * Three lookup fields on one object, each isolating one reading of the chain.
 *
 * Cast once, at the boundary: these fixtures are object-schema documents, not
 * the `RuntimeField` view the resolver narrows them to.
 */
const OBJECTS = [
  {
    name: 'quality_dispatch',
    fields: {
      // Declared (camelCase) spellings only — the shape `getObjectSchema` serves.
      camel: {
        type: 'lookup',
        label: 'Camel',
        reference: 'sys_user',
        lookupColumns: CAMEL_COLUMNS,
        lookupPageSize: CAMEL_PAGE_SIZE,
      },
      // The recorded dialect only — a document stored before the key tightened.
      snake: {
        type: 'lookup',
        label: 'Snake',
        reference: 'sys_user',
        lookup_columns: SNAKE_COLUMNS,
        lookup_page_size: SNAKE_PAGE_SIZE,
      },
      // Both present — the ranking case.
      both: {
        type: 'lookup',
        label: 'Both',
        reference: 'sys_user',
        lookupColumns: CAMEL_COLUMNS,
        lookup_columns: SNAKE_COLUMNS,
        lookupPageSize: CAMEL_PAGE_SIZE,
        lookup_page_size: SNAKE_PAGE_SIZE,
      },
    },
  },
] as unknown as ResolveActionParamsContext['objects'];

const ctx = (): ResolveActionParamsContext => ({
  objectName: 'quality_dispatch',
  objects: OBJECTS,
  fieldLabel: (_o, _f, fallback) => fallback,
});

/** Exit 1 — what this resolver emits for a field-backed param. */
const resolved = (fieldName: string) => {
  const params: RawActionParam[] = [{ field: fieldName }];
  return resolveActionParams(params, ctx())[0];
};

/** Exit 2 — the field object `ActionParamDialog` hands the widget. */
const widgetField = (fieldName: string) =>
  paramToField(resolved(fieldName)) as unknown as Record<string, unknown>;

describe('contract — the spellings this change ranks first are the ones `FieldSchema` declares (objectui#7435)', () => {
  /** The minimal lookup definition, built from `FieldSchema.shape`: `type` is
   * the only required member, and the target's declared spelling is
   * `reference` — ⛔ not `referenceTo`, which is what voided the first slice's
   * opening probe run. */
  const MINIMAL = { type: 'lookup', name: 'owner', label: 'Owner', reference: 'sys_user' };

  it('CONTROLS — the minimal lookup def is ACCEPTED and a nonsense key is REJECTED', () => {
    // Without both, an "accepted" below could be a schema that accepts anything
    // and a "rejected" could be a fixture broken for an unrelated reason.
    expect(FieldSchema.safeParse(MINIMAL).success).toBe(true);
    const nonsense = FieldSchema.safeParse({ ...MINIMAL, zzz_not_a_real_key: 'x' });
    expect(nonsense.success).toBe(false);
    expect(nonsense.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('declares `lookupColumns` and `lookupPageSize`, and refuses both snake twins', () => {
    expect(FieldSchema.safeParse({ ...MINIMAL, lookupColumns: CAMEL_COLUMNS }).success).toBe(true);
    expect(FieldSchema.safeParse({ ...MINIMAL, lookupPageSize: CAMEL_PAGE_SIZE }).success).toBe(true);
    expect(FieldSchema.safeParse({ ...MINIMAL, lookup_columns: SNAKE_COLUMNS }).success).toBe(false);
    expect(FieldSchema.safeParse({ ...MINIMAL, lookup_page_size: SNAKE_PAGE_SIZE }).success).toBe(false);
  });
});

describe('resolveActionParams lookup group — the remaining declared spellings reach the picker (objectui#7435)', () => {
  it('a camel-authored `lookupColumns` REACHES the resolved param and the widget', () => {
    // Asserted by identity: the value is carried across, not cloned or reshaped.
    expect(resolved('camel').lookupColumns).toBe(CAMEL_COLUMNS);
    // Exit 2 spells it `lookupColumns` too — the one key `LookupField` reads
    // (objectui#12157). The VALUE is what this case is about.
    expect(widgetField('camel').lookupColumns).toBe(CAMEL_COLUMNS);
  });

  it('a camel-authored `lookupPageSize` REACHES the resolved param and the widget', () => {
    expect(resolved('camel').lookupPageSize).toBe(CAMEL_PAGE_SIZE);
    expect(widgetField('camel').lookupPageSize).toBe(CAMEL_PAGE_SIZE);
  });

  it('camel WINS over snake on both keys when both spellings are present', () => {
    // The ranking needs its own case: a chain that merely CONTAINS the declared
    // leg — appended last — passes every case above and fails only here.
    const def = resolved('both');
    expect(def.lookupColumns).toBe(CAMEL_COLUMNS);
    expect(def.lookupPageSize).toBe(CAMEL_PAGE_SIZE);
    expect(widgetField('both').lookupColumns).toBe(CAMEL_COLUMNS);
    expect(widgetField('both').lookupPageSize).toBe(CAMEL_PAGE_SIZE);
  });
});

/**
 * The snake-only def, built fresh per call: the fold MUTATES the def in place,
 * and the module-level `OBJECTS` above must stay unfolded for the raw case.
 * `SNAKE_COLUMNS` is carried by reference, so identity is assertable after the
 * fold stamps it.
 */
const snakeObjects = () => [
  {
    name: 'quality_dispatch',
    fields: {
      snake: {
        type: 'lookup',
        label: 'Snake',
        reference: 'sys_user',
        lookup_columns: SNAKE_COLUMNS,
        lookup_page_size: SNAKE_PAGE_SIZE,
      },
    },
  },
] as unknown as ResolveActionParamsContext['objects'];

const resolvedFrom = (objects: ResolveActionParamsContext['objects']) =>
  resolveActionParams([{ field: 'snake' }], { ...ctx(), objects })[0];

describe('the recorded dialect reaches the picker through the ingestion fold, and only through it (objectui#12157)', () => {
  // objectui#7435 KEPT the snake legs here for a document stored before the key
  // tightened (the serve path runs no parse). objectui#7650 ruling A answered
  // that premise with the ingestion fold, and objectui#12157 retired both legs
  // on it, with no alias — the `display_field` route of objectui#11070 round 6.
  it('a `lookup_columns` / `lookup_page_size`-only def handed in UNFOLDED reaches neither exit', () => {
    // The break the changeset states: a host passing its own, unfolded
    // `objects` loses the snake value. Pinned so a restored leg turns this red.
    const def = resolvedFrom(snakeObjects());
    expect(def.lookupColumns).toBeUndefined();
    expect(def.lookupPageSize).toBeUndefined();
    const bag = paramToField(def) as unknown as Record<string, unknown>;
    expect(bag.lookupColumns).toBeUndefined();
    expect(bag.lookupPageSize).toBeUndefined();
    // …and no snake key is re-seeded onto the widget bag either.
    expect(bag).not.toHaveProperty('lookup_columns');
    expect(bag).not.toHaveProperty('lookup_page_size');
  });

  it('the SAME def, folded at ingestion, reaches both exits with its stored values', () => {
    // `normalizeSchemaReferenceKeys` is the pass `MetadataProvider` runs over
    // every object it stores and `ObjectStackAdapter.getObjectSchema` runs on
    // every schema it serves. This is the measurement the retirement rests on.
    const objects = snakeObjects();
    for (const o of objects) normalizeSchemaReferenceKeys(o);
    const def = resolvedFrom(objects);
    expect(def.lookupColumns).toBe(SNAKE_COLUMNS);
    expect(def.lookupPageSize).toBe(SNAKE_PAGE_SIZE);
    const bag = paramToField(def) as unknown as Record<string, unknown>;
    expect(bag.lookupColumns).toBe(SNAKE_COLUMNS);
    expect(bag.lookupPageSize).toBe(SNAKE_PAGE_SIZE);
  });
});
