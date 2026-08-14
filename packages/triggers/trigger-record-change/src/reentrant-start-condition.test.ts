// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8689 — a record-change flow's start condition must be evaluated on the
 * RE-ENTRANT dispatch its own write-back causes, not skipped.
 *
 * Reported on 17.0.0 GA: a `record-after-update` flow whose start condition, as
 * authored, is false on the flow's own write was nevertheless re-dispatched for
 * the same record, and the engine's last-resort loop-breaker — not the author's
 * guard — was what stopped it. The breaker said so itself in its WARN.
 *
 * ## Which of the two candidate mechanisms — measured, not assumed
 *
 * The card named two readings that need different repairs: the re-entrant
 * dispatch **skips** condition evaluation, or evaluation **runs but aborts** and
 * the abort is counted as a fire. Measured on this exact harness before the fix:
 *
 * ```
 * dispatches for the record ........ 2   (the re-fire really happened)
 * start-condition evaluations ...... 1   (only the FIRST dispatch)
 * evaluations that threw ........... 0
 * loop-breaker WARNs for the id .... 1
 * ```
 *
 * Two dispatches, one evaluation, zero throws ⇒ mechanism one: the re-fire never
 * reached the gate at all. `AutomationEngine.execute()` checked the re-entrancy
 * breaker and returned BEFORE the start-condition gate, so on the one dispatch
 * where the guard mattered most it was never consulted. Nothing aborted, so the
 * "abort counted as a fire" reading is falsified for this path.
 *
 * ## Why this pin is not vacuous
 *
 * "The flow terminated" is already true today — the breaker makes it true — so
 * asserting termination alone cannot tell the two mechanisms apart, and cannot
 * tell either of them from a correct engine. This test therefore asserts the
 * card's own three-legged probe design together:
 *
 *  1. the flow ACTUALLY fired (the record reached `status = 'escalated'`) and the
 *     re-entrant dispatch really occurred — otherwise legs 2 and 3 are vacuous;
 *  2. NO loop-breaker WARN carries this record's id (filtered by the probe's own
 *     id, so unrelated warnings cannot be miscounted);
 *  3. the start condition was EVALUATED on the re-fire, against the post-write
 *     row, and returned a verdict of `false` rather than throwing.
 *
 * Leg 3 is what makes the two mechanisms distinguishable from outside: a
 * regression to "skips evaluation" drops the evaluation count back to 1, and a
 * regression to "evaluation aborts" turns the second evaluation into a throw.
 * Leg 2 alone would pass under either if the breaker were merely made stronger —
 * which is explicitly NOT the repair.
 *
 * Resolution note: this package's tests resolve `@objectstack/service-automation`
 * through its `exports` to `dist/` (`check:test-source-alias`'s
 * `KNOWN_UNALIASED_TEST_IMPORTS` entry for this package), so this file is a
 * verdict on the BUILT engine — the built package is what the trigger loads in
 * production, and CI builds the dependency closure before running it. The
 * engine-side ordering contract is pinned against source separately, in
 * `service-automation`'s `engine-reentrancy-guard.test.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import { RecordChangeTriggerPlugin } from './plugin.js';

/** See `record-change-integration.test.ts` for why this shape is named. */
type TestObjectQLEngine = IObjectQLEngine & {
  syncSchemas(): Promise<void>;
  registry: IObjectQLEngine['registry'] & {
    registerObject(schema: unknown, packageId?: string, namespace?: string): void;
  };
};

/**
 * The engine's logger is a constructor-injected collaborator, not part of the
 * published `AutomationEngine` surface — the loop-breaker WARN is only
 * observable through it, so the property is named here rather than erased to
 * `any`.
 */
type EngineWithLogger = { logger: { warn(message: string, meta?: unknown): void } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeSqliteDriver(): SqlDriver {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const openDrivers: SqlDriver[] = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
  vi.restoreAllMocks();
});

/**
 * The reporting app's `case_escalation` shape, reduced to its essentials: the
 * guard is on STRINGS and a null check — deliberately NOT on a boolean, so the
 * SQLite `1 != true` coercion the breaker's own hint is about cannot be what
 * this test measures.
 */
const CONDITION =
  'record.priority == "critical" && record.status != "escalated" && record.escalated_date == null';

const escalationFlow = (name: string, object: string) => ({
  name,
  label: name,
  type: 'record_change',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Start',
      config: { objectName: object, triggerType: 'record-after-update', condition: CONDITION },
    },
    {
      id: 'escalate',
      type: 'update_record',
      label: 'Escalate',
      // The write-back that puts the record OUTSIDE the condition above — the
      // whole point: the author's guard is what should stop the re-fire.
      config: {
        objectName: object,
        filter: { id: '{record.id}' },
        fields: { status: 'escalated', escalated_date: '2026-08-14T13:14:38.628Z' },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'escalate' },
    { id: 'e2', source: 'escalate', target: 'end' },
  ],
});

const caseObjectDef = (name: string) => ({
  name,
  label: name,
  fields: {
    priority: { name: 'priority', label: 'Priority', type: 'text' as const },
    status: { name: 'status', label: 'Status', type: 'text' as const },
    escalated_date: { name: 'escalated_date', label: 'Escalated at', type: 'text' as const },
  },
});

describe("a record-change flow's start condition is evaluated on its own write-back's dispatch (#8689)", () => {
  it('suppresses the re-fire by the AUTHORED guard, with the loop-breaker never consulted', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService<TestObjectQLEngine>('objectql');
    const data = kernel.getService<IDataEngine>('data');
    const automation = kernel.getService<AutomationEngine>('automation');

    const driver = makeSqliteDriver();
    await driver.connect();
    (objectql as unknown as { registerDriver(d: unknown, isDefault?: boolean): void }).registerDriver(driver, true);
    openDrivers.push(driver);

    objectql.registry.registerObject(caseObjectDef('esc_case'), 'test', 'test');
    await objectql.syncSchemas();
    automation.registerFlow('esc_escalation', escalationFlow('esc_escalation', 'esc_case') as never);

    // Created OUTSIDE the condition (`priority` is not critical). The flow is
    // bound to after-UPDATE, so the insert cannot fire it either way.
    const created = await data.insert(
      'esc_case',
      { priority: 'low', status: 'new' },
      { context: { userId: 'u_trigger' } },
    );
    const id = String(Array.isArray(created) ? created[0]?.id : (created as { id?: unknown })?.id ?? created);
    await sleep(200);

    // ── instrumentation, armed only for the write under test ──
    const breakerWarns: unknown[] = [];
    const engineLogger = (automation as unknown as EngineWithLogger).logger;
    vi.spyOn(engineLogger, 'warn').mockImplementation((message: string, meta?: unknown) => {
      // Filtered by BOTH the breaker's own wording and this record's id, so a
      // warning from any other source or any other record cannot be counted.
      if (
        String(message).includes('re-entered for the same record') &&
        JSON.stringify(meta ?? {}).includes(id)
      ) {
        breakerWarns.push({ message, meta });
      }
    });

    // Spied WITHOUT a replacement implementation: the real gate still runs, and
    // `mock.results` records whether each evaluation returned or threw — the
    // distinction between the card's two candidate mechanisms.
    const condSpy = vi.spyOn(automation, 'evaluateCondition');

    // The write that puts the record INTO the condition.
    await data.update('esc_case', { id, priority: 'critical' }, { context: { userId: 'u_trigger' } });
    await sleep(400);

    // Leg 1 — the flow actually FIRED. Without this a missing WARN proves
    // nothing (a flow that never runs never loops).
    const row = (await data.findOne('esc_case', { where: { id } })) as Record<string, unknown>;
    expect(row.status, 'the flow ran and applied its own write-back').toBe('escalated');
    expect(row.escalated_date).toBe('2026-08-14T13:14:38.628Z');

    // Leg 3 — the START condition was evaluated on BOTH dispatches: the
    // triggering one and the re-entrant one the flow's own write caused.
    // Filtered to this flow's start condition so edge/decision predicates in
    // any other flow cannot inflate the count.
    const startCondEvals = condSpy.mock.calls
      .map((call, index) => ({ call, result: condSpy.mock.results[index] }))
      .filter(({ call }) => {
        const expr = call[0] as string | { source?: string };
        return (typeof expr === 'string' ? expr : expr?.source) === CONDITION;
      });

    expect(
      startCondEvals,
      'the start condition is evaluated on the re-entrant dispatch too, not only the first',
    ).toHaveLength(2);

    // …and it produced a VERDICT rather than aborting. An abort here is the
    // card's second candidate mechanism; it must not be how the loop ends.
    expect(startCondEvals.map((e) => e.result?.type)).toEqual(['return', 'return']);
    expect(startCondEvals[0]?.result?.value, 'the triggering write is inside the guard').toBe(true);
    expect(
      startCondEvals[1]?.result?.value,
      "the flow's own write-back is outside the guard — the author's condition is what stops the re-fire",
    ).toBe(false);

    // …against the POST-write row. This is the leg that proves the guard terms
    // were really re-read, rather than the first dispatch's snapshot re-judged.
    const reentrantVars = startCondEvals[1]?.call[1] as Map<string, unknown>;
    const reentrantRecord = reentrantVars.get('record') as Record<string, unknown>;
    expect(reentrantRecord.status).toBe('escalated');
    expect(reentrantRecord.escalated_date).toBe('2026-08-14T13:14:38.628Z');

    // Leg 2 — the loop-breaker was never reached. It stays armed as a backstop
    // (unchanged in strength, see `engine-reentrancy-guard.test.ts`); it is
    // simply no longer the thing doing the work.
    expect(breakerWarns, 'the last-resort loop-breaker never had to fire').toEqual([]);
  }, 20000);
});
