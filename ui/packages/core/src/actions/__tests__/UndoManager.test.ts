/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { UndoManager, type UndoableOperation } from '../UndoManager';

function makeOp(id: string, type: 'create' | 'update' | 'delete' = 'update'): UndoableOperation {
  return {
    id,
    type,
    objectName: 'Account',
    recordId: `rec-${id}`,
    timestamp: Date.now(),
    description: `op-${id}`,
    undoData: { prev: id },
    redoData: { next: id },
  };
}

describe('UndoManager', () => {
  let manager: UndoManager;

  beforeEach(() => {
    manager = new UndoManager({ maxHistory: 5 });
  });

  // ---------------------------------------------------------------------------
  // Basic push / pop (existing behaviour)
  // ---------------------------------------------------------------------------
  describe('basic push/pop', () => {
    it('pushes and peeks', () => {
      const op = makeOp('1');
      manager.push(op);
      expect(manager.canUndo).toBe(true);
      expect(manager.peekUndo()).toEqual(op);
      expect(manager.undoCount).toBe(1);
    });

    it('popUndo moves to redo stack', () => {
      const op = makeOp('1');
      manager.push(op);
      const popped = manager.popUndo();
      expect(popped).toEqual(op);
      expect(manager.canUndo).toBe(false);
      expect(manager.canRedo).toBe(true);
      expect(manager.peekRedo()).toEqual(op);
    });

    it('popRedo moves back to undo stack', () => {
      manager.push(makeOp('1'));
      manager.popUndo();
      const redone = manager.popRedo();
      expect(redone?.id).toBe('1');
      expect(manager.canUndo).toBe(true);
      expect(manager.canRedo).toBe(false);
    });

    it('push clears redo stack', () => {
      manager.push(makeOp('1'));
      manager.popUndo();
      expect(manager.canRedo).toBe(true);
      manager.push(makeOp('2'));
      expect(manager.canRedo).toBe(false);
    });

    it('trims beyond maxHistory', () => {
      for (let i = 0; i < 7; i++) manager.push(makeOp(String(i)));
      expect(manager.undoCount).toBe(5);
      // Oldest operations should have been shifted out
      expect(manager.getHistory()[0].id).toBe('2');
    });

    it('clear removes everything', () => {
      manager.push(makeOp('1'));
      manager.clear();
      expect(manager.canUndo).toBe(false);
      expect(manager.canRedo).toBe(false);
    });

    it('subscribe notifies on changes', () => {
      const listener = vi.fn();
      const unsub = manager.subscribe(listener);
      manager.push(makeOp('1'));
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      manager.push(makeOp('2'));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // pushBatch
  // ---------------------------------------------------------------------------
  describe('pushBatch', () => {
    it('pushes multiple operations atomically', () => {
      const ops = [makeOp('a'), makeOp('b'), makeOp('c')];
      manager.pushBatch(ops);
      expect(manager.undoCount).toBe(3);
      expect(manager.getHistory().map((o) => o.id)).toEqual(['a', 'b', 'c']);
    });

    it('clears redo stack', () => {
      manager.push(makeOp('1'));
      manager.popUndo();
      expect(manager.canRedo).toBe(true);
      manager.pushBatch([makeOp('x')]);
      expect(manager.canRedo).toBe(false);
    });

    it('notifies listeners exactly once', () => {
      const listener = vi.fn();
      manager.subscribe(listener);
      manager.pushBatch([makeOp('a'), makeOp('b')]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for empty array', () => {
      const listener = vi.fn();
      manager.subscribe(listener);
      manager.pushBatch([]);
      expect(listener).not.toHaveBeenCalled();
      expect(manager.undoCount).toBe(0);
    });

    it('trims to maxHistory when batch exceeds limit', () => {
      const ops = Array.from({ length: 8 }, (_, i) => makeOp(String(i)));
      manager.pushBatch(ops);
      expect(manager.undoCount).toBe(5);
      // Oldest should be trimmed
      expect(manager.getHistory()[0].id).toBe('3');
      expect(manager.getHistory()[4].id).toBe('7');
    });
  });

  // ---------------------------------------------------------------------------
  // popUndoBatch / popRedoBatch
  // ---------------------------------------------------------------------------
  describe('popUndoBatch', () => {
    it('pops multiple operations from undo to redo', () => {
      manager.pushBatch([makeOp('a'), makeOp('b'), makeOp('c')]);
      const popped = manager.popUndoBatch(2);
      expect(popped.map((o) => o.id)).toEqual(['b', 'c']);
      expect(manager.undoCount).toBe(1);
      expect(manager.redoCount).toBe(2);
    });

    it('clamps to available stack size', () => {
      manager.push(makeOp('1'));
      const popped = manager.popUndoBatch(10);
      expect(popped).toHaveLength(1);
      expect(manager.undoCount).toBe(0);
    });

    it('returns empty array when nothing to undo', () => {
      expect(manager.popUndoBatch(3)).toEqual([]);
    });

    it('notifies listeners once', () => {
      manager.pushBatch([makeOp('a'), makeOp('b')]);
      const listener = vi.fn();
      manager.subscribe(listener);
      manager.popUndoBatch(2);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('popRedoBatch', () => {
    it('pops multiple operations from redo to undo', () => {
      manager.pushBatch([makeOp('a'), makeOp('b'), makeOp('c')]);
      manager.popUndoBatch(3);
      expect(manager.redoCount).toBe(3);
      const redone = manager.popRedoBatch(2);
      expect(redone.map((o) => o.id)).toEqual(['b', 'c']);
      expect(manager.undoCount).toBe(2);
      expect(manager.redoCount).toBe(1);
    });

    it('clamps to available stack size', () => {
      manager.push(makeOp('1'));
      manager.popUndo();
      const redone = manager.popRedoBatch(5);
      expect(redone).toHaveLength(1);
    });

    it('returns empty array when nothing to redo', () => {
      expect(manager.popRedoBatch(3)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getHistory / getRedoHistory
  // ---------------------------------------------------------------------------
  describe('getHistory / getRedoHistory', () => {
    it('getHistory returns shallow copy of undo stack', () => {
      manager.push(makeOp('1'));
      manager.push(makeOp('2'));
      const history = manager.getHistory();
      expect(history).toHaveLength(2);
      // Mutating the copy must not affect the manager
      history.pop();
      expect(manager.undoCount).toBe(2);
    });

    it('getRedoHistory returns shallow copy of redo stack', () => {
      manager.push(makeOp('1'));
      manager.push(makeOp('2'));
      manager.popUndo();
      const redoHistory = manager.getRedoHistory();
      expect(redoHistory).toHaveLength(1);
      expect(redoHistory[0].id).toBe('2');
      // Mutating the copy must not affect the manager
      redoHistory.pop();
      expect(manager.redoCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // saveToStorage / loadFromStorage
  // ---------------------------------------------------------------------------
  describe('persistence', () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      storage = {};
      vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => storage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
        removeItem: vi.fn((key: string) => { delete storage[key]; }),
      });
    });

    // Handed back, not left standing: this file runs in the `unit` project,
    // which is `isolate: false`, so `vi`'s stub registry is shared across FILES
    // in the worker and a stub left here is undone by whichever later file calls
    // `vi.unstubAllGlobals()` first — restoring a value that file never
    // installed (objectui#8500).
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('round-trips undo/redo stacks through localStorage', () => {
      manager.push(makeOp('1'));
      manager.push(makeOp('2'));
      manager.popUndo(); // '2' goes to redo

      manager.saveToStorage();

      const fresh = new UndoManager({ maxHistory: 5 });
      fresh.loadFromStorage();

      expect(fresh.undoCount).toBe(1);
      expect(fresh.redoCount).toBe(1);
      expect(fresh.peekUndo()?.id).toBe('1');
      expect(fresh.peekRedo()?.id).toBe('2');
    });

    it('preserves all UndoableOperation fields', () => {
      const op = makeOp('full');
      manager.push(op);
      manager.saveToStorage();

      const fresh = new UndoManager();
      fresh.loadFromStorage();
      const restored = fresh.peekUndo()!;
      expect(restored.id).toBe(op.id);
      expect(restored.type).toBe(op.type);
      expect(restored.objectName).toBe(op.objectName);
      expect(restored.recordId).toBe(op.recordId);
      expect(restored.timestamp).toBe(op.timestamp);
      expect(restored.description).toBe(op.description);
      expect(restored.undoData).toEqual(op.undoData);
      expect(restored.redoData).toEqual(op.redoData);
    });

    it('is a no-op when localStorage has no data', () => {
      const fresh = new UndoManager();
      fresh.loadFromStorage();
      expect(fresh.undoCount).toBe(0);
      expect(fresh.redoCount).toBe(0);
    });

    it('handles corrupt localStorage data gracefully', () => {
      storage['objectui:undo-history'] = 'not-valid-json!!!';
      const fresh = new UndoManager();
      expect(() => fresh.loadFromStorage()).not.toThrow();
      expect(fresh.undoCount).toBe(0);
    });

    it('notifies listeners after loading', () => {
      manager.push(makeOp('1'));
      manager.saveToStorage();

      const fresh = new UndoManager();
      const listener = vi.fn();
      fresh.subscribe(listener);
      fresh.loadFromStorage();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Boundary: batch larger than maxHistory
  // ---------------------------------------------------------------------------
  describe('boundary: batch larger than maxHistory', () => {
    it('trims oldest entries when batch overflows maxHistory', () => {
      // maxHistory is 5
      manager.push(makeOp('existing'));
      const batch = Array.from({ length: 6 }, (_, i) => makeOp(`batch-${i}`));
      manager.pushBatch(batch);
      expect(manager.undoCount).toBe(5);
      // 1 existing + 6 batch = 7 total, trimmed to last 5
      const ids = manager.getHistory().map((o) => o.id);
      expect(ids).toEqual(['batch-1', 'batch-2', 'batch-3', 'batch-4', 'batch-5']);
    });

    it('works when batch itself equals maxHistory', () => {
      const batch = Array.from({ length: 5 }, (_, i) => makeOp(`b-${i}`));
      manager.pushBatch(batch);
      expect(manager.undoCount).toBe(5);
      expect(manager.getHistory()[0].id).toBe('b-0');
      expect(manager.getHistory()[4].id).toBe('b-4');
    });
  });
});
