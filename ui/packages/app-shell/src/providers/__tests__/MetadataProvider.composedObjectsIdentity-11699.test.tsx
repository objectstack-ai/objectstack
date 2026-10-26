// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11699 — the context value's `objects` list is the same list, entry
 * for entry, for as long as the stored metadata it is built from is the same.
 *
 * ## What was measured
 *
 * On full reloads of a showcase record page (a real ObjectStack backend and a
 * production console build), the page read its record a second time, in
 * sequence. Instrumented, the record-load effect's second run had changed one
 * dependency, `objectDef`, and the new definition was JSON-equal to the old
 * one. Both definitions came out of this provider's `objects` getter at the
 * SAME context version, and neither was the stored item: the getter ran
 * `mergeViewsIntoObjects` + `attachInlineSubforms` on every read, and both
 * wrap every object they touch in a new object. So any re-render of a host
 * that reads `objects` handed its children new objects for unchanged
 * metadata. The record page now keys its read on data (its own pin is
 * `RecordDetailView.recordOpenRequests-11699.test.tsx`); this file pins the
 * provider half (AGENTS.md #10: "a provider ... may not republish an equal
 * payload as a new object").
 *
 * ## What these pins hold, in both directions
 *
 *   - Re-reading at the same version, and another metadata type landing (a new
 *     context value), hand back the same list and the same entries.
 *   - Replacing either stored array — the objects or the views — hands back a
 *     new list that carries the change. A cache that never let go would pass
 *     the first half and fail this one.
 *   - A DISCARDED `useMemo` cache — the context value's own — leaves the list
 *     where it was. React does not discard on its own in this tree (AGENTS.md
 *     #10), so the discard is forced by a module-level proxy, the technique and
 *     the reason of `packages/permissions`' `providerCtxIdentity.discarded.test.tsx`:
 *     every armed `useMemo` is thrown away, not ones picked by a marker. The
 *     case first shows the discard reached the provider (the context value IS a
 *     new object), then that the list did not move. A cache kept in the value's
 *     own `useMemo` would pass the first two bullets and fail this one.
 *
 *     ⚠️ Unlike that file, `useCallback` is NOT discarded here, and that is a
 *     measured choice, not an omission: discarding `bump` re-runs the
 *     provider's preview-mode effect, which lists it as a dependency and, after
 *     mount, clears the WHOLE metadata cache — so the list empties for a reason
 *     outside the getter this file pins. That effect's dependency on a
 *     memoised callback is its own latent AGENTS.md #10 hazard, recorded on
 *     objectui#11699 and not changed here.
 *
 * The fixture makes both helpers wrap: `task` has a list view (merged into its
 * `listViews`), and its `project` field declares `inlineEdit`, so `project`
 * gets a derived form `subforms` entry.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

const memoProxy = vi.hoisted(() => ({ armed: false, epoch: 0 }));

type UseMemo = (factory: () => unknown, deps?: unknown[]) => unknown;
type ReactModule = Record<string, unknown> & { useMemo: UseMemo; default?: Record<string, unknown> };

vi.mock('react', async (importOriginal) => {
  // Typed loosely on purpose: React's own `useMemo` type takes a
  // `DependencyList`, which the patched signature below cannot satisfy.
  const actual = await importOriginal<ReactModule>();
  const realUseMemo = actual.useMemo;
  const patchedUseMemo = (factory: () => unknown, deps?: unknown[]) =>
    memoProxy.armed && Array.isArray(deps)
      ? realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  return {
    ...actual,
    useMemo: patchedUseMemo,
    default: { ...(actual.default ?? actual), useMemo: patchedUseMemo },
  };
});

type Ctx = ReturnType<typeof useMetadata>;

const OBJECTS = [
  {
    name: 'task',
    label: 'Task',
    fields: {
      title: { type: 'text' },
      project: { type: 'master_detail', reference: 'project', inlineEdit: true },
    },
  },
  { name: 'project', label: 'Project', fields: { name: { type: 'text' } } },
];
const VIEWS = [
  { name: 'task.all', object: 'task', viewKind: 'list', label: 'All', isDefault: true, config: { type: 'grid', columns: ['title'] } },
];
const PAGES = [{ name: 'task_detail', type: 'record', object: 'task' }];

/** Serves each type from `served`, as the network does: a new array per fetch. */
function makeAdapter(served: Record<string, unknown[]>) {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => Promise.resolve({ type, items: structuredClone(served[type] ?? []) }),
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function mount(served: Record<string, unknown[]>) {
  let latest: Ctx | null = null;
  function Probe() {
    latest = useMetadata();
    return null;
  }
  const adapter = makeAdapter(served);
  const tree = () => (
    <MetadataProvider adapter={adapter}>
      <Probe />
    </MetadataProvider>
  );
  const utils = render(tree());
  return {
    ctx: () => latest as unknown as Ctx,
    rerender: () => utils.rerender(tree()),
  };
}

type Def = { name: string; fields?: Record<string, unknown>; listViews?: Record<string, unknown>; form?: { subforms?: unknown[] } };
const byName = (list: unknown[], name: string) => (list as Def[]).find((o) => o.name === name);

/** Wait until both helpers have had something to wrap. */
async function untilComposed(ctx: () => Ctx) {
  await waitFor(() => {
    const task = byName(ctx().objects, 'task');
    expect(task?.listViews?.['task.all']).toBeTruthy();
    expect(byName(ctx().objects, 'project')?.form?.subforms).toHaveLength(1);
  });
}

afterEach(() => {
  cleanup();
  memoProxy.armed = false;
});

describe('MetadataProvider: the composed `objects` list keeps its identity (objectui#11699)', () => {
  it('re-reading at the same version hands back the same list and the same entries', async () => {
    const m = mount({ object: OBJECTS, view: VIEWS });
    await untilComposed(m.ctx);

    const ctx = m.ctx();
    const first = ctx.objects;
    // Two reads in one render — the measured case: one context version, two getter reads.
    expect(ctx.objects).toBe(first);
    // A host re-render with nothing changed.
    m.rerender();
    m.rerender();
    expect(m.ctx().objects).toBe(first);
    expect(byName(m.ctx().objects, 'task')).toBe(byName(first, 'task'));
    expect(byName(m.ctx().objects, 'project')).toBe(byName(first, 'project'));
  });

  it('another metadata type landing (a new context value) hands back the same list', async () => {
    const m = mount({ object: OBJECTS, view: VIEWS, page: PAGES });
    await untilComposed(m.ctx);
    const before = m.ctx();
    const first = before.objects;

    await act(async () => {
      await before.ensureType('page');
    });
    await waitFor(() => expect(m.ctx().pages).toHaveLength(1));

    expect(m.ctx()).not.toBe(before);
    expect(m.ctx().objects).toBe(first);
    expect(byName(m.ctx().objects, 'task')).toBe(byName(first, 'task'));
  });

  it('LIVE CONTROL: replacing the stored objects hands back a new list carrying the change', async () => {
    const served: Record<string, unknown[]> = { object: OBJECTS, view: VIEWS };
    const m = mount(served);
    await untilComposed(m.ctx);
    const first = m.ctx().objects;

    served.object = [
      { ...OBJECTS[0], fields: { ...OBJECTS[0].fields, due: { type: 'date' } } },
      OBJECTS[1],
    ];
    await act(async () => {
      await m.ctx().refresh('object');
    });
    await waitFor(() => expect(byName(m.ctx().objects, 'task')?.fields?.due).toBeTruthy());

    expect(m.ctx().objects).not.toBe(first);
    // Still composed: the merge and the subform pass ran over the new list.
    expect(byName(m.ctx().objects, 'task')?.listViews?.['task.all']).toBeTruthy();
    expect(byName(m.ctx().objects, 'project')?.form?.subforms).toHaveLength(1);
  });

  it('LIVE CONTROL: replacing the stored views hands back a new list carrying the change', async () => {
    const served: Record<string, unknown[]> = { object: OBJECTS, view: VIEWS };
    const m = mount(served);
    await untilComposed(m.ctx);
    const first = m.ctx().objects;

    served.view = [
      ...VIEWS,
      { name: 'task.mine', object: 'task', viewKind: 'list', label: 'Mine', config: { type: 'grid', columns: ['title'] } },
    ];
    await act(async () => {
      await m.ctx().refresh('view');
    });
    await waitFor(() => expect(byName(m.ctx().objects, 'task')?.listViews?.['task.mine']).toBeTruthy());

    expect(m.ctx().objects).not.toBe(first);
  });

  it('a discarded context-value memo leaves the list where it was (AGENTS.md #10)', async () => {
    memoProxy.armed = true;
    const m = mount({ object: OBJECTS, view: VIEWS });
    await untilComposed(m.ctx);
    const before = m.ctx();
    const first = before.objects;

    // Two discards, each followed by a re-render with nothing changed.
    memoProxy.epoch += 1;
    m.rerender();
    memoProxy.epoch += 1;
    m.rerender();

    // The discard reached the provider: its context value was rebuilt.
    expect(m.ctx()).not.toBe(before);
    // And the list it hands out did not move.
    expect(m.ctx().objects).toBe(first);
    expect(byName(m.ctx().objects, 'task')).toBe(byName(first, 'task'));
    expect(byName(m.ctx().objects, 'project')).toBe(byName(first, 'project'));
  });
});
