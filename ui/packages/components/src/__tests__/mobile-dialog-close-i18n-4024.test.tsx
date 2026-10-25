/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MobileDialogContent`'s close button speaks the session locale —
 * objectui#4024, closing the gap objectstack#5505 left open.
 *
 * ## This is a REMAINDER, not a fresh bug — and the difference matters
 *
 * objectstack#5505 already fixed this class: `CloseSrLabel` (`../lib/close-label`)
 * resolves `common.close`, and `sheet-dialog-close-i18n.test.tsx` pins it for
 * `SheetContent` and `DialogContent`. But #5505 patched the two SHADCN-SYNCED
 * primitives under `src/ui/**`, reached by the declared patch in
 * `scripts/shadcn-local-patches.mjs`. `custom/mobile-dialog-content.tsx` is not
 * in that regeneration zone and carries its own hand-written close button, so
 * it kept a hardcoded `< span className="sr-only" >Close< /span >` and no test
 * looked at it.
 *
 * That is exactly the string the card reports. `MobileDialogContent` is what
 * `plugin-form`'s `ModalForm` renders (`ModalForm.tsx:834`), so on a zh-CN
 * console the create/edit dialog — one of the two screens the card names — is
 * precisely where an English "Close" was still being announced. The triage seat
 * on objectstack#5084 warned that this family was partly landed and told the
 * implementer to reconcile with the landed fixes and "只补余量"; this file is
 * the余量, measured rather than assumed.
 *
 * ## Assertions are accessible-name queries
 *
 * The button is icon-only (a lucide `X`), so the `sr-only` span IS its
 * accessible name — the thing assistive tech announces and the thing
 * `getByRole('button', { name })` matches. A `getByText` would pass on
 * decoration.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * Pre-fix, on `origin/main`:
 *   - every non-English case FAILS — the literal renders, so the button is
 *     named "Close" in every locale and `{ name: '关闭' }` matches nothing.
 *     The `queryByRole({ name: 'Close' })` negative assertions fail in the
 *     other direction on the very same render, which is the bug stated twice;
 *   - the en case PASSES pre-fix — the literal equals the `en` pack value.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { Dialog, DialogTitle, DialogDescription } from '../ui/dialog';
import { MobileDialogContent } from '../custom/mobile-dialog-content';

afterEach(() => cleanup());

function body() {
  return (
    <Dialog open>
      <MobileDialogContent>
        <DialogTitle>Acme Corp</DialogTitle>
        <DialogDescription>Record modal</DialogDescription>
      </MobileDialogContent>
    </Dialog>
  );
}

function inLocale(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {body()}
    </I18nProvider>,
  );
}

describe('MobileDialogContent close button — accessible name (objectui#4024)', () => {
  it('reads English under an en session (must-not-change)', () => {
    inLocale('en');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('reads the zh bundle value under a zh session', () => {
    inLocale('zh');
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
    // The literal this replaced. Before the fix this query MATCHED under zh —
    // that is the whole bug.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('reads the ja bundle value under a ja session', () => {
    inLocale('ja');
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('reads the ar bundle value under an ar session', () => {
    inLocale('ar');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

/**
 * The English no-provider fallback is pinned in a FILE OF ITS OWN —
 * `mobile-dialog-close-no-provider-4024.test.tsx`, for the reason
 * `sheet-dialog-close-i18n.test.tsx` records: `createI18n` registers a
 * react-i18next module-global default that survives `cleanup()`, so a
 * no-provider render placed here would resolve against whichever locale ran
 * last (it failed naming a button "Cerrar" when they tried it).
 */
