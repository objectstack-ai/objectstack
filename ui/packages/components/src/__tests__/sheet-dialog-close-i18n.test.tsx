/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Shadcn `Sheet`/`Dialog` close buttons speak the session locale —
 * objectstack#5505.
 *
 * Both primitives auto-render a close button that is icon-only (a lucide `X`),
 * so its `sr-only` span is not decoration: it IS the control's accessible
 * name. Upstream ships that span as a hardcoded English literal, so under
 * zh/ja/es every drawer and modal in the console — ~20 `SheetContent`
 * consumers plus every `DialogContent` consumer (ChatDock, ActivityFeed,
 * metadata-admin, AiChatPage, PeoplePicker, …) — announced "Close" in English.
 *
 * The span now renders `<CloseSrLabel />` (`../lib/close-label`), which
 * resolves `common.close`. Because `src/ui/**` is regenerated from the
 * registry, that one-line reference is DECLARED in
 * `scripts/shadcn-local-patches.mjs` and re-applied by every sync; the patch
 * mechanism itself is tested in
 * `scripts/__tests__/shadcn-local-patches.test.ts`.
 *
 * ## Why the no-provider cases matter as much as the translated ones
 *
 * A large amount of existing coverage addresses these controls by their
 * English name with NO `I18nProvider` mounted (`discardGuard.test.tsx`,
 * e2e specs). The safe
 * translation's English fallback is what keeps those green, so it is pinned
 * here explicitly rather than assumed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';

afterEach(() => cleanup());

/** Sheet/Dialog bodies carry a title + description so Radix has no a11y complaint. */
function sheetBody() {
  return (
    <Sheet open>
      <SheetContent>
        <SheetTitle>Acme Corp</SheetTitle>
        <SheetDescription>Record drawer</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

function dialogBody() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Acme Corp</DialogTitle>
        <DialogDescription>Record modal</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

function inLocale(language: string, body: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {body}
    </I18nProvider>,
  );
}

const primitives: Array<[string, () => React.ReactElement]> = [
  ['SheetContent', sheetBody],
  ['DialogContent', dialogBody],
];

describe.each(primitives)('%s close button — accessible name (objectstack#5505)', (_name, body) => {
  it('reads English under an en session', () => {
    inLocale('en', body());

    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('reads the zh bundle value under a zh session', () => {
    inLocale('zh', body());

    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
    // The literal this replaced. Before the fix this query MATCHED under zh —
    // that is the whole bug.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByText('Close')).toBeNull();
  });

  it('reads the ja bundle value under a ja session', () => {
    inLocale('ja', body());

    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('reads the es bundle value under an es session', () => {
    inLocale('es', body());

    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

/**
 * The English no-provider fallback is pinned in a FILE OF ITS OWN —
 * `sheet-dialog-close-no-provider-fallback.test.tsx`.
 *
 * `createI18n` registers its instance as react-i18next's module-global
 * default, and that registration survives unmount and `cleanup()`. So any
 * "no provider" render placed in THIS file would silently resolve against
 * whichever locale the tests above mounted last. Written here first, the
 * fallback case failed with the button named "Cerrar" under a test that
 * mounted no provider at all — see the same warning on
 * `chrome-i18n-no-provider-fallback.test.tsx` (objectstack#5506).
 */
