/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11082 — `captureUpdateUndoData` is a named export of the package,
 * and it answers as it did while it was private to `ActionRunner`.
 *
 * It is exported so every surface that builds an `update` Undo snapshot calls
 * the one rule (objectui#10404) instead of restating it: the console runtime's
 * `api` handler and the record page's own `api` handler do. The runner's own
 * use of it is pinned in `ActionRunner.undoAbsentField-10404`.
 *
 * Imported through the package entry, so a dropped re-export fails here.
 */

import { describe, it, expect } from 'vitest';
import * as core from '../../index.js';
import { captureUpdateUndoData as fromRunner } from '../ActionRunner.js';

const { captureUpdateUndoData } = core;

/**
 * The written object's field definitions, which the rule takes since
 * objectui#11122 (a relation is captured as its stored id). None of the
 * fields below holds an expanded record, so every answer is the one the rule
 * gave with two arguments.
 */
const FIELDS = {
  name: { type: 'text' },
  status: { type: 'text' },
  note: { type: 'text' },
  owner: { type: 'user' },
};

describe('`captureUpdateUndoData` — the package export of the one Undo capture rule (objectui#11082)', () => {
  it('is exported from the package entry, and is the runner module\'s own function', () => {
    expect(typeof captureUpdateUndoData).toBe('function');
    expect(captureUpdateUndoData).toBe(fromRunner);
  });

  it('snapshots the stored value of every written field the row carries', () => {
    expect(captureUpdateUndoData(['status', 'owner'], { id: 't_1', status: 'open', owner: 'u_2', name: 'Ada' }, FIELDS))
      .toEqual({ status: 'open', owner: 'u_2' });
  });

  it('captures a `null` the row carries as `null`: a real empty value', () => {
    expect(captureUpdateUndoData(['status'], { id: 't_1', status: null }, FIELDS)).toEqual({ status: null });
  });

  it('answers `undefined` when any written field is absent: no partial snapshot', () => {
    expect(captureUpdateUndoData(['status'], { id: 't_1', name: 'Ada' }, FIELDS)).toBeUndefined();
    expect(captureUpdateUndoData(['status', 'note'], { id: 't_1', status: 'open' }, FIELDS)).toBeUndefined();
  });

  it('does not count an own key holding `undefined`, or an inherited key, as carried', () => {
    expect(captureUpdateUndoData(['status'], { id: 't_1', status: undefined }, FIELDS)).toBeUndefined();
    const inherited = Object.create({ status: 'open' }) as Record<string, unknown>;
    expect(captureUpdateUndoData(['status'], inherited, FIELDS)).toBeUndefined();
  });
});
