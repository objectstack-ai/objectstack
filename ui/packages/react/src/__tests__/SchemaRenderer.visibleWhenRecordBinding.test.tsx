/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5454 — the node-level visibility chain, after the 2026-08-21 ruling.
 *
 * Three legs landed together, and each one is pinned here with the polarity
 * pair that makes it a verdict rather than an inability:
 *
 *   1. `record` is BOUND. `@objectstack/spec` has always declared that a page
 *      component's `visibleWhen` binds it (`ui/page.zod.ts`: *"Binds `record`,
 *      `current_user`, `page.<var>`"*), and the evaluator bound no `record` at
 *      all. A `record.*` predicate could not resolve; the surface is fail-soft,
 *      so it resolved to SHOWN — on both polarities of the same predicate, which
 *      is a gate that does not gate.
 *
 *   2. `visibleWhen` OUTRANKS `visible`. The memo hoists `properties.*` onto the
 *      node, so a node carrying `properties.visible` short-circuited the
 *      declared node predicate before it was ever consulted.
 *
 *   3. An unresolvable predicate is LOUD. Fail-soft answers "broken" and "yes"
 *      with the same word, so the author of a typo saw a rendered block and no
 *      signal.
 *
 * ## Every "hidden" here is paired
 *
 * `SchemaRenderer` has several other paths to rendering nothing (an unregistered
 * type, a primitive schema, the error boundary). So no case below reads a bare
 * "nothing rendered" as "the gate said no": each hidden verdict sits beside a
 * mount of the SAME schema that DOES render, differing only in the value under
 * test. A mutation that simply stops rendering fails the pair, not just the case.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Removing the `record` binding from the evaluator turns RED exactly the
 * polarity pairs in group 1 — and turns them red in the SHOWN direction (the
 * `false` half starts rendering), because fail-soft resolves to shown. It leaves
 * every group-2 and group-3 case green. Restoring `visible` above `visibleWhen`
 * turns RED only group 2. Deleting the `catch` diagnostic turns RED only group 3,
 * and leaves every verdict in groups 1 and 2 untouched — which is the point of
 * leg 3: it moved the silence, not the answer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { __resetVisibilityPredicateWarnings, UNRESOLVABLE_VISIBILITY_PREFIX } from '../utils/visibilityDiagnostic';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { RecordContextProvider } from '../context/RecordContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

const NAME = 'probe-5454';
const TYPE = 'element:probe-5454';

/**
 * Also records `content` so the `data` binding can be observed on the SAME
 * render as a visibility verdict — group 1c needs both in one mount.
 */
const Probe = (props: { content?: unknown }) => (
  <div data-testid="probe" data-content={props.content === undefined ? 'absent' : String(props.content)} />
);

/**
 * The data-source ADAPTER, which is what `SchemaRendererContext` carries and
 * what `${data.*}` resolves against. Deliberately NOT the row: the two are
 * different objects in production and this file pins that they stay so.
 */
const ADAPTER = { total: 99 };

const IN_REVIEW = { id: 'r1', status: 'in_review' };
const DONE = { id: 'r1', status: 'done' };

const cel = (source: string) => ({ dialect: 'cel', source });

/**
 * A host scope. ⚠️ NOT what app-shell's `ExpressionProvider` mounts — the
 * comment that said so was stale: `buildExpressionScope` has published no
 * `data` since objectui#8166, and since objectui#9308 the renderer publishes
 * none either. The empty `data` here is a deliberate HOST publication.
 */
const APP_SCOPE = {
  current_user: { id: 'u1', email_verified: true },
  user: { id: 'u1', email_verified: true },
  data: {},
  features: {},
};

function mount(
  schema: Record<string, unknown>,
  record?: Record<string, unknown>,
  scope: Record<string, unknown> = APP_SCOPE,
) {
  const tree = (
    <PredicateScopeProvider scope={scope}>
      <SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
        <SchemaRenderer schema={{ type: TYPE, ...schema } as never} />
      </SchemaRendererContext.Provider>
    </PredicateScopeProvider>
  );
  return render(
    record === undefined
      ? tree
      : (
        <RecordContextProvider objectName="showcase_task" recordId="r1" data={record}>
          {tree}
        </RecordContextProvider>
      ),
  );
}

const shown = () => screen.queryByTestId('probe') !== null;

beforeEach(() => {
  ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
  __resetVisibilityPredicateWarnings();
});
afterEach(() => {
  cleanup();
  ComponentRegistry.unregister?.(NAME, 'element');
  vi.restoreAllMocks();
});

describe('#5454 leg 1 — node-level `visibleWhen` binds `record`', () => {
  it('a `record.*` predicate reaches OPPOSITE verdicts on the two polarities of the row', () => {
    // THE acceptance criterion. Before the fix both mounts rendered: the
    // predicate could not resolve and fail-soft resolved to shown.
    mount({ visibleWhen: cel("record.status == 'in_review'") }, IN_REVIEW);
    expect(shown()).toBe(true);
    cleanup();
    mount({ visibleWhen: cel("record.status == 'in_review'") }, DONE);
    expect(shown()).toBe(false);
  });

  it('… and the same on the bare-string dialect, which takes a different path inside the evaluator', () => {
    // A CEL envelope routes to `evalFieldPredicate`; a bare string is compiled
    // by the legacy engine. Both read the same bag, and both had the same hole.
    mount({ visibleWhen: "record.status == 'in_review'" }, IN_REVIEW);
    expect(shown()).toBe(true);
    cleanup();
    mount({ visibleWhen: "record.status == 'in_review'" }, DONE);
    expect(shown()).toBe(false);
  });

  it('the paired control: the same node with no gate renders on BOTH rows', () => {
    // Without this, "hidden" above could be "this node never renders".
    mount({}, DONE);
    expect(shown()).toBe(true);
    cleanup();
    mount({}, IN_REVIEW);
    expect(shown()).toBe(true);
  });

  it('binds the `record` ROOT only — bare row fields stay unbound, as the spec declares', () => {
    // `page:tabs`' item predicate ALSO spreads the row flat. That breadth is
    // undeclared on both surfaces, so this tier binds the three declared roots
    // and nothing else. A bare `status` therefore does not resolve — and a
    // declared predicate that faults is WITHHELD (objectui#13299), so the pair
    // is the proof: were bare fields bound, the `in_review` row would show.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ visibleWhen: "status == 'in_review'" }, DONE);
    expect(shown()).toBe(false);
    cleanup();
    mount({ visibleWhen: "status == 'in_review'" }, IN_REVIEW);
    expect(shown()).toBe(false);
  });

  it('does NOT overwrite `data` with the row — a host-published `data` survives', () => {
    // The reverse-verification of the narrowest choice in the fix. Binding the
    // row over `data` (which `containers.tsx` does on its own surface) would
    // silently re-point every `${data.*}` interpolation in a props bag.
    //
    // objectui#9308 moved WHICH `data` has to survive: the renderer no longer
    // publishes the adapter under that name, so the one at stake is the one a
    // host published through the scope channel. `ADAPTER` is inert here.
    mount({ properties: { content: '${data.total}' } }, DONE, { ...APP_SCOPE, data: { total: 99 } });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-content', '99');
  });

  it('no row binds NOTHING — an ambient `record` supplied by a host is not shadowed', () => {
    // `{ record: undefined }` would blank out a `record` a host put in the
    // scope, turning "this surface has no row" into "this surface's row is
    // empty". Only the latter is entitled to shadow.
    const scopeWithRow = { ...APP_SCOPE, record: IN_REVIEW };
    mount({ visibleWhen: cel("record.status == 'in_review'") }, undefined, scopeWithRow);
    expect(shown()).toBe(true);
    cleanup();
    mount({ visibleWhen: cel("record.status == 'done'") }, undefined, scopeWithRow);
    expect(shown()).toBe(false);
  });

  it('a page-local row WINS over an ambient one — precedence stated, not incidental', () => {
    const scopeWithRow = { ...APP_SCOPE, record: IN_REVIEW };
    mount({ visibleWhen: cel("record.status == 'done'") }, DONE, scopeWithRow);
    expect(shown()).toBe(true);
  });

  it('`current_user` and `page.<var>` keep working — the other two declared roots', () => {
    mount({ visibleWhen: cel('current_user.email_verified == true') }, DONE);
    expect(shown()).toBe(true);
    cleanup();
    mount({ visibleWhen: cel('current_user.email_verified == false') }, DONE);
    expect(shown()).toBe(false);
  });
});

describe('#5454 leg 2 — a declared `visibleWhen` outranks a hoisted `properties.visible`', () => {
  it('a co-declared `visibleWhen` now decides, in BOTH directions', () => {
    // Before: `properties.visible` hoisted onto `schema.visible`, which the
    // chain tested first, so `visibleWhen` was silently ignored whatever it said.
    mount({ properties: { visible: 'true' }, visibleWhen: cel('false') }, DONE);
    expect(shown()).toBe(false);
    cleanup();
    // The other direction, which a "delete the `visible` leg" mutation passes
    // and a "always hide when both are present" mutation fails.
    mount({ properties: { visible: 'false' }, visibleWhen: cel('true') }, DONE);
    expect(shown()).toBe(true);
  });

  it('a `record.*` `visibleWhen` beats a hoisted `properties.visible` — the two legs composed', () => {
    mount({ properties: { visible: 'true' }, visibleWhen: cel("record.status == 'in_review'") }, DONE);
    expect(shown()).toBe(false);
    cleanup();
    mount({ properties: { visible: 'true' }, visibleWhen: cel("record.status == 'in_review'") }, IN_REVIEW);
    expect(shown()).toBe(true);
  });

  it('`properties.visible` ALONE is unchanged — this change is additive, not a migration', () => {
    // The assertion that proves nothing was taken away from the props channel.
    mount({ properties: { visible: 'false' } }, DONE);
    expect(shown()).toBe(false);
    cleanup();
    mount({ properties: { visible: 'true' } }, DONE);
    expect(shown()).toBe(true);
  });

  it('a node-level `visible` still decides when no `visibleWhen` is declared', () => {
    // The case that stays green if someone "fixes" precedence by deleting the
    // `visible` leg outright.
    mount({ visible: false }, DONE);
    expect(shown()).toBe(false);
    cleanup();
    mount({ visible: true }, DONE);
    expect(shown()).toBe(true);
  });

  it('`visible` still outranks the DEPRECATED `visibleOn` — only `visibleWhen` moved', () => {
    // Deliberately unmoved: re-ranking it would move verdicts #5454 did not
    // rule on. (The page component's `visibility` spelling is retired and no
    // longer a leg at all, objectui#12654.)
    mount({ visible: true, visibleOn: 'false' }, DONE);
    expect(shown()).toBe(true);
  });
});

describe('#5454 leg 3 — an unresolvable predicate is loud, and fails closed (objectui#13299)', () => {
  it('warns, names the node, the key and the predicate — and WITHHOLDS the block', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No row is bound, so `record.*` cannot resolve.
    mount({ visibleWhen: cel("record.status == 'in_review'") }, undefined);
    expect(shown()).toBe(false); // fail-closed since objectui#13299
    const msg = warn.mock.calls.map(c => String(c[0])).find(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
    expect(msg).toBeDefined();
    expect(msg).toContain(TYPE);
    expect(msg).toContain('visibleWhen');
    expect(msg).toContain("record.status == 'in_review'");
    // The sentence that makes the missing block diagnosable: it was withheld.
    expect(msg).toContain('WITHHELD');
    expect(msg).not.toContain('gate did NOT bite');
  });

  it('the paired control: a predicate that RESOLVES emits nothing', () => {
    // Without this, "always warn" satisfies the case above.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ visibleWhen: cel("record.status == 'in_review'") }, IN_REVIEW);
    expect(shown()).toBe(true);
    expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX))).toHaveLength(0);
  });

  it('a genuine FALSE is not a fault — it hides, silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ visibleWhen: cel("record.status == 'in_review'") }, DONE);
    expect(shown()).toBe(false);
    expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX))).toHaveLength(0);
  });

  it('the bare-string dialect is loud too — the path that was previously mute', () => {
    // The CEL envelope already warned through `evalFieldPredicate`
    // (objectstack#5149). A bare expression that threw was caught and answered
    // `true` with no diagnostic at all, so whether an author heard about their
    // own typo depended on which dialect they wrote it in.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ visibleWhen: 'record.status == ' }, IN_REVIEW);
    expect(shown()).toBe(false);
    expect(warn.mock.calls.map(c => String(c[0])).some(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX))).toBe(true);
  });

  it('the NON-negated legs keep their inverted fail-soft answer: a broken `hidden` still HIDES', () => {
    // `hidden` / `hiddenOn` are not negated, so `evaluateCondition`'s single
    // "nothing to evaluate" answer (`true`) means HIDE here. Leg 3 must not
    // quietly flip that while making it loud.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ hidden: cel('record.nope.deeper == 1') }, undefined);
    expect(shown()).toBe(false);
    expect(warn.mock.calls.map(c => String(c[0])).some(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX))).toBe(true);
  });

  it('a PRODUCTION build takes the single-evaluation branch and reaches the SAME verdicts', async () => {
    // Leg 3 detects a fault via `throwOnError`, and on the CEL branch
    // `evaluateCelCondition` implements that by evaluating TWICE. Spec-parsed
    // metadata normalizes `visibleWhen` into a CEL envelope, so paying for the
    // probe unconditionally would double the engine calls for every predicate
    // of every node in production, to build a message production never prints.
    //
    // The branch is therefore `__DEV__`-gated — and a gate that changes the
    // ANSWER would be a fork, not an optimisation. This case is what makes that
    // claim checkable: the same three inputs, re-imported under
    // NODE_ENV=production, reach the verdicts the dev branch reached above.
    //
    // The dynamic import lives in the test BODY, not a hook: it has to read
    // module state that only exists after `resetModules` + `stubEnv`, which is
    // the case `object-ui/no-dynamic-import-in-test-hook` exempts.
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const [core, prod, ctx, rec, expr] = await Promise.all([
        import('@object-ui/core'),
        import('../SchemaRenderer'),
        import('../context/SchemaRendererContext'),
        import('../context/RecordContext'),
        import('../hooks/useExpression'),
      ]);
      core.ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
      const mountProd = (schema: Record<string, unknown>, record?: Record<string, unknown>) => {
        const tree = (
          <expr.PredicateScopeProvider scope={APP_SCOPE}>
            <ctx.SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
              <prod.SchemaRenderer schema={{ type: TYPE, ...schema } as never} />
            </ctx.SchemaRendererContext.Provider>
          </expr.PredicateScopeProvider>
        );
        return render(
          record === undefined
            ? tree
            : (
              <rec.RecordContextProvider objectName="showcase_task" recordId="r1" data={record}>
                {tree}
              </rec.RecordContextProvider>
            ),
        );
      };

      // Resolvable, both polarities — the record binding still works.
      mountProd({ visibleWhen: cel("record.status == 'in_review'") }, IN_REVIEW);
      expect(shown()).toBe(true);
      cleanup();
      mountProd({ visibleWhen: cel("record.status == 'in_review'") }, DONE);
      expect(shown()).toBe(false);
      cleanup();
      // Unresolvable — the same fail-closed WITHHELD the dev branch returns
      // (objectui#13299)...
      mountProd({ visibleWhen: cel("record.status == 'in_review'") }, undefined);
      expect(shown()).toBe(false);
      // ...and the non-negated leg keeps its inverted fail-soft answer too.
      cleanup();
      mountProd({ hidden: cel('record.nope.deeper == 1') }, undefined);
      expect(shown()).toBe(false);
      // ...and, since objectui#6038, WITH this module's diagnostic — one line
      // per distinct faulting predicate source, in production too.
      //
      // This assertion used to read `toHaveLength(0)`, and the change is the
      // whole of the maintainer's 2026-08-25 ruling (option B): "A is rejected
      // — the silence is no longer an accepted property." The pin is rewritten
      // rather than deleted, because what it was really guarding is the half
      // that did NOT move: every verdict above matches the dev branch (both
      // fail closed since objectui#13299), and the branch is
      // still the SINGLE-evaluation one (production never pays for the
      // `throwOnError` probe — `EvaluationOptions.onFault` reports the fault
      // the evaluator had already caught).
      //
      // TWO lines, not one: the two mounts above carry two DIFFERENT predicate
      // sources (`record.status == 'in_review'` on `visibleWhen`, and
      // `record.nope.deeper == 1` on `hidden`). One line each is the dedupe
      // working; one line total would mean it had swallowed the second.
      const produced = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
      expect(produced).toHaveLength(2);
      expect(produced.some(m => m.includes("record.status == 'in_review'"))).toBe(true);
      expect(produced.some(m => m.includes('record.nope.deeper == 1'))).toBe(true);
      core.ComponentRegistry.unregister?.(NAME, 'element');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('deduped: one line per (node type, key, predicate), not one per render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ visibleWhen: cel("record.status == 'in_review'") }, undefined);
    cleanup();
    mount({ visibleWhen: cel("record.status == 'in_review'") }, undefined);
    expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- *
 * objectui#6487 — the node gate names ITS OWN roots, and only those.
 *
 * The reporter's closing paragraph became per-tier when objectui#6443 wired the
 * app-shell chrome gate onto it and that surface started printing the node
 * tier's roots for a bag that has neither. This cell is the node tier's end of
 * that split, asserted where a REAL faulting node predicate reaches the
 * console: the paragraph here is unchanged, and it must not drift onto the
 * app-shell copy.
 *
 * The `not` half is the load-bearing one. `current_user` is named at both tiers,
 * so asserting on it alone would be green whichever paragraph printed; the cells
 * below assert the roots the two tiers DISAGREE about.
 * -------------------------------------------------------------------------- */

describe('#6487 — the node tier`s advice paragraph', () => {
  it('names the three roots the spec declares, and not the app-shell bag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No row is bound, so `record.*` cannot resolve — a real fault, at the real
    // call site, on the same run as the assertions below.
    mount({ visibleWhen: cel("record.nosuchroot6487node == 'x'") }, undefined);
    expect(shown()).toBe(false); // fail-closed verdict (objectui#13299)

    const msg = warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
    expect(msg).toBeDefined(); // the fault reached the reporter in THIS run
    expect(msg).toContain('Page-component predicates bind');
    expect(msg).toContain('`record`');
    expect(msg).toContain('`page.<var>`');
    // The app-shell tier's roots, which this bag does not promise.
    expect(msg).not.toContain('`features`');
    expect(msg).not.toContain('`ctx.user`');
    expect(msg).not.toContain('`os.user`');
  });

  it('the ambient app scope being mounted does not move the node gate onto the app-shell copy', () => {
    // `APP_SCOPE` is the bag app-shell's `ExpressionProvider` really publishes,
    // and `mount` spreads it into the node evaluator — so a fix that had
    // deduced the tier from what happens to be in scope, rather than from the
    // call site, would print the app-shell paragraph here. The tier is an
    // argument precisely so that it cannot.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ visibleWhen: 'nosuchroot6487ambient.x > 1' }, IN_REVIEW, APP_SCOPE);
    const msg = warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
    expect(msg).toBeDefined();
    expect(msg).toContain('Page-component predicates bind');
    expect(msg).not.toContain('Neither `record` nor');
  });
});
