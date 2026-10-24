/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { globalUndoManager, type UndoableOperation } from '@object-ui/core';

export interface UseGlobalUndoOptions {
  /** DataSource to execute undo/redo operations. */
  dataSource?: {
    create(objectName: string, data: Record<string, unknown>): Promise<unknown>;
    update(objectName: string, recordId: string, data: Record<string, unknown>): Promise<unknown>;
    delete(objectName: string, recordId: string): Promise<unknown>;
  };
  /** Callback after successful undo. */
  onUndo?: (op: UndoableOperation) => void;
  /** Callback after successful redo. */
  onRedo?: (op: UndoableOperation) => void;
}

function getSnapshot() {
  return {
    canUndo: globalUndoManager.canUndo,
    canRedo: globalUndoManager.canRedo,
    undoDescription: globalUndoManager.peekUndo()?.description,
    redoDescription: globalUndoManager.peekRedo()?.description,
    history: globalUndoManager.getHistory(),
  };
}

function getServerSnapshot() {
  return { canUndo: false, canRedo: false, undoDescription: undefined, redoDescription: undefined, history: [] as UndoableOperation[] };
}

// Cache reference to avoid re-renders when nothing changed
let cachedSnapshot = getSnapshot();
function subscribe(callback: () => void) {
  return globalUndoManager.subscribe(() => {
    cachedSnapshot = getSnapshot();
    callback();
  });
}
function getCachedSnapshot() { return cachedSnapshot; }

/** One mounted instance, as the undo/redo runners and the keyboard see it. */
type OptionsRef = { readonly current: UseGlobalUndoOptions };

async function executeOp(optionsRef: OptionsRef, op: UndoableOperation, data: Record<string, unknown>, mode: 'undo' | 'redo') {
  const ds = optionsRef.current.dataSource;
  if (!ds) return;
  const action = mode === 'undo'
    ? ({ create: 'delete', update: 'update', delete: 'create' } as const)[op.type]
    : op.type;
  if (action === 'delete') await ds.delete(op.objectName, op.recordId);
  else if (action === 'update') await ds.update(op.objectName, op.recordId, data);
  else await ds.create(op.objectName, data);
}

async function runUndo(optionsRef: OptionsRef) {
  const op = globalUndoManager.popUndo();
  if (!op) return;
  await executeOp(optionsRef, op, op.undoData, 'undo');
  optionsRef.current.onUndo?.(op);
}

async function runRedo(optionsRef: OptionsRef) {
  const op = globalUndoManager.popRedo();
  if (!op) return;
  await executeOp(optionsRef, op, op.redoData, 'redo');
  optionsRef.current.onRedo?.(op);
}

// ── Keyboard shortcuts: ONE listener for the one shared stack (objectui#11081) ──
//
// Every instance used to add its own `window` `keydown` listener, and each of
// them popped `globalUndoManager`, so one Ctrl+Z undid one operation PER
// MOUNTED INSTANCE (the console mounts several at once). Now the instances
// register here and a single module-level listener answers each keypress,
// popping at most one operation.
//
// Which instance answers is decided once: the longest-mounted live one, the
// first entry of this insertion-ordered set. An `UndoableOperation` carries
// nothing that names the instance whose runner pushed it, so "the owner of the
// operation" is not readable here. The oldest live instance is also exactly
// the one that answered a keypress before this change whenever a single
// operation was stacked (its listener was first on `window` and popped it; the
// rest found the stack empty), so the one-operation keypress behaves as it
// always did. When it unmounts, the next-oldest takes over.
const keyboardInstances = new Set<OptionsRef>();

/** A field whose own Ctrl+Z (the browser's text undo) must not be taken over. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function onUndoShortcut(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  // Inside a text field Ctrl+Z is the field's own undo: no pop, no preventDefault.
  if (isEditableTarget(e.target)) return;
  const owner = keyboardInstances.values().next().value;
  if (!owner) return;
  e.preventDefault();
  if (e.shiftKey) { void runRedo(owner); } else { void runUndo(owner); }
}

function registerKeyboardInstance(optionsRef: OptionsRef): () => void {
  keyboardInstances.add(optionsRef);
  if (keyboardInstances.size === 1) window.addEventListener('keydown', onUndoShortcut);
  return () => {
    keyboardInstances.delete(optionsRef);
    if (keyboardInstances.size === 0) window.removeEventListener('keydown', onUndoShortcut);
  };
}

/**
 * React hook that wraps the global UndoManager for use in console components.
 *
 * Provides reactive undo/redo state, executes data operations through the
 * supplied dataSource, and registers Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts.
 *
 * Keyboard: however many instances are mounted, one `window` `keydown`
 * listener serves them all and one keypress pops at most one operation. It is
 * answered by the longest-mounted live instance — its `dataSource` runs the
 * write and its `onUndo` / `onRedo` fires — and by no other. A keypress whose
 * target is an `input`, `textarea`, `select` or contenteditable region is left
 * to that field: nothing is popped and the default is not prevented.
 *
 * The returned `undo` / `redo` (e.g. a toast's Undo button) always run through
 * THIS instance's `dataSource` and callbacks.
 */
export function useGlobalUndo(options: UseGlobalUndoOptions = {}) {
  const optionsRef = useRef(options);
  // Refreshed in the MUTATION phase, never in the render body. Every caller
  // passes an inline object literal with inline `onUndo` / `onRedo` closures,
  // so `options` is a new object on every render; `undo` / `redo` and the
  // keyboard registration hold the ref (whose identity React does keep) and
  // still reach the newest callbacks. Writing it during render published the
  // options of renders React discards or replays.
  // `useInsertionEffect` runs ahead of every layout effect, ref attachment and
  // paint in the commit, so the only window this moves is the render phase
  // itself — where `undo` / `redo`, being async data mutations, are not
  // callable. `useEffectEvent` would be idiomatic but is React 19.2+, and this
  // package's peer range starts at React 18.
  useInsertionEffect(() => {
    optionsRef.current = options;
  });

  const state = useSyncExternalStore(subscribe, getCachedSnapshot, getServerSnapshot);

  const undo = useCallback(() => runUndo(optionsRef), []);
  const redo = useCallback(() => runRedo(optionsRef), []);

  // Registered once per mount, keyed on the ref and on no memoised identity, so
  // this instance's place in the keyboard order is its mount order.
  useEffect(() => registerKeyboardInstance(optionsRef), []);

  return useMemo(() => ({ ...state, undo, redo }), [state, undo, redo]);
}
