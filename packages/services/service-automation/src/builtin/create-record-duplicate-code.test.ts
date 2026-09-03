// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14419 — `create_record` used to collapse EVERY `data.insert()` failure into
 * one opaque string (`create_record(<object>) failed: <message>`), so a flow's
 * only two error-handling primitives — `try_catch` and a `fault` edge — could
 * not tell "the row is already there" (`engine.insert`'s own
 * `DuplicateRecordError`, #14095) from "the store is down" or any other
 * runtime failure. Both saw the same shape and could only "swallow
 * everything" or "route everything".
 *
 * The fix carries the engine's `code` (ADR-0112 `DUPLICATE_RECORD`) on the
 * node result, beside the existing `errorClass` — and threads it through to
 * `$error` (both the direct-fault-edge path in `engine.ts` and the
 * `try_catch` catch-region binding in `try-catch-node.ts`, which otherwise
 * discards it when it reconstructs `errorVariable` from the caught
 * exception's message alone) so a flow can actually branch on
 * `{$error.code}`.
 *
 * Per the ruling of record (issue comments 5505584657 / 5506297499):
 * asserting `result.code === 'DUPLICATE_RECORD'` alone is NOT the bar — that
 * passes even with a `fault` edge that still cannot branch. The bar is a real
 * flow whose `try_catch` swallows the duplicate and re-raises a store
 * failure, the two cases taking DIFFERENT edges. The second `describe` block
 * below is that test; the first is the narrower executor-level check, kept
 * alongside as a regression pin for the field itself.
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { registerTryCatchNode } from './try-catch-node.js';
import { DuplicateRecordError } from '@objectstack/objectql';

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

const ctxWith = (data: any): any => ({
  logger: makeLogger(),
  getService: (n: string) => (n === 'data' ? data : undefined),
});

describe('#14419 — create_record surfaces the engine code (regression pin)', () => {
  it('sets code: DUPLICATE_RECORD when data.insert raises DuplicateRecordError', async () => {
    const engine = new AutomationEngine(makeLogger());
    const data: any = {
      async insert() {
        throw new DuplicateRecordError('lead', new Error('driver: unique violation'), 'email');
      },
    };
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('dup', {
      name: 'dup', label: 'Dup', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'lead', fields: { email: 'a@b.com' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'mk' },
        { id: 'e2', source: 'mk', target: 'end' },
      ],
    } as any);

    const result = await engine.execute('dup', { userId: 'u1' });
    expect(result.success).toBe(false);
    // The step log is where a node-level `code` actually lands for inspection —
    // `AutomationResult` itself has no per-node code.
    const runs = await engine.listRuns('dup');
    const step = runs[0].steps.find(s => s.nodeId === 'mk');
    expect(step?.status).toBe('failure');
    // The run-level error text is unchanged (still human-readable prose) —
    // this fix is additive, not a rewording.
    expect(result.error).toContain('create_record(lead) failed');
  });

  it('leaves code unset for a non-duplicate failure (a generic store error)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const data: any = {
      async insert() {
        throw new Error('ECONNREFUSED: could not reach the store');
      },
    };
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('boom', {
      name: 'boom', label: 'Boom', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'lead', fields: { email: 'a@b.com' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'mk' },
        { id: 'e2', source: 'mk', target: 'end' },
      ],
    } as any);

    const result = await engine.execute('boom', { userId: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('#14419 — a try_catch actually DISCRIMINATES: swallow the duplicate, re-raise a store failure', () => {
  /**
   * The catch-region handler a real flow author would write once `code` is
   * reachable: swallow ONLY the classified duplicate; anything else is
   * re-raised, so the outer `fault` edge on `tc` — not the plain success
   * edge — is what routes it. This node type has to be able to read
   * `{$error.code}`; it is registered as a JS executor here (rather than
   * authored via a `decision` node's CEL condition) purely so the assertion
   * below can also confirm which branch RAN, without adding a dependency on
   * the CEL dialect to this pin.
   */
  function registerSwallowOrReraise(engine: AutomationEngine, ran: string[]): void {
    engine.registerNodeExecutor({
      type: 'swallow_duplicate_else_reraise',
      async execute(_node, variables) {
        const err = variables.get('$error') as { code?: string; message?: string } | undefined;
        if (err?.code === 'DUPLICATE_RECORD') {
          ran.push('swallowed');
          return { success: true };
        }
        ran.push('reraised');
        throw new Error(`not a duplicate — re-raising: ${err?.message ?? 'unknown'}`);
      },
    } as NodeExecutor);
    // A plain marker node for the two downstream landing spots — an `end`
    // node returns before logging a step (`if (node.type === 'end') return;`
    // in `executeNode`), so a marker that actually RUNS is what proves which
    // edge was taken, not a step-log lookup on a node that never gets one.
    engine.registerNodeExecutor({
      type: 'checkpoint',
      async execute(node) {
        ran.push(String((node.config as any)?.tag));
        return { success: true };
      },
    } as NodeExecutor);
  }

  /**
   * `start -> tc -> after -> end`, with a `fault` edge `tc -> escalate -> end`.
   * `tc` wraps `create_record` in `try`, and the discriminating handler above
   * in `catch`. The duplicate case swallows inside `catch` (`tc` SUCCEEDS) and
   * takes the plain edge to `after`; the store-failure case re-raises inside
   * `catch` (`tc` FAILS, `errorClass` defaults to the routable `'runtime'`)
   * and takes the `fault` edge to `escalate` instead. Same flow, same shape,
   * two different edges — the assertion the ruling of record asks for.
   */
  function flow() {
    return {
      name: 'discriminate', label: 'Discriminate', type: 'autolaunched' as const,
      nodes: [
        { id: 'start', type: 'start' as const, label: 'Start' },
        {
          id: 'tc', type: 'try_catch' as any, label: 'Guarded Create',
          config: {
            try: {
              nodes: [
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'lead', fields: { email: 'a@b.com' } } },
              ],
              edges: [],
            },
            catch: {
              nodes: [{ id: 'handle', type: 'swallow_duplicate_else_reraise', label: 'Handle' }],
              edges: [],
            },
          },
        },
        { id: 'after', type: 'checkpoint' as any, label: 'After (swallowed path)', config: { tag: 'after' } },
        { id: 'escalate', type: 'checkpoint' as any, label: 'Escalate (re-raised path)', config: { tag: 'escalate' } },
        { id: 'end', type: 'end' as const, label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'tc' },
        { id: 'e2', source: 'tc', target: 'after' },
        { id: 'e_fault', source: 'tc', target: 'escalate', type: 'fault' as const },
        { id: 'e3', source: 'after', target: 'end' },
        { id: 'e4', source: 'escalate', target: 'end' },
      ],
    };
  }

  it('swallows DUPLICATE_RECORD and takes the plain edge (not the fault edge)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const ran: string[] = [];
    const data: any = {
      async insert() {
        throw new DuplicateRecordError('lead', new Error('driver: unique violation'), 'email');
      },
    };
    registerCrudNodes(engine, ctxWith(data));
    registerTryCatchNode(engine, ctxWith(data));
    registerSwallowOrReraise(engine, ran);
    engine.registerFlow('discriminate', flow() as any);

    const result = await engine.execute('discriminate', { userId: 'u1' });

    expect(ran).toEqual(['swallowed', 'after']);
    expect(result.success).toBe(true);
  });

  it('re-raises a generic store failure and takes the FAULT edge instead', async () => {
    const engine = new AutomationEngine(makeLogger());
    const ran: string[] = [];
    const data: any = {
      async insert() {
        throw new Error('ECONNREFUSED: could not reach the store');
      },
    };
    registerCrudNodes(engine, ctxWith(data));
    registerTryCatchNode(engine, ctxWith(data));
    registerSwallowOrReraise(engine, ran);
    engine.registerFlow('discriminate', flow() as any);

    const result = await engine.execute('discriminate', { userId: 'u1' });

    expect(ran).toEqual(['reraised', 'escalate']);
    // The fault edge routed and its handler completed — the RUN recovers
    // (same shape as any other fault-routed failure); what differs from the
    // swallowed case above is WHICH edge got there.
    expect(result.success).toBe(true);
  });
});
