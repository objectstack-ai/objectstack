/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `InlineEditSaveBar`'s in-flight label resolves to ENGLISH when no
 * `I18nProvider` is mounted — objectui#4396.
 *
 * `detail.saving` is one of the six keys PR #4372's census measured as reading
 * **outside** its hook's defaults table with **no inline `defaultValue`** at
 * the call site. #4372 taught `createSafeTranslation`'s fallback to honour an
 * inline default, which fixed the other 20 outside-table keys; these six carry
 * neither, so until this card they fell through to `fallbackT`'s last resort —
 * the raw key. The button announced `detail.saving` to the user mid-save.
 *
 * The call site is bare on purpose and stays bare (`t('detail.saving')`,
 * `InlineEditSaveBar.tsx`); the fix is the row in
 * `DETAIL_DEFAULT_TRANSLATIONS`, byte-identical to `en.detail.saving`.
 *
 * Direction: this file was RED before the change (it rendered the raw key) and
 * is GREEN after. The negative assertion is the load-bearing half — asserting
 * only `'Saving…'` would also pass if the bar rendered both.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`, so one `<I18nProvider>` mount
 * anywhere in a file silently resolves every later "no provider" render in that
 * same file against it — a green-looking file that asserts nothing about the
 * fallback. Vitest's `dom` project runs with `isolate: true`, so a file that
 * never mounts a provider gets a genuinely clean global. Keep it that way:
 * **do not import or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

/**
 * Drives the shared inline-edit context into the one state that renders the
 * label: `editing` (the bar returns `null` otherwise) with `saving` true.
 */
function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('status')}>edit-enter</button>
      <button onClick={() => inline.setSaving(true)}>edit-saving</button>
    </>
  );
}

function renderSavingBar() {
  render(
    <InlineEditProvider canEdit>
      <Harness />
      <InlineEditSaveBar objectName="proj" recordId="p1" data={{ updated_at: 'v1' }} />
    </InlineEditProvider>,
  );
  fireEvent.click(screen.getByText('edit-enter'));
  fireEvent.click(screen.getByText('edit-saving'));
}

afterEach(() => cleanup());

describe('InlineEditSaveBar saving label — English fallback with no provider (objectui#4396)', () => {
  it('renders the en value, never the raw key', () => {
    renderSavingBar();

    expect(screen.getByText('Saving…')).toBeTruthy();
    expect(screen.queryByText('detail.saving')).toBeNull();
  });

  it('leaves no `detail.` raw key anywhere in the bar', () => {
    // Non-vacuity for the case above: a bar that rendered nothing at all would
    // satisfy `queryByText(...) === null` for the empty reason. This asserts
    // the bar IS mounted (its Cancel control resolves) while carrying no raw
    // key of any kind.
    renderSavingBar();

    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/detail\.[a-zA-Z]/);
  });
});
