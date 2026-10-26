/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ THE DECLARED LOOKUP LEGS REACH THE PICKER — objectui#7435.
 *
 * ## The defect, stated as what the author saw
 *
 * `resolveActionParams`' picker group read the resolved object-schema field def
 * in `snake_case` ONLY. `field` there is a `getObjectSchema` / `useMetadata()`
 * document, which serves the spec's camelCase spelling — so a field declaring
 * `displayField` / `descriptionField` / `lookupFilters` had every one of those
 * values silently dropped, and the action param rendered with picker defaults.
 * No warning fired anywhere: the resolver simply read keys that were not there.
 *
 * ## What each case asserts, and why it is the resolved VALUE
 *
 * Two exits are read, never "the resolver ran":
 *
 *   1. `ActionParamDef` — what this resolver EMITS.
 *   2. the field object `paramToField()` hands `ActionParamDialog`, which is
 *      what `LookupField` actually consumes. A value that reaches (1) but is
 *      dropped at (2) is not a fix, and only the second exit can say so.
 *
 * Camel and snake fixtures carry DIFFERENT values on every key, so no assertion
 * can be satisfied by the wrong leg.
 *
 * ## Measured, on the pin this tree resolves
 *
 * `@objectstack/spec@17.4.0` — re-measured for this card, which asked for
 * exactly this re-run (its own correction was taken on 17.2.0).
 * `FieldSchema.safeParse` over a minimal lookup def ACCEPTS `displayField`,
 * `descriptionField` and `lookupFilters`, and REJECTS every snake twin with
 * `unrecognized_keys`. Controls lit in the same run: the minimal def ACCEPTED,
 * `zzz_not_a_real_key` REJECTED.
 *
 * ## ⛔ The two carve-outs are pinned as ABSENCES
 *
 * `idField` and `titleFormat` deliberately gain no camel leg — measured on the
 * same pin, `FieldSchema` refuses both exactly as it refuses their snake twins
 * (the spec's only `idField` is on `InlineGridColumnSchema`; `titleFormat` is an
 * object-level key under an ADR-0079 deprecation toward `nameField`). Adding a
 * read would fossilise a spelling no contract declares. That fence is stated in
 * prose in three places and enforced by nothing, so
 * {@link carveOuts} asserts it: a camel-authored `idField` / `titleFormat` must
 * NOT reach the param, while the snake read keeps working.
 */
import { describe, it, expect } from 'vitest';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import {
  resolveActionParams,
  type ResolveActionParamsContext,
  type RawActionParam,
} from '@object-ui/fields';
import { paramToField } from './paramToField';

/** The camel filter value — kept by reference so identity is assertable. */
const CAMEL_FILTERS = [{ field: 'is_active', operator: 'eq', value: true }];
/** The snake filter value — a DIFFERENT array, so the wrong leg cannot pass. */
const SNAKE_FILTERS = [{ field: 'legacy_active', operator: 'eq', value: false }];

/**
 * Four lookup fields on one object, each isolating one reading of the chain.
 *
 * Cast once, at the boundary: `RuntimeField` intentionally declares no camel
 * `idField` / `titleFormat`, and the carve-out cases below must be able to
 * AUTHOR those keys in order to assert they are not read.
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
        displayField: 'full_name',
        descriptionField: 'email',
        lookupFilters: CAMEL_FILTERS,
      },
      // The recorded dialect only — a document stored before the key tightened.
      snake: {
        type: 'lookup',
        label: 'Snake',
        reference: 'sys_user',
        display_field: 'legacy_full_name',
        description_field: 'legacy_email',
        lookup_filters: SNAKE_FILTERS,
      },
      // Both present — the ranking case.
      both: {
        type: 'lookup',
        label: 'Both',
        reference: 'sys_user',
        displayField: 'full_name',
        display_field: 'legacy_full_name',
        reference_field: 'reference_field_name',
        descriptionField: 'email',
        description_field: 'legacy_email',
        lookupFilters: CAMEL_FILTERS,
        lookup_filters: SNAKE_FILTERS,
      },
      // The third display leg on its own — still the last resort, still read.
      refField: {
        type: 'lookup',
        label: 'Reference field',
        reference: 'sys_user',
        reference_field: 'reference_field_name',
      },
      // The carve-outs: camel spellings that must NOT be read…
      carveCamel: {
        type: 'lookup',
        label: 'Carve-out, camel',
        reference: 'sys_user',
        idField: 'MUST_NOT_BE_READ',
        titleFormat: 'MUST_NOT_BE_READ',
      },
      // …and the snake spellings that must keep working.
      carveSnake: {
        type: 'lookup',
        label: 'Carve-out, snake',
        reference: 'sys_user',
        id_field: 'legacy_id',
        title_format: '{legacy_name}',
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

describe('resolveActionParams lookup group — the declared spellings reach the picker (objectui#7435)', () => {
  it('a camel-authored `displayField` REACHES the resolved param and the widget', () => {
    expect(resolved('camel').displayField).toBe('full_name');
    expect(widgetField('camel').displayField).toBe('full_name');
  });

  it('a camel-authored `descriptionField` REACHES the resolved param and the widget', () => {
    expect(resolved('camel').descriptionField).toBe('email');
    expect(widgetField('camel').descriptionField).toBe('email');
  });

  it('a camel-authored `lookupFilters` REACHES the resolved param and the widget', () => {
    // Asserted by identity: the value is carried across, not cloned or reshaped.
    expect(resolved('camel').lookupFilters).toBe(CAMEL_FILTERS);
    expect(widgetField('camel').lookupFilters).toBe(CAMEL_FILTERS);
  });

  it('camel WINS over snake on all three keys when both spellings are present', () => {
    // The ranking needs its own case: a chain that merely CONTAINS the declared
    // leg — appended last — passes every case above and fails only here.
    const def = resolved('both');
    expect(def.displayField).toBe('full_name');
    expect(def.descriptionField).toBe('email');
    expect(def.lookupFilters).toBe(CAMEL_FILTERS);
  });
});

describe('resolveActionParams lookup group — the retired `display_field` (objectui#11070 round 6)', () => {
  it('a `display_field`-only def no longer reaches the picker: the leg is retired, with no alias', () => {
    expect(resolved('snake').displayField).toBeUndefined();
    expect(widgetField('snake').displayField).toBeUndefined();
  });

  it('the same def folded at ingestion reaches it as `displayField`: a served def loses nothing', () => {
    // The snake spelling is the INPUT here. `MetadataProvider` runs this fold on
    // every object it stores (objectui#7650 ruling A), which is the served path.
    const folded = normalizeSchemaReferenceKeys(structuredClone(OBJECTS[0]));
    const params: RawActionParam[] = [{ field: 'snake' }];
    const [def] = resolveActionParams(params, { ...ctx(), objects: [folded] });
    expect(def.displayField).toBe('legacy_full_name');
    expect((paramToField(def) as unknown as Record<string, unknown>).displayField).toBe('legacy_full_name');
  });
});

describe('resolveActionParams lookup group — the recorded dialect still resolves (objectui#7435)', () => {
  it('a `description_field`-only def still reaches the picker', () => {
    expect(resolved('snake').descriptionField).toBe('legacy_email');
    expect(widgetField('snake').descriptionField).toBe('legacy_email');
  });

  it('a `lookup_filters`-only def still reaches the picker', () => {
    expect(resolved('snake').lookupFilters).toBe(SNAKE_FILTERS);
    expect(widgetField('snake').lookupFilters).toBe(SNAKE_FILTERS);
  });

  it('`reference_field` remains the last display leg before nothing', () => {
    expect(resolved('refField').displayField).toBe('reference_field_name');
  });
});

describe('carveOuts — `idField` and `titleFormat` gain NO camel leg (objectui#7435)', () => {
  it('a camel-authored `idField` does NOT reach the param', () => {
    // Asserting the ABSENCE is the point: there is no declared spelling to read,
    // so reading one would fossilise an undeclared key. Routed to objectui#7650.
    expect(resolved('carveCamel').idField).toBeUndefined();
  });

  it('a camel-authored `titleFormat` does NOT reach the param', () => {
    expect(resolved('carveCamel').titleFormat).toBeUndefined();
  });

  it('the snake reads the carve-outs DO have are untouched by this change', () => {
    expect(resolved('carveSnake').idField).toBe('legacy_id');
    expect(resolved('carveSnake').titleFormat).toBe('{legacy_name}');
  });
});
