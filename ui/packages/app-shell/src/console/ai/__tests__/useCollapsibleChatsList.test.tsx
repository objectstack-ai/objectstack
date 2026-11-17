import '@testing-library/jest-dom/vitest';
import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCollapsibleChatsList } from '../AiChatPage';

const KEY = 'ai-chats-collapsed';

describe('useCollapsibleChatsList', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to expanded and persists a manual toggle', () => {
    const { result } = renderHook(() => useCollapsibleChatsList());
    expect(result.current.collapsed).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('1');

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('initializes from the persisted preference', () => {
    localStorage.setItem(KEY, '1');
    const { result } = renderHook(() => useCollapsibleChatsList());
    expect(result.current.collapsed).toBe(true);
  });
  // objectstack#34610 — the Live Canvas split that tucked the list away is
  // gone, so the hook has one driver, the user's toggle.
  it('exposes no canvas seam any more: the toggle is the only driver', () => {
    const { result } = renderHook(() => useCollapsibleChatsList());
    expect(Object.keys(result.current).sort()).toEqual(['collapsed', 'toggle']);
  });
});
