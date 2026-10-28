// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26170] `HookContext.session.locale` — the caller's locale rides on the
 * session a hook receives, so the sandboxed body runner can answer a declared
 * hook refusal (`hooks.<hook>.refusals.<CODE>.message`) in the caller's
 * language.
 */

import { describe, it, expect } from 'vitest';
import { buildSession } from './engine-execution-plumbing.js';

describe('[#26170] buildSession carries the caller\'s locale', () => {
  it('copies `execCtx.locale` onto a session that exists', () => {
    expect(buildSession({ userId: 'u1', locale: 'zh-CN' } as any)).toMatchObject({ userId: 'u1', locale: 'zh-CN' });
  });

  it('a locale alone does not make a session — it says how to speak, not who is speaking', () => {
    expect(buildSession({ locale: 'zh-CN' } as any)).toBeUndefined();
  });

  it('writes no `locale` key when none was asked', () => {
    for (const locale of [undefined, '']) {
      expect(buildSession({ userId: 'u1', locale } as any)).not.toHaveProperty('locale');
    }
  });
});
