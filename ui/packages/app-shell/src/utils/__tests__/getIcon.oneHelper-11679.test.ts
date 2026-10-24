/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * app-shell's `getIcon` IS `getLazyIcon` from `@object-ui/components`, not a
 * copy of it (objectui#11679).
 *
 * This module used to carry its own implementation. The copy kept the
 * known-name check but not the letter-to-digit boundary objectui#9414 gave
 * `toKebabIconName`, so `Building2` — the spelling `lucide-react` exports —
 * tokenised to `building2` and degraded to the `Database` glyph in the shell
 * chrome with no signal. The identity leg is what stops a second copy from
 * growing back; the two behaviour legs say what that identity buys here.
 */

import { describe, it, expect } from 'vitest';
import { Database } from 'lucide-react';
import { getLazyIcon } from '@object-ui/components';
import { getIcon } from '../getIcon';

describe('app-shell getIcon is the one icon helper (objectui#11679)', () => {
  it('is the very function @object-ui/components exports, not a second implementation', () => {
    expect(getIcon).toBe(getLazyIcon);
  });

  it('resolves a digit-suffixed Lucide name to its own icon instead of the Database fallback', () => {
    expect(getIcon('Building2')).not.toBe(Database);
  });

  it('still degrades a name Lucide does not have to the Database fallback', () => {
    expect(getIcon('box-open')).toBe(Database);
  });
});
