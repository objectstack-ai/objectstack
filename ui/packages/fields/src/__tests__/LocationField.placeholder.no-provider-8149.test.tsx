/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `LocationField`'s fallback placeholder with NO `I18nProvider` mounted
 * (objectui#8149) — standalone usage, and every test that renders the widget
 * bare.
 *
 * Keying the hint's nouns must leave this path byte-identical to the literal it
 * replaced: `createSafeTranslation` falls back to `FIELD_DEFAULTS`, whose two
 * noun rows are the English words, and the widget joins them itself.
 *
 * Why a separate FILE rather than a case in
 * `LocationField.placeholderI18n-8149.test.tsx`: mounting `I18nProvider` calls
 * `initReactI18next`, which installs that instance as react-i18next's GLOBAL
 * default, so once a sibling case has mounted one there is no provider-less
 * state left to observe in that module graph. Vitest's per-file isolation is
 * what makes this observation honest — the split
 * `TagsField.placeholder.no-provider.test.tsx` states for the same reason.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

import { LocationField } from '../widgets/LocationField';

type LocationFieldMeta = React.ComponentProps<typeof LocationField>['field'];

const undeclared: LocationFieldMeta = { name: 'site', label: 'Site', type: 'location' };

function placeholderOf(field: LocationFieldMeta): string | null {
  const { container } = render(<LocationField value={null} onChange={vi.fn()} field={field} />);
  return (container.querySelector('input') as HTMLInputElement).getAttribute('placeholder');
}

describe('LocationField placeholder with no i18n configured (objectui#8149)', () => {
  it('renders the English pair it rendered before, not a raw key', () => {
    const placeholder = placeholderOf(undeclared);
    expect(placeholder).toBe('latitude, longitude');
    expect(placeholder).not.toContain('fields.location');
  });

  it('ships no CJK from code (Commandment #-1)', () => {
    // With no provider mounted, whatever renders here came from CODE. The
    // ranges are numeric code points (kana and CJK punctuation, then the
    // unified ideographs) so this file itself carries no CJK character.
    const isCjk = (ch: string) => {
      const cp = ch.codePointAt(0) ?? 0;
      return (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0x4e00 && cp <= 0x9fff);
    };
    expect([...(placeholderOf(undeclared) ?? '')].filter(isCjk)).toEqual([]);
  });

  it('lets the author-declared placeholder win', () => {
    expect(placeholderOf({ ...undeclared, placeholder: 'Office GPS (lat, lng)' })).toBe('Office GPS (lat, lng)');
  });
});
