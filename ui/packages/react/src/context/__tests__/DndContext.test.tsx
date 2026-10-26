/**
 * Tests for DndProvider and useDnd
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  DndProvider,
  useDnd,
  useHasDndProvider,
} from '../DndContext';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DndProvider>{children}</DndProvider>
);

describe('DndProvider', () => {
  it('provides DnD context', () => {
    const { result } = renderHook(() => useDnd(), { wrapper });
    expect(result.current.enabled).toBe(true);
    expect(result.current.activeItem).toBeNull();
  });

  it('starts drag operation', () => {
    const onDragStart = vi.fn();
    const customWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <DndProvider onDragStart={onDragStart}>{children}</DndProvider>
    );

    const { result } = renderHook(() => useDnd(), { wrapper: customWrapper });

    act(() => {
      result.current.startDrag({ id: 'item-1', type: 'card' });
    });

    expect(result.current.activeItem).toEqual({ id: 'item-1', type: 'card' });
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it('ends drag operation', () => {
    const onDrop = vi.fn();
    const customWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <DndProvider onDrop={onDrop}>{children}</DndProvider>
    );

    const { result } = renderHook(() => useDnd(), { wrapper: customWrapper });

    act(() => {
      result.current.startDrag({ id: 'item-1', type: 'card' });
    });

    act(() => {
      result.current.endDrag('zone-1');
    });

    expect(result.current.activeItem).toBeNull();
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ item: { id: 'item-1', type: 'card' }, targetZoneId: 'zone-1' })
    );
  });

  it('cancels drag operation', () => {
    const onDragCancel = vi.fn();
    const customWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <DndProvider onDragCancel={onDragCancel}>{children}</DndProvider>
    );

    const { result } = renderHook(() => useDnd(), { wrapper: customWrapper });

    act(() => {
      result.current.startDrag({ id: 'item-1', type: 'card' });
    });

    act(() => {
      result.current.cancelDrag();
    });

    expect(result.current.activeItem).toBeNull();
    expect(onDragCancel).toHaveBeenCalledTimes(1);
  });

  it('registers and checks drop zones', () => {
    const { result } = renderHook(() => useDnd(), { wrapper });

    act(() => {
      result.current.registerDropZone({
        id: 'zone-1',
        acceptTypes: ['card', 'widget'],
      });
    });

    expect(result.current.canDrop('zone-1', 'card')).toBe(true);
    expect(result.current.canDrop('zone-1', 'unknown')).toBe(false);
    expect(result.current.canDrop('nonexistent', 'card')).toBe(false);
  });

  it('unregisters drop zones', () => {
    const { result } = renderHook(() => useDnd(), { wrapper });

    act(() => {
      result.current.registerDropZone({
        id: 'zone-1',
        acceptTypes: ['card'],
      });
    });

    act(() => {
      result.current.unregisterDropZone('zone-1');
    });

    expect(result.current.canDrop('zone-1', 'card')).toBe(false);
  });

  it('respects disabled config', () => {
    const onDragStart = vi.fn();
    const customWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <DndProvider config={{ enabled: false }} onDragStart={onDragStart}>{children}</DndProvider>
    );

    const { result } = renderHook(() => useDnd(), { wrapper: customWrapper });

    act(() => {
      result.current.startDrag({ id: 'item-1', type: 'card' });
    });

    expect(result.current.activeItem).toBeNull();
    expect(onDragStart).not.toHaveBeenCalled();
  });
});

describe('useHasDndProvider', () => {
  it('returns false outside provider', () => {
    const { result } = renderHook(() => useHasDndProvider());
    expect(result.current).toBe(false);
  });

  it('returns true inside provider', () => {
    const { result } = renderHook(() => useHasDndProvider(), { wrapper });
    expect(result.current).toBe(true);
  });
});

describe('useDnd without provider', () => {
  it('throws error', () => {
    expect(() => {
      renderHook(() => useDnd());
    }).toThrow('useDnd must be used within a <DndProvider>');
  });
});
