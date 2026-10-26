// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  computeLayoutWithGeometry,
  diagramSize,
  isBackEdge,
  rightAnchor,
  backEdgePath,
  backEdgeLabelAnchor,
  bottomAnchor,
  topAnchor,
  edgePath,
  edgeMidpoint,
  forwardEdgeRoute,
  DETOUR_LANE_GAP,
  extractRegions,
  hasManualPosition,
  manualPosition,
  withCanonicalGeometry,
  NODE_W,
  NODE_H,
  V_GAP,
  PADDING,
  type FlowDesignerNode,
  type FlowDesignerEdge,
  type NodeBox,
  type Point,
} from './flow-canvas-layout';

describe('isBackEdge', () => {
  it('is true only for type "back"', () => {
    expect(isBackEdge({ type: 'back' })).toBe(true);
    expect(isBackEdge({ type: 'default' })).toBe(false);
    expect(isBackEdge({ type: 'fault' })).toBe(false);
    expect(isBackEdge({})).toBe(false);
  });
});

describe('back-edge geometry', () => {
  it('rightAnchor sits on the node right edge, vertically centered', () => {
    expect(rightAnchor({ x: 100, y: 200 })).toEqual({ x: 100 + NODE_W, y: 200 + NODE_H / 2 });
  });

  it('backEdgePath is a cubic from source to target', () => {
    const from = rightAnchor({ x: 0, y: 300 });
    const to = rightAnchor({ x: 0, y: 0 });
    const d = backEdgePath(from, to);
    expect(d.startsWith(`M ${from.x},${from.y}`)).toBe(true);
    expect(d).toContain(' C ');
    expect(d.trimEnd().endsWith(`${to.x},${to.y}`)).toBe(true);
  });

  it('backEdgeLabelAnchor bows out to the right of the nodes', () => {
    const from = rightAnchor({ x: 0, y: 300 });
    const to = rightAnchor({ x: 0, y: 0 });
    const anchor = backEdgeLabelAnchor(from, to);
    // Apex is to the right of the (shared) node right edge…
    expect(anchor.x).toBeGreaterThan(from.x);
    // …and vertically between the two endpoints.
    expect(anchor.y).toBeCloseTo((from.y + to.y) / 2);
  });

  it('a forward edge anchors at the node bottom (unchanged)', () => {
    expect(bottomAnchor({ x: 10, y: 20 })).toEqual({ x: 10 + NODE_W / 2, y: 20 + NODE_H });
  });
});

describe('computeLayout — back-edges excluded from layering (ADR-0044)', () => {
  const nodes: FlowDesignerNode[] = [
    { id: 's', type: 'start' },
    { id: 'a', type: 'approval' },
    { id: 'w', type: 'wait' },
  ];

  it('keeps the back-edge target ABOVE the wait node it loops from', () => {
    const edges: FlowDesignerEdge[] = [
      { source: 's', target: 'a' },
      { source: 'a', target: 'w', label: 'revise' },
      { source: 'w', target: 'a', label: 'resubmit', type: 'back' },
    ];
    const pos = computeLayout(nodes, edges);
    const s = pos.get('s')!;
    const a = pos.get('a')!;
    const w = pos.get('w')!;
    // Top-to-bottom: start above approval above the wait point.
    expect(s.y).toBeLessThan(a.y);
    expect(a.y).toBeLessThan(w.y);
  });

  it('an UNMARKED return edge would instead drag the target down', () => {
    // Same graph, but the closing edge is a normal connection: the longest-path
    // relaxation now pushes `a` below `w` (demonstrates why excluding back-edges
    // matters for a readable loop).
    const edges: FlowDesignerEdge[] = [
      { source: 's', target: 'a' },
      { source: 'a', target: 'w', label: 'revise' },
      { source: 'w', target: 'a', label: 'resubmit' },
    ];
    const pos = computeLayout(nodes, edges);
    expect(pos.get('a')!.y).toBeGreaterThan(pos.get('w')!.y);
  });
});

describe('extractRegions (#2670 structured containers)', () => {
  const region = (n: string) => ({ nodes: [{ id: n, type: 'http' }], edges: [] });

  it('returns [] for an ordinary node', () => {
    expect(extractRegions({ id: 'x', type: 'create_record' })).toEqual([]);
  });

  it('returns [] for a legacy flat loop (no config.body)', () => {
    expect(extractRegions({ id: 'l', type: 'loop', config: { collection: '{items}' } })).toEqual([]);
    // ...and for an empty body region.
    expect(extractRegions({ id: 'l', type: 'loop', config: { body: { nodes: [], edges: [] } } })).toEqual([]);
  });

  it('extracts a loop body as one unlabeled region', () => {
    const out = extractRegions({ id: 'l', type: 'loop', config: { body: region('send') } });
    expect(out).toHaveLength(1);
    expect(out[0].label).toBeUndefined();
    expect(out[0].key).toBe('body');
    expect(out[0].nodes.map((n) => n.id)).toEqual(['send']);
  });

  it('extracts parallel branches, labeled by name then Branch N', () => {
    const out = extractRegions({
      id: 'p',
      type: 'parallel',
      config: { branches: [{ name: 'notify', ...region('a') }, region('b')] },
    });
    expect(out.map((r) => r.label)).toEqual(['notify', 'Branch 2']);
    expect(out.map((r) => r.key)).toEqual(['branch-0', 'branch-1']);
  });

  it('extracts try + catch, in order, labeled', () => {
    const out = extractRegions({
      id: 't',
      type: 'try_catch',
      config: { try: region('risky'), catch: region('recover') },
    });
    expect(out.map((r) => r.label)).toEqual(['Try', 'Catch']);
    // catch is optional — a try-only container yields just the try region.
    expect(extractRegions({ id: 't', type: 'try_catch', config: { try: region('risky') } }).map((r) => r.label)).toEqual(['Try']);
  });
});

// ── #2670 Phase 2: geometry-aware layered layout ─────────────────────────────

/** heightOf making exactly one node tall — the expanded-container shape. */
const tallOnly = (id: string, h: number) => (n: FlowDesignerNode) => (n.id === id ? h : NODE_H);

describe('computeLayoutWithGeometry — constant-height invariance (the regression lock)', () => {
  const GRAPHS: { name: string; nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] }[] = [
    {
      name: 'linear chain',
      nodes: [{ id: 's', type: 'start' }, { id: 'a', type: 'script' }, { id: 'e', type: 'end' }],
      edges: [{ source: 's', target: 'a' }, { source: 'a', target: 'e' }],
    },
    {
      name: 'diamond branch + join',
      nodes: [
        { id: 's', type: 'start' },
        { id: 'l', type: 'script' },
        { id: 'r', type: 'script' },
        { id: 'j', type: 'end' },
      ],
      edges: [
        { source: 's', target: 'l' },
        { source: 's', target: 'r' },
        { source: 'l', target: 'j' },
        { source: 'r', target: 'j' },
      ],
    },
    {
      name: 'declared back-edge (ADR-0044)',
      nodes: [{ id: 's', type: 'start' }, { id: 'a', type: 'approval' }, { id: 'w', type: 'wait' }],
      edges: [
        { source: 's', target: 'a' },
        { source: 'a', target: 'w', label: 'revise' },
        { source: 'w', target: 'a', label: 'resubmit', type: 'back' },
      ],
    },
    {
      name: 'unreached cycle island (trailing layers)',
      nodes: [
        { id: 's', type: 'start' },
        { id: 'a', type: 'script' },
        { id: 'c1', type: 'script' },
        { id: 'c2', type: 'script' },
      ],
      edges: [
        { source: 's', target: 'a' },
        { source: 'c1', target: 'c2' },
        { source: 'c2', target: 'c1' },
      ],
    },
    {
      name: 'manual position (spec-canonical)',
      nodes: [
        { id: 's', type: 'start' },
        { id: 'pin', type: 'script', position: { x: 400, y: 10 } },
        { id: 'e', type: 'end' },
      ],
      edges: [{ source: 's', target: 'pin' }, { source: 'pin', target: 'e' }],
    },
    {
      name: 'manual position (legacy `ui`, read-compat)',
      nodes: [
        { id: 's', type: 'start' },
        { id: 'pin', type: 'script', ui: { x: 400, y: 10 } },
        { id: 'e', type: 'end' },
      ],
      edges: [{ source: 's', target: 'pin' }, { source: 'pin', target: 'e' }],
    },
  ];

  for (const g of GRAPHS) {
    it(`matches computeLayout + diagramSize on: ${g.name}`, () => {
      const geo = computeLayoutWithGeometry(g.nodes, g.edges);
      expect(geo.positions).toEqual(computeLayout(g.nodes, g.edges));
      expect(geo.size).toEqual(diagramSize(geo.positions));
      for (const n of g.nodes) expect(geo.heights.get(n.id)).toBe(NODE_H);
    });
  }
});

describe('computeLayoutWithGeometry — cumulative variable-height offsets (#2670)', () => {
  const chain: { nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] } = {
    nodes: [{ id: 's', type: 'start' }, { id: 'c', type: 'loop' }, { id: 'b', type: 'end' }],
    edges: [{ source: 's', target: 'c' }, { source: 'c', target: 'b' }],
  };

  it('pushes the layer below a tall card down by its full height', () => {
    const geo = computeLayoutWithGeometry(chain.nodes, chain.edges, tallOnly('c', 200));
    const s = geo.positions.get('s')!;
    const c = geo.positions.get('c')!;
    const b = geo.positions.get('b')!;
    expect(c.y - s.y).toBe(NODE_H + V_GAP); // layer above the tall card: unchanged pitch
    expect(b.y - c.y).toBe(200 + V_GAP); // layer below: pushed by the tall card
  });

  it('same-layer siblings share y; the row is as tall as its tallest card', () => {
    const nodes: FlowDesignerNode[] = [
      { id: 's', type: 'start' },
      { id: 'l', type: 'loop' },
      { id: 'r', type: 'script' },
      { id: 'j', type: 'end' },
    ];
    const edges: FlowDesignerEdge[] = [
      { source: 's', target: 'l' },
      { source: 's', target: 'r' },
      { source: 'l', target: 'j' },
      { source: 'r', target: 'j' },
    ];
    const geo = computeLayoutWithGeometry(nodes, edges, tallOnly('l', 200));
    expect(geo.positions.get('l')!.y).toBe(geo.positions.get('r')!.y);
    expect(geo.positions.get('j')!.y - geo.positions.get('l')!.y).toBe(200 + V_GAP);
  });

  it('size.height accounts for a tall bottom card', () => {
    const geo = computeLayoutWithGeometry(chain.nodes, chain.edges, tallOnly('b', 200));
    expect(geo.size.height).toBe(geo.positions.get('b')!.y + 200 + PADDING);
  });

  it('a manually-pinned tall node does not push auto rows (accepted-overlap rule)', () => {
    const nodes: FlowDesignerNode[] = [
      { id: 's', type: 'start' },
      { id: 'pin', type: 'loop', position: { x: 400, y: 10 } },
      { id: 'e', type: 'end' },
    ];
    const edges: FlowDesignerEdge[] = [{ source: 's', target: 'pin' }, { source: 'pin', target: 'e' }];
    const tall = computeLayoutWithGeometry(nodes, edges, tallOnly('pin', 300));
    const constant = computeLayoutWithGeometry(nodes, edges);
    expect(tall.positions.get('s')).toEqual(constant.positions.get('s'));
    expect(tall.positions.get('e')).toEqual(constant.positions.get('e'));
    expect(tall.heights.get('pin')).toBe(300); // still reported for rendering/size
  });
});

describe('bottomAnchor with explicit height (#2670)', () => {
  it('anchors at the true bottom of a tall card', () => {
    expect(bottomAnchor({ x: 10, y: 20 }, 200)).toEqual({ x: 10 + NODE_W / 2, y: 220 });
  });
});

// ── objectui#3172: node geometry IS the spec's `FlowNode.position` ───────────

describe('manualPosition — `position` is canonical, `ui` is legacy read-only', () => {
  it('reads the spec-canonical `position`', () => {
    expect(manualPosition({ id: 'n', type: 'script', position: { x: 12, y: 34 } })).toEqual({ x: 12, y: 34 });
  });

  it('falls back to a legacy `ui` so stored flows still open pinned', () => {
    expect(manualPosition({ id: 'n', type: 'script', ui: { x: 12, y: 34 } })).toEqual({ x: 12, y: 34 });
  });

  it('prefers `position` when a legacy node carries both', () => {
    expect(
      manualPosition({ id: 'n', type: 'script', position: { x: 1, y: 2 }, ui: { x: 90, y: 90 } }),
    ).toEqual({ x: 1, y: 2 });
  });

  it('is null unless BOTH coordinates are finite (either spelling)', () => {
    expect(manualPosition({ id: 'n', type: 'script' })).toBeNull();
    expect(manualPosition({ id: 'n', type: 'script', ui: { x: 400 } })).toBeNull();
    expect(manualPosition({ id: 'n', type: 'script', ui: { y: 400 } })).toBeNull();
    expect(manualPosition({ id: 'n', type: 'script', position: { x: NaN, y: 1 } })).toBeNull();
    // A half-position must not shadow a usable legacy one either.
    expect(
      manualPosition({ id: 'n', type: 'script', position: { x: 5 } as never, ui: { x: 7, y: 8 } }),
    ).toEqual({ x: 7, y: 8 });
    expect(hasManualPosition({ id: 'n', type: 'script', ui: { x: 400 } })).toBe(false);
    expect(hasManualPosition({ id: 'n', type: 'script', position: { x: 4, y: 0 } })).toBe(true);
  });

  it('pins a legacy node at exactly the same point as the canonical spelling', () => {
    const edges: FlowDesignerEdge[] = [{ source: 's', target: 'pin' }];
    const legacy = computeLayout(
      [{ id: 's', type: 'start' }, { id: 'pin', type: 'script', ui: { x: 400, y: 10 } }],
      edges,
    );
    const canonical = computeLayout(
      [{ id: 's', type: 'start' }, { id: 'pin', type: 'script', position: { x: 400, y: 10 } }],
      edges,
    );
    expect(legacy.get('pin')).toEqual({ x: 400, y: 10 });
    expect(legacy).toEqual(canonical);
  });
});

describe('withCanonicalGeometry — migrate-on-write (the strict-schema gate)', () => {
  it('lifts a legacy `ui` onto `position` and drops the `ui` key', () => {
    const out = withCanonicalGeometry([{ id: 'n', type: 'script', ui: { x: 7, y: 9 } }]);
    expect(out[0]).toEqual({ id: 'n', type: 'script', position: { x: 7, y: 9 } });
    expect('ui' in out[0]).toBe(false);
  });

  it('keeps an existing `position` and still drops a stale `ui`', () => {
    const out = withCanonicalGeometry([
      { id: 'n', type: 'script', position: { x: 1, y: 2 }, ui: { x: 90, y: 90 } },
    ]);
    expect(out[0].position).toEqual({ x: 1, y: 2 });
    expect('ui' in out[0]).toBe(false);
  });

  it('drops an unusable `ui` without inventing a position', () => {
    const out = withCanonicalGeometry([{ id: 'n', type: 'script', ui: { x: 5 } }]);
    expect(out[0]).toEqual({ id: 'n', type: 'script' });
  });

  it('preserves every other key, including ones the canvas does not understand', () => {
    const out = withCanonicalGeometry([
      {
        id: 'n',
        type: 'http',
        label: 'Call',
        config: { url: 'https://x' },
        connectorConfig: { connectorId: 'c', actionId: 'a' },
        ui: { x: 3, y: 4 },
      },
    ]);
    expect(out[0]).toEqual({
      id: 'n',
      type: 'http',
      label: 'Call',
      config: { url: 'https://x' },
      connectorConfig: { connectorId: 'c', actionId: 'a' },
      position: { x: 3, y: 4 },
    });
  });

  it('returns the SAME array when nothing needs migrating (memo identity)', () => {
    const nodes: FlowDesignerNode[] = [
      { id: 's', type: 'start' },
      { id: 'n', type: 'script', position: { x: 1, y: 2 } },
    ];
    expect(withCanonicalGeometry(nodes)).toBe(nodes);
    // …and it is idempotent: migrating twice is migrating once.
    const once = withCanonicalGeometry([{ id: 'n', type: 'script', ui: { x: 7, y: 9 } }]);
    expect(withCanonicalGeometry(once)).toBe(once);
  });
});

// ── objectui#13144: a forward edge that skips a node is routed around it ─────

/**
 * Points along an SVG path made of `M`, `C` and `L` commands — read back from
 * the `d` string itself, so these pins hold whatever the router does inside.
 */
function pointsOnPath(d: string): Point[] {
  const tokens = d.match(/[MCL]|-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) ?? [];
  const pt = (s: string): Point => {
    const [x, y] = s.split(',').map(Number);
    return { x, y };
  };
  const out: Point[] = [];
  let at: Point = { x: 0, y: 0 };
  for (let i = 0; i < tokens.length; ) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      at = pt(tokens[i++]);
      out.push(at);
    } else if (cmd === 'L') {
      const to = pt(tokens[i++]);
      for (let k = 1; k <= 100; k++) out.push({ x: at.x + ((to.x - at.x) * k) / 100, y: at.y + ((to.y - at.y) * k) / 100 });
      at = to;
    } else if (cmd === 'C') {
      const [c1, c2, to] = [pt(tokens[i++]), pt(tokens[i++]), pt(tokens[i++])];
      for (let k = 1; k <= 100; k++) {
        const t = k / 100;
        const u = 1 - t;
        out.push({
          x: u * u * u * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
          y: u * u * u * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
        });
      }
      at = to;
    } else {
      throw new Error(`unexpected path token ${cmd}`);
    }
  }
  return out;
}

const insideBox = (p: Point, b: NodeBox) => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;

/** Lay out a flow and give every node's box, keyed by id. */
function boxesOf(nodes: FlowDesignerNode[], edges: FlowDesignerEdge[]): Map<string, NodeBox> {
  const pos = computeLayout(nodes, edges);
  return new Map(nodes.map((n) => [n.id, { ...pos.get(n.id)!, width: NODE_W, height: NODE_H }]));
}

/** The route the canvas draws for `source → target`: every other node is an obstacle. */
function routeOf(boxes: Map<string, NodeBox>, source: string, target: string) {
  const s = boxes.get(source)!;
  const t = boxes.get(target)!;
  const from = bottomAnchor(s);
  const to = topAnchor(t);
  const obstacles = [...boxes].filter(([id]) => id !== source && id !== target).map(([, b]) => b);
  return { from, to, route: forwardEdgeRoute(from, to, obstacles) };
}

describe('forwardEdgeRoute — an edge that skips a node is drawn around it (objectui#13144)', () => {
  // The card's flow: Start → Decision → Notify → End, plus a Decision → End branch.
  const nodes: FlowDesignerNode[] = [
    { id: 'start', type: 'start' },
    { id: 'decide', type: 'decision' },
    { id: 'notify', type: 'script' },
    { id: 'end', type: 'end' },
  ];
  const edges: FlowDesignerEdge[] = [
    { id: 'e1', source: 'start', target: 'decide' },
    { id: 'e2', source: 'decide', target: 'notify', isDefault: true },
    { id: 'e3', source: 'notify', target: 'end' },
    { id: 'e4', source: 'decide', target: 'end', condition: "record.status != 'done'" },
  ];
  const boxes = boxesOf(nodes, edges);

  it('the straight curve WOULD run through the node it skips (the defect this routes around)', () => {
    const { from, to } = routeOf(boxes, 'decide', 'end');
    const notify = boxes.get('notify')!;
    expect(pointsOnPath(edgePath(from, to)).some((p) => insideBox(p, notify))).toBe(true);
    expect(insideBox(edgeMidpoint(from, to), notify)).toBe(true);
  });

  it('keeps the skip edge clear of the skipped node, and of every other node', () => {
    const { from, to, route } = routeOf(boxes, 'decide', 'end');
    expect(route.detour).toBe('left');
    const points = pointsOnPath(route.d);
    for (const [id, box] of boxes) {
      expect(points.filter((p) => insideBox(p, box)), id).toEqual([]);
    }
    // It still leaves the source's bottom anchor and enters the target's top anchor.
    expect(points[0]).toEqual(from);
    expect(points[points.length - 1]).toEqual(to);
    // The lane runs DETOUR_LANE_GAP clear of the node it passes.
    const xs = points.map((p) => p.x);
    expect(Math.min(...xs)).toBe(boxes.get('notify')!.x - DETOUR_LANE_GAP);
  });

  it('puts the pill on the routed path, outside every node box, in a band no card reaches', () => {
    const { route } = routeOf(boxes, 'decide', 'end');
    const points = pointsOnPath(route.d);
    const nearest = Math.min(...points.map((p) => Math.hypot(p.x - route.label.x, p.y - route.label.y)));
    expect(nearest).toBeLessThan(1);
    for (const [id, box] of boxes) expect(insideBox(route.label, box), id).toBe(false);
    // A 22px pill centred on the point, of any width, crosses no card: the band
    // it occupies sits between the decision's bottom and the skipped node's top.
    expect(route.label.y - 11).toBeGreaterThan(boxes.get('decide')!.y + NODE_H);
    expect(route.label.y + 11).toBeLessThan(boxes.get('notify')!.y);
  });

  it('leaves an edge between adjacent ranks byte-for-byte unchanged', () => {
    for (const [source, target] of [
      ['start', 'decide'],
      ['decide', 'notify'],
      ['notify', 'end'],
    ]) {
      const { from, to, route } = routeOf(boxes, source, target);
      expect(route).toEqual({ d: edgePath(from, to), label: edgeMidpoint(from, to) });
    }
    // The literal string, so a change to edgePath itself cannot pass unnoticed here.
    expect(routeOf(boxes, 'start', 'decide').route.d).toBe('M 148,94 C 148,122 148,122 148,150');
  });

  it('leaves a skip edge that runs between two nodes (not through one) unchanged', () => {
    const fanNodes: FlowDesignerNode[] = [
      { id: 'decide', type: 'decision' },
      { id: 'a', type: 'script' },
      { id: 'b', type: 'script' },
      { id: 'end', type: 'end' },
    ];
    const fanEdges: FlowDesignerEdge[] = [
      { source: 'decide', target: 'a' },
      { source: 'decide', target: 'b' },
      { source: 'a', target: 'end' },
      { source: 'b', target: 'end' },
      { source: 'decide', target: 'end' },
    ];
    const { from, to, route } = routeOf(boxesOf(fanNodes, fanEdges), 'decide', 'end');
    expect(route).toEqual({ d: edgePath(from, to), label: edgeMidpoint(from, to) });
  });

  it('moves the pill of an edge running between two cards out of their rank, onto the same path', () => {
    // Same fan as above: the path is unchanged, but a pill as wide as a long
    // condition centred at the midpoint would sit in the a/b rank, under both.
    const fanNodes: FlowDesignerNode[] = [
      { id: 'decide', type: 'decision' },
      { id: 'a', type: 'script' },
      { id: 'b', type: 'script' },
      { id: 'end', type: 'end' },
    ];
    const fanEdges: FlowDesignerEdge[] = [
      { source: 'decide', target: 'a' },
      { source: 'decide', target: 'b' },
      { source: 'a', target: 'end' },
      { source: 'b', target: 'end' },
      { source: 'decide', target: 'end' },
    ];
    const fan = boxesOf(fanNodes, fanEdges);
    const s = fan.get('decide')!;
    const from = bottomAnchor(s);
    const to = topAnchor(fan.get('end')!);
    const obstacles = [fan.get('a')!, fan.get('b')!];
    const pill = { width: 174, height: 22 };
    const pillBox = (p: Point): NodeBox => ({ x: p.x - pill.width / 2, y: p.y - pill.height / 2, ...pill });
    const covered = (p: Point) =>
      obstacles.some((b) => {
        const q = pillBox(p);
        return q.x < b.x + b.width && q.x + q.width > b.x && q.y < b.y + b.height && q.y + q.height > b.y;
      });
    expect(covered(edgeMidpoint(from, to))).toBe(true); // the defect: midpoint pill under a and b

    const route = forwardEdgeRoute(from, to, obstacles, pill);
    expect(route.d).toBe(edgePath(from, to));
    expect(covered(route.label)).toBe(false);
    // On the path, in the band between the decision and the a/b rank.
    expect(route.label.x).toBe(from.x);
    expect(route.label.y - pill.height / 2).toBeGreaterThan(s.y + NODE_H);
    expect(route.label.y + pill.height / 2).toBeLessThan(fan.get('a')!.y);
    // A pill that fits between the two cards stays at the midpoint.
    expect(forwardEdgeRoute(from, to, obstacles, { width: 30, height: 22 }).label).toEqual(edgeMidpoint(from, to));
  });

  it('keeps an adjacent-rank pill at the midpoint whatever its width', () => {
    const { from, to } = routeOf(boxes, 'decide', 'notify');
    const obstacles = [boxes.get('start')!, boxes.get('end')!];
    expect(forwardEdgeRoute(from, to, obstacles, { width: NODE_W, height: 22 })).toEqual({
      d: edgePath(from, to),
      label: edgeMidpoint(from, to),
    });
  });

  it('runs the lane through the gap beside the node it skips, clear of that node’s neighbours', () => {
    // The middle of three siblings is in the way; the lane takes the 44px gap
    // between it and its left neighbour rather than crossing that neighbour.
    const triNodes: FlowDesignerNode[] = [
      { id: 'decide', type: 'decision' },
      { id: 'a', type: 'script' },
      { id: 'b', type: 'script' },
      { id: 'c', type: 'script' },
      { id: 'end', type: 'end' },
    ];
    const triEdges: FlowDesignerEdge[] = [
      { source: 'decide', target: 'a' },
      { source: 'decide', target: 'b' },
      { source: 'decide', target: 'c' },
      { source: 'a', target: 'end' },
      { source: 'b', target: 'end' },
      { source: 'c', target: 'end' },
      { source: 'decide', target: 'end' },
    ];
    const triBoxes = boxesOf(triNodes, triEdges);
    const { route } = routeOf(triBoxes, 'decide', 'end');
    expect(route.detour).toBeDefined();
    const points = pointsOnPath(route.d);
    for (const [id, box] of triBoxes) expect(points.filter((p) => insideBox(p, box)), id).toEqual([]);
    expect(route.label.x).toBe(triBoxes.get('b')!.x - DETOUR_LANE_GAP);
    expect(route.label.x).toBeGreaterThan(triBoxes.get('a')!.x + NODE_W);
  });

  it('detours on the side with the shorter way round when one is shorter', () => {
    // `skip` sits right of centre and its edge to `end` would cross the column
    // under the decision: it goes down the right-hand side, not across to the left.
    const nodes2: FlowDesignerNode[] = [
      { id: 'decide', type: 'decision' },
      { id: 'email', type: 'connector_action' },
      { id: 'skip', type: 'update_record' },
      { id: 'wait', type: 'wait' },
      { id: 'end', type: 'end' },
    ];
    const edges2: FlowDesignerEdge[] = [
      { source: 'decide', target: 'email' },
      { source: 'decide', target: 'skip', isDefault: true },
      { source: 'email', target: 'wait' },
      { source: 'wait', target: 'end' },
      { source: 'skip', target: 'end' },
    ];
    const b2 = boxesOf(nodes2, edges2);
    const { route } = routeOf(b2, 'skip', 'end');
    expect(route.detour).toBe('right');
    const points = pointsOnPath(route.d);
    for (const [id, box] of b2) expect(points.filter((p) => insideBox(p, box)), id).toEqual([]);
  });

  it('draws the straight curve when the target is not below the source (no room to detour)', () => {
    const from = { x: 100, y: 300 };
    const to = { x: 100, y: 0 };
    const obstacle: NodeBox = { x: 0, y: 100, width: NODE_W, height: NODE_H };
    expect(forwardEdgeRoute(from, to, [obstacle])).toEqual({ d: edgePath(from, to), label: edgeMidpoint(from, to) });
  });
});
