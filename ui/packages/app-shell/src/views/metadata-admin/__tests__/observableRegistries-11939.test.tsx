// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11939 (step 1 of objectui#6795's order) — the three designer
 * registries are observable.
 *
 * Measured on objectui#6795 before this change, with the registries as plain
 * `Map`s read during render:
 *
 *     fallback before registration: true
 *     still fallback after registration: true
 *     late inspector rendered: false
 *
 * This file pins the store and the hooks the readers moved onto. The readers'
 * own recovery pins live beside them:
 *   - `studio-design/StudioDesignSurface.lateRegistration-11939.test.tsx`
 *   - `studio-design/ObjectPanels.lateRegistration-11939.test.tsx`
 *   - `ResourceEditPage.lateRegistration-11939.test.tsx`
 *
 * Four things are held here:
 *   1. the `register*` / `get*` / `list*` contract is what it was for current
 *      callers — same overwrite, same lookup, a fresh sorted array per `list*`;
 *   2. a `useRegistered*` reader re-renders when its entry is registered late;
 *   3. it does NOT re-render for a registration it cannot observe (another type,
 *      or the same component registered again), and a populated registry
 *      renders its reader exactly once — no extra render, no loop;
 *   4. the types snapshot is cached, so React never reports an uncached
 *      `getSnapshot` (the infinite-loop trap of a `list*` read that builds a new
 *      array per call).
 *
 * Every type name here is prefixed `t11939_` so it collides with nothing a
 * module this file imports might register.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

import {
  createObservableTypeRegistry,
  registerMetadataPreview,
  getMetadataPreview,
  listMetadataPreviewTypes,
  useRegisteredMetadataPreview,
  useRegisteredMetadataPreviewTypes,
  type MetadataPreview,
} from '../preview-registry';
import {
  registerMetadataInspector,
  getMetadataInspector,
  listMetadataInspectorTypes,
  useRegisteredMetadataInspector,
  useRegisteredMetadataInspectorTypes,
  type MetadataInspector,
} from '../inspector-registry';
import {
  registerMetadataDefaultInspector,
  getMetadataDefaultInspector,
  useRegisteredMetadataDefaultInspector,
  type MetadataDefaultInspector,
} from '../default-inspector-registry';

afterEach(cleanup);

const PreviewA: MetadataPreview = () => <div data-testid="preview-a" />;
const PreviewB: MetadataPreview = () => <div data-testid="preview-b" />;
const InspectorA: MetadataInspector = () => <div data-testid="inspector-a" />;
const DefaultInspectorA: MetadataDefaultInspector = () => <div data-testid="default-inspector-a" />;

describe('the store under all three registries (objectui#11939)', () => {
  it('notifies every subscriber of a registration, and stops once unsubscribed', () => {
    const store = createObservableTypeRegistry<string>();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = store.subscribe(first);
    store.subscribe(second);

    store.set('a', 'A');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    stopFirst();
    store.set('b', 'B');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('notifies on a replacement, and not when the stored value is registered again', () => {
    const store = createObservableTypeRegistry<string>();
    store.set('a', 'A');
    const listener = vi.fn();
    store.subscribe(listener);

    store.set('a', 'A');
    expect(listener).not.toHaveBeenCalled();
    expect(store.get('a')).toBe('A');

    store.set('a', 'A2');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get('a')).toBe('A2');
  });

  it('a listener that unsubscribes another mid-notification does not skip the rest', () => {
    const store = createObservableTypeRegistry<string>();
    const calls: string[] = [];
    let stopSecond = () => {};
    store.subscribe(() => {
      calls.push('first');
      stopSecond();
    });
    stopSecond = store.subscribe(() => calls.push('second'));

    store.set('a', 'A');
    // The iteration runs over a copy, so the listener removed during this
    // notification still receives it; it is gone from the next one.
    expect(calls).toEqual(['first', 'second']);
    store.set('b', 'B');
    expect(calls).toEqual(['first', 'second', 'first']);
  });

  it('types() is a new sorted array on every call, owned by the caller', () => {
    const store = createObservableTypeRegistry<string>();
    store.set('b', 'B');
    store.set('a', 'A');
    const read = store.types();
    expect(read).toEqual(['a', 'b']);
    expect(store.types()).not.toBe(read);
    read.push('mutated');
    expect(store.types()).toEqual(['a', 'b']);
  });
});

describe('the register / get / list contract is unchanged for current callers (objectui#11939)', () => {
  it('preview registry: overwrite, lookup, and a fresh sorted list', () => {
    expect(getMetadataPreview('t11939_contract_b')).toBeUndefined();
    registerMetadataPreview('t11939_contract_b', PreviewA);
    registerMetadataPreview('t11939_contract_a', PreviewA);
    registerMetadataPreview('t11939_contract_b', PreviewB);
    expect(getMetadataPreview('t11939_contract_b')).toBe(PreviewB);
    expect(getMetadataPreview('t11939_contract_a')).toBe(PreviewA);

    const list = listMetadataPreviewTypes();
    expect(list).toEqual([...list].sort());
    expect(list).toEqual(expect.arrayContaining(['t11939_contract_a', 't11939_contract_b']));
    expect(listMetadataPreviewTypes()).not.toBe(list);
    list.length = 0;
    expect(listMetadataPreviewTypes()).toEqual(expect.arrayContaining(['t11939_contract_a']));
  });

  it('inspector registry: overwrite, lookup, and a fresh sorted list', () => {
    const InspectorB: MetadataInspector = () => null;
    registerMetadataInspector('t11939_contract', InspectorA);
    registerMetadataInspector('t11939_contract', InspectorB);
    expect(getMetadataInspector('t11939_contract')).toBe(InspectorB);
    const list = listMetadataInspectorTypes();
    expect(list).toEqual([...list].sort());
    expect(list).toContain('t11939_contract');
    expect(listMetadataInspectorTypes()).not.toBe(list);
  });

  it('default-inspector registry: overwrite and lookup', () => {
    const DefaultInspectorB: MetadataDefaultInspector = () => null;
    expect(getMetadataDefaultInspector('t11939_contract')).toBeUndefined();
    registerMetadataDefaultInspector('t11939_contract', DefaultInspectorA);
    registerMetadataDefaultInspector('t11939_contract', DefaultInspectorB);
    expect(getMetadataDefaultInspector('t11939_contract')).toBe(DefaultInspectorB);
  });
});

/**
 * Renders the entry a hook hands back, or a fallback. `renders.count` is the
 * number of commits of the probe's tree, read off a `React.Profiler` so the
 * probe itself mutates nothing during render.
 */
function makeEntryProbe(useEntry: (type: string) => unknown) {
  const renders = { count: 0 };
  function Reader({ type }: { type: string }) {
    const Entry = useEntry(type) as React.ComponentType | undefined;
    return Entry ? React.createElement(Entry) : <p>fallback</p>;
  }
  function Probe({ type }: { type: string }) {
    return (
      <React.Profiler id="probe" onRender={() => (renders.count += 1)}>
        <Reader type={type} />
      </React.Profiler>
    );
  }
  return { Probe, renders };
}

describe('a useRegistered* reader re-renders on a late registration (objectui#11939)', () => {
  it('preview: the fallback gives way to the preview registered after first render', () => {
    const { Probe } = makeEntryProbe(useRegisteredMetadataPreview);
    render(<Probe type="t11939_late_preview" />);
    expect(screen.getByText('fallback')).toBeInTheDocument();

    act(() => registerMetadataPreview('t11939_late_preview', PreviewA));
    expect(screen.getByTestId('preview-a')).toBeInTheDocument();
    expect(screen.queryByText('fallback')).toBeNull();

    // A replacement reaches the same reader.
    act(() => registerMetadataPreview('t11939_late_preview', PreviewB));
    expect(screen.getByTestId('preview-b')).toBeInTheDocument();
  });

  it('scoped inspector: the late registration renders', () => {
    const { Probe } = makeEntryProbe(useRegisteredMetadataInspector);
    render(<Probe type="t11939_late_inspector" />);
    expect(screen.getByText('fallback')).toBeInTheDocument();
    act(() => registerMetadataInspector('t11939_late_inspector', InspectorA));
    expect(screen.getByTestId('inspector-a')).toBeInTheDocument();
  });

  it('default inspector: the late registration renders', () => {
    const { Probe } = makeEntryProbe(useRegisteredMetadataDefaultInspector);
    render(<Probe type="t11939_late_default" />);
    expect(screen.getByText('fallback')).toBeInTheDocument();
    act(() => registerMetadataDefaultInspector('t11939_late_default', DefaultInspectorA));
    expect(screen.getByTestId('default-inspector-a')).toBeInTheDocument();
  });

  it('type lists: a new type reaches both list readers', () => {
    function Lists() {
      const previews = useRegisteredMetadataPreviewTypes();
      const inspectors = useRegisteredMetadataInspectorTypes();
      return (
        <p>
          {previews.includes('t11939_list') ? 'preview listed' : 'preview absent'} /{' '}
          {inspectors.includes('t11939_list') ? 'inspector listed' : 'inspector absent'}
        </p>
      );
    }
    render(<Lists />);
    expect(screen.getByText('preview absent / inspector absent')).toBeInTheDocument();
    act(() => registerMetadataPreview('t11939_list', PreviewA));
    expect(screen.getByText('preview listed / inspector absent')).toBeInTheDocument();
    act(() => registerMetadataInspector('t11939_list', InspectorA));
    expect(screen.getByText('preview listed / inspector listed')).toBeInTheDocument();
  });
});

describe('controls — nothing a reader cannot observe re-renders it (objectui#11939)', () => {
  it('an already-populated registry renders its reader once, and a no-op registration renders nothing', () => {
    registerMetadataPreview('t11939_populated', PreviewA);
    const { Probe, renders } = makeEntryProbe(useRegisteredMetadataPreview);
    render(<Probe type="t11939_populated" />);
    expect(screen.getByTestId('preview-a')).toBeInTheDocument();
    expect(renders.count).toBe(1);

    // The same component again, and an entry of another type: neither changes
    // what this reader reads, so neither renders it.
    act(() => registerMetadataPreview('t11939_populated', PreviewA));
    act(() => registerMetadataPreview('t11939_populated_other', PreviewB));
    expect(renders.count).toBe(1);
    expect(screen.getByTestId('preview-a')).toBeInTheDocument();
  });

  it('an unregistered type keeps its fallback while other types register', () => {
    const { Probe, renders } = makeEntryProbe(useRegisteredMetadataInspector);
    render(<Probe type="t11939_never" />);
    act(() => registerMetadataInspector('t11939_someone_else', InspectorA));
    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('inspector-a')).toBeNull();
    expect(renders.count).toBe(1);
  });

  it('the types snapshot is the same array until the type set changes', () => {
    registerMetadataPreview('t11939_snapshot', PreviewA);
    const seen: Array<readonly string[]> = [];
    function Lists() {
      seen.push(useRegisteredMetadataPreviewTypes());
      return null;
    }
    const view = render(<Lists />);
    view.rerender(<Lists />);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(Object.isFrozen(seen[0])).toBe(true);

    // Replacing an existing type's entry does not change the set: no render.
    act(() => registerMetadataPreview('t11939_snapshot', PreviewB));
    expect(seen).toHaveLength(2);

    // A new type does: one render, with a new array holding it.
    act(() => registerMetadataPreview('t11939_snapshot_new', PreviewA));
    expect(seen).toHaveLength(3);
    expect(seen[2]).not.toBe(seen[1]);
    expect(seen[2]).toContain('t11939_snapshot_new');
  });

  it('React reports no uncached snapshot and no update-depth loop', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      function Lists() {
        const previews = useRegisteredMetadataPreviewTypes();
        const inspectors = useRegisteredMetadataInspectorTypes();
        const entry = useRegisteredMetadataPreview('t11939_loop');
        return <p>{`${previews.length}:${inspectors.length}:${entry ? 'y' : 'n'}`}</p>;
      }
      render(<Lists />);
      act(() => registerMetadataPreview('t11939_loop', PreviewA));
      const reported = errors.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(reported).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
    } finally {
      errors.mockRestore();
    }
  });
});
