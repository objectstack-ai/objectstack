// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11838 — a node rename carries the expression references to the
 * node's outputs, read through the expression parsers; a reference no parser
 * can place refuses the rename; and the Problems check names a reference (or a
 * boundary event) left naming a node that does not exist, as an error.
 *
 * `expressionRefsAfterNodeRename` takes the draft with the rename already
 * written to the node — the state `FlowNodeInspector` hands it, after the edge
 * and boundary halves (objectui#11827) — so each fixture here renames the node
 * first, as `renamed()` does.
 */

import { describe, it, expect } from 'vitest';
import {
  describeExprSite,
  expressionRefsAfterNodeRename,
  exprSites,
  missingNodePositions,
  nodeIdPositions,
  parseExpr,
} from './flow-node-refs';
import { missingNodeRefDiagnostics } from './simulator/flow-sim-validate';
import { buildFlowProblems } from './flow-problems';
import { tFormat } from '../i18n';
import { flowNodeDisplayName } from './flow-canvas-parts';

type Rec = Record<string, unknown>;
type Flow = { nodes: Rec[]; edges: Rec[]; variables?: unknown[] };

/** The card's flow: an approval `x` read downstream by a decision branch, an edge guard and a record write. */
function card(): Flow {
  return {
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'approval', label: 'Approve', config: { approvers: [{ type: 'user', value: 'u1' }] } },
      {
        id: 'd',
        type: 'decision',
        label: 'Approved?',
        config: { conditions: [{ label: 'Yes', expression: "x.decision == 'approve'" }, { label: 'Else', expression: 'true' }] },
      },
      {
        id: 'c',
        type: 'create_record',
        label: 'Log it',
        config: { objectName: 'task', fields: { subject: '{x.field}', note: 'Approved by {{x.field}}' } },
      },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'x' },
      { id: 'e2', source: 'x', target: 'd' },
      { id: 'e3', source: 'd', target: 'c', condition: "x.decision == 'approve'" },
      { id: 'e4', source: 'd', target: 'e', isDefault: true },
      { id: 'e5', source: 'c', target: 'e' },
    ],
  };
}

/** `flow` with node `from` already called `to` — the id half of the rename. */
function renamed(flow: Flow, from: string, to: string): Flow {
  return { ...flow, nodes: flow.nodes.map((n) => (n.id === from ? { ...n, id: to } : n)) };
}

/** Every expression's text, by where it sits. */
function texts(flow: Flow): Record<string, string> {
  return Object.fromEntries(exprSites(flow).map((s) => [describeExprSite(s).split(': ')[0], s.source]));
}

function carried(flow: Flow, from: string, to: string): Flow {
  const r = expressionRefsAfterNodeRename(renamed(flow, from, to), from, to);
  if (!r.ok) throw new Error(`refused: ${r.refusal.sites.map(describeExprSite).join('; ')}`);
  return { ...flow, nodes: r.nodes, edges: r.edges };
}

describe('a rename carries the expression references to the node (objectui#11838)', () => {
  it("the card's pin: x → renamed with a downstream x.decision == 'approve' — the reference follows, on the branch and the edge", () => {
    const after = carried(card(), 'x', 'renamed');
    const at = texts(after);
    expect(at['d › config.conditions[0].expression']).toBe("renamed.decision == 'approve'");
    expect(at['d → c › condition']).toBe("renamed.decision == 'approve'");
    expect(missingNodePositions(after).filter((p) => p.kind === 'expression-root')).toEqual([]);
  });

  it('a {{x.field}} hole follows — only the root changes; a single-brace {x.field} is literal text and stays (objectui#12390)', () => {
    const at = texts(carried(card(), 'x', 'renamed'));
    expect(at['c › config.fields.subject']).toBe('{x.field}');
    expect(at['c › config.fields.note']).toBe('Approved by {{renamed.field}}');
  });

  it("a {{ x.at | date }} hole, a CEL value envelope and a body-less loop's bare-name collection follow too", () => {
    const flow = card();
    flow.nodes[3] = {
      ...flow.nodes[3],
      config: {
        objectName: 'task',
        fields: { due: 'on {{ x.at | date }}', total: { dialect: 'cel', source: 'x.amount * 2' } },
      },
    };
    flow.nodes.push({ id: 'l', type: 'loop', label: 'Each', config: { collection: 'x.items', iteratorVariable: 'it' } });
    const at = texts(carried(flow, 'x', 'renamed'));
    expect(at['c › config.fields.due']).toBe('on {{ renamed.at | date }}');
    expect(at['c › config.fields.total.source']).toBe('renamed.amount * 2');
    expect(at['l › config.collection']).toBe('renamed.items');
  });

  it("a loop's collection is CEL by its descriptor, and a map's value envelope follows a rename too (objectui#12170, objectui#12390)", () => {
    // The descriptor marks `collection` a plain `expression` field: a body-less
    // loop reads the bare name of a list variable, and a value-slot collection
    // (a map's) holds a CEL value envelope, read by its own dialect.
    const flow = card();
    flow.nodes.push(
      { id: 'l', type: 'loop', label: 'Each', config: { collection: 'x.items', iteratorVariable: 'it' } },
      { id: 'm', type: 'map', label: 'Each item', config: { collection: { dialect: 'cel', source: 'x.items' }, flowName: 'one_task_signoff', iteratorVariable: 'it' } },
    );
    const dialects = Object.fromEntries(
      exprSites(flow)
        .filter((s) => s.holder.kind === 'node' && s.holderPath[1] === 'collection')
        .map((s) => [s.holder.kind === 'node' ? s.holder.id : '', s.dialect]),
    );
    expect(dialects).toEqual({ l: 'cel', m: 'cel' });
    expect(texts(carried(flow, 'x', 'renamed'))['m › config.collection.source']).toBe('renamed.items');
  });

  it('an identifier that only contains x, a member named x, a string literal and a macro-bound x are untouched', () => {
    const flow = card();
    const source = "xy.decision == 'approve' && ax > 1 && y.x == 2 && \"x.decision\" == z && rows.exists(x, x.ok) && x.decision == 'a'";
    (flow.nodes[2].config as Rec).conditions = [{ label: 'Yes', expression: source }];
    const at = texts(carried(flow, 'x', 'renamed'));
    expect(at['d › config.conditions[0].expression']).toBe(
      "xy.decision == 'approve' && ax > 1 && y.x == 2 && \"x.decision\" == z && rows.exists(x, x.ok) && renamed.decision == 'a'",
    );
  });

  it("keeps the author's bytes: quotes, spacing and a nullable ternary the canonical parse rewrites", () => {
    const flow = card();
    (flow.nodes[2].config as Rec).conditions = [{ label: 'Yes', expression: "x . decision   ==  'approve'" }];
    flow.edges[2] = { ...flow.edges[2], condition: { dialect: 'cel', source: 'x.ok ? x.v : null' } };
    const at = texts(carried(flow, 'x', 'renamed'));
    expect(at['d › config.conditions[0].expression']).toBe("renamed . decision   ==  'approve'");
    expect(at['d → c › condition.source']).toBe('renamed.ok ? renamed.v : null');
  });

  it("a reference inside a region (a loop's body) follows", () => {
    const flow = card();
    flow.nodes.push({
      id: 'l',
      type: 'loop',
      label: 'Each',
      config: {
        collection: { dialect: 'cel', source: 'rows' },
        body: { nodes: [{ id: 'inner', type: 'decision', config: { condition: "x.decision == 'approve'" } }], edges: [] },
      },
    });
    const after = carried(flow, 'x', 'renamed');
    expect(texts(after)['inner › config.condition']).toBe("renamed.decision == 'approve'");
  });

  it("a script body is code, not an expression, and is not rewritten", () => {
    const flow = card();
    flow.nodes.push({ id: 'sc', type: 'script', config: { script: 'return {x.decision}' } });
    const after = carried(flow, 'x', 'renamed');
    expect((after.nodes[5].config as Rec).script).toBe('return {x.decision}');
  });

  it('control: renaming a node nothing references hands back the very same arrays', () => {
    const flow = card();
    const after = renamed(flow, 'c', 'log_it');
    const r = expressionRefsAfterNodeRename(after, 'c', 'log_it');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nodes).toBe(after.nodes);
    expect(r.edges).toBe(after.edges);
  });

  it('untouched nodes and edges come back as the same objects', () => {
    const flow = card();
    const before = renamed(flow, 'x', 'renamed');
    const r = expressionRefsAfterNodeRename(before, 'x', 'renamed');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nodes[0]).toBe(before.nodes[0]);
    expect(r.nodes[4]).toBe(before.nodes[4]);
    expect(r.nodes[2]).not.toBe(before.nodes[2]);
    expect(r.edges[0]).toBe(before.edges[0]);
    expect(r.edges[2]).not.toBe(before.edges[2]);
  });
});

describe('a reference the rename cannot carry refuses it, naming the reference (objectui#11838)', () => {
  it('a reference that does not parse refuses the rename, naming it', () => {
    const flow = card();
    (flow.nodes[2].config as Rec).conditions = [{ label: 'Yes', expression: 'x.decision ==' }];
    const r = expressionRefsAfterNodeRename(renamed(flow, 'x', 'renamed'), 'x', 'renamed');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe('unparsed');
    expect(r.refusal.sites.map(describeExprSite)).toEqual(['d › config.conditions[0].expression: `x.decision ==`']);
  });

  it('a template hole that does not parse refuses it too, while a parsed hole beside it would have followed', () => {
    const flow = card();
    (flow.nodes[3].config as Rec).fields = { subject: '{{x.field}} {{x.field +}}' };
    const r = expressionRefsAfterNodeRename(renamed(flow, 'x', 'renamed'), 'x', 'renamed');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.sites.map(describeExprSite)).toEqual(['c › config.fields.subject: `{{x.field}} {{x.field +}}`']);
  });

  it('control: an expression that does not parse but never reads x does not stop the rename', () => {
    const flow = card();
    flow.nodes.push({ id: 'z', type: 'decision', config: { conditions: [{ label: 'Bad', expression: 'amount >' }] } });
    expect(expressionRefsAfterNodeRename(renamed(flow, 'x', 'renamed'), 'x', 'renamed').ok).toBe(true);
  });

  it('a node id that is also a variable name is refused: a reference could read either', () => {
    const flow = card();
    flow.nodes[1] = { id: 'x', type: 'get_record', config: { objectName: 'deal', outputVariable: 'x' } };
    const r = expressionRefsAfterNodeRename(renamed(flow, 'x', 'renamed'), 'x', 'renamed');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal).toMatchObject({ kind: 'ambiguous', name: 'x' });
    // The branch, the edge guard and the `{{x.field}}` hole; the `{x.field}` beside it is literal text.
    expect(r.refusal.sites).toHaveLength(3);
  });

  it('a new id a comprehension macro already binds would capture the reference, and is refused', () => {
    const flow = card();
    (flow.nodes[2].config as Rec).conditions = [{ label: 'Yes', expression: 'rows.exists(r, r.ok && x.decision == r.want)' }];
    const r = expressionRefsAfterNodeRename(renamed(flow, 'x', 'r'), 'x', 'r');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal).toMatchObject({ kind: 'ambiguous', name: 'r' });
  });
});

describe('the Problems check names a position left naming a missing node, as an error (objectui#11838)', () => {
  /** The draft a rename made before this fix: the node renamed, the edges and host carried, the expressions not. */
  function stale(): Flow {
    const flow = renamed(card(), 'x', 'renamed');
    flow.edges = flow.edges.map((e) => ({
      ...e,
      ...(e.source === 'x' ? { source: 'renamed' } : {}),
      ...(e.target === 'x' ? { target: 'renamed' } : {}),
    }));
    return flow;
  }

  it("x.decision on a branch and an edge, {{x.field}} in a field: each is an error row on the node or edge that holds it", () => {
    const rows = missingNodeRefDiagnostics(stale(), 'en-US');
    const msg = (ref: string) => tFormat('engine.flowValidate.exprRefNodeMissing', 'en-US', { ref, id: 'x' });
    expect(rows).toEqual([
      { level: 'error', nodeId: 'd', message: msg('x.decision') },
      { level: 'error', nodeId: 'c', message: msg('x.field') },
      { level: 'error', edge: { source: 'd', target: 'c' }, message: msg('x.decision') },
    ]);
  });

  it('it reaches the Problems panel as errors, not only the scope warning', () => {
    const flow = stale();
    const problems = buildFlowProblems({ nodes: flow.nodes as never, edges: flow.edges as never, variables: [], locale: 'en-US' });
    const message = tFormat('engine.flowValidate.exprRefNodeMissing', 'en-US', { ref: 'x.decision', id: 'x' });
    expect(problems.filter((p) => p.message === message).map((p) => p.level)).toEqual(['error', 'error']);
  });

  it('a boundary event attached to a missing host is an error row', () => {
    const flow = card();
    flow.nodes.push({ id: 'be', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'gone', eventType: 'error' } });
    expect(missingNodeRefDiagnostics(flow, 'zh-CN')).toEqual([
      { level: 'error', nodeId: 'be', message: tFormat('engine.flowValidate.boundaryHostMissing', 'zh-CN', { name: flowNodeDisplayName({ id: 'be', type: 'boundary_event' }, 'zh-CN'), id: 'be', host: 'gone' }) },
    ]);
  });

  it('control: a declared variable, the trigger record, a $-root, a bare name and the start node draw no row', () => {
    const flow = card();
    flow.variables = [{ name: 'deal', type: 'object' }];
    flow.nodes[0] = { id: 's', type: 'start', config: { objectName: 'deal', criteria: 'account.tier == "gold"' } };
    (flow.nodes[2].config as Rec).conditions = [
      { label: 'Yes', expression: 'deal.amount > 1 && record.owner == previous.owner && status == "open" && x.decision == "approve"' },
    ];
    (flow.nodes[3].config as Rec).fields = { subject: '{{$error.message}} {{$User.Id}} {{record.name}} {{deal.name}}' };
    expect(missingNodeRefDiagnostics(flow, 'en-US')).toEqual([]);
    expect(missingNodePositions(flow)).toEqual([]);
  });

  it('the list holds every kind of position, and only the ones that name a node', () => {
    const flow = card();
    flow.nodes.push({ id: 'be', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'x', eventType: 'error' } });
    const kinds = nodeIdPositions(flow).map((p) => `${p.kind}:${p.id}`);
    expect(new Set(kinds)).toEqual(
      new Set(['edge-source:s', 'edge-target:x', 'edge-source:x', 'edge-target:d', 'edge-source:d', 'edge-target:c', 'edge-target:e', 'edge-source:c', 'boundary-host:x', 'expression-root:x']),
    );
  });

  it('parseExpr reads a {{ }} hole and never a single-brace {…} (objectui#12390), and a CEL source that does not parse as unread', () => {
    expect(parseExpr('template', '{x.field} and {{x.field}}').refs.map((r) => [r.text, r.start])).toEqual([['x.field', 16]]);
    expect(parseExpr('cel', 'x.decision ==')).toEqual({ refs: [], unparsed: ['x.decision =='] });
  });
});
