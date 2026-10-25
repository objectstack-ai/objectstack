/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ConfigFieldRenderer`'s select fallback with NO `I18nProvider` —
 * objectui#11252.
 *
 * The fallback reads `common.select` through a `createSafeTranslation` defaults
 * map because this primitive has provider-less consumers, where the bare hook
 * answers the raw key. This leg pins that path: no provider, no instance, and
 * the trigger shows the en pack's word, never the key.
 *
 * Its own file on purpose: `createI18n` registers a module-global instance that
 * survives `cleanup()`, so this file creates none. The en word is read from the
 * pack module itself, not from an instance.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { en } from '@object-ui/i18n';
import { ConfigFieldRenderer } from '../custom/config-field-renderer';

afterEach(cleanup);

describe('objectui#11252 — a config select with no provider shows the en word, never the raw key', () => {
  it('renders the en pack\'s `common.select`', () => {
    render(
      <ConfigFieldRenderer
        field={{
          key: 'theme',
          label: 'Theme',
          type: 'select',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ],
        }}
        value={undefined}
        onChange={vi.fn()}
        draft={{}}
      />,
    );
    const text = screen.getByTestId('config-field-theme').textContent ?? '';
    expect(text).not.toContain('common.select');
    expect(text).toContain(en.common.select);
  });
});
