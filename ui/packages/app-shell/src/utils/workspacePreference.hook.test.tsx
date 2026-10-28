/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 — `useWorkspacePreference`, the live read: the fallback
 * while there is no choice, every caller of the same preference and scope
 * re-rendered by a write, a scope apart from every other, another tab's write
 * heard through the `storage` event, and a choice a refusing storage would
 * not keep held for this page.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
  RECORD_TIMELINE_COLUMN_PREFERENCE,
  objectPreferenceScope,
  useWorkspacePreference,
  workspacePreferenceStorageKey,
  type PreferenceSwitch,
  type WorkspacePreferenceScope,
} from './workspacePreference';

const LEAD = objectPreferenceScope('crm_lead');
const PRODUCT = objectPreferenceScope('crm_product');
const LEAD_KEY = workspacePreferenceStorageKey(RECORD_TIMELINE_COLUMN_PREFERENCE, LEAD);

function Probe({ id, scope, fallback }: { id: string; scope: WorkspacePreferenceScope; fallback: PreferenceSwitch }) {
  const [value, setValue] = useWorkspacePreference(RECORD_TIMELINE_COLUMN_PREFERENCE, scope, fallback);
  return (
    <button type="button" data-testid={id} onClick={() => setValue(value === 'on' ? 'off' : 'on')}>
      {value}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useWorkspacePreference (objectstack#27052)', () => {
  it('answers the fallback with no choice; a write re-renders every caller of the same scope, and no other', () => {
    render(
      <>
        <Probe id="a" scope={LEAD} fallback="on" />
        <Probe id="b" scope={LEAD} fallback="on" />
        <Probe id="product" scope={PRODUCT} fallback="off" />
      </>,
    );
    expect(screen.getByTestId('a').textContent).toBe('on');
    expect(screen.getByTestId('product').textContent).toBe('off');
    fireEvent.click(screen.getByTestId('a'));
    expect(screen.getByTestId('a').textContent).toBe('off');
    expect(screen.getByTestId('b').textContent).toBe('off');
    expect(screen.getByTestId('product').textContent).toBe('off');
    expect(JSON.parse(window.localStorage.getItem(LEAD_KEY)!)).toEqual({ value: 'off', v: 1 });
  });

  it('the choice survives a remount (a reload reads the same storage)', () => {
    const first = render(<Probe id="a" scope={LEAD} fallback="on" />);
    fireEvent.click(screen.getByTestId('a'));
    first.unmount();
    render(<Probe id="a" scope={LEAD} fallback="on" />);
    expect(screen.getByTestId('a').textContent).toBe('off');
  });

  it("hears another tab's write through the `storage` event", () => {
    render(<Probe id="a" scope={LEAD} fallback="on" />);
    act(() => {
      window.localStorage.setItem(LEAD_KEY, JSON.stringify({ value: 'off', v: 1 }));
      window.dispatchEvent(new StorageEvent('storage', { key: LEAD_KEY }));
    });
    expect(screen.getByTestId('a').textContent).toBe('off');
    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(screen.getByTestId('a').textContent).toBe('on');
  });

  it('holds a choice a refusing storage would not keep, for this page', () => {
    const real = window.localStorage;
    const refusing = {
      getItem: (key: string) => real.getItem(key),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    Object.defineProperty(window, 'localStorage', { value: refusing, configurable: true });
    try {
      render(<Probe id="a" scope={LEAD} fallback="on" />);
      fireEvent.click(screen.getByTestId('a'));
      expect(screen.getByTestId('a').textContent).toBe('off');
      expect(real.getItem(LEAD_KEY)).toBeNull();
    } finally {
      Object.defineProperty(window, 'localStorage', { value: real, configurable: true });
    }
  });
});
