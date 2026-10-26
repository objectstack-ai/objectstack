/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4514, the `unit` project's half.
 *
 * The sibling `global-instance-reset.test.tsx` pins the DOM projects. This one
 * exists because the `unit` project is where the same leak is WORSE, and it is
 * easy to assume node-env tests are out of reach of a React-flavoured bug:
 *
 *   - `createI18n()` installs react-i18next's global from plain node code — no
 *     React, no render, no provider needed. `instance.use(initReactI18next)`
 *     is what does it, and `packages/i18n/src/__tests__/i18n.test.ts` calls
 *     `createI18n()` a dozen times.
 *   - the `unit` project runs `isolate: false` (vitest.config.mts), so its
 *     module graph — react-i18next's module-level pointer included — is shared
 *     across FILES in a worker. Uncontained, an instance installed by one file
 *     is still the global for the next file that worker picks up.
 *
 * A cross-file assertion would depend on worker assignment and file ordering,
 * so this pins the per-test guarantee that makes the cross-file one hold.
 */

import { describe, it, expect } from 'vitest';
import { getI18n } from 'react-i18next';
import { createI18n } from '../i18n';

describe('objectui#4514 — createI18n does not leave a global behind (unit project)', () => {
  it('baseline: no global before anything in this file runs', () => {
    expect(getI18n()).toBeUndefined();
  });

  it('createI18n installs itself as the react-i18next global', () => {
    const instance = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
    // Not incidental — this is `initReactI18next`'s documented job, and the
    // reason `useObjectTranslation()` is provider-safe.
    expect(getI18n()).toBe(instance);
    expect(getI18n().language).toBe('zh');
  });

  it('THE PIN: the next test sees no global at all', () => {
    expect(getI18n()).toBeUndefined();
  });

  it('THE PIN: holds for a second instance too', () => {
    createI18n({ defaultLanguage: 'ja', detectBrowserLanguage: false });
    expect(getI18n().language).toBe('ja');
  });

  it('THE PIN: and again after that one', () => {
    expect(getI18n()).toBeUndefined();
  });
});
