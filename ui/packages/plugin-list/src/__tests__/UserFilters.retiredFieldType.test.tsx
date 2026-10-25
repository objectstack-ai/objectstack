/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Item 10 of objectui#4914 — `UserFilters`' `LOOKUP_LIKE_TYPES` membership and
 * its `f.type === 'owner'` conjunct, behind the retirement gate (maintainer
 * ruling B, 2026-08-18).
 *
 * ## Why this face needed proving live at all
 *
 * `FILTER_CONTROL_KINDS`' docblock says the control type comes from the spec's
 * published `UserFilterFieldSchema.type` — an enum of five members that never
 * held the retired spelling — which would have made this face genuinely dead.
 * The premise-gate measurement (comment 5324769751) found the line that refutes
 * it, in `resolveFields`:
 *
 *     if (!resolvedType) resolvedType = fieldDef.type;
 *
 * When the view author omits the filter `type`, the resolved type is adopted
 * VERBATIM from the object definition — so a backend column typed with the
 * retired spelling flows straight into the predicate. Every case below drives
 * that exact route: `config.fields` names the field and nothing else, and the
 * type arrives only from `objectDef`.
 *
 * ## The disposition
 *
 * The chip still renders — refusing to draw it would strip a stored filter out
 * of the toolbar with nothing in its place — but it gets the ordinary control
 * instead of the remote person picker, and the author gets the prescription
 * once. That is the maintainer's answer to the boundary question: a retired
 * spelling arriving through a backend-vocabulary normalizer is an authoring
 * error to refuse loudly, not legitimate foreign input to tolerate.
 *
 * Ablation direction, predicted before running: drop the gate and
 * `refuses the remote person picker` goes RED (the picker reappears), while the
 * `user` control stays green in both directions.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { operatorsForFieldType } from '@object-ui/components';
import {
  RETIRED_FIELD_TYPES,
  isRetiredFieldType,
  resetRetiredFieldTypeReports,
} from '@object-ui/fields';
import { UserFilters } from '../UserFilters';

const RETIRED = Object.keys(RETIRED_FIELD_TYPES)[0];
/** The live sibling the retired spelling was a synonym for. */
const LIVE = 'user';

/**
 * The object definition is the ONLY place the type appears — `config.fields`
 * below never spells a `type`, so this is the `resolveFields` adoption path the
 * measurement identified, not an authored control type.
 */
const objectDef = (ownerType: string) => ({
  name: 'tasks',
  fields: {
    record_owner: { type: ownerType, label: 'Record owner' },
  },
});

function renderFilters(ownerType: string) {
  const onFilterChange = vi.fn();
  const utils = render(
    <UserFilters
      config={{ element: 'dropdown', fields: [{ field: 'record_owner' }] }}
      objectDef={objectDef(ownerType)}
      data={[]}
      onFilterChange={onFilterChange}
    />,
  );
  return { ...utils, onFilterChange };
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

describe('`UserFilters` — the backend-adopted field type', () => {
  it('gives the LIVE sibling the remote person picker', () => {
    // NON-VACUITY CONTROL, and it is the whole harness in one line: it proves
    // the adoption path reaches the predicate at all. Without it, "no picker
    // for the retired type" could just mean the popover never opened.
    renderFilters(LIVE);
    fireEvent.click(screen.getByTestId('filter-badge-record_owner'));
    expect(screen.getByTestId('filter-lookup-record_owner')).toBeTruthy();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refuses the remote person picker to a retired spelling', () => {
    renderFilters(RETIRED);
    fireEvent.click(screen.getByTestId('filter-badge-record_owner'));
    expect(screen.queryByTestId('filter-lookup-record_owner')).toBeNull();
  });

  it('still draws the chip — a refusal is not a disappearing filter', () => {
    // The rejected alternative, pinned: dropping the badge would silently
    // remove a stored filter from the toolbar, which is a worse failure than
    // the one being fixed.
    renderFilters(RETIRED);
    expect(screen.getByTestId('filter-badge-record_owner')).toBeTruthy();
  });

  it('says why, and says it once', () => {
    renderFilters(RETIRED);
    fireEvent.click(screen.getByTestId('filter-badge-record_owner'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(RETIRED_FIELD_TYPES[RETIRED]);
  });
});

describe('one gate, one console line — across packages', () => {
  it('the toolbar face and the filter-builder face share the dedupe set', () => {
    // The ruling's "fires ONCE, not once per predicate on the same value",
    // measured where it is actually at risk: `operatorsForFieldType` lives in
    // `@object-ui/components` and `UserFilters` in this package, and they reach
    // the gate by two different import spellings — `@object-ui/core` and
    // `@object-ui/fields`. If those ever resolved to two module instances there
    // would be two `reportedRetiredTypes` sets and this line would read 2.
    operatorsForFieldType(RETIRED);
    renderFilters(RETIRED);
    fireEvent.click(screen.getByTestId('filter-badge-record_owner'));
    operatorsForFieldType(RETIRED);

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('`@object-ui/fields` really does export the ruled gate', () => {
    // The ruling names this package surface specifically: "export a single
    // `isRetiredFieldType(t)` gate from `@object-ui/fields`". Pinned as an
    // import that must resolve and answer, so a re-export lost in a refactor
    // fails here rather than in someone's editor.
    expect(typeof isRetiredFieldType).toBe('function');
    for (const spelling of Object.keys(RETIRED_FIELD_TYPES)) {
      expect(isRetiredFieldType(spelling), spelling).toBe(true);
    }
    expect(isRetiredFieldType(LIVE)).toBe(false);
  });
});
