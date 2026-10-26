/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The no-provider half of objectui#3263: routing the built-in `select` branch's
 * empty copy through `t('fields.options.empty')` must not change what a form
 * with NO `I18nProvider` renders — a standalone form, a test, an embedded
 * widget. `createSafeTranslation`'s defaults map carries the same English
 * sentence the branch used to hardcode, so the output stays byte-identical.
 *
 * Deliberately its own file: `I18nProvider` registers its instance as
 * react-i18next's global default, so any module graph that mounts one (see
 * `form-builtin-select-empty-i18n.test.tsx`) no longer has a "no provider"
 * state to observe.
 *
 * The second assertion pins something the fix could plausibly have broken: the
 * empty state moved from an inline `<div>` to a small component, and
 * `<FormControl>` is a Radix `Slot` that hands the control its `id` — drop the
 * rest props and the box stops receiving the id and the description link.
 *
 * ⚠️ That assertion used to read `expect(label).toHaveAttribute('for', box.id)`,
 * which pinned the very association objectui#3991 removed: this branch renders
 * NO control, and `for` may only reference a labelable element, so a `for`
 * naming this `<div>` was inert HTML. The Slot half — the id and the
 * `aria-describedby` reaching the box — is what #3263 actually needed to keep
 * true, and it still is; the `for` half is now pinned from the other side, in
 * `form-builtin-select-empty-label-association.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />);
}

const unconfiguredSelect = [
  { name: 'province', label: 'Province', type: 'select', options: [] },
];

describe('form renderer — built-in select empty state without an I18nProvider (objectui#3263)', () => {
  it('falls back to the same English sentence it used to hardcode', () => {
    renderForm(unconfiguredSelect);

    expect(screen.getByText('No options available')).toBeInTheDocument();
  });

  it('still receives the Slot props, and carries no label association (objectui#3991)', () => {
    renderForm(unconfiguredSelect);

    const box = screen.getByText('No options available');
    const label = screen.getByText('Province');

    // The #3263 half: the rest props still reach the box, so the component
    // boundary did not swallow what `<FormControl>`'s Slot hands down.
    expect(box.id).toBeTruthy();
    expect(box).toHaveAttribute('aria-describedby');
    // The #3991 half: no control renders here, so the label names nothing —
    // a `for` pointing at this `<div>` would be inert HTML.
    expect(label).not.toHaveAttribute('for');
  });
});
