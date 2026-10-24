/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10036 — the record fetch may not re-fire because React threw a
 * memo cache away.
 *
 * Two banned identities sat on the same seam (AGENTS.md §5 commandment #10,
 * ruled on objectui#8640 over eight prior instances):
 *
 *   1. `reload`'s dependency list named `effectiveDataSource`, a `useMemo`
 *      result. `resolveDataSource` returns the context adapter UNCHANGED for
 *      `provider: 'object'`, but CONSTRUCTS a new `ValueDataSource` for
 *      `provider: 'value'` (and, until objectui#12325 retired that arm, a new
 *      `ApiDataSource` for `'api'`) — so there a discarded memo hands back a
 *      fresh adapter for a byte-identical config, and `reload` is rebuilt for
 *      no authored reason.
 *   2. The mount effect named `reload`, a `useCallback` result — and a
 *      discarded `useCallback` yields a fresh function whatever its own
 *      dependency list says, INCLUDING an empty one. So fixing (1) alone
 *      cannot be observed and does not close the defect: both sides of the
 *      seam, or neither holds.
 *
 * The file already recorded half of this in the first person: `dataItems` was
 * removed from `reload`'s dependency list precisely because a discard «was
 * enough to give `reload` a fresh identity and re-fire the mount effect below
 * (objectui#6592)». One banned identity came off that line; another stayed.
 *
 * ⚠️ WHY THIS PIN FORCES A DISCARD, AND WHAT IT WOULD BE WITHOUT ONE.
 * Commandment #10 states the blind spot itself: React does not discard
 * spontaneously in this tree (measured on the pinned React 19.2.8 while
 * objectui#6724 landed, and this repo still has no `Activity`/Offscreen
 * subtree), so an ordinary render-count or request-count pin here is GREEN on
 * the defect AND on the fix and therefore asserts nothing. The discriminating
 * input is a FORCED discard. The proxy below is the one
 * `packages/permissions/src/__tests__/providerCtxIdentity.discarded.test.tsx`
 * uses (objectui#6813 / #6862), for the same reasons it records: it patches
 * `useMemo` AND `useCallback` at the MODULE level, because the component
 * reaches them through its own `import { … } from 'react'` bindings and
 * `vi.spyOn`/assignment/`defineProperty` on the frozen `[object Module]`
 * namespace all fail to patch those — silently leaving any pin built on them
 * unfalsifiable. It arms EVERY memo and callback in the tree rather than ones
 * matched by a marker dependency: a marker on `effectiveDataSource` alone
 * would leave `reload`'s own `useCallback` un-discarded, which is exactly the
 * half of the seam (2) names.
 *
 * ⚠️ THE OBSERVABLE IS A READ COUNT, NOT AN IDENTITY COMPARE. An identity
 * comparison can hold while the effect re-runs for some other reason. Reads
 * are counted on `ValueDataSource.prototype.find`, which every adapter the
 * memo constructs shares, so a fresh adapter is counted like the first one.
 *
 * ⚠️ THE PROVIDER IS `'value'` ON PURPOSE. `ObjectGantt.discardedConfigMemo.test.tsx`
 * records why an `object`-provider pin cannot see this: `resolveDataSource`
 * answers that provider with the `fallback` context DataSource UNCHANGED, so
 * `effectiveDataSource`'s VALUE is referentially stable there even when its
 * memo reruns. That file names the gap it leaves as a "Known boundary" for the
 * constructing providers. This is that boundary, measured. It was measured on
 * the `'api'` provider until the view-level `api` data source was retired in
 * `@objectstack/spec` (objectstack#23082, objectui#12325); `'value'` is the
 * constructing provider that remains.
 */

import React from 'react';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ValueDataSource } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from './ObjectGantt';

const memoProxy = vi.hoisted(() => ({ armed: false, epoch: 0 }));

vi.mock('react', async (importOriginal) => {
  // `<any>` matches the sibling pins (objectui#6697 / #6724 / #6813) and is
  // load-bearing: a precise module type makes the real hooks' deps parameter
  // `DependencyList`, which the patched signatures below cannot satisfy.
  const actual = await importOriginal<any>();
  const realUseMemo = actual.useMemo;
  const realUseCallback = actual.useCallback;
  const patchedUseMemo = (factory: () => unknown, deps?: unknown[]) =>
    memoProxy.armed && Array.isArray(deps)
      ? realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  const patchedUseCallback = (fn: unknown, deps?: unknown[]) =>
    memoProxy.armed && Array.isArray(deps)
      ? realUseCallback(fn, [...deps, memoProxy.epoch])
      : realUseCallback(fn, deps);
  return {
    ...actual,
    useMemo: patchedUseMemo,
    useCallback: patchedUseCallback,
    default: {
      ...(actual.default ?? actual),
      useMemo: patchedUseMemo,
      useCallback: patchedUseCallback,
    },
  };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid={`gv-task-${t.id}`}>{t.title}</div>
      ))}
    </div>
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

/** Put EVERY memo and callback in the tree under this file's control. */
function armDiscardProxy(): () => void {
  memoProxy.armed = true;
  return () => {
    memoProxy.armed = false;
  };
}
/** Throw away every armed cache — one discard event, on demand. */
function discardNow(): void {
  memoProxy.epoch += 1;
}

afterEach(() => {
  cleanup();
  memoProxy.armed = false;
});

const ROWS = [
  { id: '1', name: 'Task A', start_date: '2024-01-01', end_date: '2024-01-05', progress: 50 },
];

const GANTT = { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' };

/**
 * ⛔ Deliberately NO `objectName`. `resolveRecordSourceObjectName` answers
 * `schema.objectName` for every non-`object` provider, so naming one here would
 * give `useSettledSchema` a key to read and put a SECOND read into the numbers
 * below. With no key that hook settles immediately with `def: null` on every
 * render, so `objectSchemaReady` / `objectSchema` are constants here and the
 * record read is the only thing being counted.
 */
function valueSchema(items: unknown[] = ROWS, extra: Record<string, unknown> = {}): any {
  return {
    type: 'gantt',
    gantt: GANTT,
    data: { provider: 'value', items },
    ...extra,
  };
}

/**
 * Count every `find` any `ValueDataSource` serves, recording the first row's
 * id so a read of NEW items is distinguishable from a re-read of the old ones.
 */
function countValueReads(log: string[]) {
  const real = ValueDataSource.prototype.find;
  return vi.spyOn(ValueDataSource.prototype, 'find').mockImplementation(async function (
    this: ValueDataSource,
    ...args: Parameters<typeof real>
  ) {
    const result = await real.apply(this, args);
    log.push(`read ${String((result.data?.[0] as any)?.id ?? '-')}`);
    return result;
  });
}

/**
 * Give a re-fired effect a real turn to issue its read. Asserting the
 * ABSENCE of a read needs a settle window; `waitFor` cannot express one.
 */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('the discard proxy really reaches the bindings ObjectGantt uses (objectui#10036)', () => {
  it('provesTheProxyDiscriminates: an armed memo AND an armed callback are both discarded', () => {
    const memos: unknown[] = [];
    const callbacks: unknown[] = [];
    const Probe: React.FC = () => {
      memos.push(React.useMemo(() => ({}), []));
      callbacks.push(React.useCallback(() => {}, []));
      return null;
    };

    const restore = armDiscardProxy();
    try {
      const { rerender } = render(<Probe />);
      // Armed but not fired: ordinary caching still holds, so a green in the
      // pins below cannot come from the proxy breaking caching outright.
      rerender(<Probe />);
      expect(memos[1]).toBe(memos[0]);
      expect(callbacks[1]).toBe(callbacks[0]);

      discardNow();
      rerender(<Probe />);
    } finally {
      restore();
    }
    expect(memos[2]).not.toBe(memos[1]);
    expect(callbacks[2]).not.toBe(callbacks[1]);
  });
});

describe("ObjectGantt provider:'value' — the record read survives a discarded cache (objectui#10036)", () => {
  let readSpy: ReturnType<typeof countValueReads> | undefined;
  afterEach(() => {
    readSpy?.mockRestore();
    readSpy = undefined;
  });

  it('costs no redundant read when a discard rebuilds the adapter and the callback, config unchanged', async () => {
    const log: string[] = [];
    readSpy = countValueReads(log);
    const schema = valueSchema();
    const tree = () => <ObjectGantt schema={schema} />;

    const restore = armDiscardProxy();
    let mounted: number;
    try {
      const { rerender } = render(tree());
      await waitFor(() => expect(log.length).toBeGreaterThan(0));
      await settle();
      // The baseline is MEASURED, not assumed: an inline-provider gantt reads
      // its items more than once while it mounts, for a reason outside this
      // card (see the PR body of objectui#12325). What this pin owns is that
      // nothing after the mount adds a read.
      mounted = log.length;

      // Armed but NOT fired: an ordinary re-render must not re-read either.
      rerender(tree());
      await settle();
      expect(log).toHaveLength(mounted);

      // Two discards, each followed by a re-render with the SAME authored
      // config and the SAME (absent) context adapter. Nothing an author or a
      // host controls has changed.
      discardNow();
      rerender(tree());
      await settle();
      discardNow();
      rerender(tree());
      await settle();
    } finally {
      restore();
    }

    // THE observable this card names: a read count, not an identity compare.
    expect(log).toHaveLength(mounted);
  });

  /**
   * The non-regression axis, taken from the plausible WRONG fix rather than
   * from the defect's shape: dropping the dependency altogether would also
   * stop the redundant read — and would stop every LEGITIMATE re-read with
   * it. These pins fail on such a fix. Together with the `object`-provider
   * block below they cover the authored config and the host's adapter, which
   * is the parity claim: the fix removes React's licence to re-fire and
   * narrows nothing else. (`resource`, `dataProvider`, `hasInlineData` are all
   * DERIVED from the authored config the two pins here move; `objectSchema`
   * and `perms` are unchanged members of the same list.)
   */
  it('still re-reads when the authored items genuinely change', async () => {
    const log: string[] = [];
    readSpy = countValueReads(log);
    const tree = (schema: any) => <ObjectGantt schema={schema} />;
    const NEXT = [{ ...ROWS[0], id: '2', name: 'Task B' }];

    const { rerender } = render(tree(valueSchema(ROWS)));
    await waitFor(() => expect(log.length).toBeGreaterThan(0));
    await settle();
    const mounted = log.length;
    expect(log.every((e) => e === 'read 1')).toBe(true);

    rerender(tree(valueSchema(NEXT)));
    await waitFor(() => expect(log.length).toBeGreaterThan(mounted));
    await settle();
    // Not merely "a read happened": the NEW items are what was read.
    expect(log.slice(mounted).every((e) => e === 'read 2')).toBe(true);
  });

  it('still re-reads when the authored filter genuinely changes', async () => {
    const log: string[] = [];
    readSpy = countValueReads(log);
    const tree = (schema: any) => <ObjectGantt schema={schema} />;

    const { rerender } = render(tree(valueSchema(ROWS, { filter: [['name', '=', 'Task A']] })));
    await waitFor(() => expect(log.length).toBeGreaterThan(0));
    await settle();
    const mounted = log.length;
    expect(log.every((e) => e === 'read 1')).toBe(true);

    rerender(tree(valueSchema(ROWS, { filter: [['name', '!=', 'Task A']] })));
    await waitFor(() => expect(log.length).toBeGreaterThan(mounted));
    await settle();
    // The new filter excludes the only row, so the re-read answers nothing.
    expect(log.slice(mounted).every((e) => e === 'read -')).toBe(true);
  });
});

describe("ObjectGantt provider:'object' — the host adapter is still a refetch trigger (objectui#10036)", () => {
  function makeDataSource(tag: string, log: string[]): DataSource {
    return {
      find: vi.fn(async (resource: string) => {
        log.push(`${tag} ${resource}`);
        return { data: ROWS };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ fields: { name: { type: 'text' } } }),
    } as any;
  }

  it('still refetches when the context adapter is swapped for a different one', async () => {
    const log: string[] = [];
    const dsA = makeDataSource('A', log);
    const dsB = makeDataSource('B', log);
    const schema: any = { type: 'gantt', gantt: GANTT, data: { provider: 'object', object: 'tasks' } };
    const tree = (ds: DataSource) => <ObjectGantt schema={schema} dataSource={ds} />;

    const { rerender } = render(tree(dsA));
    await waitFor(() => expect(log).toHaveLength(1));

    rerender(tree(dsB));
    // Not merely "a read happened": the NEW adapter must be the one that runs.
    await waitFor(() => expect(log).toContain('B tasks'));
    await settle();
    expect(log[0]).toBe('A tasks');
    expect(log.slice(1).every((e) => e === 'B tasks')).toBe(true);
    // ⛔ The exact length is deliberately NOT pinned. An adapter swap on this
    // provider costs MORE than one read, and for a reason outside this card's
    // file: `useSettledSchema` re-reads `getObjectSchema` through the new
    // adapter and settles a FRESH definition object for a byte-identical
    // answer, so `objectSchema` — a genuine member of the fetch effect's value
    // list — moves and the record query runs again. Pinning the number here
    // would make this file go red on the day that is repaired. See the PR body.
  });
});
