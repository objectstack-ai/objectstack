/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13299 — a page node whose DECLARED visibility predicate FAULTS on
 * evaluation is not rendered (fail-CLOSED), the direction objectui#13286 set
 * for a `page:tabs` item. The fault is reported once, through the shared
 * reporter, with the `'withholding'` consequence on the SHOW legs.
 *
 * Rows:
 *  (a) a throwing `visibleWhen` is not rendered, and two renders log ONE
 *      warning — in the production branch (one engine call, `onFault`) and in
 *      the development branch (`throwOnError`); that line names no navigation
 *      surface (objectui#13303);
 *  (b) every other leg with a faulting declared predicate is not rendered:
 *      `visible`, `visibleOn` (SHOW legs, negated) and `hidden`, `hiddenOn`
 *      (HIDE legs, not negated — their fail-soft `true` already hid);
 *  (c) CONTROLS — true shows, false hides, absent shows, blank (declares
 *      nothing) shows, and none of them is withheld by a fault;
 *  (d) an over-budget CEL source on a node is withheld, while the same shape
 *      under the bound evaluates and shows.
 *
 * The `page:tabs` count badge (row e) and the form field control (row f) live
 * in `@object-ui/components`, beside the renderers they read.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { RecordContextProvider } from '../context/RecordContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import {
  UNRESOLVABLE_VISIBILITY_PREFIX,
  __resetVisibilityPredicateWarnings,
} from '../utils/visibilityDiagnostic';

const NAME = 'probe-13299';
const TYPE = 'element:probe-13299';

const Probe = () => <div data-testid="probe-13299" />;

const APP_SCOPE = { current_user: { id: 'u1' }, user: { id: 'u1' }, data: {}, features: {} };
const ROW = { id: 'r1', status: 'open' };

/** An unbound root: faults on every dialect path. */
const FAULT = 'nosuchroot13299.x > 1';
/** The spec's normalized wire shape (ADR-0089 D2). */
const cel = (source: string) => ({ dialect: 'cel', source });
/** `n` OR-ed literal comparisons — about four AST nodes per term. */
const orChain = (n: number) => Array.from({ length: n }, (_, i) => `${i} == ${i}`).join(' || ');

/** The line the shared reporter prints for the fail-closed SHOW legs. */
const WITHHELD = 'WITHHELD';

/**
 * The navigation surface's nouns. The `'withholding'` copy was written for the
 * app-shell navigation gate and told a page-node author that "a navigation
 * entry" was withheld (objectui#13303); a page node's line names neither.
 */
const NAVIGATION_SURFACE = /navigation|\bentry\b/i;

type WarnSpy = { mock: { calls: unknown[][] } };
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));

const shownCount = () => screen.queryAllByTestId('probe-13299').length;

type Mount = (schemas: Record<string, unknown>[]) => ReturnType<typeof render>;

function tree(
  R: typeof SchemaRenderer,
  Ctx: typeof SchemaRendererContext,
  Rec: typeof RecordContextProvider,
  Scope: typeof PredicateScopeProvider,
  schemas: Record<string, unknown>[],
) {
  return (
    <Scope scope={APP_SCOPE}>
      <Ctx.Provider value={{ dataSource: {} } as never}>
        <Rec objectName="showcase_task" recordId={ROW.id} data={ROW}>
          {schemas.map((s, i) => (
            <R key={i} schema={{ type: TYPE, ...s } as never} />
          ))}
        </Rec>
      </Ctx.Provider>
    </Scope>
  );
}

/** The development module graph this file imports statically. */
async function inDevelopment(fn: (mount: Mount, rerender: (schemas: Record<string, unknown>[]) => void) => void | Promise<void>) {
  __resetVisibilityPredicateWarnings();
  ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
  try {
    let last: ReturnType<typeof render> | undefined;
    const mount: Mount = (schemas) => {
      last = render(tree(SchemaRenderer, SchemaRendererContext, RecordContextProvider, PredicateScopeProvider, schemas));
      return last;
    };
    await fn(mount, (schemas) =>
      last!.rerender(tree(SchemaRenderer, SchemaRendererContext, RecordContextProvider, PredicateScopeProvider, schemas)),
    );
  } finally {
    cleanup();
    ComponentRegistry.unregister?.(NAME, 'element');
  }
}

/**
 * A PRODUCTION module graph: `__DEV__` is an IIFE evaluated at module load, so
 * the env is stubbed before a fresh import (objectui#6038's harness). The
 * dedupe `Set` is reset on that same fresh graph.
 */
async function inProduction(fn: (mount: Mount, rerender: (schemas: Record<string, unknown>[]) => void) => void | Promise<void>) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  try {
    const [core, prod, ctx, rec, expr, diag] = await Promise.all([
      import('@object-ui/core'),
      import('../SchemaRenderer'),
      import('../context/SchemaRendererContext'),
      import('../context/RecordContext'),
      import('../hooks/useExpression'),
      import('../utils/visibilityDiagnostic'),
    ]);
    diag.__resetVisibilityPredicateWarnings();
    core.ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
    let last: ReturnType<typeof render> | undefined;
    const build = (schemas: Record<string, unknown>[]) =>
      tree(
        prod.SchemaRenderer,
        ctx.SchemaRendererContext,
        rec.RecordContextProvider,
        expr.PredicateScopeProvider,
        schemas,
      );
    const mount: Mount = (schemas) => {
      last = render(build(schemas));
      return last;
    };
    await fn(mount, (schemas) => last!.rerender(build(schemas)));
    core.ComponentRegistry.unregister?.(NAME, 'element');
  } finally {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

const BUILDS = [
  ['production', inProduction],
  ['development', inDevelopment],
] as const;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#13299 (a) — a faulting `visibleWhen` withholds its node, reported once', () => {
  it.each(BUILDS)('%s: not rendered, and two renders log ONE warning', async (_build, run) => {
    await run((mount, rerender) => {
      const warn = spyWarn();
      mount([{ id: 'ungated' }, { id: 'gated', visibleWhen: FAULT }]);
      expect(shownCount()).toBe(1);

      // A FRESH schema object: the dedupe is per authored source, not per
      // schema identity.
      rerender([{ id: 'ungated' }, { id: 'gated', visibleWhen: FAULT }]);
      expect(shownCount()).toBe(1);

      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(TYPE);
      expect(lines[0]).toContain('visibleWhen');
      expect(lines[0]).toContain(FAULT);
      expect(lines[0]).toContain(WITHHELD);
      expect(lines[0]).not.toMatch(NAVIGATION_SURFACE);
    });
  });
});

describe('objectui#13299 (b) — every other leg with a faulting declared predicate is not rendered', () => {
  const LEGS = [
    ['visible', WITHHELD],
    ['visibleOn', WITHHELD],
    ['hidden', 'REMOVED the node'],
    ['hiddenOn', 'REMOVED the node'],
  ] as const;
  for (const [build, run] of BUILDS) {
    it.each(LEGS)(`${build}: \`%s\` faulting withholds the node`, async (key, consequence) => {
      await run((mount) => {
        const warn = spyWarn();
        mount([{ id: 'ungated' }, { id: 'gated', [key]: FAULT }]);
        expect(shownCount()).toBe(1);
        const lines = reports(warn);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`${key}: `);
        expect(lines[0]).toContain(consequence);
      });
    });
  }

  it.each(BUILDS)('%s: a faulting CEL envelope on `visibleWhen` withholds the node', async (_build, run) => {
    await run((mount) => {
      spyWarn();
      mount([{ id: 'ungated' }, { id: 'gated', visibleWhen: cel('record.status ==') }]);
      expect(shownCount()).toBe(1);
    });
  });
});

describe('objectui#13299 (c) — CONTROLS: a predicate that evaluates decides as before', () => {
  it.each(BUILDS)('%s: true shows, false hides, absent shows, blank shows — none is withheld', async (_build, run) => {
    await run((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'absent' },
        { id: 'yes', visibleWhen: cel("record.status == 'open'") },
        { id: 'no', visibleWhen: cel("record.status == 'closed'") },
        { id: 'blank', visibleWhen: '' },
        { id: 'blank-env', visibleWhen: cel('') },
      ]);
      // absent + yes + blank + blank-env.
      expect(shownCount()).toBe(4);
      expect(reports(warn).some((l) => l.includes(WITHHELD))).toBe(false);
    });
  });
});

describe('objectui#13299 (d) — an over-budget source on a node is withheld', () => {
  it.each(BUILDS)('%s: beyond the AST bound is withheld; the same shape under the bound shows', async (build, run) => {
    await run((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'small', visibleWhen: cel(orChain(4)) },
        { id: 'huge', visibleWhen: cel(orChain(120)) },
      ]);
      expect(shownCount()).toBe(1);
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(WITHHELD);
      // The engine's `[bounds]` reason reaches the line through `onFault`, the
      // production branch. The development branch's `throwOnError` probe
      // reports its own generic CEL reason for the same fault.
      if (build === 'production') expect(lines[0]).toContain('[bounds]');
    });
  });
});
