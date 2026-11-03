// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29690 — the generic create form (`useCreateDerive`) when the
 * pinyin dictionary lands AFTER the label was typed: a Name still following
 * the label takes the pinyin without another keystroke, and the label is never
 * reported underivable meanwhile. The dictionary is never loaded up front
 * here, so the module-wide state is "not loaded" when the case starts.
 */

import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { useCreateDerive } from './createDerive';
import { romanizerPending } from './romanizeHan';

describe('useCreateDerive re-derives when the pinyin dictionary lands (objectstack#29690)', () => {
  it('the generic create form (useCreateDerive): a following Name takes the pinyin once it lands', async () => {
    const rules = [{ from: 'label', to: 'name', transform: 'slugify' as const }];
    const { result } = renderHook(() => {
      const [draft, setDraft] = React.useState<Record<string, unknown>>({ label: '客户等级' });
      const derive = useCreateDerive({ rules, draft, onPatch: (p) => setDraft((d) => ({ ...d, ...p })) });
      return { draft, derive };
    });
    // Not landed yet: Name empty, and not reported underivable.
    expect(romanizerPending('客户等级')).toBe(true);
    expect(result.current.draft.name).toBe('');
    expect(result.current.derive.underivable).toEqual([]);
    await waitFor(() => expect(result.current.draft.name).toBe('kehu_dengji'), { timeout: 8000 });
    expect(result.current.derive.underivable).toEqual([]);
  });
});
