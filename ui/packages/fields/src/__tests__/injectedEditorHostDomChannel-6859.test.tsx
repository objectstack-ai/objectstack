/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The widgets an inline ("injected") cell editor resolves to DO carry a host's
 * DOM pass-through set onto a real control — measured, not assumed
 * (objectui#6859).
 *
 * ## What this is evidence for
 *
 * `packages/components/src/renderers/complex/data-table.tsx` used to justify
 * its document-level `pointerdown` commit with "the injected widgets (text,
 * number, date, lookup, …) have no such handler". #6859 corrected that comment,
 * and this file is what stops the old claim coming back: the three widget types
 * that sentence names are asserted here to deliver the host's set — including
 * `onBlur` — to a control the user can actually focus.
 *
 * (The reason the listener is still needed is a different one, and it lives in
 * `@object-ui/components`: nothing on that seam ever PASSES the widget an
 * `onBlur`. That half is pinned by
 * `data-table-injected-editor-focus-6859.test.tsx`.)
 *
 * ## Probe and control
 *
 * The locator is a `data-*` sentinel rather than `id`: `data-*` is an open
 * family `toDomProps` forwards by prefix, and — unlike `id` — no widget
 * re-writes it further down, so "the sentinel is on element X" means "the host
 * set reached element X" and nothing else.
 *
 * `GeolocationField` is the CONTROL, and it is a control precisely because it
 * must answer BOTH ways in one render: the latitude box takes `{...domProps}`,
 * the longitude box deliberately takes none — a composite widget must not
 * duplicate `id` / `name` onto a second element. A probe that cannot see that
 * asymmetry cannot be trusted when it reports delivery elsewhere.
 *
 * ⚠️ The longitude assertion pins a DELIBERATE exception. Do not "repair" it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { TextField } from '../widgets/TextField';
import { DateField } from '../widgets/DateField';
import { LookupField } from '../widgets/LookupField';
import { GeolocationField } from '../widgets/GeolocationField';

afterEach(() => cleanup());

const PROBE = 'data-os6859' as const;

/** The host props an inline-edit host would hand a widget. */
function hostProps(onBlur: () => void) {
  return {
    value: '',
    onChange: () => {},
    onBlur,
    [PROBE]: 'probe',
  } as any;
}

describe('injected-editor widgets carry the host DOM channel (objectui#6859)', () => {
  it.each([
    ['text', TextField, { name: 'f', type: 'text' }],
    ['date', DateField, { name: 'f', type: 'date' }],
    ['lookup', LookupField, { name: 'f', type: 'lookup', reference: 'sys_user' }],
  ] as const)(
    '%s — the host set reaches a real control, and onBlur fires from it',
    (_label, Widget, field) => {
      const onBlur = vi.fn();
      const { container } = render(
        <Widget field={field as any} {...hostProps(onBlur)} />,
      );

      const carriers = container.querySelectorAll(`[${PROBE}]`);
      expect(carriers.length).toBeGreaterThan(0);

      // A real control, not a wrapper div: this is the half the stale comment
      // got wrong, so it is asserted rather than inferred.
      const control = carriers[0] as HTMLElement;
      expect(['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT']).toContain(control.tagName);

      fireEvent.blur(control);
      expect(onBlur).toHaveBeenCalledTimes(1);
    },
  );

  it('CONTROL: GeolocationField delivers to latitude and deliberately WITHHOLDS from longitude', () => {
    // Both halves in one render. If the probe cannot see the withheld half it
    // cannot be trusted about the delivered ones above.
    const onBlur = vi.fn();
    const { container } = render(
      <GeolocationField field={{ name: 'geo', type: 'geolocation' } as any} {...hostProps(onBlur)} />,
    );

    const carriers = Array.from(container.querySelectorAll(`[${PROBE}]`));
    expect(carriers.length).toBe(1);

    const latitude = container.querySelector('[id$="-latitude"]');
    const longitude = container.querySelector('[id$="-longitude"]');
    expect(latitude).toBeTruthy();
    expect(longitude).toBeTruthy();

    expect(latitude).toHaveAttribute(PROBE);
    // ⚠️ Deliberate — a composite widget must not duplicate the host's `id` /
    // `name` onto a second element. Not a defect; do not "fix" it.
    expect(longitude).not.toHaveAttribute(PROBE);

    fireEvent.blur(latitude as HTMLElement);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
