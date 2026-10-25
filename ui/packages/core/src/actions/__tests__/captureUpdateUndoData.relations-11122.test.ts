/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11122 — the Undo snapshot of a written relation is the id the
 * relation STORES, never the related record `$expand` put in its place.
 *
 * Surfaces read rows with `$expand` on the relations they show, and the server
 * replaces the id in place with the related record (`{ id: 'a1', name: 'Acme' }`
 * where `'a1'` is stored). `captureUpdateUndoData` copied that record into the
 * snapshot, and Undo wrote it back into a reference slot, which stores an id.
 * The rule now reads which fields are relations from the object's field
 * definitions, never from the value's shape: a `json` field holding an object
 * with an `id` is captured exactly as the row carries it.
 *
 * The runner's own `operation: 'update'` capture takes those definitions from
 * the action context, where the host publishes them as `objectFields` beside
 * `objectName`; both halves are pinned here, and the console hosts that publish
 * them are pinned in `app-shell`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { captureUpdateUndoData, ActionRunner, type ActionDef } from '../ActionRunner';
import { globalUndoManager } from '../UndoManager';
import { EXPANDABLE_FIELD_TYPES } from '../../utils/expand-fields';

afterEach(() => {
  vi.restoreAllMocks();
  globalUndoManager.clear();
});

/** An opportunity, as its object declares it. */
const FIELDS = {
  name: { type: 'text' },
  account: { type: 'lookup', reference: 'crm_account' },
  owner: { type: 'user' },
  contacts: { type: 'lookup', reference: 'crm_contact', multiple: true },
  config: { type: 'json' },
};

/** The row as a `$expand`-ed read delivers it: every relation replaced by its record. */
const EXPANDED_ROW = {
  id: 'o1',
  name: 'Deal',
  account: { id: 'a1', name: 'Acme' },
  owner: { id: 'u1', name: 'Ada' },
  contacts: [{ id: 'c1', name: 'Grace' }, { id: 'c2', name: 'Alan' }],
  config: { id: 'cfg1', mode: 'strict' },
};

describe('`captureUpdateUndoData` — a relation is captured as its stored id (objectui#11122)', () => {
  it('captures the id of an expanded lookup, not the related record', () => {
    expect(captureUpdateUndoData(['account'], EXPANDED_ROW, FIELDS)).toEqual({ account: 'a1' });
  });

  it('does the same for every relation type the object can declare', () => {
    for (const type of EXPANDABLE_FIELD_TYPES) {
      expect(captureUpdateUndoData(['rel'], { id: 'o1', rel: { id: 'r1', name: 'R' } }, { rel: { type } }))
        .toEqual({ rel: 'r1' });
    }
  });

  it('captures a `multiple` relation expanded as an array as the array of ids', () => {
    expect(captureUpdateUndoData(['contacts'], EXPANDED_ROW, FIELDS)).toEqual({ contacts: ['c1', 'c2'] });
    // A member the server could not expand (the related row is not readable)
    // is still the bare id: it is kept as it is.
    expect(captureUpdateUndoData(['contacts'], { id: 'o1', contacts: [{ id: 'c1', name: 'Grace' }, 'c3'] }, FIELDS))
      .toEqual({ contacts: ['c1', 'c3'] });
  });

  it('leaves a `json` field holding an object with an `id` exactly as the row carries it', () => {
    const undoData = captureUpdateUndoData(['config'], EXPANDED_ROW, FIELDS);
    expect(undoData).toEqual({ config: { id: 'cfg1', mode: 'strict' } });
    expect(undoData!.config).toBe(EXPANDED_ROW.config);
  });

  it('captures relations and non-relations of one write together, each by its own rule', () => {
    expect(captureUpdateUndoData(['account', 'owner', 'name', 'config'], EXPANDED_ROW, FIELDS)).toEqual({
      account: 'a1',
      owner: 'u1',
      name: 'Deal',
      config: { id: 'cfg1', mode: 'strict' },
    });
  });

  it('keeps an unexpanded relation id, and an empty relation as `null`', () => {
    expect(captureUpdateUndoData(['account'], { id: 'o1', account: 'a1' }, FIELDS)).toEqual({ account: 'a1' });
    expect(captureUpdateUndoData(['account'], { id: 'o1', account: null }, FIELDS)).toEqual({ account: null });
  });

  it('reads the field definitions in either served shape', () => {
    const asArray = Object.entries(FIELDS).map(([name, def]) => ({ name, ...def }));
    expect(captureUpdateUndoData(['account', 'config'], EXPANDED_ROW, asArray)).toEqual({
      account: 'a1',
      config: { id: 'cfg1', mode: 'strict' },
    });
  });

  it('still answers `undefined` when a written relation is absent from the row (objectui#10404)', () => {
    expect(captureUpdateUndoData(['account'], { id: 'o1', name: 'Deal' }, FIELDS)).toBeUndefined();
  });

  it('guesses nothing without field definitions: the value is captured as the row carries it', () => {
    expect(captureUpdateUndoData(['account'], EXPANDED_ROW, undefined)).toEqual({ account: { id: 'a1', name: 'Acme' } });
  });

  it('does not change the row it reads', () => {
    const row = structuredClone(EXPANDED_ROW);
    captureUpdateUndoData(['account', 'contacts'], row, FIELDS);
    expect(row).toEqual(EXPANDED_ROW);
  });
});

/**
 * A runner whose `script` dispatch answers success, as the platform action
 * route does. The toast handler is what makes the runner register the Undo
 * operation, as the console's does.
 */
function wireRunner(context: Record<string, unknown>) {
  const runner = new ActionRunner(context);
  runner.setToastHandler(() => {});
  runner.registerHandler('script', vi.fn(async () => ({ success: true })));
  return runner;
}

/** An undoable `operation: 'update'` on the expanded row. */
function update(patch: Record<string, unknown>, extra: Partial<ActionDef> = {}): ActionDef {
  return {
    type: 'script',
    name: 'set_account',
    label: 'Set account',
    operation: 'update',
    undoable: true,
    patch,
    params: { _rowRecord: EXPANDED_ROW },
    ...extra,
  } as ActionDef;
}

describe('ActionRunner `operation: \'update\'` — the Undo of a relation restores its stored id (objectui#11122)', () => {
  it('reads the field definitions the host publishes beside `objectName`', async () => {
    const runner = wireRunner({ objectName: 'crm_opportunity', objectFields: FIELDS });

    const result = await runner.execute(update({ account: 'a2', config: { id: 'cfg2' } }));

    expect(result.success).toBe(true);
    expect(result.undo?.undoData).toEqual({ account: 'a1', config: { id: 'cfg1', mode: 'strict' } });
    expect(result.undo?.redoData).toEqual({ account: 'a2', config: { id: 'cfg2' } });
    expect(globalUndoManager.peekUndo()?.undoData).toEqual({ account: 'a1', config: { id: 'cfg1', mode: 'strict' } });
  });

  it('does not apply one object\'s field definitions to a row of another object', async () => {
    // The host's object declares `config` a relation; the action retargets an
    // object whose row carries `config` as a plain object. Read against the
    // host's schema it would be collapsed to `'cfg1'`, a value it never held.
    const runner = wireRunner({
      objectName: 'crm_account',
      objectFields: { config: { type: 'lookup', reference: 'crm_config' } },
    });

    const result = await runner.execute(update({ config: { id: 'cfg2' } }, { objectName: 'crm_opportunity' }));

    expect(result.undo?.objectName).toBe('crm_opportunity');
    expect(result.undo?.undoData).toEqual({ config: { id: 'cfg1', mode: 'strict' } });
  });
});
