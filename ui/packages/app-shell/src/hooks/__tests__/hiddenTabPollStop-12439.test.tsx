/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12439 — the shared hidden-tab clock on its own: when a tab counts as
 * hidden for too long. `.tsx` only for the DOM environment the root config
 * gives that suffix; nothing here renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HIDDEN_POLL_STOP_MS,
  __resetHiddenTabClock,
  hiddenForMs,
  isPollingSuspended,
} from '../hiddenTabPollStop';

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

function switchTab(hidden: boolean): void {
  setHidden(hidden);
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
  __resetHiddenTabClock();
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe('objectui#12439 — hiddenTabPollStop', () => {
  it('is ten minutes, and a visible tab is never suspended', () => {
    expect(HIDDEN_POLL_STOP_MS).toBe(10 * 60_000);
    expect(hiddenForMs()).toBe(0);
    vi.advanceTimersByTime(2 * HIDDEN_POLL_STOP_MS);
    expect(isPollingSuspended()).toBe(false);
  });

  it('suspends once the tab has been hidden for the whole window, not before', () => {
    expect(hiddenForMs()).toBe(0); // starts listening
    switchTab(true);
    vi.advanceTimersByTime(HIDDEN_POLL_STOP_MS - 1);
    expect(isPollingSuspended()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isPollingSuspended()).toBe(true);
  });

  it('starts the clock at the first question for a tab already hidden', () => {
    setHidden(true);
    vi.advanceTimersByTime(HIDDEN_POLL_STOP_MS);
    // No event was seen and nobody asked yet: the clock starts now.
    expect(hiddenForMs()).toBe(0);
    vi.advanceTimersByTime(HIDDEN_POLL_STOP_MS);
    expect(isPollingSuspended()).toBe(true);
  });

  it('resets on a visible spell nobody polled through', () => {
    expect(hiddenForMs()).toBe(0);
    switchTab(true);
    vi.advanceTimersByTime(HIDDEN_POLL_STOP_MS - 1_000);
    // A one-second look between two polls: only the listener sees it.
    switchTab(false);
    vi.advanceTimersByTime(500);
    switchTab(true);
    vi.advanceTimersByTime(HIDDEN_POLL_STOP_MS - 1_000);
    expect(isPollingSuspended()).toBe(false);
    expect(hiddenForMs()).toBe(HIDDEN_POLL_STOP_MS - 1_000);
  });

  it('ends the suspension the moment the tab is visible again', () => {
    expect(hiddenForMs()).toBe(0);
    switchTab(true);
    vi.advanceTimersByTime(3 * HIDDEN_POLL_STOP_MS);
    expect(isPollingSuspended()).toBe(true);
    // Read straight from `document.hidden`, so the answer does not wait on
    // which visibilitychange listener ran first.
    setHidden(false);
    expect(isPollingSuspended()).toBe(false);
  });
});
