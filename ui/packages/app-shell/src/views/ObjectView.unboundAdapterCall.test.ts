/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4463 — "Set as Default" was dead on every saved view, and drag-reorder
 * with it, because the adapter method was called **unbound**.
 *
 * Both `handleSetDefaultView` and `handleReorderViews` detached the method into a
 * local first and then called the bare reference:
 *
 * ```ts
 * const updateView = (dataSource as any).updateView;   // detached here
 * …
 * updateView(objectName, target, patch);               // `this` === undefined
 * ```
 *
 * `ObjectStackAdapter.updateView` opens with `await this.connect()`, so every
 * write in the list rejected with
 * `TypeError: Cannot read properties of undefined (reading 'connect')` **before a
 * single request went out** — QA measured zero network requests, one console
 * error and a toast. The sibling `handlePinView` called the same method as a
 * method and worked, which is why rename and pin passed in the same menu while
 * set-default did not.
 *
 * WHY A CLASS-BASED ADAPTER IS LOAD-BEARING HERE. A plain `vi.fn()` spy has no
 * `this` to lose, so it answers identically bound or unbound: a test built on one
 * is green against the defect and pins nothing. The fake below therefore
 * reproduces the one property that makes the bug observable — its `updateView`
 * dereferences `this` on its first statement, exactly as the real adapter does.
 * {@link describe} block "the fake reds when the method is detached" is the
 * control that proves it: it restores the detached call shape and asserts the
 * verbatim TypeError, so the green assertions below cannot be vacuously green.
 *
 * Reverse verification (direction predicted before running, and it holds):
 * restoring `const updateView = (dataSource as any).updateView` inside
 * {@link dispatchViewPatches} turns the set-default block RED with that same
 * TypeError, while the control block stays green — it pins the failure mode
 * itself, which this change does not move.
 *
 * The reorder block left with objectui#12418: a drag-reorder is the user's own
 * tab order (`sys_user_preference`), and it writes no view any more, so there
 * is no `sortOrder` patch list left to dispatch.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  dispatchViewPatches,
  setDefaultViewPatches,
} from './ObjectView';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** One `updateView` call as the fake recorded it. */
interface RecordedWrite {
  objectName: string;
  viewName: string;
  patch: Record<string, unknown>;
}

/**
 * A minimal stand-in for `ObjectStackAdapter` that fails the same way the real
 * one does when its methods are called unbound.
 *
 * `updateView` mirrors the real method's opening statement (`await this.connect()`)
 * and its `this.writes` bookkeeping — both dereference `this`, so a detached call
 * rejects instead of quietly recording a write against nothing.
 */
class FakeViewAdapter {
  /** Every write the adapter actually issued, in call order. */
  readonly writes: RecordedWrite[] = [];
  /** How many times the connection was established — proof `this` survived. */
  connectCount = 0;

  async connect(): Promise<void> {
    this.connectCount += 1;
  }

  async updateView(
    objectName: string,
    viewName: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // The real adapter's first statement, and the one that throws when `this`
    // is undefined (packages/data-objectstack/src/index.ts — `updateView`).
    await this.connect();
    this.writes.push({ objectName, viewName, patch });
    return { name: viewName, ...patch };
  }
}

/** Two saved views: `mine` is the current default, `board` is the target. */
const SAVED_VIEWS = [
  { name: 'showcase_task.mine', label: 'My Tasks', isDefault: true },
  { name: 'showcase_task.rt5_board', label: 'Board', isDefault: false },
];

const OBJECT = 'showcase_task';

describe('the fake reds when the method is detached (control)', () => {
  it('rejects with the verbatim TypeError the QA run recorded', async () => {
    const ds = new FakeViewAdapter();
    // The exact shape the handlers used to have.
    const updateView = ds.updateView;

    await expect(
      updateView(OBJECT, 'showcase_task.rt5_board', { isDefault: true }),
    ).rejects.toThrow(
      "Cannot read properties of undefined (reading 'connect')",
    );
    await expect(
      updateView(OBJECT, 'showcase_task.rt5_board', { isDefault: true }),
    ).rejects.toBeInstanceOf(TypeError);

    // The defining symptom: the failure happens BEFORE any write is issued.
    expect(ds.writes).toEqual([]);
    expect(ds.connectCount).toBe(0);
  });

  it('is green when the same fake is called as a method', async () => {
    const ds = new FakeViewAdapter();
    await ds.updateView(OBJECT, 'showcase_task.rt5_board', { isDefault: true });
    expect(ds.writes).toHaveLength(1);
    expect(ds.connectCount).toBe(1);
  });
});

describe('set as default (#4463)', () => {
  it('issues every patch against the adapter with `this` intact', async () => {
    const ds = new FakeViewAdapter();

    await Promise.all(
      dispatchViewPatches(
        ds,
        OBJECT,
        setDefaultViewPatches(SAVED_VIEWS, 'showcase_task.rt5_board'),
      ),
    );

    // The prior default is cleared and the target is set — the two PUTs the
    // issue expected and measured zero of.
    expect(ds.writes).toEqual([
      {
        objectName: OBJECT,
        viewName: 'showcase_task.mine',
        patch: { isDefault: false },
      },
      {
        objectName: OBJECT,
        viewName: 'showcase_task.rt5_board',
        patch: { isDefault: true },
      },
    ]);
    // `this` was live on every call, not just the first.
    expect(ds.connectCount).toBe(2);
  });

  it('still writes when the target is the only saved view', async () => {
    const ds = new FakeViewAdapter();
    const only = [{ name: 'showcase_task.rt5_board', isDefault: false }];

    await Promise.all(
      dispatchViewPatches(
        ds,
        OBJECT,
        setDefaultViewPatches(only, 'showcase_task.rt5_board'),
      ),
    );

    expect(ds.writes).toEqual([
      {
        objectName: OBJECT,
        viewName: 'showcase_task.rt5_board',
        patch: { isDefault: true },
      },
    ]);
  });
});

describe('the detach-then-call pattern stays gone (ratchet)', () => {
  it('ObjectView.tsx never assigns an adapter method to a local', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./ObjectView.tsx', import.meta.url)),
      'utf8',
    );

    // Comments are stripped FIRST, and that is not a detail: the fix's own
    // docblock quotes the broken line verbatim to explain it, so a scan over the
    // raw file reports the documentation of the bug as the bug. (Measured — this
    // assertion failed exactly that way before the strip was added.)
    const code = mask(source);

    // `const updateView = (dataSource as any).updateView;` and any sibling —
    // the shape that drops `this`. Calling through the object
    // (`(dataSource as any).updateView(…)`) does not match, because the capture
    // requires the statement to END at the member name.
    const detached = [
      ...code.matchAll(
        /const\s+\w+\s*=\s*\(\s*dataSource\s+as\s+any\s*\)[?.]*\.(\w+)\s*;/g,
      ),
    ].map(m => m[1]);

    expect(detached).toEqual([]);
  });
});
