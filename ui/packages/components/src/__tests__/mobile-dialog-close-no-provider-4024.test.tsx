/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MobileDialogContent`'s close button stays ENGLISH with no provider —
 * objectui#4024.
 *
 * `CloseSrLabel` is built on `createSafeTranslation` precisely so the large
 * body of existing coverage that addresses these controls by their English
 * name with no `I18nProvider` mounted keeps working —
 * `packages/plugin-form/src/discardGuard.test.tsx` drives `ModalForm`, which
 * renders this very component, and clicks its close control.
 *
 * Separate FILE for the reason recorded on `sheet-dialog-close-i18n.test.tsx`:
 * `createI18n` registers a react-i18next module-global default that survives
 * `cleanup()`, so a no-provider render sharing a file with locale-mounted ones
 * resolves against whichever locale ran last.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * PASSES before and after — a must-not-change pin.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Dialog, DialogTitle, DialogDescription } from '../ui/dialog';
import { MobileDialogContent } from '../custom/mobile-dialog-content';

afterEach(() => cleanup());

describe('MobileDialogContent close button with no I18nProvider (objectui#4024)', () => {
  it('is named "Close", never a raw bundle key', () => {
    render(
      <Dialog open>
        <MobileDialogContent>
          <DialogTitle>Acme Corp</DialogTitle>
          <DialogDescription>Record modal</DialogDescription>
        </MobileDialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByText('common.close')).toBeNull();
  });
});
