/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  notifyDataChanged,
  useMutationInvalidationBridge,
  subscribeDataChanges,
  dataChangeMatches,
  useDataInvalidation,
  RELATED_CHANGED_EVENT,
} from './data-invalidation';

describe('dataChangeMatches (objectui#2269)', () => {
  it('object-wide change stales lists AND every record of that object', () => {
    expect(dataChangeMatches({ objectName: 'contact' }, 'contact')).toBe(true);
    expect(dataChangeMatches({ objectName: 'contact' }, 'contact', 'C-1')).toBe(true);
    expect(dataChangeMatches({ objectName: 'contact' }, 'invoice')).toBe(false);
  });

  it('record-scoped change stales that record and the object lists, not sibling records', () => {
    const change = { objectName: 'contact', recordId: 'C-1' };
    expect(dataChangeMatches(change, 'contact', 'C-1')).toBe(true);
    expect(dataChangeMatches(change, 'contact')).toBe(true); // list reader
    expect(dataChangeMatches(change, 'contact', 'C-2')).toBe(false);
  });

  it("'*' stales everything (undo/redo of unknown ops)", () => {
    expect(dataChangeMatches({ objectName: '*' }, 'anything', 'X')).toBe(true);
  });
});

describe('notifyDataChanged / subscribeDataChanges', () => {
  it('delivers to subscribers and keeps going past a throwing listener', () => {
    const seen: string[] = [];
    const unsub1 = subscribeDataChanges(() => { throw new Error('bad listener'); });
    const unsub2 = subscribeDataChanges((c) => seen.push(c.objectName));
    notifyDataChanged({ objectName: 'contact' });
    expect(seen).toEqual(['contact']);
    unsub1(); unsub2();
    notifyDataChanged({ objectName: 'contact' });
    expect(seen).toEqual(['contact']); // unsubscribed
  });

  it('bridges to the legacy related-changed window event', () => {
    const handler = vi.fn();
    window.addEventListener(RELATED_CHANGED_EVENT, handler);
    notifyDataChanged({ objectName: 'invoice', recordId: 'I-1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ objectName: 'invoice', recordId: 'I-1' });
    window.removeEventListener(RELATED_CHANGED_EVENT, handler);
  });
});

describe('useDataInvalidation', () => {
  it('bumps the nonce only for matching changes', () => {
    const { result } = renderHook(() => useDataInvalidation('contact', 'C-1'));
    expect(result.current).toBe(0);
    act(() => notifyDataChanged({ objectName: 'invoice' }));
    expect(result.current).toBe(0);
    act(() => notifyDataChanged({ objectName: 'contact', recordId: 'C-2' }));
    expect(result.current).toBe(0);
    act(() => notifyDataChanged({ objectName: 'contact', recordId: 'C-1' }));
    expect(result.current).toBe(1);
    act(() => notifyDataChanged({ objectName: 'contact' }));
    expect(result.current).toBe(2);
    act(() => notifyDataChanged({ objectName: '*' }));
    expect(result.current).toBe(3);
  });

  it('without an objectName it never subscribes (inert)', () => {
    const { result } = renderHook(() => useDataInvalidation(undefined));
    act(() => notifyDataChanged({ objectName: '*' }));
    expect(result.current).toBe(0);
  });

  it('unsubscribes on unmount', () => {
    const { result, unmount } = renderHook(() => useDataInvalidation('contact'));
    unmount();
    expect(() => notifyDataChanged({ objectName: 'contact' })).not.toThrow();
    expect(result.current).toBe(0);
  });
});

describe('useMutationInvalidationBridge', () => {
  it('fans dataSource MutationEvents out to the bus and unsubscribes on unmount', () => {
    let handler: ((e: any) => void) | null = null;
    const unsub = vi.fn(() => { handler = null; });
    const ds = { onMutation: vi.fn((cb: any) => { handler = cb; return unsub; }) };
    const seen: any[] = [];
    const stop = subscribeDataChanges((c) => seen.push(c));

    const { unmount } = renderHook(() => useMutationInvalidationBridge(ds));
    expect(ds.onMutation).toHaveBeenCalledTimes(1);
    act(() => handler!({ type: 'update', resource: 'contact', id: 42 }));
    expect(seen).toEqual([{ objectName: 'contact', recordId: '42' }]);
    act(() => handler!({ type: 'create', resource: 'invoice' }));
    expect(seen[1]).toEqual({ objectName: 'invoice', recordId: undefined });

    unmount();
    expect(unsub).toHaveBeenCalled();
    stop();
  });

  it('is inert for a dataSource without onMutation', () => {
    expect(() => renderHook(() => useMutationInvalidationBridge({} as any)).unmount()).not.toThrow();
    expect(() => renderHook(() => useMutationInvalidationBridge(null)).unmount()).not.toThrow();
  });
});
