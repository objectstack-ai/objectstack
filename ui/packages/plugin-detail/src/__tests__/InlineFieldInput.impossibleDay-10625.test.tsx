/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The inline date editor and a stored day that does not exist (objectui#10625).
 *
 * `InlineFieldInput` edits `date` AND `datetime` fields with the platform date
 * picker (objectui#12759; before it, one native `<input type="date">`). A
 * stored `2026-02-30` (or `2026-02-30T10:00:00Z` on a `datetime` field) is a
 * day that does not exist, and painting it blank on its own is the silent
 * blank objectui#10026 direction A rules out. The editor must answer it the way
 * `@object-ui/fields`' `DateField` does since objectui#10567: an empty control,
 * marked `aria-invalid`, described by a notice that NAMES the stored string,
 * and nothing written until the user enters a day.
 *
 * Provider-free, like the other suites here: the notice falls back to the
 * English default the fields package carries for provider-less rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { InlineFieldInput } from '../InlineFieldInput';

async function renderInline(type: string, value: unknown) {
  const onChange = vi.fn();
  const { container } = render(
    <InlineFieldInput field={{ name: 'due', type }} value={value} onChange={onChange} />,
  );
  // The platform picker's text box; it loads lazily (objectui#12759).
  const input = await waitFor(() => {
    const el = container.querySelector('[data-slot="date-picker"] input');
    if (!el) throw new Error('date picker not rendered');
    return el as HTMLInputElement;
  });
  return { container, input, onChange };
}

describe('InlineFieldInput marks a stored impossible day (objectui#10625)', () => {
  const cases: Array<[string, string]> = [
    ['date', '2026-02-30'],
    ['datetime', '2026-02-30T10:00:00Z'],
  ];

  for (const [type, stored] of cases) {
    it(`a \`${type}\` field holding ${stored} shows an empty, invalid control described by a notice naming it`, async () => {
      const { container, input, onChange } = await renderInline(type, stored);
      expect(input).not.toBeNull();
      expect(input!.value).toBe('');
      expect(input!.getAttribute('aria-invalid')).toBe('true');

      const describedBy = input!.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const notice = describedBy!
        .split(' ')
        .map((id) => container.ownerDocument.getElementById(id))
        .find((el) => el != null);
      expect(notice).toBeTruthy();
      expect(notice!.textContent).toContain(`"${stored}"`);

      // Nothing is written on mount: only a user edit emits.
      expect(onChange).not.toHaveBeenCalled();
    });
  }

  for (const [type, stored, shown] of [
    ['date', '2026-02-14', /^02\/14\/2026$/],
    // The time shows too: the date-only control dropped it (objectui#12759).
    ['datetime', '2026-02-14T14:46:20.862Z', /^02\/14\/2026, 0?2:46\s?PM$/],
  ] as const) {
    it(`a real day on a \`${type}\` field is unchanged: shown, not marked, no notice, no emit`, async () => {
      const { input, onChange } = await renderInline(type, stored);
      expect(input).not.toBeNull();
      expect(input!.value).toMatch(shown);
      expect(input!.getAttribute('aria-invalid')).not.toBe('true');
      expect(input!.getAttribute('aria-describedby')).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });
  }
});
