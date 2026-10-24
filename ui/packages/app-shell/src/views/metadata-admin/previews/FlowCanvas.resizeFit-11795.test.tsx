// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11795 — the flow canvas re-fits when its own width changes, and
 * nothing an author does to the diagram moves the viewport.
 *
 * Measured in Chromium before the fix: Studio's Automations pillar opened at a
 * 390px window framed the diagram for a ~34px canvas (centred, so it hung off
 * both edges); widened to 1024px, the canvas grew to ~460px and the diagram
 * stayed where the narrow box had put it, its Start/End cards clipped at the
 * left edge. The mount framing ran once and nothing re-ran it.
 *
 * The canvas is the real one. happy-dom lays nothing out, so the viewport's
 * `clientWidth` / `clientHeight` are read from a box this file sets, and
 * `ResizeObserver` is a double whose notifications the tests deliver, the way
 * a browser delivers them: once after `observe`, then on each resize.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import { NODE_W, PADDING, type FlowDesignerEdge, type FlowDesignerNode } from './flow-canvas-layout';

// The palette's engine overlay answers "engine absent" (its offline answer).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

/** The diagram's width at 100% for a linear flow: one node column plus the layout's padding. */
const DIAGRAM_W = NODE_W + 2 * PADDING;

const box = { w: 0, h: 0 };
const observers = new Set<{ cb: ResizeObserverCallback; self: ResizeObserver }>();
class ResizeObserverDouble {
  private entry: { cb: ResizeObserverCallback; self: ResizeObserver };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, self: this as unknown as ResizeObserver };
  }
  observe() {
    observers.add(this.entry);
  }
  unobserve() {
    observers.delete(this.entry);
  }
  disconnect() {
    observers.delete(this.entry);
  }
}
/** Deliver a notification to every live observer, as a browser does after a resize. */
function notify() {
  act(() => {
    for (const o of [...observers]) o.cb([], o.self);
  });
}
function resizeTo(w: number, h: number) {
  box.w = w;
  box.h = h;
  notify();
}

/** The prototype that owns `name` on the viewport element. */
function ownerOf(name: 'clientWidth' | 'clientHeight'): object {
  let p: object | null = HTMLDivElement.prototype;
  while (p && !Object.getOwnPropertyDescriptor(p, name)) p = Object.getPrototypeOf(p);
  if (!p) throw new Error(`no prototype defines ${name}`);
  return p;
}

let realResizeObserver: typeof ResizeObserver | undefined;
beforeEach(() => {
  box.w = 0;
  box.h = 0;
  observers.clear();
  realResizeObserver = globalThis.ResizeObserver;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverDouble;
  const isViewport = (el: Element) => el.getAttribute('role') === 'application';
  vi.spyOn(ownerOf('clientWidth') as HTMLElement, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return isViewport(this) ? box.w : 0;
  });
  vi.spyOn(ownerOf('clientHeight') as HTMLElement, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return isViewport(this) ? box.h : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = realResizeObserver;
  localStorage.clear();
});

type Draft = { nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] };

const flow = (): Draft => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'assign', type: 'assignment', label: 'Set owner' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'assign' },
    { id: 'e2', source: 'assign', target: 'end' },
  ],
});

/** Mount the canvas in a host that keeps the draft, as Studio does; `edit` changes it from outside. */
function mountAt(w: number, h: number) {
  box.w = w;
  box.h = h;
  const host: { edit: (fn: (d: Draft) => Draft) => void } = { edit: () => {} };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(flow);
    host.edit = (fn) => act(() => setDraft(fn));
    return (
      <FlowCanvas
        nodes={draft.nodes}
        edges={draft.edges}
        editable
        designMode
        selectedId={null}
        onSelect={() => {}}
        onPatch={(patch) => setDraft((d) => ({ ...d, ...(patch as Partial<Draft>) }))}
      />
    );
  }
  render(<Host />);
  // The browser's first notification after `observe`, at the width just framed.
  notify();
  return host;
}

/** The pan and zoom the canvas applied to the diagram, read off its transform. */
function view(): { x: number; y: number; zoom: number } {
  const layer = screen.getByRole('application').firstElementChild as HTMLElement;
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(layer.style.transform);
  expect(m, `diagram transform: ${layer.style.transform}`).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]), zoom: Number(m![3]) };
}

describe('FlowCanvas — a width change re-fits the diagram (objectui#11795)', () => {
  it('opened narrow and then widened, the diagram is framed for the new width, not left where the narrow box put it', () => {
    mountAt(34, 541);
    // The mount framing at 34px: centred at 100%, so the diagram's left edge is off-canvas.
    expect(view().x).toBeLessThan(0);

    resizeTo(460, 570);

    const v = view();
    expect(v.zoom).toBe(1);
    expect(v.x).toBe((460 - DIAGRAM_W) / 2);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.x + DIAGRAM_W * v.zoom).toBeLessThanOrEqual(460);
  });

  it('narrowed below the diagram, it zooms out until the whole flow fits, centred', () => {
    mountAt(800, 600);
    expect(view().zoom).toBe(1);

    resizeTo(200, 600);

    const v = view();
    expect(v.zoom).toBeLessThan(1);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.x + DIAGRAM_W * v.zoom).toBeLessThanOrEqual(200);
    expect(screen.getByText(`${Math.round(v.zoom * 100)}%`)).toBeTruthy();
  });

  it('a wider canvas does not zoom a small flow past the 100% it opens at', () => {
    mountAt(460, 570);

    resizeTo(1400, 900);

    expect(view()).toMatchObject({ zoom: 1, x: (1400 - DIAGRAM_W) / 2 });
  });
});

describe('FlowCanvas — what an author does to the diagram never moves the viewport (objectui#11795, the control)', () => {
  it('a node add re-arms the observer at the width already framed, and the view stays put', () => {
    const host = mountAt(800, 600);
    const before = view();

    host.edit((d) => ({
      nodes: [...d.nodes, { id: 'extra', type: 'assignment', label: 'Extra' }],
      edges: [...d.edges, { id: 'e3', source: 'end', target: 'extra' }],
    }));
    // The re-armed observer's first notification arrives at the same width.
    notify();

    expect(document.querySelector('[data-node-id="extra"]')).not.toBeNull();
    expect(view()).toEqual(before);
  });

  it('a height-only change — a notice landing above the canvas after an edit — does not re-fit', () => {
    mountAt(800, 600);
    const before = view();

    resizeTo(800, 560);

    expect(view()).toEqual(before);
  });

  it('a hidden canvas (0 wide) is not fitted into nothing', () => {
    mountAt(800, 600);
    const before = view();

    resizeTo(0, 0);

    expect(view()).toEqual(before);
  });
});
