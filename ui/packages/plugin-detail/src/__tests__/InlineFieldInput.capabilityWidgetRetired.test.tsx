/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the `capability-multiselect` widget hint (objectui#3308,
 * ADR-0049 enforce-or-remove).
 *
 * `InlineFieldInput` used to special-case `field.widget ===
 * 'capability-multiselect'` and render `CapabilityMultiSelectField`. It was the
 * hint's ONLY surviving consumer: no producer stamps it, and
 * `field:capability-multiselect` was registered only
 * on the docs-site-only `registerFields()` path, so the form path never resolved
 * it. Keeping one honoring surface for a name nothing emits and no form resolves
 * is the declared-vs-enforced split #3308 was filed about, inverted.
 *
 * Contract now: an unregistered/retired widget hint degrades to the field's
 * declared `type` renderer — the same behavior every other unknown hint gets.
 *
 * Reverse-verified: restoring the deleted branch turns this file red (the picker
 * renders its "Loading capabilities…" placeholder and no text input carries the
 * stored JSON).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineFieldInput } from '../InlineFieldInput';

// The retired hint, exactly as stored metadata could still spell it.
const RETIRED_HINT_FIELD = {
  name: 'system_permissions',
  type: 'textarea',
  widget: 'capability-multiselect',
} as any;

const STORED = '["setup.access","studio.access"]';

describe('InlineFieldInput — retired capability-multiselect hint (objectui#3308)', () => {
  it('degrades to the declared type renderer instead of the capability picker', () => {
    render(
      <InlineFieldInput field={RETIRED_HINT_FIELD} value={STORED} onChange={vi.fn()} />,
    );

    // The picker is gone: its unconditional empty-state placeholder must not
    // appear, and neither must the toggle chips it renders (role=button).
    expect(screen.queryByText(/Loading capabilities/i)).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    // The value round-trips through the plain type renderer instead.
    expect(screen.getByDisplayValue(STORED)).toBeInTheDocument();
  });
});
