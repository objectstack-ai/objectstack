// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13144 — on the flow canvas, a Decision branch that skips a node
 * (Decision → End past the Notify between them) is drawn around that node.
 *
 * Before the fix the edge was the same straight source-bottom → target-top curve
 * as every forward edge: it ran under the Notify card, its branch pill sat at the
 * curve's midpoint under that card, and the card took the click meant for the
 * edge. The geometry itself is pinned beside the router
 * (`forwardEdgeRoute` in `flow-canvas-layout.test.ts`); this file pins that the
 * canvas DRAWS that route — the visible stroke, the wide hit path and the pill
 * all follow it — and that the nested region view routes the same way.
 *
 * Node boxes are read from the cards' own `left` / `top` / `width` / `height`
 * styles and the pill's box from its `foreignObject`, i.e. what the browser lays
 * out, not from the layout function.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import { FlowRegionView } from './flow-region-view';
import { flowEdgeDisplayName } from './flow-canvas-parts';
import { edgePath, type FlowDesignerEdge, type FlowDesignerNode, type Point } from './flow-canvas-layout';

// The palette's engine overlay answers "engine absent", so no read reaches a
// real socket.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(cleanup);

// The card's flow: Start → Decision → Notify → End, and a Decision → End branch.
const nodes: FlowDesignerNode[] = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'decide', type: 'decision', label: 'Already done?' },
  { id: 'notify', type: 'script', label: 'Notify', config: { function: 'compose_reminder' } },
  { id: 'end', type: 'end', label: 'End' },
];
const edges: FlowDesignerEdge[] = [
  { id: 'e_start_decide', source: 'start', target: 'decide' },
  { id: 'e_decide_notify', source: 'decide', target: 'notify', isDefault: true },
  { id: 'e_notify_end', source: 'notify', target: 'end' },
  { id: 'e_decide_end', source: 'decide', target: 'end', condition: "record.status != 'done'" },
];

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cardBox(container: HTMLElement, id: string): Box {
  const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
  const px = (v: string) => Number.parseFloat(v);
  return { x: px(el.style.left), y: px(el.style.top), width: px(el.style.width), height: px(el.style.height) };
}

/** The `<g>` the canvas draws one edge in, found by its hit path's title — the ends' names (objectui#13242). */
function edgeGroup(container: HTMLElement, source: string, target: string): SVGGElement {
  const g = Array.from(container.querySelectorAll<SVGGElement>('svg g')).find(
    (el) => el.querySelector('path > title')?.textContent === flowEdgeDisplayName({ source, target }, nodes),
  );
  if (!g) throw new Error(`no drawn edge ${source} → ${target}`);
  return g;
}

/** Points along an `M` / `C` / `L` path, read back from its `d` string. */
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
    } else {
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
    }
  }
  return out;
}

const inside = (p: Point, b: Box) => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function mount(onSelectEdge = vi.fn()) {
  const view = render(
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      editable
      designMode
      selectedId={null}
      onSelect={() => {}}
      onSelectEdge={onSelectEdge}
      onPatch={() => {}}
    />,
  );
  return { ...view, onSelectEdge };
}

describe('flow canvas: a Decision branch that skips a node is drawn around it (objectui#13144)', () => {
  it('draws the skip edge clear of every card, and its wide hit path along the same route', () => {
    const { container } = mount();
    const g = edgeGroup(container, 'decide', 'end');
    const [stroke, hit] = Array.from(g.querySelectorAll('path'));
    const d = stroke.getAttribute('d')!;
    expect(hit.getAttribute('d')).toBe(d);
    const points = pointsOnPath(d);
    for (const id of ['start', 'decide', 'notify', 'end']) {
      expect(points.filter((p) => inside(p, cardBox(container, id))), id).toEqual([]);
    }
  });

  it('draws its branch pill where no card covers it', () => {
    const { container } = mount();
    const pill = edgeGroup(container, 'decide', 'end').querySelector('[data-branch-label]')!;
    expect(pill.textContent).toBe("if record.status != 'done'");
    const fo = pill.closest('foreignObject')!;
    const box: Box = {
      x: Number(fo.getAttribute('x')),
      y: Number(fo.getAttribute('y')),
      width: Number(fo.getAttribute('width')),
      height: Number(fo.getAttribute('height')),
    };
    for (const id of ['start', 'decide', 'notify', 'end']) expect(overlaps(box, cardBox(container, id)), id).toBe(false);
  });

  // A control, not the pin: happy-dom does no hit-testing, so this passes with
  // the pill under a card too. What made a real click land on the card is the
  // pill's box, which the test above pins; the PR's browser reading clicks it.
  it('wires the skip edge’s pill to select that edge', () => {
    const { container, onSelectEdge } = mount();
    fireEvent.click(edgeGroup(container, 'decide', 'end').querySelector('[data-branch-label]')!);
    expect(onSelectEdge).toHaveBeenCalledTimes(1);
    expect(onSelectEdge.mock.calls[0][0]).toMatchObject({ id: 'e_decide_end', source: 'decide', target: 'end' });
  });

  it('draws the edges between adjacent ranks exactly as before', () => {
    const { container } = mount();
    const decide = cardBox(container, 'decide');
    const notify = cardBox(container, 'notify');
    const d = edgeGroup(container, 'decide', 'notify').querySelector('path')!.getAttribute('d');
    expect(d).toBe(
      edgePath({ x: decide.x + decide.width / 2, y: decide.y + decide.height }, { x: notify.x + notify.width / 2, y: notify.y }),
    );
  });
});

describe('flow canvas: a branch that runs between two cards keeps its path, and its pill leaves their rank (objectui#13144)', () => {
  // Decision → Path A / Path B → End, and a Decision → End branch: its straight
  // line passes in the gap between A and B, and its pill used to sit there too.
  const fanNodes: FlowDesignerNode[] = [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'decide', type: 'decision', label: 'Route' },
    { id: 'a', type: 'script', label: 'Path A' },
    { id: 'b', type: 'script', label: 'Path B' },
    { id: 'end', type: 'end', label: 'End' },
  ];
  const fanEdges: FlowDesignerEdge[] = [
    { id: 'f1', source: 'start', target: 'decide' },
    { id: 'f2', source: 'decide', target: 'a', condition: 'x == 1' },
    { id: 'f3', source: 'decide', target: 'b', condition: 'x == 2' },
    { id: 'f4', source: 'a', target: 'end' },
    { id: 'f5', source: 'b', target: 'end' },
    { id: 'f6', source: 'decide', target: 'end', condition: "record.status != 'done'" },
  ];

  it('draws the straight line and puts the pill where no card covers it', () => {
    const { container } = render(
      <FlowCanvas nodes={fanNodes} edges={fanEdges} editable={false} designMode={false} selectedId={null} onSelect={() => {}} />,
    );
    const decide = cardBox(container, 'decide');
    const end = cardBox(container, 'end');
    const g = Array.from(container.querySelectorAll<SVGGElement>('svg g')).find(
      (el) => el.querySelector('[data-branch-label]')?.textContent === "if record.status != 'done'",
    )!;
    expect(g.querySelector('path')!.getAttribute('d')).toBe(
      edgePath({ x: decide.x + decide.width / 2, y: decide.y + decide.height }, { x: end.x + end.width / 2, y: end.y }),
    );
    const fo = g.querySelector('foreignObject')!;
    const box: Box = {
      x: Number(fo.getAttribute('x')),
      y: Number(fo.getAttribute('y')),
      width: Number(fo.getAttribute('width')),
      height: Number(fo.getAttribute('height')),
    };
    for (const id of ['start', 'decide', 'a', 'b', 'end']) expect(overlaps(box, cardBox(container, id)), id).toBe(false);
  });
});

describe('flow region view: a skip edge inside a region is drawn around the node it skips (objectui#13144)', () => {
  it('routes the region edge clear of every region node', () => {
    const { container } = render(
      <FlowRegionView
        maxWidth={2000}
        regions={[
          {
            key: 'body',
            nodes: [
              { id: 'check', type: 'decision', label: 'Check' },
              { id: 'send', type: 'script', label: 'Send' },
              { id: 'log', type: 'script', label: 'Log' },
            ],
            edges: [
              { id: 'r1', source: 'check', target: 'send' },
              { id: 'r2', source: 'send', target: 'log' },
              { id: 'r3', source: 'check', target: 'log' },
            ],
          },
        ]}
      />,
    );
    const boxes = Array.from(container.querySelectorAll<HTMLElement>('[data-region-node-id]')).map((el) => ({
      x: Number.parseFloat(el.style.left),
      y: Number.parseFloat(el.style.top),
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
    }));
    expect(boxes).toHaveLength(3);
    // The edge layer is the one direct-child `<path>` set; node icons are SVGs too.
    const paths = Array.from(container.querySelectorAll('svg.pointer-events-none > path')).map((p) => p.getAttribute('d')!);
    expect(paths).toHaveLength(3);
    for (const d of paths) {
      const points = pointsOnPath(d);
      for (const b of boxes) expect(points.filter((p) => inside(p, b))).toEqual([]);
    }
  });
});
