/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0057 P3a — ChatDock pure state: the width clamp keeps neither pane from
 * collapsing, and the toggle shortcut is composer-safe (⌘/Ctrl+Shift+I).
 * P3c adds the canvas-maximize width and the stored-expanded parse.
 */
import { describe, it, expect } from 'vitest';
import {
  clampDockWidth,
  maximizedDockWidth,
  parseStoredDockExpanded,
  matchChatDockShortcut,
  DOCK_MIN_WIDTH,
  DOCK_CONTENT_MIN_WIDTH,
} from '../chatDockState';

describe('clampDockWidth', () => {
  it('never narrower than the minimum', () => {
    expect(clampDockWidth(100, 1600)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(DOCK_MIN_WIDTH - 1, 1600)).toBe(DOCK_MIN_WIDTH);
  });

  it('never so wide the main content drops below its minimum', () => {
    const container = 1200;
    const max = container - DOCK_CONTENT_MIN_WIDTH;
    expect(clampDockWidth(9999, container)).toBe(max);
    expect(clampDockWidth(max - 20, container)).toBe(max - 20);
  });

  it('skips the upper bound when the container is unmeasured', () => {
    expect(clampDockWidth(4000, 0)).toBe(4000);
  });
});

describe('maximizedDockWidth', () => {
  it('is the widest legal rail — main content keeps its minimum', () => {
    expect(maximizedDockWidth(1600)).toBe(1600 - DOCK_CONTENT_MIN_WIDTH);
  });

  it('floors at the rail minimum on tiny containers', () => {
    // container − CONTENT_MIN would be below the rail minimum → the min wins
    // (clampDockWidth's lower bound takes precedence over its upper bound).
    expect(maximizedDockWidth(700)).toBe(DOCK_MIN_WIDTH);
  });
});

describe('parseStoredDockExpanded', () => {
  it("'1' → expanded, '0' → collapsed (explicit, so a default-expanded surface can remember a collapse)", () => {
    expect(parseStoredDockExpanded('1')).toBe(true);
    expect(parseStoredDockExpanded('0')).toBe(false);
  });

  it('unset / garbage → null so the caller falls back to its own default', () => {
    expect(parseStoredDockExpanded(null)).toBeNull();
    expect(parseStoredDockExpanded('true')).toBeNull();
    expect(parseStoredDockExpanded('')).toBeNull();
  });
});

describe('matchChatDockShortcut', () => {
  const base = { key: 'i', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  it('matches ⌘/Ctrl+Shift+I', () => {
    expect(matchChatDockShortcut({ ...base, metaKey: true, shiftKey: true })).toBe('toggle');
    expect(matchChatDockShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe('toggle');
    expect(matchChatDockShortcut({ ...base, key: 'I', metaKey: true, shiftKey: true })).toBe('toggle');
  });
  it('is composer-safe — needs the ⌘/Ctrl+Shift modifier, no bare I', () => {
    expect(matchChatDockShortcut({ ...base })).toBeNull();
    expect(matchChatDockShortcut({ ...base, metaKey: true })).toBeNull(); // no Shift
    expect(matchChatDockShortcut({ ...base, metaKey: true, shiftKey: true, altKey: true })).toBeNull();
  });
  it('does not collide with the AI-chat page shortcuts (O / S)', () => {
    expect(matchChatDockShortcut({ ...base, key: 'o', metaKey: true, shiftKey: true })).toBeNull();
    expect(matchChatDockShortcut({ ...base, key: 's', metaKey: true, shiftKey: true })).toBeNull();
  });
});
