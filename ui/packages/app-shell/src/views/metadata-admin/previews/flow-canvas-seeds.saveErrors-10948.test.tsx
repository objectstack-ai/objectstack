// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10948 — what the designer's live `FlowSchema` pass says about a node
 * the author has ADDED but not yet configured, on the installed spec (18.1.0).
 *
 * Spec 17.5.0 carries objectstack#20316 (a node config key its executor
 * contract requires, left out, and a decision branch with no `label`, are
 * refused at authoring) and objectstack#20418 (a `connector_action` whose
 * `connectorConfig` names no connector or action is refused too). The designer
 * seeds several node kinds INCOMPLETE on purpose — the author supplies an
 * `http` node's `url`, a `notify` node's `title` — and its row editors drop a
 * blank cell rather than writing `''`. This file is the measurement those two
 * facts were read against, kept as a regression pin:
 *
 *  1. every seeded kind the flow parse refuses is refused AT THE NODE — each
 *     issue is addressed to `nodes.N.<config path>`, and the canvas resolves
 *     it onto that node, so the error is located, not silently lost;
 *  2. the CONTROL: the same kinds, configured, make a flow that saves clean —
 *     without it, "every seed is refused" could be a pass that refuses all;
 *  3. a blank branch label and a blank screen field name, authored through the
 *     inspector's real row editor, are refused at the row's key.
 *
 * ⛔ The expected table is the MEASUREMENT, not a requiredness list the product
 * reads: the inspector's required markers ask the installed spec at render time
 * (`inspectors/flow-required-keys.ts`). If a seed is completed, or the spec
 * stops refusing a kind, the row for it goes red here and is re-measured —
 * that is what a regression pin is for.
 *
 * What the pass does NOT do is stop the draft being kept: live client issues
 * are advisory and gate no save door (`ResourceEditPage.schemaAdvisory.test.tsx`
 * pins that for every type), so an unconfigured node is a located error on a
 * draft the editor still holds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Same doubles as the sibling flow-node suites: the engine config-schema hook
// publishes nothing (so the STATIC field table is what renders), and object
// fields resolve empty.
vi.mock('./useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('./useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { validateMetadataDraft } from '../clientValidation';
import { FlowNodeInspector } from '../inspectors/FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';
import { NODE_PALETTE, defaultNodeExtras, defaultNodeLabel } from './flow-canvas-parts';
import { buildFlowProblems } from './flow-problems';
import type { FlowDesignerNode } from './flow-canvas-layout';

/* ── `fetch` double: reference pickers resolve through a real `fetch` under
 * happy-dom; answer the metadata routes empty and fail on anything else. ── */
const META_PREFIX = '/api/v1/meta/';
let calls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      calls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }),
      };
    }),
  );
});

afterEach(() => {
  expect(calls.filter((url) => !routeOf(url).startsWith(META_PREFIX))).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

const flowOf = (nodes: unknown[], edges: unknown[] = []) => ({
  name: 'probe_flow',
  label: 'Probe flow',
  type: 'autolaunched',
  nodes,
  edges,
});

/** Exactly what `FlowCanvas.addNode` builds before the author edits it. */
const seeded = (type: string): FlowDesignerNode =>
  ({ id: 'n1', type, label: defaultNodeLabel(type), ...defaultNodeExtras(type) }) as FlowDesignerNode;

/**
 * The measured verdict per seeded kind: the issue paths the live pass reports
 * for a flow holding one freshly added node of that kind. `[]` = the seed
 * saves clean. `map` is not in the static palette but the engine palette can
 * offer it, and the card names it, so it is measured beside the palette kinds.
 */
const MEASURED: Record<string, string[]> = {
  create_record: ['nodes.0.config.objectName'],
  update_record: ['nodes.0.config.objectName'],
  get_record: ['nodes.0.config.objectName'],
  delete_record: ['nodes.0.config.objectName'],
  decision: [],
  loop: [],
  assignment: [],
  parallel: ['nodes.0.config.branches'],
  try_catch: ['nodes.0.config.try'],
  approval: [],
  screen: [],
  http: ['nodes.0.config.url'],
  notify: ['nodes.0.config.title'],
  connector_action: ['nodes.0.connectorConfig.connectorId', 'nodes.0.connectorConfig.actionId'],
  script: ['nodes.0.config.function'],
  subflow: ['nodes.0.config.flowName'],
  wait: [],
  end: [],
  map: ['nodes.0.config.collection', 'nodes.0.config.flowName'],
};

const KINDS = [...new Set([...NODE_PALETTE.map((p) => p.type), 'map'])];

describe('an unconfigured seeded node is a LOCATED save error (objectui#10948)', () => {
  it('measures every palette kind — a new palette entry must be measured here', () => {
    expect(KINDS.filter((k) => !(k in MEASURED))).toEqual([]);
  });

  it.each(KINDS)('`%s`: the live pass reports exactly the measured paths, each on the seeded node', async (type) => {
    const node = seeded(type);
    const res = await validateMetadataDraft('flow', flowOf([node]));
    const paths = res.issues.map((i) => i.path);
    expect(paths, JSON.stringify(res.issues)).toEqual(MEASURED[type]);
    expect(res.ok).toBe(MEASURED[type].length === 0);

    // Located on the canvas: the same issues, handed to the Problems panel the
    // way `ResourceEditPage` hands them (path + message, severity error), land
    // on the seeded node's badge — never on the flow as a whole.
    const problems = buildFlowProblems({
      nodes: [node],
      edges: [],
      serverDiagnostics: res.issues.map((i) => ({ path: i.path, message: i.message, severity: 'error' as const })),
      locale: 'en-US',
    }).filter((p) => p.source === 'server');
    expect(problems).toHaveLength(MEASURED[type].length);
    for (const p of problems) expect(p.target).toEqual({ kind: 'node', nodeId: 'n1' });
  });

  it('CONTROL — the same kinds, configured, make a flow that saves clean', async () => {
    const nodes = [
      { id: 'c1', type: 'create_record', label: 'C', config: { objectName: 'account', fields: { name: 'x' } } },
      { id: 'u1', type: 'update_record', label: 'U', config: { objectName: 'account' } },
      { id: 'g1', type: 'get_record', label: 'G', config: { objectName: 'account' } },
      { id: 'd1', type: 'delete_record', label: 'D', config: { objectName: 'account' } },
      { id: 'h1', type: 'http', label: 'H', config: { method: 'GET', url: 'https://example.com' } },
      { id: 'no1', type: 'notify', label: 'N', config: { channels: ['inbox'], recipients: ['u1'], title: 'Hi' } },
      { id: 'k1', type: 'connector_action', label: 'K', connectorConfig: { connectorId: 'slack', actionId: 'post', input: {} } },
      { id: 's1', type: 'script', label: 'S', config: { function: 'score_lead' } },
      { id: 'f1', type: 'subflow', label: 'F', config: { flowName: 'other_flow' } },
      { id: 'm1', type: 'map', label: 'M', config: { collection: '{items}', flowName: 'per_item' } },
      { id: 'b1', type: 'decision', label: 'B', config: { conditions: [{ label: 'yes', expression: 'true' }] } },
      { id: 'sc1', type: 'screen', label: 'Sc', config: { fields: [{ name: 'discount', label: 'Discount', type: 'number' }] } },
    ];
    const res = await validateMetadataDraft('flow', flowOf(nodes));
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

function renderInspector(node: Record<string, unknown>) {
  const onPatch = vi.fn();
  render(
    <FlowNodeInspector
      type="flow"
      name="probe_flow"
      draft={flowOf([node])}
      selection={{ kind: 'node', id: String(node.id) } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return onPatch;
}

/** The node the inspector's last patch wrote. */
function patchedNode(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const patch = onPatch.mock.calls.at(-1)?.[0] as { nodes?: Array<Record<string, unknown>> } | undefined;
  expect(patch?.nodes, 'the row editor committed a patch').toBeDefined();
  return patch!.nodes![0];
}

describe('a blank row key, authored in the inspector, is refused at that key (objectui#10948)', () => {
  it('a decision branch written with an expression and a BLANK label', async () => {
    const onPatch = renderInspector({ id: 'n1', type: 'decision', label: 'Route' });
    // objectui#12488 — the decision's Branches draw as branch cards, added by "Add branch".
    fireEvent.click(screen.getByRole('button', { name: 'Add branch' }));
    const expression = screen.getByPlaceholderText('expiring_deals.length > 0');
    fireEvent.change(expression, { target: { value: 'amount > 10' } });
    fireEvent.blur(expression);

    const node = patchedNode(onPatch);
    // The row editor drops the blank cell: the branch carries no `label` key.
    expect(node.config).toEqual({ conditions: [{ expression: 'amount > 10' }] });
    const res = await validateMetadataDraft('flow', flowOf([node]));
    expect(res.issues.map((i) => i.path)).toEqual(['nodes.0.config.conditions.0.label']);
  });

  it('a screen field written with a label and a BLANK name', async () => {
    const onPatch = renderInspector({ id: 'n1', type: 'screen', label: 'Ask' });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const label = screen.getByPlaceholderText('Discount %');
    fireEvent.change(label, { target: { value: 'Discount' } });
    fireEvent.blur(label);

    const node = patchedNode(onPatch);
    expect(node.config).toEqual({ fields: [{ label: 'Discount' }] });
    const res = await validateMetadataDraft('flow', flowOf([node]));
    expect(res.issues.map((i) => i.path)).toEqual(['nodes.0.config.fields.0.name']);
  });
});
