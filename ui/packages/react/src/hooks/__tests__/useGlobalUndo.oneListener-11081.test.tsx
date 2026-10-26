/**
 * ObjectUI — useGlobalUndo keyboard pins (objectui#11081)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Every mounted `useGlobalUndo` used to add its OWN `window` `keydown`
 * listener, and every one of them popped the one shared `globalUndoManager`.
 * The console mounts several instances at once, so one Ctrl+Z reverted as many
 * saved record writes as there were instances and operations. The listener
 * also ignored the event target: Ctrl+Z typed into a text field was
 * `preventDefault`ed and reverted a saved write instead of the typing.
 *
 * These pins drive the REAL hook against the REAL manager with real keydown
 * events that bubble to `window`:
 *
 *   - however many instances are mounted, one keypress pops at most one
 *     operation (undo and redo alike), and exactly one instance's
 *     `dataSource` / `onUndo` / `onRedo` answer it;
 *   - which instance answers is decided once: the longest-mounted live one;
 *   - a keypress inside `input`, `textarea`, `select` or a contenteditable
 *     region pops nothing and is not `defaultPrevented`;
 *   - the listener is gone once the last instance unmounts, StrictMode's
 *     mount-unmount-mount included;
 *   - an instance's own `undo()` (what a toast's Undo button calls) still runs
 *     through THAT instance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, act } from '@testing-library/react';
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

function makeInstance() {
  return {
    dataSource: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
}
type Instance = ReturnType<typeof makeInstance>;

type Ctl = ReturnType<typeof useGlobalUndo>;

function Probe({ options, onCtl }: { options: UseGlobalUndoOptions; onCtl?: (ctl: Ctl) => void }) {
  const ctl = useGlobalUndo(options);
  onCtl?.(ctl);
  return null;
}

/** Dispatch a Ctrl+Z (or Ctrl+Shift+Z) keydown on `target`; it bubbles to `window`. */
function pressUndo(target: EventTarget, { shift = false } = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key: shift ? 'Z' : 'z',
    ctrlKey: true,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  return e;
}

/** Let the popped operation's async undo/redo settle (dataSource call, then callback). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function totalUndoCallbacks(instances: Instance[]) {
  return instances.reduce((n, i) => n + i.onUndo.mock.calls.length, 0);
}
function totalRedoCallbacks(instances: Instance[]) {
  return instances.reduce((n, i) => n + i.onRedo.mock.calls.length, 0);
}
function totalDeletes(instances: Instance[]) {
  return instances.reduce((n, i) => n + i.dataSource.delete.mock.calls.length, 0);
}
function totalCreates(instances: Instance[]) {
  return instances.reduce((n, i) => n + i.dataSource.create.mock.calls.length, 0);
}

beforeEach(() => {
  globalUndoManager.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useGlobalUndo — one Ctrl+Z pops one operation, however many instances are mounted (objectui#11081)', () => {
  it('pops exactly one of three stacked operations with three instances mounted', async () => {
    const a = makeInstance();
    const b = makeInstance();
    const c = makeInstance();
    render(
      <>
        <Probe options={a} />
        <Probe options={b} />
        <Probe options={c} />
      </>,
    );
    act(() => {
      globalUndoManager.push(createOp('op1'));
      globalUndoManager.push(createOp('op2'));
      globalUndoManager.push(createOp('op3'));
    });

    const e = pressUndo(document.body);
    await settle();

    expect(globalUndoManager.undoCount).toBe(2);
    expect(globalUndoManager.redoCount).toBe(1);
    expect(globalUndoManager.peekRedo()?.id).toBe('op3');
    expect(totalDeletes([a, b, c])).toBe(1);
    expect(totalUndoCallbacks([a, b, c])).toBe(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('pops exactly one redo on Ctrl+Shift+Z with three instances mounted', async () => {
    const a = makeInstance();
    const b = makeInstance();
    const c = makeInstance();
    render(
      <>
        <Probe options={a} />
        <Probe options={b} />
        <Probe options={c} />
      </>,
    );
    act(() => {
      globalUndoManager.push(createOp('op1'));
      globalUndoManager.push(createOp('op2'));
      globalUndoManager.push(createOp('op3'));
      globalUndoManager.popUndoBatch(3);
    });
    expect(globalUndoManager.redoCount).toBe(3);

    const e = pressUndo(document.body, { shift: true });
    await settle();

    expect(globalUndoManager.redoCount).toBe(2);
    expect(globalUndoManager.undoCount).toBe(1);
    expect(totalCreates([a, b, c])).toBe(1);
    expect(totalRedoCallbacks([a, b, c])).toBe(1);
    expect(totalUndoCallbacks([a, b, c])).toBe(0);
    expect(e.defaultPrevented).toBe(true);
  });

  it('answers each keypress through the longest-mounted live instance, then its successor once it unmounts', async () => {
    const first = makeInstance();
    const second = makeInstance();
    const third = makeInstance();

    function Tree({ showFirst }: { showFirst: boolean }) {
      return (
        <>
          {showFirst && <Probe options={first} />}
          <Probe options={second} />
        </>
      );
    }
    const { rerender } = render(<Tree showFirst />);
    // Mounted by a later commit: registered after the two above.
    const late = render(<Probe options={third} />);

    act(() => {
      globalUndoManager.push(createOp('op1'));
      globalUndoManager.push(createOp('op2'));
    });

    pressUndo(document.body);
    await settle();
    expect(first.onUndo).toHaveBeenCalledTimes(1);
    expect(first.dataSource.delete).toHaveBeenCalledWith('account', 'rec_op2');
    expect(second.onUndo).not.toHaveBeenCalled();
    expect(third.onUndo).not.toHaveBeenCalled();

    rerender(<Tree showFirst={false} />);
    pressUndo(document.body);
    await settle();
    expect(second.onUndo).toHaveBeenCalledTimes(1);
    expect(second.dataSource.delete).toHaveBeenCalledWith('account', 'rec_op1');
    expect(first.onUndo).toHaveBeenCalledTimes(1);
    expect(third.onUndo).not.toHaveBeenCalled();

    late.unmount();
  });
});

describe('useGlobalUndo — Ctrl+Z inside an editable target is the field\'s own undo (objectui#11081)', () => {
  function mountWithOneOp() {
    const a = makeInstance();
    const b = makeInstance();
    render(
      <>
        <Probe options={a} />
        <Probe options={b} />
      </>,
    );
    act(() => {
      globalUndoManager.push(createOp('op1'));
    });
    return [a, b];
  }

  const editableTargets: Array<[string, () => HTMLElement]> = [
    ['a text input', () => document.createElement('input')],
    ['a textarea', () => document.createElement('textarea')],
    ['a select', () => document.createElement('select')],
    [
      'a contenteditable region',
      () => {
        const el = document.createElement('div');
        el.setAttribute('contenteditable', 'true');
        return el;
      },
    ],
    [
      'an element nested inside a contenteditable region',
      () => {
        const host = document.createElement('div');
        host.setAttribute('contenteditable', 'true');
        const inner = document.createElement('span');
        inner.textContent = 'typed';
        host.appendChild(inner);
        document.body.appendChild(host);
        return inner;
      },
    ],
  ];

  it.each(editableTargets)('leaves the stack untouched and the default alone in %s', async (_label, make) => {
    const instances = mountWithOneOp();
    const el = make();
    if (!el.isConnected) document.body.appendChild(el);
    el.focus();

    const undoKey = pressUndo(el);
    const redoKey = pressUndo(el, { shift: true });
    await settle();

    expect(undoKey.defaultPrevented).toBe(false);
    expect(redoKey.defaultPrevented).toBe(false);
    expect(globalUndoManager.undoCount).toBe(1);
    expect(globalUndoManager.redoCount).toBe(0);
    expect(totalDeletes(instances)).toBe(0);
    expect(totalUndoCallbacks(instances)).toBe(0);
  });

  it('still pops from a non-editable control such as a button', async () => {
    const instances = mountWithOneOp();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    const e = pressUndo(button);
    await settle();

    expect(e.defaultPrevented).toBe(true);
    expect(globalUndoManager.undoCount).toBe(0);
    expect(totalUndoCallbacks(instances)).toBe(1);
  });
});

describe('useGlobalUndo — the one listener lives exactly as long as some instance does (objectui#11081)', () => {
  it('adds one keydown listener for three instances and removes it when the last one unmounts', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const a = makeInstance();
      const b = makeInstance();
      const c = makeInstance();
      const { unmount } = render(
        <>
          <Probe options={a} />
          <Probe options={b} />
          <Probe options={c} />
        </>,
      );
      const keydownAdds = add.mock.calls.filter(([type]) => type === 'keydown');
      expect(keydownAdds).toHaveLength(1);

      unmount();
      const keydownRemoves = remove.mock.calls.filter(([type]) => type === 'keydown');
      expect(keydownRemoves).toHaveLength(1);
      expect(keydownRemoves[0][1]).toBe(keydownAdds[0][1]);

      act(() => {
        globalUndoManager.push(createOp('op1'));
      });
      const e = pressUndo(document.body);
      await settle();
      expect(e.defaultPrevented).toBe(false);
      expect(globalUndoManager.undoCount).toBe(1);
      expect(totalUndoCallbacks([a, b, c])).toBe(0);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('under StrictMode double-mount pops once per keypress and drops the listener on the last unmount', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const a = makeInstance();
      const b = makeInstance();
      const { unmount } = render(
        <StrictMode>
          <Probe options={a} />
          <Probe options={b} />
        </StrictMode>,
      );
      act(() => {
        globalUndoManager.push(createOp('op1'));
        globalUndoManager.push(createOp('op2'));
      });

      pressUndo(document.body);
      await settle();
      expect(globalUndoManager.undoCount).toBe(1);
      expect(totalUndoCallbacks([a, b])).toBe(1);

      unmount();
      const keydownAdds = add.mock.calls.filter(([type]) => type === 'keydown').length;
      const keydownRemoves = remove.mock.calls.filter(([type]) => type === 'keydown').length;
      expect(keydownAdds).toBeGreaterThan(0);
      expect(keydownRemoves).toBe(keydownAdds);

      const e = pressUndo(document.body);
      await settle();
      expect(e.defaultPrevented).toBe(false);
      expect(globalUndoManager.undoCount).toBe(1);
      expect(totalUndoCallbacks([a, b])).toBe(1);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});

describe('useGlobalUndo — an instance\'s own undo() still runs through that instance (objectui#11081)', () => {
  it('routes a toast-style undo() call to the calling instance, not the keyboard owner', async () => {
    const owner = makeInstance();
    const caller = makeInstance();
    let callerCtl: Ctl | undefined;
    render(
      <>
        <Probe options={owner} />
        <Probe options={caller} onCtl={(ctl) => { callerCtl = ctl; }} />
      </>,
    );
    act(() => {
      globalUndoManager.push(createOp('op1'));
    });

    await act(async () => {
      await callerCtl!.undo();
    });

    expect(caller.dataSource.delete).toHaveBeenCalledWith('account', 'rec_op1');
    expect(caller.onUndo).toHaveBeenCalledTimes(1);
    expect(owner.dataSource.delete).not.toHaveBeenCalled();
    expect(owner.onUndo).not.toHaveBeenCalled();
    expect(globalUndoManager.undoCount).toBe(0);
  });
});
