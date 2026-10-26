/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10377 — every `mode` the `ui:calendar` designer offers is a mode
 * the contract admits.
 *
 * The registration `inputs` offered `'default'` beside `single` / `multiple` /
 * `range`. `CalendarSchema.mode` (TS) and the `UiCalendarSchema` mirror both
 * refuse it, so an author who picked it in the designer stored a document the
 * save-gate rejects. `DayPicker` (react-day-picker 10) has no `default` mode
 * either: under it the picker drops the authored selection and a click selects
 * nothing. The enum now lists the contract's modes only.
 *
 * The pin is enum ⊆ contract, judged by the mirror itself: nothing here
 * restates the list of modes, so a value added to the designer enum that the
 * mirror refuses turns this red, whatever the value is.
 */
import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { UiCalendarSchema } from '@object-ui/types/zod';
// Registers the renderers at module scope, NOT inside a hook (objectui#3010).
import '../../../renderers';

/** The values the `ui:calendar` designer offers for `mode`. */
function designerModes(): unknown[] {
  const input = (ComponentRegistry.getConfig('ui:calendar')?.inputs ?? []).find(
    (i) => i.name === 'mode',
  );
  return (input?.enum ?? []).map((e) =>
    typeof e === 'object' && e !== null ? (e as { value: unknown }).value : e,
  );
}

describe('ui:calendar designer `mode` enum ⊆ UiCalendarSchema.mode (objectui#10377)', () => {
  it('the registration offers a `mode` enum at all (non-vacuity)', () => {
    expect(designerModes().length).toBeGreaterThan(0);
  });

  it('every offered mode passes UiCalendarSchema.safeParse', () => {
    const refused = designerModes().filter(
      (mode) => !UiCalendarSchema.safeParse({ type: 'ui:calendar', mode }).success,
    );
    expect(refused).toEqual([]);
  });

  it('control: the mirror still refuses `default`, so the check above can fail', () => {
    const result = UiCalendarSchema.safeParse({ type: 'ui:calendar', mode: 'default' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('mode');
  });
});
