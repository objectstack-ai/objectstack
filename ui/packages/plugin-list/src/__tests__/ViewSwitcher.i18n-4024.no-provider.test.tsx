/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The switcher's provider-less fallback stays ENGLISH — objectui#4024, and the
 * #4514 trap this card was warned about.
 *
 * Wiring `VIEW_LABELS` through the bundle is only safe because
 * `createSafeTranslation` keeps a provider-less host rendering English rather
 * than a raw `console.objectView.viewTypeGrid`. A large amount of existing
 * coverage addresses these controls by their English name with no
 * `I18nProvider` mounted (`packages/plugin-list/src/__tests__/ListView.test.tsx`
 * among them), so this is a hard constraint, not a nicety.
 *
 * ## Why this is a separate FILE and not another `it` next door
 *
 * `createI18n` registers its instance as react-i18next's module-global default
 * and that registration survives unmount and `cleanup()`. A no-provider render
 * sharing a file with locale-mounted renders resolves against whichever locale
 * ran last — measured, and recorded on
 * `packages/components/src/__tests__/sheet-dialog-close-i18n.test.tsx`
 * (objectstack#5505/#5506), where the fallback case failed naming a button
 * "Cerrar" under a test that mounted no provider at all.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * PASSES both before and after the fix — this is a must-not-change pin, not
 * evidence of the change. It goes red only if the fix reaches for
 * `useObjectTranslation` directly instead of the safe factory.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ViewSwitcherDropdown } from '../ViewSwitcher';

afterEach(() => cleanup());

describe('view switcher with no I18nProvider (objectui#4024 / #4514)', () => {
  it('renders the English labels, never a raw bundle key', () => {
    render(
      <ViewSwitcherDropdown
        currentView="grid"
        availableViews={['grid', 'gallery']}
        onViewChange={() => {}}
        animated={false}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Grid' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Gallery' })).toBeTruthy();
    expect(screen.queryByText(/console\.objectView\.viewType/)).toBeNull();
  });
});
