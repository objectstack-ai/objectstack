/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9308 — the data-source ADAPTER stops being an expression root, and
 * `bind` starts resolving the scope channel instead.
 *
 * Maintainer ruling, 2026-09-13, option B, in two halves:
 *
 *   b1. `data: dataSource` leaves the evaluator scope `SchemaRenderer` builds.
 *       `data` is no longer a root this tier binds.
 *   b2. `useDataScope` stops walking `context.dataSource` and reads
 *       `usePredicateScope()` — the ambient scope a host publishes through
 *       `PredicateScopeProvider`, which app-shell's `ExpressionProvider`
 *       already feeds.
 *
 * ## Why this is not a new direction
 *
 * `ExpressionProvider` states the governing principle for the tier above:
 * "Every root below is one the engine accepts AND one this tier can actually
 * answer". objectui#8155 unbound `app` under it and objectui#8166 unbound
 * `data`. Against a conformant `DataSource` adapter every `data.*` path already
 * resolved `undefined`, so the renderer tier could not answer the root it
 * bound. This file applies the same principle one tier down.
 *
 * ## The legs, and what each one would have to break to go green wrongly
 *
 * Legs 1 and 2 are a PAIR on one coordinate: the injected object is the same
 * bag in both, and only the CHANNEL it arrives through moves. An
 * implementation that simply stopped resolving expressions would pass leg 1
 * and fail leg 2; one that kept the adapter bound would fail leg 1 and pass
 * leg 2. Neither can pass both.
 *
 * Leg 3 is the shadowing the ruling's own appendix named: `...predicateScope`
 * was spread BEFORE `data: dataSource`, so a host that legitimately published
 * `data` through the documented scope channel was silently overwritten by the
 * adapter. b1 removes the overwrite, and this leg is the only place that says
 * so.
 *
 * Legs 4-6 are the same coordinate pair for `useDataScope`, plus its own lit
 * control (a hook that returned `undefined` unconditionally would pass leg 5
 * and fail legs 4 and 6).
 *
 * Leg 7 records a VERDICT MOVE, measured rather than assumed. `data` was a key
 * whose value happened to be undefined-at-every-path; it is now ABSENT. The
 * engine distinguishes the two: `data.status == 'draft'` against
 * `{ data: undefined }` is a clean `false`, and against a scope with no `data`
 * key at all it THROWS `data is not defined` — which `evaluateCondition`
 * answers fail-soft with `true`. So a node whose `visible` gate read `data.*`
 * was hidden on every row before this card and is SHOWN on every row after it,
 * and the objectui#5454 reporter — which is the loud one, and the true one —
 * names it. That is the breaking half of this change, and it is pinned here
 * rather than discovered in a console.
 *
 * Module-scope imports, never `beforeAll` (AGENTS.md 测试纪律): registering a
 * renderer is an unbounded module load and must not be billed to a bounded
 * hook timeout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import {
  __resetVisibilityPredicateWarnings,
  UNRESOLVABLE_VISIBILITY_PREFIX,
} from '../utils/visibilityDiagnostic';
import {
  SchemaRendererProvider,
  useDataScope,
} from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import type { DataSource } from '@object-ui/types';

const NAME = 'probe-9308';
const TYPE = 'element:probe-9308';

const Probe = (props: { content?: unknown }) => (
  <div data-testid="probe" data-content={props.content === undefined ? 'absent' : String(props.content)} />
);

/**
 * ONE bag, injected through two different channels by legs 1 and 2.
 *
 * It is deliberately NOT an adapter: crossing `DataSource` with an explicit
 * cast is what makes leg 1 a measurement of the SEAM rather than of a type.
 * A host that puts a bag here is the population this card breaks, and leg 1 is
 * the pin that says it breaks.
 */
const BAG = { stats: { total: 99 } };

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const linesWith = (warn: { mock: { calls: unknown[][] } }, prefix: string): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(prefix));

beforeEach(() => {
  ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
  __resetVisibilityPredicateWarnings();
});
afterEach(() => {
  cleanup();
  ComponentRegistry.unregister?.(NAME, 'element');
  vi.restoreAllMocks();
});

/** Render one node under the ADAPTER seam only. */
function underAdapter(content: string) {
  return render(
    <SchemaRendererProvider dataSource={BAG as unknown as DataSource}>
      <SchemaRenderer schema={{ type: TYPE, props: { content } } as never} />
    </SchemaRendererProvider>,
  );
}

/** Render one node under the SCOPE channel only. */
function underScope(content: string, scope: Record<string, unknown> = BAG) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={{ type: TYPE, props: { content } } as never} />
    </PredicateScopeProvider>,
  );
}

const contentOf = () => screen.getByTestId('probe').getAttribute('data-content');

describe('objectui#9308 b1 — the adapter is not an expression root', () => {
  it('leg 1: `${data.stats.total}` against an injected bag does NOT resolve', () => {
    underAdapter('${data.stats.total}');
    // Unresolvable: the evaluator hands back its own SOURCE TEXT, which is the
    // failure an author can actually see. `99` here would mean the adapter is
    // still bound as `data`.
    expect(contentOf()).toBe('${data.stats.total}');
  });

  it('leg 2: the SAME bag through the scope channel resolves under its own name', () => {
    underScope('${stats.total}');
    expect(contentOf()).toBe('99');
  });

  it('leg 3: a host-published `data` is no longer shadowed by the adapter', () => {
    // Both channels carry a `data`, and they disagree. Before this card the
    // adapter's spread came LAST and won; the documented scope channel must.
    render(
      <PredicateScopeProvider scope={{ data: { stats: { total: 7 } } }}>
        <SchemaRendererProvider dataSource={BAG as unknown as DataSource}>
          <SchemaRenderer schema={{ type: TYPE, props: { content: '${data.stats.total}' } } as never} />
        </SchemaRendererProvider>
      </PredicateScopeProvider>,
    );
    expect(contentOf()).toBe('7');
  });
});

describe('objectui#9308 b2 — `useDataScope` reads the scope channel', () => {
  it('leg 4: a path resolves against the ambient scope', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PredicateScopeProvider scope={BAG}>{children}</PredicateScopeProvider>
    );
    const { result } = renderHook(() => useDataScope('stats.total'), { wrapper });
    expect(result.current).toBe(99);
  });

  it('leg 5: the same path against the ADAPTER seam resolves to nothing', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SchemaRendererProvider dataSource={BAG as unknown as DataSource}>{children}</SchemaRendererProvider>
    );
    const { result } = renderHook(() => useDataScope('stats.total'), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it('leg 6: lit control — no path still means no value, scope or not', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PredicateScopeProvider scope={BAG}>{children}</PredicateScopeProvider>
    );
    expect(renderHook(() => useDataScope(undefined), { wrapper }).result.current).toBeUndefined();
    expect(renderHook(() => useDataScope(''), { wrapper }).result.current).toBeUndefined();
  });
});

describe('objectui#9308 — the verdict this card MOVES, stated as a pin', () => {
  it('leg 7: a `data.*` visibility gate becomes unresolvable — withheld, and LOUD', () => {
    const warn = spyWarn();
    render(
      <SchemaRendererProvider dataSource={BAG as unknown as DataSource}>
        <SchemaRenderer schema={{ type: TYPE, visible: "data.status == 'draft'" } as never} />
      </SchemaRendererProvider>,
    );
    // Fail-CLOSED since objectui#13299: a declared visibility predicate that
    // cannot be evaluated withholds its node. (Before this card the same gate
    // was a clean constant `false`; between this card and objectui#13299 the
    // evaluator's fail-soft `true` drew it.)
    expect(screen.queryByTestId('probe')).toBeNull();
    // …and it is not silent. objectui#5454's reporter is the one that is TRUE
    // about this predicate now: it cannot be evaluated at all.
    expect(linesWith(warn, UNRESOLVABLE_VISIBILITY_PREFIX).length).toBeGreaterThan(0);
  });
});
