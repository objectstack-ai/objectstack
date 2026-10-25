/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7530 -- the CEL envelope object is DECLARED on `visible` / `hidden`
 * / `disabled` (maintainer ruling 2026-09-04, option A), and it renders
 * IDENTICALLY to the string form the same keys already declared.
 *
 * ## What "identically" means here, and how it is measured
 *
 * The three keys reach the evaluator by two routes. `visible` is consulted the
 * moment it is `!== undefined` and handed to `evaluateVisibilityPredicate`;
 * `hidden` and `disabled` first ask core's one definition of "declared"
 * (`hasDeclaredPredicate`) and then evaluate. Both routes end in
 * `ExpressionEvaluator.evaluateCondition`, which routes a `{ dialect: 'cel' }`
 * envelope to the canonical `@objectstack/formula` engine and unwraps any other
 * envelope onto the legacy `${...}` path. So ONE predicate written three ways
 * must reach ONE verdict on each key:
 *
 *   - the `${...}` template string (the form #4581 / #7455 declared);
 *   - `{ dialect: 'cel', source }` over the CEL spelling of the same predicate;
 *   - `{ source }` -- an envelope WITHOUT a dialect, over the template spelling,
 *     which the normalizer unwraps onto the legacy path (`dialect` is optional
 *     on the wire, exactly as `ExpressionWire` declares it).
 *
 * Each key is measured in BOTH polarities, so a faulting CEL read cannot pass
 * as identity: the evaluator's fail-soft default is `true`, which on `hidden`
 * hides both cases, on `visible` shows both, on `disabled` disables both -- and
 * each pair below has one case a constant verdict fails.
 *
 * ## No casts
 *
 * Every schema below is typed `BaseSchema`, through a helper that takes
 * nothing wider. `tsc -p tsconfig.test.json` (chained from this package's
 * `type-check` script) is the checker that sees the declaration; vitest erases
 * it before a single case runs. Narrowing any of the three keys back to
 * `boolean | string` makes the envelope call sites below TS2322.
 *
 * ## What each case detects
 *
 *   - a spelling that reaches a DIFFERENT verdict from its siblings -- the
 *     defect this file exists to keep out (a per-key branch in the shared
 *     evaluator, option B, would show up here first);
 *   - the envelope silently falling to "no gate" on one key -- the `holds`
 *     polarity catches it on `visible` (would render) and `disabled` (would
 *     forward nothing), the `fails` polarity on `hidden` (would hide);
 *   - `dialect` becoming required somewhere on the path -- the dialect-less
 *     rows go red on all three keys at once.
 *
 * The validate-accepts half of the same ruling lives in
 * `packages/types/src/__tests__/base-schema-predicate-envelope-7530.test.ts`,
 * beside the zod mirror it pins.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { BaseSchema, DataSource, ExpressionWire } from '@object-ui/types';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

/**
 * This file's registered probe, declared to `@object-ui/types` the way an
 * application declares a type it registers (objectui#11466): a node slot and
 * the `schema` prop take the declared node types only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'probe-7530': BaseSchema;
  }
}

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

/**
 * Records the `disabled` prop exactly as it arrives, so "the node rendered" and
 * "the renderer forwarded `disabled`" are separate observations.
 */
const Probe = (props: { disabled?: unknown }) => (
  <div
    data-testid="probe"
    data-disabled-prop={props.disabled === undefined ? 'absent' : String(props.disabled)}
  />
);

const DATA = { status: 'draft', published: false };

/** The DECLARED path -- `BaseSchema`, nothing wider, no cast. */
function mount(schema: BaseSchema & { type: 'probe-7530' }) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRendererContext.Provider value={{ dataSource: DATA as unknown as DataSource }}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
  );
}

function visibility(): 'rendered' | 'not rendered' {
  return screen.queryByTestId('probe') !== null ? 'rendered' : 'not rendered';
}

/** The forwarded prop, or `null` when the node did not render at all. */
function disabledProp(): string | null {
  const el = screen.queryByTestId('probe');
  return el ? el.getAttribute('data-disabled-prop') : null;
}

/**
 * One predicate, three spellings. `holds` is TRUE against `DATA`
 * (`status === 'draft'`); `fails` is FALSE (`published`).
 */
const SPELLINGS: Array<{ label: string; holds: ExpressionWire; fails: ExpressionWire }> = [
  {
    label: '`${...}` template string (the form already declared)',
    holds: '${data.status === "draft"}',
    fails: '${data.published}',
  },
  {
    label: "{ dialect: 'cel', source } -- the canonical engine",
    holds: { dialect: 'cel', source: 'data.status == "draft"' },
    fails: { dialect: 'cel', source: 'data.published' },
  },
  {
    label: '{ source } -- no dialect, unwrapped onto the legacy path',
    holds: { source: '${data.status === "draft"}' },
    fails: { source: '${data.published}' },
  },
];

describe('the CEL envelope renders identically to the string form on all three keys (objectui#7530)', () => {
  beforeEach(() => {
    ComponentRegistry.register('probe-7530', Probe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('probe-7530');
  });

  describe.each(SPELLINGS)('$label', ({ holds, fails }) => {
    it('visible: a holding predicate renders, a failing one does not', () => {
      const { unmount } = mount({ type: 'probe-7530', visible: holds });
      expect(visibility()).toBe('rendered');
      unmount();
      mount({ type: 'probe-7530', visible: fails });
      expect(visibility()).toBe('not rendered');
    });

    it('hidden: a holding predicate hides, a failing one renders', () => {
      const { unmount } = mount({ type: 'probe-7530', hidden: holds });
      expect(visibility()).toBe('not rendered');
      unmount();
      mount({ type: 'probe-7530', hidden: fails });
      expect(visibility()).toBe('rendered');
    });

    it('disabled: a holding predicate forwards `disabled`, a failing one forwards nothing', () => {
      const { unmount } = mount({ type: 'probe-7530', disabled: holds });
      expect(disabledProp()).toBe('true');
      unmount();
      mount({ type: 'probe-7530', disabled: fails });
      expect(disabledProp()).toBe('absent');
    });
  });

  it('the three spellings reach ONE verdict per key and polarity -- measured side by side', () => {
    const verdicts: Record<string, Set<string>> = {};
    const record = (bucket: string, verdict: string) => {
      (verdicts[bucket] ??= new Set()).add(verdict);
    };
    for (const { holds, fails } of SPELLINGS) {
      for (const [polarity, predicate] of [['holds', holds], ['fails', fails]] as const) {
        let view = mount({ type: 'probe-7530', visible: predicate });
        record(`visible/${polarity}`, visibility());
        view.unmount();
        view = mount({ type: 'probe-7530', hidden: predicate });
        record(`hidden/${polarity}`, visibility());
        view.unmount();
        view = mount({ type: 'probe-7530', disabled: predicate });
        record(`disabled/${polarity}`, String(disabledProp()));
        view.unmount();
      }
    }
    // Six buckets, one verdict each -- and the verdicts differ BETWEEN
    // polarities, so this is not three spellings agreeing on a constant.
    expect(Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, [...v]]))).toEqual({
      'visible/holds': ['rendered'],
      'visible/fails': ['not rendered'],
      'hidden/holds': ['not rendered'],
      'hidden/fails': ['rendered'],
      'disabled/holds': ['true'],
      'disabled/fails': ['absent'],
    });
  });
});
