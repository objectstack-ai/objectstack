/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7217 — a `null` entry in `grouping.fields[]` must not take the grid
 * down.
 *
 * ## The defect
 *
 * `ObjectGrid`'s `groupValueFormatter` memo walked `grouping.fields` and read
 * `gf.field` off every entry with no guard, so a single `null` hole threw
 * `TypeError: Cannot read properties of null (reading 'field')` during render
 * — the whole grid, gone, before any projection was built.
 *
 * `useGroupedData` is a SECOND dereference site of the same list (`const f =
 * fields[depth]` then `f.field` / `f.order` / `f.collapsed`), so guarding the
 * memo alone only moves the crash one call downstream. Both sites now read one
 * normalized entry list — `usableGroupingFields` — and this file pins both:
 * ablating either guard on its own turns these tests red.
 *
 * ## Why a guard, not a schema change (the reachability measurement)
 *
 * Author-time validation ALREADY refuses a null entry — `GroupingConfigSchema`
 * types `fields` as an array of `$strict` objects, so `{ fields: [null] }`
 * fails with `invalid_type` at `fields.0`, and objectui's own `ListViewSchema`
 * inherits that by reference. The last two `it`s below measure exactly that,
 * so the claim is checked rather than asserted in prose.
 *
 * That makes this a defensive guard rather than a validation gap — but the
 * crash is still live, because NOTHING ON THE RENDER PATH RUNS THAT VALIDATOR.
 * `ObjectGrid` reads `schema.grouping` straight off its props; `@object-ui/core`'s
 * `validateSchema` is structural and never looks at the `grouping` key. A
 * runtime-composed or generated schema therefore reaches the memo unparsed,
 * which is the reachable path this pin closes.
 *
 * ## Test-source note
 *
 * The root vitest config aliases `@object-ui/*` to each package's `src`, and
 * this file imports `../ObjectGrid` relatively, so no build step stands
 * between the edit and the run — the ablation recorded in the PR body reads
 * source directly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { GroupingConfigSchema } from '@objectstack/spec/ui';
import { ListViewSchema } from '@object-ui/types/zod';

registerAllFields();

const ROWS = [
  { id: '1', name: 'Row 1', active: true },
  { id: '2', name: 'Row 2', active: false },
  { id: '3', name: 'Row 3', active: true },
];

/**
 * Mount a grid whose `grouping.fields` is exactly `fields`.
 *
 * `data.provider: 'value'` keeps the rows inline, so `useGroupedData` runs over
 * a NON-EMPTY array: the hook's dereference is only reached once there is a row
 * to bucket, and a pin mounted on empty data would leave that half unmeasured.
 */
function renderGrid(fields: unknown[]) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'active', label: 'Active', type: 'boolean' },
    ],
    data: { provider: 'value', items: ROWS },
    grouping: { fields },
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
}

const groupLabels = () =>
  Array.from(document.querySelectorAll('.group-label')).map((el) => el.textContent);

afterEach(() => cleanup());

describe('ObjectGrid — a null `grouping.fields[]` entry never crashes the grid (objectui#7217)', () => {
  // ── PIN 1: THE DEFECT ───────────────────────────────────────────────────
  it('renders instead of throwing when the only grouping entry is null', async () => {
    expect(
      () => renderGrid([null]),
      'a null hole in `grouping.fields[]` threw a TypeError out of render and '
        + 'took the whole grid down before any projection was built',
    ).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('Row 1'));
    expect(document.body.textContent).toContain('Row 2');
    expect(document.body.textContent).toContain('Row 3');
  });

  it('renders instead of throwing when the only grouping entry is undefined', async () => {
    // Same defect class as `null`: a hole a trailing comma or a sparse
    // generator leaves behind, which no dereference can survive.
    expect(() => renderGrid([undefined])).not.toThrow();
    await waitFor(() => expect(document.body.textContent).toContain('Row 1'));
  });

  // ── PIN 2: THE SURVIVING ENTRY STILL GROUPS ─────────────────────────────
  // The guard must DROP the unusable entry, not abandon grouping altogether —
  // otherwise a single hole silently degrades a working grouped view into a
  // flat one, which is the objectui#7179 class of silent wrong answer.
  it('still groups by the usable entry when a null precedes it', async () => {
    expect(() => renderGrid([null, { field: 'active' }])).not.toThrow();
    await waitFor(() => expect(groupLabels().length).toBeGreaterThan(0));
    expect(groupLabels()).toEqual(expect.arrayContaining(['Yes', 'No']));
  });

  it('still groups by the usable entry when a null follows it at a deeper level', async () => {
    // The second entry is the NESTED level, so this reaches `buildLevel`'s
    // recursion rather than only its depth-0 call.
    expect(() => renderGrid([{ field: 'active' }, null])).not.toThrow();
    await waitFor(() => expect(groupLabels().length).toBeGreaterThan(0));
    expect(groupLabels()).toEqual(expect.arrayContaining(['Yes', 'No']));
  });

  // ── PIN 3: REACHABILITY — the validator refuses it, the render path never runs one ──
  it('author-time validation already refuses a null entry (`@objectstack/spec`)', () => {
    const refused = GroupingConfigSchema.safeParse({ fields: [null] });
    expect(refused.success).toBe(false);
    expect(refused.success === false && refused.error.issues[0]).toMatchObject({
      code: 'invalid_type',
      path: ['fields', 0],
    });
    // Positive control: the well-formed entry the same schema accepts, so a
    // schema that refused EVERYTHING could not pass the assertion above.
    expect(GroupingConfigSchema.safeParse({ fields: [{ field: 'active' }] }).success).toBe(true);
  });

  it("objectui's own `ListViewSchema` inherits that refusal by reference", () => {
    const refused = ListViewSchema.safeParse({
      type: 'list-view',
      objectName: 'test_object',
      grouping: { fields: [null] },
    });
    expect(refused.success).toBe(false);
    expect(
      refused.success === false
        && refused.error.issues.some((i) => i.path.join('.') === 'grouping.fields.0'),
      '`grouping` is imported into `ListViewSchema` from the spec by reference, so '
        + 'the entry-shape refusal must arrive with it',
    ).toBe(true);
    // Positive control: the same payload with a well-formed entry is accepted,
    // so the refusal above is about the null entry and not about the envelope.
    expect(
      ListViewSchema.safeParse({
        type: 'list-view',
        objectName: 'test_object',
        grouping: { fields: [{ field: 'active' }] },
      }).success,
    ).toBe(true);
  });
});
