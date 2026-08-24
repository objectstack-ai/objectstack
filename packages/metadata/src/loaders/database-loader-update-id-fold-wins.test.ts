// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11231] `DatabaseLoader._update` folds its authoritative `id` PARAMETER
 * into the write payload — and that id outranks a payload naming another row.
 *
 * ## The shape
 *
 * `_update(table, id, data)` takes the row address as a separate parameter —
 * every caller resolves it first (`existing.id`, from the `baseFilter(type,
 * name)` read just above) and then hands it here. The method folds it into the
 * payload and passes **no `where`** to the engine, so the payload is the only
 * id the engine sees; the engine's conflicting-id refusal
 * (`UPDATE_ID_MISMATCH`, 400 — #11142/#11230) needs two disagreeing
 * declarations and therefore cannot cover this site. The fold IS the trust
 * boundary.
 *
 * Spelled `{ id, ...data }` the fold LOSES: a `data.id` spreads over the
 * resolved id and the write silently retargets to a row the loader never read
 * and never version-checked. Spelled `{ ...data, id }` — the convention
 * documented at `rest-server.ts`'s batch arm ("the operation's id AFTER the
 * spread, so it wins") and at `protocol.updateData` (#6479) — the parameter
 * wins, which is what a separate id parameter MEANS.
 *
 * ## Why this drives `_update` directly
 *
 * Today's in-repo callers (`save`'s update arm, `registerRollback`) build a
 * fresh field literal — `{ metadata, version, checksum, updated_at, state }` —
 * so none of them can currently produce the conflict, and no public path can
 * reach it. That is exactly what makes this a fragile-pattern pin rather than
 * a repro: the guarded fact is the METHOD's contract, "the id parameter names
 * the row", which a future caller passing a row copy (rows carry `id`) would
 * otherwise break silently. Pinning it through a caller that cannot express
 * the conflict would pin nothing.
 *
 * ## Why every case carries a CONFLICT
 *
 * A payload with no `id` produces the same write under BOTH spellings — such a
 * case passes against the defect and measures nothing. Each case below hands
 * `_update` a payload whose `id` names a DIFFERENT row than the id parameter.
 *
 * The bound row is not re-derived here: the double's `update` asks
 * `assertEngineUpdateDispatch`, the predicate `ObjectQL.update` itself
 * dispatches on, so it cannot be kinder or stricter than a running server
 * (#4550/#5480, the contract `check:engine-double-contract` keeps).
 */

import { describe, expect, it } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { DatabaseLoader } from './database-loader.js';

/** The row the loader resolved and passed as the `id` parameter. */
const RESOLVED = 'meta_resolved';
/** The row a payload `id` claims instead. Never the row that should be written. */
const CLAIMED = 'meta_claimed';

interface SeenUpdate {
  objectName: string;
  data: Record<string, unknown>;
  dispatch: ReturnType<typeof assertEngineUpdateDispatch>;
}

function makeRecordingEngine(seen: SeenUpdate[]): IDataEngine {
  return {
    async update(
      objectName: string,
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      seen.push({ objectName, data, dispatch });
      return { ...data };
    },
  } as unknown as IDataEngine;
}

/** Reach the private fold the way the loader's own callers do. */
function updateVia(
  loader: DatabaseLoader,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (
    loader as unknown as {
      _update(t: string, i: string, d: Record<string, unknown>): Promise<Record<string, unknown>>;
    }
  )._update(table, id, data);
}

describe('[#11231] DatabaseLoader._update — the id parameter outranks a payload id', () => {
  it('binds the row named by the id parameter, not the row the payload claims', async () => {
    const seen: SeenUpdate[] = [];
    const loader = new DatabaseLoader({ engine: makeRecordingEngine(seen) });

    await updateVia(loader, 'sys_metadata', RESOLVED, {
      id: CLAIMED,
      version: 7,
      state: 'active',
    });

    expect(seen).toHaveLength(1);
    const [call] = seen;

    // The load-bearing assertion: which row the engine BINDS. On the losing
    // spread order this reads `CLAIMED`.
    expect(call.dispatch).toEqual({ kind: 'by-id', id: RESOLVED });
    expect(call.data.id).toBe(RESOLVED);
    expect(call.data.id).not.toBe(CLAIMED);
  });

  it('keeps the payload’s other fields while overriding only its id', async () => {
    const seen: SeenUpdate[] = [];
    const loader = new DatabaseLoader({ engine: makeRecordingEngine(seen) });

    await updateVia(loader, 'sys_metadata', RESOLVED, {
      id: CLAIMED,
      metadata: '{"a":1}',
      version: 7,
      checksum: 'abc',
      state: 'active',
    });

    expect(seen[0].objectName).toBe('sys_metadata');
    expect(seen[0].data).toEqual({
      id: RESOLVED,
      metadata: '{"a":1}',
      version: 7,
      checksum: 'abc',
      state: 'active',
    });
  });

  it('writes the resolved row for the history table too', async () => {
    const seen: SeenUpdate[] = [];
    const loader = new DatabaseLoader({ engine: makeRecordingEngine(seen) });

    // The fold is per-call, not per-table: the same method serves every table
    // the loader writes, so the guarantee cannot be table-specific.
    await updateVia(loader, 'sys_metadata_history', RESOLVED, {
      id: CLAIMED,
      event_seq: 3,
    });

    expect(seen[0].objectName).toBe('sys_metadata_history');
    expect(seen[0].dispatch).toEqual({ kind: 'by-id', id: RESOLVED });
  });
});
