// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A node behaves the same inside a structured region as it does outside one
 * (#4347).
 *
 * `registerFlow` canonicalizes a stored flow through three passes — the ADR-0087
 * conversion table, `FlowSchema.parse`, and the ADR-0032 predicate validation —
 * and all three walked `flow.nodes` / `flow.edges` only. An ADR-0031 container
 * keeps a whole sub-graph in its open `config`, so every one of them stopped at
 * the container and metadata came out **position-dependent**: the reporting app
 * shipped three sweeps whose gates never opened, with `success: true` on every
 * run and nothing in the log.
 *
 * Each test here is a parity assertion: identical metadata, once at the top
 * level and once inside a `loop` body, must come out the same.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { registerLoopNode } from './builtin/loop-node.js';
import { registerLogicNodes } from './builtin/logic-nodes.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}

/** A logger that records `warn` calls — message AND structured meta, since
 *  #6654 moved the soft-fail validators' identifiers into the meta slot. */
function recordingLogger(sink: Array<{ msg: string; meta?: Record<string, any> }>) {
  const l: any = {
    info() {}, error() {}, debug() {},
    warn(msg: string, meta?: Record<string, any>) { sink.push({ msg: String(msg), meta }); },
    child() { return l; },
  };
  return l;
}
function ctx() {
  return { logger: silentLogger(), getService() { return undefined; } } as any;
}

const CONDITION = 'row.shouldRun == true';
const ENVELOPE = { dialect: 'cel', source: CONDITION };

describe('#4347 — a loop-body predicate is canonicalized like a top-level one', () => {
  let engine: AutomationEngine;
  let opened: string[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    opened = [];
    registerLoopNode(engine, ctx());
    registerLogicNodes(engine, ctx());
    // The node behind the gate: it records that the gate let execution through,
    // which is the only way to tell "nothing to do" from "the gate is broken".
    engine.registerNodeExecutor({
      type: 'mark',
      async execute(node) { opened.push(String(node.id)); return { success: true }; },
    } as NodeExecutor);
  });

  /** The issue's repro: the same predicate on a top-level edge and a body edge. */
  const reproFlow = (condition: unknown) => ({
    name: 'repro', label: 'Repro', type: 'schedule' as const, status: 'active' as const, runAs: 'system' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
      {
        id: 'loop', type: 'loop', label: 'Loop',
        config: {
          collection: [{ shouldRun: true }], iteratorVariable: 'row',
          body: {
            nodes: [
              { id: 'gate', type: 'decision', label: 'Gate' },
              { id: 'inner', type: 'mark', label: 'Inner' },
            ],
            edges: [{ id: 'b1', source: 'gate', target: 'inner', type: 'conditional' as const, condition }],
          },
        },
      },
      { id: 'outer', type: 'mark', label: 'Outer' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'loop', type: 'default' as const },
      { id: 'e2', source: 'loop', target: 'outer', type: 'conditional' as const, condition },
    ],
  });

  it.each([
    ['a bare string', CONDITION],
    ['an explicit CEL envelope', ENVELOPE],
  ])('stores %s as the canonical envelope on BOTH edges', (_label, condition) => {
    engine.registerFlow('repro', reproFlow(condition));
    const flow = engine.flows.get('repro')!;

    const topEdge = flow.edges.find(e => e.id === 'e2')!.condition;
    const bodyEdge = (flow.nodes.find(n => n.id === 'loop')!.config as any).body.edges[0].condition;

    expect(topEdge).toEqual(ENVELOPE);
    expect(bodyEdge).toEqual(ENVELOPE);
  });

  it.each([
    ['a bare string', CONDITION],
    ['an explicit CEL envelope', ENVELOPE],
  ])('opens the loop-body gate when written as %s', async (_label, condition) => {
    engine.registerFlow('repro', reproFlow(condition));
    const result = await engine.execute('repro', { params: {}, event: 'schedule' } as never);

    expect(result.success).toBe(true);
    // The assertion the reporting app had to add by hand: a run that reports
    // success and writes nothing is indistinguishable from one with no work.
    expect(opened).toEqual(['inner', 'outer']);
  });

  it('still evaluates a loop-body predicate that is FALSE as false', async () => {
    engine.registerFlow('repro', reproFlow('row.shouldRun == false'));
    await engine.execute('repro', { params: {}, event: 'schedule' } as never);
    expect(opened).toEqual([]);
  });
});

describe('#4347 — the conversion table reaches a node inside a region', () => {
  it('renames a protocol-11 callout type in a loop body, so the node still has an executor', async () => {
    const engine = new AutomationEngine(silentLogger());
    registerLoopNode(engine, ctx());
    const called: string[] = [];
    // Only the CANONICAL type is registered — exactly the runtime situation: the
    // retired alias has no executor, so an unconverted nested node fails.
    engine.registerNodeExecutor({
      type: 'http',
      async execute(node) { called.push(String(node.id)); return { success: true }; },
    } as NodeExecutor);

    engine.registerFlow('callout', {
      name: 'callout', label: 'Callout', type: 'schedule', status: 'active', runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
        {
          id: 'loop', type: 'loop', label: 'Loop',
          config: {
            collection: [1], iteratorVariable: 'row',
            body: { nodes: [{ id: 'nested', type: 'webhook', label: 'Nested', config: { url: 'https://x' } }], edges: [] },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'loop', type: 'default' }],
    });

    expect((engine.flows.get('callout')!.nodes[1]!.config as any).body.nodes[0].type).toBe('http');
    const result = await engine.execute('callout', { params: {}, event: 'schedule' } as never);
    expect(result.success).toBe(true);
    expect(called).toEqual(['nested']);
  });

  it('canonicalizes a nested CRUD alias — an unconverted `filters` leaves no filter at all', () => {
    const engine = new AutomationEngine(silentLogger());
    registerLoopNode(engine, ctx());
    engine.registerNodeExecutor({ type: 'delete_record', async execute() { return { success: true }; } } as NodeExecutor);

    engine.registerFlow('purge', {
      name: 'purge', label: 'Purge', type: 'schedule', status: 'active', runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
        {
          id: 'loop', type: 'loop', label: 'Loop',
          config: {
            collection: [1], iteratorVariable: 'row',
            body: {
              nodes: [{ id: 'del', type: 'delete_record', label: 'Del', config: { object: 'lead', filters: { status: 'stale' } } }],
              edges: [],
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'loop', type: 'default' }],
    });

    expect((engine.flows.get('purge')!.nodes[1]!.config as any).body.nodes[0].config)
      .toEqual({ objectName: 'lead', filter: { status: 'stale' } });
  });
});

describe('#4347 — predicate validation covers region graphs', () => {
  const braceTrapFlow = (placeNested: boolean) => {
    const bad = '{record.rating} >= 4'; // #1491 — braces in a CEL predicate
    const body = {
      nodes: [{ id: 'gate', type: 'decision', label: 'Gate' }, { id: 'inner', type: 'mark', label: 'Inner' }],
      edges: [{
        id: 'b1', source: 'gate', target: 'inner', type: 'conditional' as const,
        ...(placeNested ? { condition: bad } : {}),
      }],
    };
    return {
      name: 'trap', label: 'Trap', type: 'schedule' as const, status: 'active' as const, runAs: 'system' as const,
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
        { id: 'loop', type: 'loop', label: 'Loop', config: { collection: [1], iteratorVariable: 'row', body } },
        { id: 'outer', type: 'mark', label: 'Outer' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'loop', type: 'default' as const },
        {
          id: 'e2', source: 'loop', target: 'outer', type: 'conditional' as const,
          ...(placeNested ? {} : { condition: bad }),
        },
      ],
    };
  };

  let engine: AutomationEngine;
  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    registerLoopNode(engine, ctx());
    registerLogicNodes(engine, ctx());
    engine.registerNodeExecutor({ type: 'mark', async execute() { return { success: true }; } } as NodeExecutor);
  });

  it('rejects the brace trap at the top level (unchanged)', () => {
    expect(() => engine.registerFlow('trap', braceTrapFlow(false))).toThrow(/invalid expression/i);
  });

  it('rejects the SAME brace trap inside a loop body, naming the region', () => {
    expect(() => engine.registerFlow('trap', braceTrapFlow(true))).toThrow(/invalid expression/i);
    expect(() => engine.registerFlow('trap', braceTrapFlow(true))).toThrow(/loop 'loop' body/);
  });
});

/**
 * #4389 — the three registration validators #4347 left walking `flow.nodes`
 * only. Same parity shape: identical bad metadata at the top level and one
 * level in must get the identical verdict.
 *
 * Measured before extending them: 0 new findings across app-showcase / app-crm
 * / app-todo (9 region graphs), so nothing that registers today stops.
 */
describe('#4389 — registration validators cover region graphs', () => {
  /** Wrap `nodes` in a loop body when `nested`, else splice them in flat. */
  const flowWith = (nested: boolean, bodyNodes: Array<Record<string, unknown>>) => ({
    name: 'sweep', label: 'Sweep', type: 'schedule' as const, status: 'active' as const, runAs: 'system' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 0 * * *' } },
      ...(nested
        ? [{
            id: 'loop', type: 'loop', label: 'Loop',
            config: {
              collection: [1], iteratorVariable: 'row',
              body: { nodes: bodyNodes, edges: [] },
            },
          }]
        : bodyNodes),
    ],
    edges: [{ id: 'e1', source: 'start', target: nested ? 'loop' : String(bodyNodes[0]!.id), type: 'default' as const }],
  });

  describe('validateNodeConfigKeys (hard-fail)', () => {
    let engine: AutomationEngine;
    beforeEach(() => {
      engine = new AutomationEngine(silentLogger());
      registerLoopNode(engine, ctx());
      registerCrudNodes(engine, ctx());
    });

    // `fieldz` is not on the `create_record` descriptor — the #4277 typo class.
    const typoNode = [{ id: 'w', type: 'create_record', label: 'W', config: { objectName: 'lead', fieldz: { a: 1 } } }];

    it('rejects an undeclared config key at the top level (unchanged)', () => {
      expect(() => engine.registerFlow('sweep', flowWith(false, typoNode))).toThrow(/undeclared config key/);
    });

    it('rejects the SAME key inside a loop body, naming the region', () => {
      expect(() => engine.registerFlow('sweep', flowWith(true, typoNode))).toThrow(/undeclared config key/);
      expect(() => engine.registerFlow('sweep', flowWith(true, typoNode))).toThrow(/loop 'loop' body · node 'w'/);
    });

    it('reports each nested key ONCE — the container config physically contains it', () => {
      try {
        engine.registerFlow('sweep', flowWith(true, typoNode));
        throw new Error('expected a rejection');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toMatch(/1 undeclared config key/);
        expect(msg.match(/`fieldz`/g)).toHaveLength(1);
      }
    });

    it('leaves a correct region alone', () => {
      const ok = [{ id: 'w', type: 'create_record', label: 'W', config: { objectName: 'lead', fields: { a: 1 } } }];
      expect(() => engine.registerFlow('sweep', flowWith(true, ok))).not.toThrow();
    });
  });

  describe('unknown node types (soft-fail)', () => {
    const unknownNode = [{ id: 'x', type: 'no_such_node_type', label: 'X' }];

    const warningsFor = (nested: boolean) => {
      const warnings: Array<{ msg: string; meta?: Record<string, any> }> = [];
      const engine = new AutomationEngine(recordingLogger(warnings));
      registerLoopNode(engine, ctx());
      engine.registerFlow('sweep', flowWith(nested, unknownNode));
      // #4771 — the verdict is delivered once the vocabulary is sealed (during
      // boot an unknown type only means "not registered YET"). Region coverage
      // is unchanged: the audit walks ADR-0031 regions exactly as the
      // registration-time check did.
      engine.sealNodeTypeVocabulary();
      return warnings.filter(w => w.msg.includes('no registered executor'));
    };

    it('warns about an unknown node type at the top level (unchanged)', () => {
      expect(warningsFor(false)).toHaveLength(1);
    });

    it('warns about the SAME type inside a loop body', () => {
      const warnings = warningsFor(true);
      expect(warnings).toHaveLength(1);
      // #6654 — the type name is flow-author metadata with no newline
      // constraint, so it rides the structured slot instead of the message.
      // The region-coverage fact under test is unchanged: the audit found
      // THIS type inside the loop body.
      expect(warnings[0].meta?.unknownTypes).toContain('no_such_node_type');
    });
  });

  describe('validateControlFlow (hard-fail)', () => {
    let engine: AutomationEngine;
    beforeEach(() => {
      engine = new AutomationEngine(silentLogger());
      registerLoopNode(engine, ctx());
      engine.registerNodeExecutor({ type: 'mark', async execute() { return { success: true }; } } as NodeExecutor);
    });

    /** A two-entry (malformed) region — `analyzeRegion`'s single-entry rule. */
    const malformed = { nodes: [{ id: 'a', type: 'mark', label: 'A' }, { id: 'b', type: 'mark', label: 'B' }], edges: [] };
    const innerLoop = { id: 'inner', type: 'loop', label: 'Inner', config: { collection: [1], body: malformed } };

    it('rejects a malformed region on a top-level container (unchanged)', () => {
      expect(() => engine.registerFlow('sweep', flowWith(false, [innerLoop]))).toThrow(/single-entry/);
    });

    it('rejects a malformed region on a NESTED container, naming both levels', () => {
      // Previously this registered clean and threw mid-run from `findRegionEntry`
      // — after the outer loop had begun iterating.
      expect(() => engine.registerFlow('sweep', flowWith(true, [innerLoop]))).toThrow(/single-entry/);
      expect(() => engine.registerFlow('sweep', flowWith(true, [innerLoop])))
        .toThrow(/loop 'loop' body → loop 'inner' body/);
    });

    it('leaves a well-formed nested container alone', () => {
      const wellFormed = {
        id: 'inner', type: 'loop', label: 'Inner',
        config: { collection: [1], body: { nodes: [{ id: 'a', type: 'mark', label: 'A' }], edges: [] } },
      };
      expect(() => engine.registerFlow('sweep', flowWith(true, [wellFormed]))).not.toThrow();
    });
  });
});

describe("#4347 — the legacy `{var}` path refuses an unresolved reference", () => {
  let engine: AutomationEngine;
  beforeEach(() => { engine = new AutomationEngine(silentLogger()); });

  it('evaluates a wholly brace-free dotted predicate as CEL', () => {
    const vars = new Map<string, unknown>([['oppRecord', { amount: 10 }]]);
    // The reported footgun: 'oppRecord.amount' > '500000' compares 'o' to '5',
    // so this used to be TRUE for every record regardless of the amount. #4347
    // stopped the wrong answer by refusing it; #4336 goes on to give the RIGHT
    // one — a condition with no `{…}` hole is CEL, so the amount is compared.
    expect(engine.evaluateCondition('oppRecord.amount > 500000', vars)).toBe(false);
    expect(engine.evaluateCondition('oppRecord.amount > 5', vars)).toBe(true);
  });

  it('still refuses a dotted reference mixed INTO a template-dialect condition', () => {
    // A `{…}` hole puts the whole condition in the template dialect, where a
    // dotted operand is text and the compare would answer anyway. One operand
    // away from the right dialect, so the refusal names the fix.
    const vars = new Map<string, unknown>([['limit', 5]]);
    expect(() => engine.evaluateCondition('{limit} > record.amount', vars)).toThrow(/unresolved expression reference/);
    expect(() => engine.evaluateCondition('{limit} > record.amount', vars)).toThrow(/dialect: 'cel'/);
    // Either side of the operator.
    expect(() => engine.evaluateCondition('{limit} == row.shouldRun', vars)).toThrow(/unresolved expression reference/);
  });

  it('evaluates the same predicate correctly once it is a CEL envelope', () => {
    const vars = new Map<string, unknown>([['oppRecord', { amount: 10 }]]);
    expect(engine.evaluateCondition({ dialect: 'cel', source: 'oppRecord.amount > 500000' }, vars)).toBe(false);
  });

  it('leaves the documented legacy dialects alone', () => {
    const vars = new Map<string, unknown>([['amount', 500], ['status', 'active'], ['rate', 1.5]]);
    // `{var}` templates: substitution resolves the reference before comparison.
    expect(engine.evaluateCondition('{amount} > 100', vars)).toBe(true);
    // A decimal literal is not a reference.
    expect(engine.evaluateCondition('{rate} > 1.25', vars)).toBe(true);
    // Bare words compare as strings on purpose — the documented spelling.
    expect(engine.evaluateCondition('{status} == active', vars)).toBe(true);
    expect(engine.evaluateCondition('true', vars)).toBe(true);
    // A dotted key that DID resolve is a value by the time the compare runs.
    expect(engine.evaluateCondition('{a.b} == 7', new Map([['a.b', 7]]))).toBe(true);
  });
});
