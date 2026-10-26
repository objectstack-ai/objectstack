/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `Sheet`/`Dialog` close buttons still resolve to ENGLISH when no
 * `I18nProvider` is mounted — objectstack#5505.
 *
 * This is the load-bearing half of the fix, not a formality. Routing the
 * primitives' `sr-only` label through `t()` touches every `SheetContent` and
 * `DialogContent` consumer in the repo, and a large amount of existing
 * coverage addresses those controls by their ENGLISH accessible name with no
 * provider in the tree — `packages/plugin-form/src/discardGuard.test.tsx`
 * (`getByRole('button', { name: 'Close' })`) among them. A `t()` call without a working default renders the
 * raw `common.close` key and breaks all of it — in other packages' suites, not
 * this one's.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, which registers that
 * instance as react-i18next's module-global default, and the registration
 * survives unmount and `cleanup()`. The moment any test in a file mounts
 * `<I18nProvider config={{ defaultLanguage: 'es' }}>`, every later "no
 * provider" render in that same file resolves against the Spanish instance.
 * Written as a describe block inside
 * `sheet-dialog-close-i18n.test.tsx` this case failed with the button named
 * "Cerrar" under a test that mounted no provider at all — the identical trap
 * `chrome-i18n-no-provider-fallback.test.tsx` documents for objectstack#5506.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never
 * mounts a provider gets a genuinely clean global. Keep it that way:
 * **do not import or mount `I18nProvider` here.**
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';

afterEach(() => cleanup());

describe('Sheet/Dialog close — English fallback with no provider (objectstack#5505)', () => {
  it('names SheetContent’s close button "Close"', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Acme Corp</SheetTitle>
          <SheetDescription>Record drawer</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    // Never the raw key — that is the shape that would break the consumers above.
    expect(screen.queryByText('common.close')).toBeNull();
  });

  it('names DialogContent’s close button "Close"', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Acme Corp</DialogTitle>
          <DialogDescription>Record modal</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByText('common.close')).toBeNull();
  });
});
