// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28645 — an app page reads its views, page and dashboard from
 * the app bundle, and the `/meta/view`, `/meta/page`, `/meta/dashboard` lists
 * only for what the bundle does not hold.
 *
 * Measured on cloud's console before this card: a warm open of an app page
 * asked the bundle AND the three lists the bundle already answers. The double
 * below serves the list and by-name doors and a bundle the test controls
 * (`peekAppBundle`, as the real adapter answers it), recording every list read.
 *
 * What these pins hold:
 *
 *   - the mount reads the app list and NOT the view list;
 *   - a scope whose objects the bundle all holds composes them with the
 *     bundle's views and never asks `view`; it is not settled while the bundle
 *     is on the wire, and settles when it lands;
 *   - CONTROL: a scope holding an object outside the bundle reads the `view`
 *     list, and the whole registry is read with it, answering only once both
 *     have;
 *   - a bundled page is a hit, read for read the same document; a name the
 *     bundle lacks, or a same-named page another package owns, is a miss;
 *   - an app entered in the same commit (a descendant's effect, as
 *     `AppContent` enters it) is waited for; no app entered at all is a miss
 *     once the commit has settled, so the readers read their lists.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MetadataProvider, useMetadata } from '../MetadataProvider';
import { bundledFirst, useBundledItem, useBundledReads, type BundledRead, type BundledReads } from '../bundledReads';
import { useServedViewItems } from '../../hooks/useServedViewItems';

type Ctx = ReturnType<typeof useMetadata>;
type Doc = { name: string; [key: string]: unknown };

const PKG = 'app.b28645';
const OBJECTS: Doc[] = [
  { name: 'b28645_plan', _packageId: PKG, fields: { name: { type: 'text' } } },
  { name: 'b28645_price', _packageId: PKG, fields: { plan: { type: 'lookup', reference: 'b28645_plan' } } },
  { name: 'b28645_outside', _packageId: PKG, fields: { name: { type: 'text' } } },
];
const VIEWS: Doc[] = [
  { name: 'b28645_plan.all', object: 'b28645_plan', viewKind: 'list', label: 'All plans', isDefault: true, config: { type: 'grid', columns: ['name'] } },
  { name: 'b28645_outside.all', object: 'b28645_outside', viewKind: 'list', label: 'All outside', isDefault: true, config: { type: 'grid', columns: ['name'] } },
];
const PAGES: Doc[] = [{ name: 'b28645_pricing', _packageId: PKG, label: 'Pricing' }];

/** The bundle's items, keyed as the adapter's `AppBundleItems` keys them. */
function bundleItems(over: { pages?: Doc[] } = {}) {
  const items = new Map<string, Map<string, { item: unknown; envelope: Record<string, unknown> }>>();
  const put = (type: string, docs: Doc[]) => {
    const byName = new Map();
    for (const doc of docs) byName.set(doc.name, { item: structuredClone(doc), envelope: { type, name: doc.name, item: doc } });
    items.set(type, byName);
  };
  put('object', OBJECTS.slice(0, 2));
  put('view', VIEWS.slice(0, 1));
  put('page', over.pages ?? PAGES);
  put('dashboard', [{ name: 'b28645_home', _packageId: PKG, label: 'Home' }]);
  return items;
}

interface Bundle {
  state: { status: 'none' } | { status: 'pending'; settled: Promise<unknown> } | { status: 'ready'; items: ReturnType<typeof bundleItems> };
  enter(): void;
  land(items?: ReturnType<typeof bundleItems>): Promise<void>;
}

function makeBundle(): Bundle {
  let resolve: () => void = () => {};
  const bundle: Bundle = {
    state: { status: 'none' },
    enter() {
      if (bundle.state.status !== 'none') return;
      bundle.state = { status: 'pending', settled: new Promise<void>((r) => { resolve = r; }) };
    },
    async land(items = bundleItems()) {
      bundle.state = { status: 'ready', items };
      resolve();
      await Promise.resolve();
    },
  };
  return bundle;
}

function makeAdapter(calls: string[], bundle: Bundle | null) {
  return {
    clearCache: () => {},
    invalidateCache: () => {},
    ...(bundle ? { peekAppBundle: () => bundle.state } : {}),
    getObjectSchema: (name: string) => {
      calls.push(`object/${name}`);
      const item = OBJECTS.find((o) => o.name === name);
      return item ? Promise.resolve(structuredClone(item)) : Promise.reject(Object.assign(new Error('nf'), { httpStatus: 404 }));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'view' ? VIEWS : type === 'page' ? PAGES : [];
          return Promise.resolve({ type, items: structuredClone(all) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          return Promise.reject(Object.assign(new Error('nf'), { httpStatus: 404 }));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function mount(opts: { bundle?: Bundle | null; enterInEffect?: Bundle } = {}) {
  const calls: string[] = [];
  const bundle = opts.bundle === undefined ? makeBundle() : opts.bundle;
  let ctx: Ctx | null = null;
  let reads: BundledReads | null = null;
  let page: BundledRead<any> | null = null;
  function Probe() {
    ctx = useMetadata();
    reads = useBundledReads();
    page = useBundledItem('page', 'b28645_pricing', PKG);
    return null;
  }
  // Enters the app from an effect, as `AppContent` does: a descendant's
  // effect runs before the provider's own.
  function Enter() {
    useEffect(() => opts.enterInEffect?.enter(), []);
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(calls, bundle)}>
      <Probe />
      <Enter />
    </MetadataProvider>,
  );
  // `bundle` is null only for the host-without-a-bundle case, which never reads it.
  return { calls, bundle: bundle as Bundle, ctx: () => ctx as unknown as Ctx, reads: () => reads as BundledReads, page: () => page as BundledRead<any> };
}

const lists = (calls: string[]) => calls.filter((c) => !c.includes('/'));
const scopeNames = ['b28645_plan', 'b28645_price'];

afterEach(() => cleanup());

describe('MetadataProvider — bundle-first reads (objectstack#28645)', () => {
  it('reads the app list at mount, and not the view list', async () => {
    const m = mount();
    await waitFor(() => expect(m.calls).toContain('app'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(lists(m.calls)).toEqual(['app']);
  });

  it('composes a scope the bundle holds whole with its views, and never asks `view`', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    await waitFor(() => expect(m.calls).toContain('app'));
    let scope = m.ctx().readObjectScope!({ names: scopeNames });
    await waitFor(() => {
      scope = m.ctx().readObjectScope!({ names: scopeNames });
      expect(scope.served).toHaveLength(2);
    });
    // Its objects are answered, its views are not yet: not settled.
    expect(scope.settled).toBe(false);
    await act(async () => { await m.bundle.land(); });
    await waitFor(() => {
      scope = m.ctx().readObjectScope!({ names: scopeNames });
      expect(scope.settled).toBe(true);
    });
    const plan = (scope.objects as Doc[]).find((o) => o.name === 'b28645_plan') as { listViews?: Record<string, { label?: string }> };
    expect(plan.listViews?.['b28645_plan.all']?.label).toBe('All plans');
    expect(lists(m.calls)).toEqual(['app']);
  });

  it('CONTROL: a scope holding an object outside the bundle reads the `view` list', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    await act(async () => { await m.bundle.land(); });
    const withOutside = ['b28645_plan', 'b28645_outside'];
    await waitFor(() => {
      const scope = m.ctx().readObjectScope!({ names: withOutside });
      expect(scope.settled).toBe(true);
    });
    const scope = m.ctx().readObjectScope!({ names: withOutside });
    const outside = (scope.objects as Doc[]).find((o) => o.name === 'b28645_outside') as { listViews?: Record<string, unknown> };
    expect(outside.listViews?.['b28645_outside.all']).toBeDefined();
    expect(lists(m.calls)).toEqual(['app', 'view']);
  });

  it('composes a package scope from the bundle when every name asked is bundled, though the package holds more', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    await act(async () => { await m.bundle.land(); });
    let scope = m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] });
    await waitFor(() => {
      scope = m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] });
      expect(scope.settled).toBe(true);
    });
    // The package list holds `b28645_outside` too; no reader asked for it.
    expect(scope.served).toHaveLength(3);
    const plan = (scope.objects as Doc[]).find((o) => o.name === 'b28645_plan') as { listViews?: Record<string, unknown> };
    expect(plan.listViews?.['b28645_plan.all']).toBeDefined();
    expect(lists(m.calls)).toEqual(['app', `object?package=${PKG}`]);
    // The same composition, read after read.
    expect(m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] }).objects).toBe(scope.objects);
  });

  it('CONTROL: a package scope asking an object the bundle lacks reads the `view` list', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    await act(async () => { await m.bundle.land(); });
    const asked = ['b28645_plan', 'b28645_outside'];
    await waitFor(() => {
      const scope = m.ctx().readObjectScope!({ packageId: PKG, names: asked });
      expect(scope.settled).toBe(true);
    });
    const scope = m.ctx().readObjectScope!({ packageId: PKG, names: asked });
    const outside = (scope.objects as Doc[]).find((o) => o.name === 'b28645_outside') as { listViews?: Record<string, unknown> };
    expect(outside.listViews?.['b28645_outside.all']).toBeDefined();
    expect(lists(m.calls)).toEqual(['app', `object?package=${PKG}`, 'view']);
  });

  it('composes an unasked package object from a `view` list already in hand', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    await act(async () => { await m.bundle.land(); });
    await act(async () => { await m.ctx().ensureType!('view'); });
    await waitFor(() => {
      expect(m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] }).settled).toBe(true);
    });
    const scope = m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] });
    const byName = (name: string) => (scope.objects as Doc[]).find((o) => o.name === name) as { listViews?: Record<string, unknown> };
    expect(byName('b28645_plan').listViews?.['b28645_plan.all']).toBeDefined();
    expect(byName('b28645_outside').listViews?.['b28645_outside.all']).toBeDefined();
    expect(lists(m.calls)).toEqual(['app', 'view', `object?package=${PKG}`]);
  });

  it('a scope settled on the view list stays settled, and keeps its objects, when an app is entered after it', async () => {
    const m = mount();
    await act(async () => { await m.ctx().ensureType!('view'); });
    await waitFor(() => {
      expect(m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] }).settled).toBe(true);
    });
    const before = m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] });
    act(() => m.bundle.enter());
    const during = m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] });
    expect(during.settled).toBe(true);
    expect(during.objects).toBe(before.objects);
    await act(async () => { await m.bundle.land(); });
    expect(m.ctx().readObjectScope!({ packageId: PKG, names: ['b28645_plan'] }).objects).toBe(before.objects);
  });

  it('a scope read with `views: false` asks which objects there are and never reads the view list', async () => {
    const m = mount();
    const read = (names: string[]) =>
      (m.ctx().readObjectScope as unknown as (s: { packageId: string; names: string[]; views: false }) => ReturnType<NonNullable<Ctx['readObjectScope']>>)(
        { packageId: PKG, names, views: false },
      );
    // `b28645_outside` is not in the bundle, and no bundle was even entered.
    await waitFor(() => expect(read(['b28645_outside']).settled).toBe(true));
    const scope = read(['b28645_outside']);
    expect((scope.objects as Doc[]).map((o) => o.name)).toContain('b28645_outside');
    expect(scope.objects).toBe(scope.served);
    expect(lists(m.calls)).toEqual(['app', `object?package=${PKG}`]);
  });

  it('CONTROL: the whole registry reads the view list with it, and answers once both have', async () => {
    const m = mount();
    await waitFor(() => expect(m.calls).toContain('app'));
    act(() => { void m.ctx().objects; });
    expect(lists(m.calls)).toEqual(['app', 'object', 'view']);
    await waitFor(() => expect(m.ctx().getTypeStatus!('object')).toBe('ready'));
    const plan = (m.ctx().objects as Doc[]).find((o) => o.name === 'b28645_plan') as { listViews?: Record<string, unknown> };
    expect(plan.listViews?.['b28645_plan.all']).toBeDefined();
  });

  it('answers a bundled page from the bundle, the same document read after read', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    expect(m.page().state).toBe('pending');
    await act(async () => { await m.bundle.land(); });
    await waitFor(() => expect(m.page().state).toBe('hit'));
    const first = m.page();
    expect(first.state === 'hit' && first.value.label).toBe('Pricing');
    expect(m.reads().item('page', 'b28645_pricing', PKG)).toBe(first);
    expect(lists(m.calls)).toEqual(['app']);
  });

  it('a name the bundle lacks, or a same-named page another package owns, is a miss', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    await act(async () => {
      await m.bundle.land(bundleItems({ pages: [{ name: 'b28645_pricing', _packageId: 'app.other', label: 'Theirs' }] }));
    });
    await waitFor(() => expect(m.page().state).toBe('miss'));
    expect(m.reads().item('page', 'b28645_nowhere').state).toBe('miss');
    // Without an owning package the bundle's item is taken as it is.
    expect(m.reads().item('page', 'b28645_pricing').state).toBe('hit');
  });

  it('waits for an app a descendant enters in the same commit', async () => {
    const bundle = makeBundle();
    const m = mount({ bundle, enterInEffect: bundle });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(m.page().state).toBe('pending');
    await act(async () => { await bundle.land(); });
    await waitFor(() => expect(m.page().state).toBe('hit'));
  });

  it('with no app entered, reads are a miss once the commit settles', async () => {
    const m = mount();
    await waitFor(() => expect(m.page().state).toBe('miss'));
  });

  it('a host adapter without the bundle answers every read a miss', async () => {
    const m = mount({ bundle: null });
    expect(m.page().state).toBe('miss');
    expect(m.reads().viewsFor(scopeNames).state).toBe('miss');
  });

  it('bundledFirst reads the list only for a name the bundle does not hold', async () => {
    const m = mount();
    act(() => m.bundle.enter());
    let listReads = 0;
    const list = () => {
      listReads += 1;
      return [{ name: 'b28645_elsewhere', label: 'Elsewhere' }];
    };
    expect(bundledFirst(m.reads(), 'dashboard', 'b28645_home', list)).toBeUndefined();
    await act(async () => { await m.bundle.land(); });
    await waitFor(() => expect(bundledFirst(m.reads(), 'dashboard', 'b28645_home', list)?.label).toBe('Home'));
    expect(listReads).toBe(0);
    expect(bundledFirst(m.reads(), 'dashboard', 'b28645_elsewhere', list)?.label).toBe('Elsewhere');
    expect(listReads).toBe(1);
    expect(bundledFirst(null, 'dashboard', 'b28645_elsewhere', list)?.label).toBe('Elsewhere');
  });

  it('useServedViewItems(false) reads neither list', async () => {
    const calls: string[] = [];
    let served: ReturnType<typeof useServedViewItems> | null = null;
    function Probe() {
      served = useServedViewItems(false);
      return null;
    }
    render(
      <MetadataProvider adapter={makeAdapter(calls, null)}>
        <Probe />
      </MetadataProvider>,
    );
    await waitFor(() => expect(calls).toContain('app'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(lists(calls)).toEqual(['app']);
    expect(served!.views).toHaveLength(0);
    expect(served!.objects).toHaveLength(0);
  });
});
