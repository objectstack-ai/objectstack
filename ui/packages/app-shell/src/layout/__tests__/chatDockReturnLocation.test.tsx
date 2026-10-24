/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3c follow-up — the dock's remembered maximize origin: the storage
 * round trip, and the same-app-absolute-path trust boundary on read (a
 * corrupted/injected value must never become an open redirect). A `.test.tsx`
 * so it runs under happy-dom (sessionStorage exists).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  rememberDockReturnLocation,
  readDockReturnLocation,
  armChatDockExpanded,
  parseStoredDockExpanded,
  readStoredDockExpanded,
  writeStoredDockExpanded,
  DOCK_EXPANDED_STORAGE_KEY,
  DOCK_STUDIO_EXPANDED_STORAGE_KEY,
  DOCK_RETURN_TO_STORAGE_KEY,
} from '../chatDockState';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('dock return-location round trip', () => {
  it('remembers and reads an in-app path with its query', () => {
    rememberDockReturnLocation('/apps/crm/objects/deal?view=kanban');
    expect(readDockReturnLocation()).toBe('/apps/crm/objects/deal?view=kanban');
  });

  it('returns undefined when nothing was remembered', () => {
    expect(readDockReturnLocation()).toBeUndefined();
  });

  it('only trusts same-app absolute paths (no open redirect)', () => {
    window.sessionStorage.setItem(DOCK_RETURN_TO_STORAGE_KEY, 'https://evil.example/x');
    expect(readDockReturnLocation()).toBeUndefined();
    window.sessionStorage.setItem(DOCK_RETURN_TO_STORAGE_KEY, '//evil.example/x');
    expect(readDockReturnLocation()).toBeUndefined();
    window.sessionStorage.setItem(DOCK_RETURN_TO_STORAGE_KEY, 'apps/relative');
    expect(readDockReturnLocation()).toBeUndefined();
  });
});

describe('armChatDockExpanded', () => {
  it("writes the '1' the dock's stored-expanded parse accepts", () => {
    armChatDockExpanded();
    expect(
      parseStoredDockExpanded(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)),
    ).toBe(true);
  });
});

describe('stored-expanded round trip (issue #2477 item 2 — Studio remembers a collapse)', () => {
  const KEY = DOCK_STUDIO_EXPANDED_STORAGE_KEY;

  it('a DEFAULT-EXPANDED surface stays collapsed after an explicit collapse', () => {
    // First visit: nothing stored → the surface's own default (expanded) wins.
    expect(readStoredDockExpanded(KEY, true)).toBe(true);
    // User collapses → persisted as an explicit '0', NOT a remove…
    writeStoredDockExpanded(KEY, false);
    expect(window.sessionStorage.getItem(KEY)).toBe('0');
    // …so the next mount reads collapsed instead of falling back to expanded.
    expect(readStoredDockExpanded(KEY, true)).toBe(false);
    // Re-expanding sticks too.
    writeStoredDockExpanded(KEY, true);
    expect(readStoredDockExpanded(KEY, true)).toBe(true);
  });

  it('a DEFAULT-COLLAPSED surface (console) is unchanged by explicit persistence', () => {
    expect(readStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, false)).toBe(false);
    writeStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, true);
    expect(readStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, false)).toBe(true);
    writeStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, false);
    expect(readStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, false)).toBe(false);
  });

  it('the two docks never fight: a collapse on either leaves the other alone', () => {
    // The hazard the card names by name — one shared flag would make collapsing
    // the Studio copilot also collapse the console rail (and vice versa).
    expect(DOCK_STUDIO_EXPANDED_STORAGE_KEY).not.toBe(DOCK_EXPANDED_STORAGE_KEY);

    // Studio → console: collapsing Studio must not touch the console's flag,
    // which stays unset and so keeps falling back to the console's own default.
    writeStoredDockExpanded(KEY, false);
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBeNull();
    expect(readStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, false)).toBe(false);
    expect(readStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, true)).toBe(true);

    // console → Studio: the console rail expanding (e.g. armChatDockExpanded
    // before navigating back) must not re-expand a Studio dock the user
    // deliberately collapsed.
    armChatDockExpanded();
    expect(readStoredDockExpanded(DOCK_EXPANDED_STORAGE_KEY, false)).toBe(true);
    expect(readStoredDockExpanded(KEY, true)).toBe(false);
  });
});
