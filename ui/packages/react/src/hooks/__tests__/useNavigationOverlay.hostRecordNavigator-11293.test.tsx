/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useNavigationOverlay` hands an authored `page` click with no `onNavigate`
 * to the record navigator the HOST publishes (objectui#11293).
 *
 * `page` is the spec's default `mode`, so `{ mode: 'page' }` and a block
 * written without `mode` both resolve to it. The branch used to call
 * `onNavigate` and nothing else, so a block a host rendered without wiring one
 * (a standalone board, calendar or grid) opened nothing on click. The hook now
 * falls back to `RelatedRecordActionsContext.openRecord`, the seam the grid's
 * link column and the lookup cells already read, and builds no URL of its own.
 *
 * Every row mounts the hook under a host that publishes `openRecord`, so each
 * "not called" below is measured against a navigator that was there to call.
 * The rows pin, in order: the two spellings that resolve to `page` navigate;
 * a supplied `onNavigate` and an `onRowClick` each keep the click (the grid's
 * explicit wiring and a parent list view are unchanged); an overlay mode is
 * the lit control; an ABSENT `navigation` stays the host's call (see the
 * hook's docblock for why that boundary is load-bearing); and with no host,
 * or no object name, there is nowhere to go.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useNavigationOverlay } from '../useNavigationOverlay';
import type { UseNavigationOverlayOptions } from '../useNavigationOverlay';
import {
  RelatedRecordActionsProvider,
  type RelatedRecordActionsValue,
} from '../../context/RelatedRecordActionsContext';

const RECORD = { id: 'r1', name: 'Ada' };

/** A host that publishes a record navigator, and the spy behind it. */
function host() {
  const openRecord = vi.fn();
  const value: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${recordId}`,
    openRecord,
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RelatedRecordActionsProvider value={value}>{children}</RelatedRecordActionsProvider>
  );
  return { openRecord, wrapper };
}

/** Mount the hook with `options` under `wrapper` (if any) and click once. */
function click(
  options: UseNavigationOverlayOptions,
  wrapper?: ({ children }: { children: React.ReactNode }) => React.ReactElement,
) {
  const { result } = renderHook(() => useNavigationOverlay(options), { wrapper });
  act(() => {
    result.current.handleClick(RECORD);
  });
  return result;
}

describe('useNavigationOverlay: `page` with no `onNavigate` goes to the host\'s record navigator (objectui#11293)', () => {
  it('`mode: "page"` calls the published `openRecord` with the object and the record id', () => {
    const { openRecord, wrapper } = host();
    const result = click({ navigation: { mode: 'page' }, objectName: 'contacts' }, wrapper);
    expect(openRecord).toHaveBeenCalledTimes(1);
    expect(openRecord).toHaveBeenCalledWith('contacts', 'r1');
    expect(result.current.isOpen).toBe(false);
  });

  it('a block written without `mode` resolves to `page` and navigates the same way', () => {
    const { openRecord, wrapper } = host();
    const result = click({ navigation: { size: 'lg' }, objectName: 'contacts' }, wrapper);
    expect(result.current.mode).toBe('page');
    expect(openRecord).toHaveBeenCalledWith('contacts', 'r1');
  });

  it('a supplied `onNavigate` WINS over the published navigator (the grid\'s explicit wiring)', () => {
    const { openRecord, wrapper } = host();
    const onNavigate = vi.fn();
    click({ navigation: { mode: 'page' }, objectName: 'contacts', onNavigate }, wrapper);
    expect(onNavigate).toHaveBeenCalledWith('r1', 'view');
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('an `onRowClick` still takes the click first (a parent list view)', () => {
    const { openRecord, wrapper } = host();
    const onRowClick = vi.fn();
    click({ navigation: { mode: 'page' }, objectName: 'contacts', onRowClick }, wrapper);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('LIT CONTROL: an overlay mode opens the overlay and does not navigate', () => {
    const { openRecord, wrapper } = host();
    const result = click({ navigation: { mode: 'drawer' }, objectName: 'contacts' }, wrapper);
    expect(result.current.isOpen).toBe(true);
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('an ABSENT `navigation` stays the host\'s call: no `onNavigate`, no navigation', () => {
    // A host withholds navigation by passing neither callback (the related
    // list's mobile gallery does, when the bridge withheld `onView`).
    const { openRecord, wrapper } = host();
    const result = click({ objectName: 'contacts' }, wrapper);
    expect(openRecord).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
  });

  it('with no host navigator, or no object name, `page` has nowhere to go', () => {
    const bare = click({ navigation: { mode: 'page' }, objectName: 'contacts' });
    expect(bare.current.isOpen).toBe(false);

    const { openRecord, wrapper } = host();
    click({ navigation: { mode: 'page' } }, wrapper);
    expect(openRecord).not.toHaveBeenCalled();
  });
});
