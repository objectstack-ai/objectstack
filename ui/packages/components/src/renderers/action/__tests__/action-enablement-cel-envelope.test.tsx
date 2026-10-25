/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9107 — the RENDER-LEVEL half: what a user could actually do.
 *
 * `packages/react/src/__tests__/SchemaRenderer.enablementEnvelopeConfigBag.test.tsx`
 * pins the fix site itself. This file mounts the two renderers objectui#9107
 * names as the carriers — `action:button` and `action:icon`, the only renderers
 * declaring more than one of the three enablement keys — through the REAL
 * `SchemaRenderer`, with the predicate authored at `properties` TOP LEVEL,
 * which is the spelling the server emits and the one channel that runs through
 * the per-value config-bag loops.
 *
 * ## What was measured on the pre-fix tree
 *
 * A CEL envelope in the bag was flattened to its bare `source` before either
 * consumer saw it, so `has(…)` — which the legacy JS engine has no such
 * function for — threw, and `evaluateCondition` fell soft to `true`. That
 * `true` is UN-negated on this chain, so the button came out DISABLED whether
 * the predicate held or failed: a control the author gated on a condition was
 * dead on every row, and no predicate the author could write would re-enable
 * it. Equal verdicts either way is the signature of a gate never consulted,
 * which is why each case below asserts the PAIR and not one row.
 *
 * ## ⚠️ Why the legacy `enabled` leg is pinned one package over, not here
 *
 * `action:button` / `action:icon` compute `disabled` from `schema.enabled`
 * (`toPredicateInput` -> `useCondition` -> `!isEnabled`) BEFORE
 * `{...toFormControlDomProps(rest)}`, and `SchemaRenderer` always forwards a
 * `disabled` key — `__disabled || undefined` — which that spread re-declares
 * over the computed value. So the renderer's own verdict never reaches the DOM
 * on this mount path. Measured, and PRE-EXISTING: a plain literal
 * `enabled: false` with no envelope, no CEL and no config bag anywhere in it is
 * disabled on a direct mount and NOT disabled through `SchemaRenderer`. That is
 * objectui#7238's mechanism, left behind in these two renderers when it was
 * repaired for `ui:button`; it is a different defect from this card and is
 * filed separately, ⛔ not repaired here and ⛔ not pinned here either, because
 * pinning a defect's current value makes its repair look like a regression.
 * The `enabled` leg's own verdict is pinned in the react package, off a probe
 * that reads the key exactly as these two do and does not re-spread a stale
 * `disabled` over its own answer.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect imports so the renderers are in the registry when
// `ComponentRegistry.get` runs (the light `dom` project does not load the
// `@object-ui/components` graph), per AGENTS.md §测试纪律 — the cost lands in
// the import phase, not under a hook timeout.
import '../action-button';
import '../action-icon';
import type { DataSource } from '@object-ui/types';

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

const DATA = { status: 'draft' };

/** CEL stdlib call + a comparison. `has` does not exist on the legacy engine. */
const HOLDS = { dialect: 'cel', source: 'has(data.status) && data.status == "draft"' };
const FAILS = { dialect: 'cel', source: 'has(data.status) && data.status == "published"' };

function mountAction(type: 'action:button' | 'action:icon', properties: Record<string, unknown>) {
  return render(
    <SchemaRendererProvider dataSource={DATA as unknown as DataSource}>
      <PredicateScopeProvider scope={{ data: DATA }}>
        <SchemaRenderer
          schema={
            {
              type,
              name: 'act',
              label: 'Act',
              icon: 'check',
              actionType: 'script',
              properties,
            } as never
          }
        />
      </PredicateScopeProvider>
    </SchemaRendererProvider>,
  );
}

const control = () => screen.getByRole('button') as HTMLButtonElement;

/** Mount one key twice — holding and failing — and report whether the control was disabled. */
function pair(type: 'action:button' | 'action:icon', key: string) {
  const holds = (() => {
    mountAction(type, { [key]: HOLDS });
    const r = control().disabled;
    cleanup();
    return r;
  })();
  const fails = (() => {
    mountAction(type, { [key]: FAILS });
    const r = control().disabled;
    cleanup();
    return r;
  })();
  return { holds, fails };
}

afterEach(cleanup);

describe.each(['action:button', 'action:icon'] as const)(
  '%s — a CEL envelope authored in the `properties` bag actually gates the control',
  (type) => {
    // The `fails: false` half is what a flattened envelope could not produce:
    // on the broken tree BOTH rows came out disabled.
    it.each(['disabled', 'disabledOn'])(
      'properties.%s: the holding row is disabled, the failing row is usable',
      (key) => {
        expect(pair(type, key)).toEqual({ holds: true, fails: false });
      },
    );

    it('the control is really on screen in both rows, so "disabled" is not "never rendered"', () => {
      // Without this, a `false` verdict would be indistinguishable from a
      // renderer that returned `null` — `action:button` has a `visible` gate
      // that does exactly that.
      mountAction(type, { disabled: HOLDS });
      expect(control()).toBeInTheDocument();
      cleanup();
      mountAction(type, { disabled: FAILS });
      expect(control()).toBeInTheDocument();
    });

    it('a TEMPLATE envelope on the same key keeps its legacy `${…}` behaviour', () => {
      // The guard matches the `cel` dialect alone; this is the no-op arm at
      // render level rather than at the fix site.
      mountAction(type, { disabled: { dialect: 'template', source: '${data.status === "draft"}' } });
      expect(control().disabled).toBe(true);
      cleanup();
      mountAction(type, { disabled: { dialect: 'template', source: '${data.status === "published"}' } });
      expect(control().disabled).toBe(false);
    });
  },
);
