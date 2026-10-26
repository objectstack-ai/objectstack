// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7255 — the pulse→dependency adapter the Studio rails read.
 *
 * Two properties are load-bearing and neither is visible from the pillar
 * tests: a pulse must reach a consumer that is NOT holding, and a pulse that
 * arrives DURING a hold must be deferred rather than dropped — the Interfaces
 * pillar's load rehydrates the nav edit buffer, so the hold is the only thing
 * standing between a background refresh and the author's unsaved drag.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';

afterEach(cleanup);

function Probe({ hold }: { hold: boolean }): React.ReactElement {
  const nonce = useMetadataRefreshNonce(hold);
  return <span data-testid="nonce">{nonce}</span>;
}

function nonce(): string {
  return screen.getByTestId('nonce').textContent ?? '';
}

describe('useMetadataRefreshNonce', () => {
  it('starts at 0 and advances on every pulse', () => {
    render(<Probe hold={false} />);
    expect(nonce()).toBe('0');

    act(() => emitMetadataRefresh());
    expect(nonce()).toBe('1');

    act(() => emitMetadataRefresh());
    expect(nonce()).toBe('2');
  });

  it('holds pulses back, then releases them coalesced when the hold lifts', () => {
    const { rerender } = render(<Probe hold />);
    expect(nonce()).toBe('0');

    act(() => emitMetadataRefresh());
    act(() => emitMetadataRefresh());
    // Held: the consumer's dependency has not moved, so nothing refetched and
    // nothing overwrote the edit buffer.
    expect(nonce()).toBe('0');

    rerender(<Probe hold={false} />);
    // Deferred, not dropped — and two held pulses release as ONE refetch.
    expect(nonce()).toBe('2');
  });

  it('stops advancing once unmounted', () => {
    const { unmount } = render(<Probe hold={false} />);
    unmount();
    // No listener left behind: emitting after unmount must not throw or warn
    // about setting state on an unmounted component.
    expect(() => act(() => emitMetadataRefresh())).not.toThrow();
  });
});
