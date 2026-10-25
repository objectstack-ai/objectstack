/**
 * ObjectUI — useGlobalUndo options-ref timing pins (objectui#6797)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `useGlobalUndo` kept its whole `options` bag in a ref that was written in the
 * RENDER BODY, which is what `react-hooks/refs` reported:
 *
 *   packages/react/src/hooks/useGlobalUndo.ts:57:3
 *     react-hooks/refs  Cannot update ref during render
 *
 * Who reads that ref, measured on this base: `executeOp` reads
 * `.dataSource` and `undo` / `redo` read `.onUndo` / `.onRedo` — all three are
 * `useCallback`s whose identity must stay put, because the keydown effect is
 * keyed on `undo` / `redo` and every in-repo caller passes a FRESH inline
 * object literal with inline closures on every render (`AppContent.tsx`,
 * `RecordDetailView.tsx`, `useConsoleActionRuntime.tsx`). So the ref is
 * load-bearing and the fix could only move the WRITE, never remove the ref.
 *
 * The write now happens in `useInsertionEffect` — the mutation phase, ahead of
 * every layout effect, ref attachment and paint. The pins below fix the
 * behaviour that had to survive that move; pin 2 is the discriminating one and
 * fails under BOTH `useEffect` and `useLayoutEffect`, because `executeOp` reads
 * `optionsRef.current.dataSource` SYNCHRONOUSLY, before `undo`'s first `await`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { render, renderHook, act } from '@testing-library/react';
import { globalUndoManager, type UndoableOperation } from '@object-ui/core';
import { useGlobalUndo, type UseGlobalUndoOptions } from '../useGlobalUndo';

/** A `create` operation — undoing one dispatches `dataSource.delete`. */
function createOp(id: string): UndoableOperation {
  return {
    id,
    type: 'create',
    objectName: 'account',
    recordId: `rec_${id}`,
    timestamp: Date.now(),
    description: `created ${id}`,
    undoData: { name: 'undo' },
    redoData: { name: 'redo' },
  };
}

function makeDataSource() {
  return {
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

/** Parent holds the hook; the child reaches `undo` from its own layout effect. */
function Harness({
  options,
  trigger,
}: {
  options: UseGlobalUndoOptions;
  trigger: number;
}) {
  const ctl = useGlobalUndo(options);
  return <CommitPhaseCaller undo={ctl.undo} trigger={trigger} />;
}

function CommitPhaseCaller({ undo, trigger }: { undo: () => Promise<void>; trigger: number }) {
  useLayoutEffect(() => {
    if (trigger > 0) void undo();
  }, [trigger, undo]);
  return null;
}

beforeEach(() => {
  globalUndoManager.clear();
});

describe('useGlobalUndo — options ref is refreshed in the commit, not in render (#6797)', () => {
  // ---- pin 1: the newest callbacks reach the next undo() -------------------
  it('routes undo through the options of the LATEST committed render', async () => {
    const dsA = makeDataSource();
    const dsB = makeDataSource();
    const onUndoA = vi.fn();
    const onUndoB = vi.fn();

    const { result, rerender } = renderHook(
      ({ ds, onUndo }: { ds: ReturnType<typeof makeDataSource>; onUndo: () => void }) =>
        // a fresh literal every render, exactly like every in-repo caller
        useGlobalUndo({ dataSource: ds, onUndo }),
      { initialProps: { ds: dsA, onUndo: onUndoA } },
    );

    act(() => {
      globalUndoManager.push(createOp('op1'));
    });
    rerender({ ds: dsB, onUndo: onUndoB });

    await act(async () => {
      await result.current.undo();
    });

    expect(dsB.delete).toHaveBeenCalledWith('account', 'rec_op1');
    expect(dsA.delete).not.toHaveBeenCalled();
    expect(onUndoB).toHaveBeenCalledTimes(1);
    expect(onUndoA).not.toHaveBeenCalled();
  });

  // ---- pin 2: DISCRIMINATING — a child layout effect of the SAME commit ----
  // `useEffect` lands after paint and `useLayoutEffect` runs bottom-up (so a
  // CHILD's layout effect precedes the parent's). Only a mutation-phase write
  // is already in place here.
  it('has the swap in place before a child layout effect of the same commit calls undo', async () => {
    const dsA = makeDataSource();
    const dsB = makeDataSource();

    const { rerender } = render(<Harness options={{ dataSource: dsA }} trigger={0} />);

    act(() => {
      globalUndoManager.push(createOp('op2'));
    });

    await act(async () => {
      rerender(<Harness options={{ dataSource: dsB }} trigger={1} />);
    });

    expect(dsB.delete).toHaveBeenCalledWith('account', 'rec_op2');
    expect(dsA.delete).not.toHaveBeenCalled();
  });

  // ---- pin 3: the identity the ref exists to protect -----------------------
  it('keeps undo/redo identity stable across renders that pass a new options literal', () => {
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useGlobalUndo({ onUndo: () => void n, onRedo: () => void n }),
      { initialProps: { n: 0 } },
    );

    const firstUndo = result.current.undo;
    const firstRedo = result.current.redo;

    rerender({ n: 1 });
    rerender({ n: 2 });

    expect(result.current.undo).toBe(firstUndo);
    expect(result.current.redo).toBe(firstRedo);
  });

  // ---- pin 4: redo reads the newest options too ---------------------------
  it('routes redo through the options of the LATEST committed render', async () => {
    const dsA = makeDataSource();
    const dsB = makeDataSource();
    const onRedoA = vi.fn();
    const onRedoB = vi.fn();

    const { result, rerender } = renderHook(
      ({ ds, onRedo }: { ds: ReturnType<typeof makeDataSource>; onRedo: () => void }) =>
        useGlobalUndo({ dataSource: ds, onRedo }),
      { initialProps: { ds: dsA, onRedo: onRedoA } },
    );

    act(() => {
      globalUndoManager.push(createOp('op3'));
    });
    await act(async () => {
      await result.current.undo();
    });

    rerender({ ds: dsB, onRedo: onRedoB });
    await act(async () => {
      await result.current.redo();
    });

    expect(dsB.create).toHaveBeenCalledWith('account', { name: 'redo' });
    expect(onRedoB).toHaveBeenCalledTimes(1);
    expect(onRedoA).not.toHaveBeenCalled();
  });
});
