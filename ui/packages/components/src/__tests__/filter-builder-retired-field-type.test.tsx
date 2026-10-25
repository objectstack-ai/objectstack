/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Item 4 of objectui#4914 — the filter builder's two field-type faces, behind
 * the retirement gate the maintainer ruled in on 2026-08-18 (option B).
 *
 * ## What was measured here BEFORE the gate (comment 5324769751)
 *
 *   - `operatorsForFieldType('owner')` equalled the `user` bucket item for
 *     item, `in` included — a retired spelling holding the full relational
 *     operator offering;
 *   - the value control chose {@link LookupValuePicker} for it through the
 *     branch's own `type === "owner"` conjunct, and the picker then defaulted
 *     its `referenceTo` to `"users"` for it.
 *
 * ## Why the disposition is "text bucket + ordinary control", not "nothing"
 *
 * The measurement that killed the mechanical-deletion plan objected to SILENCE,
 * not to the fallback: deleting the members would have degraded the column with
 * no signal, which is verbatim the failure mode `RETIRED_FIELD_TYPES`' docblock
 * exists to prevent. The gate keeps the same fallback and adds the missing
 * half — the author is TOLD, once, with the migration prescription.
 *
 * An empty operator list was considered and rejected in the source comment: a
 * blank operator trigger is objectui#4768's defect, and it would leave a stored
 * filter row unremovable. So the refusal is measured as "the answer an
 * unrecognised spelling gets", and every pin below states it that way.
 *
 * ## Ablation directions, predicted before running
 *
 *   - remove the gate from `operatorsForFieldType` (restoring `"owner"` to
 *     `lookupLikeTypes`) → the bucket pins go RED and the "logs once" pin goes
 *     red on the log count, while the control pins on `user` stay green;
 *   - remove the gate from `renderValueInput` (restoring the `type === "owner"`
 *     conjunct) → `refuses the remote person picker` goes RED;
 *   - remove ONLY the member deletions and keep the gate → nothing moves. That
 *     is the honest reading of those deletions: lockstep hygiene, not the
 *     behavioural half, and this file says so rather than implying otherwise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  RETIRED_FIELD_TYPES,
  isRetiredFieldType,
  resetRetiredFieldTypeReports,
} from '@object-ui/core';
import { FilterBuilder, operatorsForFieldType } from '../custom/filter-builder';

/** One retired spelling, read from the table — never written down here. */
const RETIRED = Object.keys(RETIRED_FIELD_TYPES)[0];

/**
 * A spelling this builder has never heard of. It is the yardstick the refusal
 * is measured against: "a retired column gets what an unknown column gets" is a
 * comparison, so the unknown side has to be a real, separate probe.
 */
const UNKNOWN = 'a_type_this_builder_has_never_heard_of';

/** The sibling that was never retired — every control assertion runs on it. */
const LIVE_LOOKUP = 'user';

const ids = (type: string | undefined) => operatorsForFieldType(type).map((op) => op.value);

const FIELDS = [
  { value: 'title', label: 'Title', type: 'text' },
  { value: 'assignee', label: 'Assignee', type: LIVE_LOOKUP, options: [] },
  { value: 'record_owner', label: 'Record owner', type: RETIRED, options: [] },
];

function renderRow(condition: Record<string, unknown>) {
  const onChange = vi.fn();
  const value = { id: 'root', logic: 'and', conditions: [{ id: 'c1', ...condition }] };
  return render(
    <FilterBuilder fields={FIELDS as any} value={value as any} onChange={onChange} />,
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredFieldTypeReports();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  resetRetiredFieldTypeReports();
});

describe('`operatorsForFieldType` — the retired spelling loses the lookup bucket', () => {
  it('the two buckets it is measured between really differ', () => {
    // NON-VACUITY CONTROL, and it has to come first. Both assertions in the
    // next test are equalities against these two lists; if the lookup bucket
    // and the text bucket happened to be identical, both would pass no matter
    // what the gate did, and this file would guard nothing.
    expect(ids(LIVE_LOOKUP)).not.toEqual(ids(UNKNOWN));
    expect(ids(LIVE_LOOKUP)).toContain('in');
    expect(ids(UNKNOWN)).not.toContain('in');
  });

  it('answers a retired spelling with the unknown-spelling bucket, not the lookup one', () => {
    expect(ids(RETIRED)).toEqual(ids(UNKNOWN));
    expect(ids(RETIRED)).not.toEqual(ids(LIVE_LOOKUP));
    // Named directly as well as by comparison: `in`/`notIn` are the relational
    // offering, and a refused column must not carry them.
    expect(ids(RETIRED)).not.toContain('in');
    expect(ids(RETIRED)).not.toContain('notIn');
  });

  it('still offers a usable row — a refusal is not a broken control', () => {
    // The rejected alternative, pinned so nobody "simplifies" the gate into it:
    // an empty bucket draws a blank operator trigger and strands a stored row.
    expect(ids(RETIRED).length).toBeGreaterThan(0);
    expect(ids(RETIRED)).toContain('equals');
  });

  it('says why, exactly once, however many times it is asked', () => {
    for (let i = 0; i < 5; i += 1) operatorsForFieldType(RETIRED);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED]);
  });

  it('stays silent for every live spelling', () => {
    for (const live of [undefined, 'text', 'number', 'date', 'select', LIVE_LOOKUP, UNKNOWN]) {
      operatorsForFieldType(live);
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('closes the CLASS — quantified over the table, not written per spelling', () => {
    for (const spelling of Object.keys(RETIRED_FIELD_TYPES)) {
      expect(isRetiredFieldType(spelling), spelling).toBe(true);
      expect(ids(spelling), spelling).toEqual(ids(UNKNOWN));
    }
  });
});

describe('the value control — a retired column is refused the remote person picker', () => {
  it('the live sibling in the same shape still gets it', () => {
    // NON-VACUITY CONTROL for the pin below: `assignee` differs from
    // `record_owner` in NOTHING but its type — same empty `options`, same
    // absent `referenceTo` — so if the picker stopped appearing for both, the
    // refusal pin would pass for the wrong reason.
    //
    // Asserted on the picker's BY-HAND id input rather than on its trigger,
    // because no `dataSource` is configured here: with none,
    // `LookupValuePicker` renders the by-hand fallback instead of the search
    // trigger. Measured, not assumed — the first spelling of this pin looked
    // for `lookup-picker-assignee` and failed for exactly that reason.
    renderRow({ field: 'assignee', operator: 'equals', value: 'usr_1' });
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Assignee id"]',
    );
    expect(input, 'the live `user` column drew no picker at all').toBeTruthy();
    expect(input!.value).toBe('usr_1');
  });

  it('draws no picker for the retired column', () => {
    renderRow({ field: 'record_owner', operator: 'equals', value: 'usr_1' });
    // The same two artifacts the live sibling produces, both absent: the
    // by-hand id input (the shape measured above) and the search trigger the
    // column would draw with a `dataSource` present.
    expect(
      document.querySelector('input[placeholder="Enter Record owner id"]'),
    ).toBeNull();
    expect(screen.queryByTestId('lookup-picker-record_owner')).toBeNull();
  });

  it('tells the author once, not once per render pass', () => {
    const { rerender } = renderRow({ field: 'record_owner', operator: 'equals', value: 'usr_1' });
    const value = {
      id: 'root',
      logic: 'and',
      conditions: [{ id: 'c1', field: 'record_owner', operator: 'equals', value: 'usr_2' }],
    };
    rerender(
      <FilterBuilder fields={FIELDS as any} value={value as any} onChange={vi.fn()} />,
    );
    // Both faces (the operator bucket AND the control chooser) run on every one
    // of these passes. One line total — that is the ruling's "once".
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED]);
  });
});
