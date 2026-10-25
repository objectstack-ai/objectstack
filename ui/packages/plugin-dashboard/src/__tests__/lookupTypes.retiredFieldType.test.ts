/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Items 8 and 9 of objectui#4914 — `computeLookupExpand`'s `$expand` whitelist
 * and `isLookupType`, behind the retirement gate (maintainer ruling B).
 *
 * Both were measured live before the ruling (comment 5324769751):
 *
 *   - `computeLookupExpand` ACTIVELY requested `$expand` for a
 *     `record_owner: { type: 'owner' }` column — the retired spelling holding
 *     the full relational read path;
 *   - `isLookupType('owner') === true`, at exactly the same level as
 *     `isLookupType('reference') === true`.
 *
 * ## What the refusal costs, stated rather than hidden
 *
 * Refusing `$expand` means the cell shows the raw foreign-key id. That is the
 * degradation the premise-gate measurement objected to — and the objection was
 * to its SILENCE. The gate keeps the degradation and adds the missing half: the
 * author is told, once, with the migration prescription, at the moment the
 * renderer stops resolving the reference. A column whose editor already answers
 * with a tombstone was never going to render its reference for long.
 *
 * Ablation direction, predicted before running: drop the gate from either face
 * and that face's refusal pin goes RED (`isLookupType` returning true; the
 * accessor reappearing in the expand list) while the `reference`/`user`
 * controls stay green in both directions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RETIRED_FIELD_TYPES, resetRetiredFieldTypeReports } from '@object-ui/core';
import { isLookupType } from '../recordFields';
import { computeLookupExpand } from '../ObjectDataTable';

const RETIRED = Object.keys(RETIRED_FIELD_TYPES)[0];

/**
 * Relations that were never retired — the non-vacuity control for the gate.
 *
 * This list used to read `['lookup', 'reference', 'master_detail', 'user']`, and
 * called `reference` "the load-bearing one: as absent from the spec's closed
 * `FieldType` as the retired spelling is … a deliberate compatibility member —
 * the measurement's reductio". objectui#5692 acted on that reductio: this face
 * now reads `EXPANDABLE_FIELD_TYPES` from `@object-ui/core` instead of a private
 * table, so `reference` is no longer a relation here and `tree` is. Rewritten
 * rather than re-spelled, because the old entry pinned the very branch that
 * change deleted — it would have kept passing only while the fork survived.
 *
 * The gate itself (objectui#4914, ruling B) is untouched: it runs AHEAD of the
 * membership test either way, and every assertion about it below is unchanged.
 */
const LIVE_RELATIONS = ['lookup', 'master_detail', 'tree', 'user'] as const;

const objectSchema = (ownerType: string) => ({
  fields: {
    id: { type: 'text' },
    account: { type: 'lookup', reference: 'accounts' },
    assignee: { type: 'user' },
    record_owner: { type: ownerType },
    title: { type: 'text' },
  },
});

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredFieldTypeReports();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  resetRetiredFieldTypeReports();
});

describe('`isLookupType` — item 9', () => {
  it('still answers true for every live relation, silently', () => {
    // NON-VACUITY CONTROL: the gate must refuse the RETIRED spelling without
    // taking any live relation with it. `reference` used to sit here for a
    // sharper reason — it is as absent from the spec's closed `FieldType` as the
    // retired spelling, so it caught a gate mistakenly written as "not in the
    // spec enum". objectui#5692 removed it from this face for exactly that
    // absence, and `tree` took its place in the list.
    for (const live of LIVE_RELATIONS) {
      expect(isLookupType(live), live).toBe(true);
    }
    expect(isLookupType('text')).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('answers false for a retired spelling, where it used to answer true', () => {
    expect(isLookupType(RETIRED)).toBe(false);
    // The comparison the measurement made was against `reference`, which sat at
    // the retired spelling's level. objectui#5692 removed that spelling from
    // this face, so the comparison is now made against a relation that is still
    // live — it says the same thing (the retired spelling does NOT rank with a
    // real relation) without depending on the branch that was deleted.
    expect(isLookupType(RETIRED)).not.toBe(isLookupType('lookup'));
  });

  it('tolerates the non-string inputs its signature accepts', () => {
    expect(isLookupType(undefined)).toBe(false);
    expect(isLookupType(null)).toBe(false);
    expect(isLookupType(42)).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('closes the CLASS — quantified over the table', () => {
    for (const spelling of Object.keys(RETIRED_FIELD_TYPES)) {
      expect(isLookupType(spelling), spelling).toBe(false);
    }
  });
});

describe('`computeLookupExpand` — item 8', () => {
  it('still expands the live relations, in both column modes', () => {
    // NON-VACUITY CONTROL: the auto-derive mode and the explicit-whitelist mode
    // are two separate code paths through the predicate, so both are exercised
    // before anything is asserted absent.
    const auto = computeLookupExpand({}, objectSchema('user'));
    expect(auto).toEqual(expect.arrayContaining(['account', 'assignee', 'record_owner']));

    const explicit = computeLookupExpand(
      { columns: ['account', 'record_owner', 'title'] },
      objectSchema('user'),
    );
    expect(explicit).toEqual(expect.arrayContaining(['account', 'record_owner']));
    expect(explicit).not.toContain('title');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('drops the retired column from `$expand` in auto-derive mode', () => {
    const out = computeLookupExpand({}, objectSchema(RETIRED));
    expect(out).not.toContain('record_owner');
    // The other two relations must survive, or the refusal took the whole
    // whitelist with it.
    expect(out).toEqual(expect.arrayContaining(['account', 'assignee']));
  });

  it('drops it from an explicit column whitelist too', () => {
    const out = computeLookupExpand(
      { columns: ['account', 'record_owner'] },
      objectSchema(RETIRED),
    );
    expect(out).toEqual(['account']);
  });

  it('says why exactly once, across both modes and every column', () => {
    computeLookupExpand({}, objectSchema(RETIRED));
    computeLookupExpand({ columns: ['record_owner'] }, objectSchema(RETIRED));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED]);
  });
});
