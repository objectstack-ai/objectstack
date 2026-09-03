// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14419 — `create_record` used to collapse EVERY `data.insert()` failure into
 * one opaque string (`create_record(OBJECT_NAME) failed: MESSAGE_TEXT`), so a
 * flow's only two error-handling primitives — `try_catch` and a `fault` edge
 * — could not tell "the row is already there" (`engine.insert`'s own
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
 * below is that test; the first is the narrower executor/`$error` -level
 * check, kept alongside as a regression pin for the field itself.
 *
 * The third `describe` block is a PR #14948 patch-round-1 addition: a
 * correctness defect the tier contract review reproduced and this PR's own
 * `try_catch` fix introduced. See its header comment for the mechanism.
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { registerTryCatchNode } from './try-catch-node.js';
import { registerLoopNode } from './loop-node.js';
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

describe('#14419 — create_record surfaces the engine code on $error (regression pin)', () => {
  /** Captures the `$error` a fault-edge handler is actually handed. */
  function registerCaptureError(engine: AutomationEngine, seen: Array<{ code?: string; message?: string } | undefined>): void {
    engine.registerNodeExecutor({
      type: 'capture_error',
      async execute(_node, variables) {
        seen.push(variables.get('$error') as { code?: string; message?: string } | undefined);
        return { success: true };
      },
    } as NodeExecutor);
  }

  it('sets $error.code to DUPLICATE_RECORD for a directly-declared fault edge to read', async () => {
    const engine = new AutomationEngine(makeLogger());
    const data: any = {
      async insert() {
        throw new DuplicateRecordError('lead', new Error('driver: unique violation'), 'email');
      },
    };
    registerCrudNodes(engine, ctxWith(data));
    const seen: Array<{ code?: string; message?: string } | undefined> = [];
    registerCaptureError(engine, seen);
    engine.registerFlow('dup', {
      name: 'dup', label: 'Dup', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'lead', fields: { email: 'a@b.com' } } },
        { id: 'handler', type: 'capture_error', label: 'Handler' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'mk' },
        { id: 'e2', source: 'mk', target: 'end' },
        // This is the DIRECT fault-edge read path (engine.ts's `executeNode`,
        // not nested in a `try_catch`) — a plain node, own fault edge.
        { id: 'e_fault', source: 'mk', target: 'handler', type: 'fault' },
        { id: 'e3', source: 'handler', target: 'end' },
      ],
    } as any);

    const result = await engine.execute('dup', { userId: 'u1' });
    // The fault edge routed and its handler completed — the run recovers.
    expect(result.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe('DUPLICATE_RECORD');
    expect(seen[0]?.message).toContain('create_record(lead) failed');
  });

  it('leaves $error.code unset for a non-duplicate failure (a generic store error)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const data: any = {
      async insert() {
        throw new Error('ECONNREFUSED: could not reach the store');
      },
    };
    registerCrudNodes(engine, ctxWith(data));
    const seen: Array<{ code?: string; message?: string } | undefined> = [];
    registerCaptureError(engine, seen);
    engine.registerFlow('boom', {
      name: 'boom', label: 'Boom', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'lead', fields: { email: 'a@b.com' } } },
        { id: 'handler', type: 'capture_error', label: 'Handler' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'mk' },
        { id: 'e2', source: 'mk', target: 'end' },
        { id: 'e_fault', source: 'mk', target: 'handler', type: 'fault' },
        { id: 'e3', source: 'handler', target: 'end' },
      ],
    } as any);

    const result = await engine.execute('boom', { userId: 'u1' });
    expect(result.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBeUndefined();
    expect(seen[0]?.message).toContain('ECONNREFUSED');
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

describe('#14419 (PR #14948 patch round 1) — a stale $error.code must not leak across attempts', () => {
  /**
   * The tier contract review's reproduction. `try_catch`'s catch region reads
   * `code` off the run-wide `$error` (necessarily — see the second describe
   * block above). But the engine only REWRITES `$error` when a failing node
   * RETURNS `{ success: false }`, or when it THROWS through a node with its
   * OWN `fault` edge (`engine.ts`'s `executeNode`, the throw arm). A node
   * inside a `try_catch`'s try region has no fault edge of its own — the
   * region's synthetic sub-flow carries only the region's own edges — so a
   * node that FAILS BY THROWING (a `timeoutMs` firing, here) leaves `$error`
   * exactly as an EARLIER, unrelated failure left it. Without the identity
   * guard in `try-catch-node.ts` (`innerError !== errorBefore`), that earlier
   * failure's `DUPLICATE_RECORD` code leaks onto this one — a store failure
   * misread as a duplicate and SWALLOWED, through a different door than
   * #14419's original bug but the exact same failure mode: the very thing
   * fence 4 of the ruling of record exists to rule out.
   */
  function registerProbes(engine: AutomationEngine, seen: Array<{ code?: string; message?: string }>, ran: string[]): void {
    engine.registerNodeExecutor({
      type: 'swallow_duplicate_else_reraise',
      async execute(_node, variables) {
        const err = variables.get('$error') as { code?: string; message?: string } | undefined;
        seen.push({ code: err?.code, message: err?.message });
        if (err?.code === 'DUPLICATE_RECORD') { ran.push('swallowed'); return { success: true }; }
        ran.push('reraised');
        throw new Error(`re-raising: ${err?.message}`);
      },
    } as NodeExecutor);
    engine.registerNodeExecutor({
      type: 'checkpoint',
      async execute(node) { ran.push(String((node.config as any)?.tag)); return { success: true }; },
    } as NodeExecutor);
  }

  it('loop over two rows: row 1 duplicate (swallowed), row 2 a timeout (must NOT inherit row 1\'s code)', async () => {
    const engine = new AutomationEngine(makeLogger());
    const ran: string[] = [];
    const seen: Array<{ code?: string; message?: string }> = [];
    let call = 0;
    const data: any = {
      async insert() {
        call++;
        if (call === 1) throw new DuplicateRecordError('lead', new Error('driver: unique violation'), 'email');
        // Row 2: the store hangs — the node's own `timeoutMs` fires, which is
        // a THROW, not a returned failure.
        await new Promise(() => {});
      },
    };
    registerCrudNodes(engine, ctxWith(data));
    registerTryCatchNode(engine, ctxWith(data));
    registerLoopNode(engine, ctxWith(data));
    registerProbes(engine, seen, ran);
    engine.registerFlow('sweep', {
      name: 'sweep', label: 'Sweep', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'each', type: 'loop', label: 'Each row',
          config: {
            collection: [{ email: 'a@b.com' }, { email: 'c@d.com' }], iteratorVariable: 'row',
            body: {
              nodes: [
                {
                  id: 'tc', type: 'try_catch', label: 'Guarded create',
                  config: {
                    try: { nodes: [{ id: 'mk', type: 'create_record', label: 'Create', timeoutMs: 20, config: { objectName: 'lead', fields: { email: '{row.email}' } } }], edges: [] },
                    catch: { nodes: [{ id: 'handle', type: 'swallow_duplicate_else_reraise', label: 'Handle' }], edges: [] },
                  },
                },
              ],
              edges: [],
            },
          },
        },
        { id: 'done', type: 'checkpoint', label: 'Done', config: { tag: 'done' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'each' },
        { id: 'e2', source: 'each', target: 'done' },
        { id: 'e3', source: 'done', target: 'end' },
      ],
    } as any);

    await engine.execute('sweep', { userId: 'u1' } as any);

    // Row 1: a genuine duplicate — swallowed, with the right code.
    expect(seen[0]?.code).toBe('DUPLICATE_RECORD');
    // Row 2: a timeout, NOT a duplicate — must carry no code, and must be
    // re-raised rather than silently swallowed as "already there".
    expect(seen[1]?.message).toContain('timed out');
    expect(seen[1]?.code).toBeUndefined();
    expect(ran).toEqual(['swallowed', 'reraised']);
  });

  it('plain flow: an earlier fault-routed duplicate must not leak into a LATER unrelated try_catch', async () => {
    const engine = new AutomationEngine(makeLogger());
    const ran: string[] = [];
    const seen: Array<{ code?: string; message?: string }> = [];
    const data: any = {
      async insert() { throw new DuplicateRecordError('lead', new Error('driver: unique violation'), 'email'); },
    };
    registerCrudNodes(engine, ctxWith(data));
    registerTryCatchNode(engine, ctxWith(data));
    registerProbes(engine, seen, ran);
    engine.registerNodeExecutor({
      type: 'store_down',
      async execute() { throw new Error('ECONNREFUSED: could not reach the store'); },
    } as NodeExecutor);
    engine.registerFlow('plain', {
      name: 'plain', label: 'Plain', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'a', type: 'create_record', label: 'A', config: { objectName: 'lead', fields: { email: 'a@b.com' } } },
        { id: 'recoverA', type: 'checkpoint', label: 'recover A', config: { tag: 'recoverA' } },
        {
          id: 'tc', type: 'try_catch', label: 'Guarded',
          config: {
            try: { nodes: [{ id: 'b', type: 'store_down', label: 'B' }], edges: [] },
            catch: { nodes: [{ id: 'handle', type: 'swallow_duplicate_else_reraise', label: 'Handle' }], edges: [] },
          },
        },
        { id: 'after', type: 'checkpoint', label: 'After', config: { tag: 'after' } },
        { id: 'escalate', type: 'checkpoint', label: 'Escalate', config: { tag: 'escalate' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'a' },
        // A fails as a duplicate FIRST and is fault-routed (recovered) —
        // this is what leaves `DUPLICATE_RECORD` sitting on `$error` before
        // `tc` (an entirely unrelated later node) ever runs.
        { id: 'ef', source: 'a', target: 'recoverA', type: 'fault' },
        { id: 'e2', source: 'recoverA', target: 'tc' },
        { id: 'e3', source: 'tc', target: 'after' },
        { id: 'e4', source: 'tc', target: 'escalate', type: 'fault' },
        { id: 'e5', source: 'after', target: 'end' },
        { id: 'e6', source: 'escalate', target: 'end' },
      ],
    } as any);

    const result = await engine.execute('plain', { userId: 'u1' });

    expect(seen[0]?.message).toContain('ECONNREFUSED');
    expect(seen[0]?.code).toBeUndefined();
    expect(ran).toEqual(['recoverA', 'reraised', 'escalate']);
    expect(result.success).toBe(true);
  });
});
