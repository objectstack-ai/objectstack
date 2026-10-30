// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27356 row 22 — the flow canvas opens with a diagram wider than itself
 * zoomed out until its width fits, and never zooms a diagram in past 100%.
 *
 * Reported from HotCRM at phone width: a branching flow opened at 100% with its
 * outer branch nodes cut off at both edges.
 *
 * The canvas is the real one. happy-dom lays nothing out, so the viewport's
 * `clientWidth` / `clientHeight` are read from a box this file sets, and
 * `ResizeObserver` is a double whose notifications the tests deliver, the way
 * a browser delivers them: once after `observe`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import type { FlowDesignerEdge, FlowDesignerNode } from './flow-canvas-layout';

// The palette's engine overlay answers "engine absent" (its offline answer).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

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
/** Deliver a notification to every live observer, as a browser does after `observe`. */
function notify() {
  act(() => {
    for (const o of [...observers]) o.cb([], o.self);
  });
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

const linear = (): { nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] } => ({
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

/** A decision with three branches: three node columns side by side. */
const branching = (): { nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] } => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'gate', type: 'decision', label: 'Route lead' },
    { id: 'a', type: 'assignment', label: 'Hot' },
    { id: 'b', type: 'assignment', label: 'Warm' },
    { id: 'c', type: 'assignment', label: 'Cold' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'gate' },
    { id: 'e2', source: 'gate', target: 'a', label: 'Hot' },
    { id: 'e3', source: 'gate', target: 'b', label: 'Warm' },
    { id: 'e4', source: 'gate', target: 'c', label: 'Cold' },
    { id: 'e5', source: 'a', target: 'end' },
    { id: 'e6', source: 'b', target: 'end' },
    { id: 'e7', source: 'c', target: 'end' },
  ],
});

function mountAt(w: number, h: number, draft: { nodes: FlowDesignerNode[]; edges: FlowDesignerEdge[] }) {
  box.w = w;
  box.h = h;
  render(
    <FlowCanvas
      nodes={draft.nodes}
      edges={draft.edges}
      editable
      designMode
      selectedId={null}
      onSelect={() => {}}
      onPatch={() => {}}
    />,
  );
  // The browser's first notification after `observe`, at the width just framed.
  notify();
}

/** The pan and zoom the canvas applied to the diagram, and the diagram's own width, read off its layer. */
function view(): { x: number; zoom: number; width: number } {
  const layer = screen.getByRole('application').firstElementChild as HTMLElement;
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(layer.style.transform);
  expect(m, `diagram transform: ${layer.style.transform}`).not.toBeNull();
  return { x: Number(m![1]), zoom: Number(m![3]), width: parseFloat(layer.style.width) };
}

describe('FlowCanvas — a diagram wider than the canvas opens fitted to its width (#27356 row 22)', () => {
  it('a branching flow at phone width opens zoomed out, centred, with every branch inside the canvas', () => {
    mountAt(390, 700, branching());

    const v = view();
    expect(v.width).toBeGreaterThan(390);
    expect(v.zoom).toBeLessThan(1);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(v.x + v.width * v.zoom).toBeLessThanOrEqual(390);
    expect(screen.getByText(`${Math.round(v.zoom * 100)}%`)).toBeTruthy();
  });

  it('the same flow on a wide canvas opens at 100%, centred', () => {
    mountAt(1400, 800, branching());

    const v = view();
    expect(v.zoom).toBe(1);
    expect(v.x).toBe((1400 - v.width) / 2);
  });

  it('a flow that already fits a phone-width canvas opens at 100%, not zoomed in', () => {
    mountAt(390, 700, linear());

    const v = view();
    expect(v.width).toBeLessThan(390);
    expect(v.zoom).toBe(1);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('a hidden canvas (0 wide) opens at 100%, not fitted into nothing', () => {
    mountAt(0, 0, branching());

    expect(view().zoom).toBe(1);
  });
});
