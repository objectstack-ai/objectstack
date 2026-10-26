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

  it('auto-tucks the list when the preview opens and restores it on close', () => {
    const { result } = renderHook(() => useCollapsibleChatsList());

    act(() => result.current.handleCanvasOpenChange(true));
    expect(result.current.collapsed).toBe(true);
    // Auto-collapse is transient — not written to the persisted preference.
    expect(localStorage.getItem(KEY)).toBeNull();

    act(() => result.current.handleCanvasOpenChange(false));
    expect(result.current.collapsed).toBe(false);
  });

  it('never overrides a list the user already collapsed (no spurious re-expand on preview close)', () => {
    localStorage.setItem(KEY, '1');
    const { result } = renderHook(() => useCollapsibleChatsList());
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.handleCanvasOpenChange(true)); // already collapsed — unchanged
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.handleCanvasOpenChange(false)); // must NOT auto-expand a manual collapse
    expect(result.current.collapsed).toBe(true);
  });

  it('lets a manual toggle during preview take control — no auto-restore afterwards', () => {
    const { result } = renderHook(() => useCollapsibleChatsList());

    act(() => result.current.handleCanvasOpenChange(true)); // auto-collapse
    expect(result.current.collapsed).toBe(true);

    act(() => result.current.toggle()); // user expands during preview → takes control
    expect(result.current.collapsed).toBe(false);

    act(() => result.current.handleCanvasOpenChange(false)); // closing must not fight the user
    expect(result.current.collapsed).toBe(false);
  });
});
