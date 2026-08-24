// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11231] The settings engine facade folds the id it RESOLVED into the write
 * payload — and that id outranks a payload naming a different row.
 *
 * ## The shape
 *
 * `wrapEngineAsSettingsEngine`'s `update` is an ingress: it reads the row
 * address out of the caller's `where.id`, then hands ObjectQL a payload with
 * that id folded in. On that branch it passes **no `where`** to the engine, so
 * the payload is the ONLY id the engine ever sees — which is also why the
 * engine's conflicting-id refusal (`UPDATE_ID_MISMATCH`, 400 — #11142/#11230)
 * cannot cover this site: a refusal needs two declarations to disagree, and
 * the fold leaves exactly one. The fold IS the trust boundary here.
 *
 * Spelled `{ id, ...data }` the fold LOSES — a caller-supplied `data.id`
 * spreads over the resolved id and silently retargets the write to a row the
 * ingress never resolved, never authorised and never read. Spelled
 * `{ ...data, id }` — the convention the repo's other two ingresses already
 * document (`rest-server.ts`'s batch arm, "the operation's id AFTER the
 * spread, so it wins", and `protocol.updateData`'s #6479 fix) — the resolved
 * id wins.
 *
 * ## Why every case below carries a CONFLICT
 *
 * A payload with no `id` in it produces the same write under BOTH spellings,
 * so a case shaped that way passes against the defect and measures nothing.
 * Each case here hands the facade a payload whose `id` names a DIFFERENT row
 * than `where.id` and asserts the engine still binds the resolved one. That is
 * the ingress-level fact a future refactor would break — a caller handing back
 * a row copy (rows carry `id`) is the whole population this guards.
 *
 * ## The bound row is not re-derived here
 *
 * The double's `update` asks `assertEngineUpdateDispatch` — the predicate
 * `ObjectQL.update` itself dispatches on — which row a call binds, so it can
 * be neither kinder nor stricter than a running server about which id wins
 * (#4550/#5480, and the contract `check:engine-double-contract` keeps).
 */

import { describe, expect, it } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';

/** The row the ingress resolved from `where.id` — the only legitimate target. */
const RESOLVED = 'sys_setting_resolved';
/** The row a payload `id` claims instead. Never the row that should be written. */
const CLAIMED = 'sys_setting_claimed';

interface SeenUpdate {
  objectName: string;
  data: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
  /** Which row the REAL engine would bind for this call. */
  dispatch: ReturnType<typeof assertEngineUpdateDispatch>;
}

/**
 * An engine double that records the call and answers "which row?" with the
 * producer's verdict rather than a hand-written re-reading of the ladder.
 */
function makeRecordingEngine(seen: SeenUpdate[]): IDataEngine {
  return {
    async update(
      objectName: string,
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      seen.push({ objectName, data, options, dispatch });
      return { ...data };
    },
  } as unknown as IDataEngine;
}

describe('[#11231] wrapEngineAsSettingsEngine — the resolved id outranks a payload id', () => {
  it('binds the row `where.id` resolved, not the row the payload claims', async () => {
    const seen: SeenUpdate[] = [];
    const wrapped = wrapEngineAsSettingsEngine(makeRecordingEngine(seen));

    await wrapped.update('sys_setting', {
      where: { id: RESOLVED },
      data: { id: CLAIMED, value: 'rotated' },
    });

    expect(seen).toHaveLength(1);
    const [call] = seen;

    // The load-bearing assertion: the row the engine BINDS. On the losing
    // spread order this reads `CLAIMED`.
    expect(call.dispatch).toEqual({ kind: 'by-id', id: RESOLVED });

    // …and the payload the facade actually handed over carries the resolved
    // id, so nothing downstream of the engine can re-derive the claimed one.
    expect(call.data.id).toBe(RESOLVED);
    expect(call.data.id).not.toBe(CLAIMED);
  });

  it('keeps the payload’s other fields while overriding only its id', async () => {
    const seen: SeenUpdate[] = [];
    const wrapped = wrapEngineAsSettingsEngine(makeRecordingEngine(seen));

    await wrapped.update('sys_setting', {
      where: { id: RESOLVED },
      data: { id: CLAIMED, value: 'rotated', updated_by: 'admin' },
    });

    // The fix overrides the id and nothing else — a fold that dropped caller
    // fields would be a different defect wearing this one's fix.
    expect(seen[0].data).toEqual({
      id: RESOLVED,
      value: 'rotated',
      updated_by: 'admin',
    });
  });

  it('forwards context and bypassTenantAudit alongside the winning id (#8030)', async () => {
    const seen: SeenUpdate[] = [];
    const wrapped = wrapEngineAsSettingsEngine(makeRecordingEngine(seen));

    await wrapped.update('sys_setting', {
      where: { id: RESOLVED },
      data: { id: CLAIMED, value_enc: 'new-handle' },
      bypassTenantAudit: true,
      context: { isSystem: true },
    });

    expect(seen[0].dispatch).toEqual({ kind: 'by-id', id: RESOLVED });
    // The by-id branch still forwards both driver options — the #8030 fix is
    // on the same three lines this card edits, so it is pinned beside it.
    expect(seen[0].options).toEqual({
      bypassTenantAudit: true,
      context: { isSystem: true },
    });
  });

  it('leaves the multi branch addressing by `where`, with no id folded in', async () => {
    const seen: SeenUpdate[] = [];
    const wrapped = wrapEngineAsSettingsEngine(makeRecordingEngine(seen));

    // The settings row write takes this branch in practice: its `where` is the
    // composite (namespace, key, scope, user_id) and carries no id at all.
    await wrapped.update('sys_setting', {
      where: { namespace: 'mail', key: 'smtp_host', scope: 'global' },
      data: { value: 'smtp.example.com' },
    });

    expect(seen[0].dispatch).toEqual({ kind: 'multi' });
    expect(seen[0].data).not.toHaveProperty('id');
    expect(seen[0].options).toMatchObject({
      where: { namespace: 'mail', key: 'smtp_host', scope: 'global' },
      multi: true,
    });
  });
});
