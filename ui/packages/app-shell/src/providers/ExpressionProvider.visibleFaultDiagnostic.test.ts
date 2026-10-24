/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6443 — a nav / area / field `visible` predicate that FAULTS is
 * reported, through the same reporter and the same rate limit as the node gate
 * (objectui#6038) and the `page:tabs` item gate.
 *
 * ## The defect, and why a runtime suite could not see it
 *
 * `evaluateCondition` is FAIL-SOFT: it answers an unevaluable predicate with
 * `true` from its own `catch` and does not throw. So `evaluateVisibility`'s
 * `try/catch` never saw a predicate fault at all — the whole class was
 * swallowed one layer down, in silence, in BOTH builds. Measured on this base
 * before the fix, the neighbouring suite
 * (`ExpressionProvider.evaluateVisibility.test.ts`) passes green against the
 * defect and always did: its `fails open (visible) on an unevaluable predicate`
 * case asserts the exact verdict the broken site returns. That is the argument
 * for this file's existence — the observable difference is on the console, and
 * nothing was looking there.
 *
 * The consequence is a permission boundary that stops biting: a menu entry
 * whose `visible` was written to exclude a role renders for that role, looking
 * exactly like an entry the author meant to show.
 *
 * ## What is pinned, split into cells that DISAGREE and cells that must not
 *
 * DISCRIMINATING (red against `origin/main`, green after) — every dialect from
 * the card's measured table, the message content that carries this site's
 * dedupe-key decision, both halves of the rate limit, and the defensive throw
 * path.
 *
 * CONTROLS (green BOTH ways, deliberately, each named at its case):
 *   - the positive/degenerate console-capture pair, without which every
 *     `toHaveLength(0)` here is equally green on a spy that observes nothing;
 *   - FAIL-OPEN IS UNCHANGED. This card is diagnostics only. A faulting
 *     predicate must still leave the item visible — including for the role it
 *     was written to exclude. The cell guards the future wrong shape where a
 *     diagnostic change quietly also flips fail-open to fail-closed, which
 *     would be a permission-boundary change wearing an observability costume.
 *   - a HEALTHY predicate stays silent on BOTH verdicts, which guards the
 *     future wrong shape where the reporter fires on a genuine `false`.
 *
 * ## Reverse verification — direction predicted BEFORE the run
 *
 * Restoring `ExpressionProvider.tsx` from `origin/main` (i.e. deleting the
 * `onFault` option and the `report` call in the `catch`) turns RED exactly the
 * discriminating cells above — `reports()` goes to 0 in each — and leaves the
 * four control cells GREEN. The `${…}` cell moves in a second, independent
 * direction: its TOTAL console line count goes 1 -> 3, because that dialect's
 * built-in warning fires once per evaluation and is not deduped (the separate
 * defect objectui#6444 tracks, which this card does not fix and does not need
 * to: supplying `onFault` transfers reporting away from it at this site).
 *
 * ## Predicate sources are unique per case, on purpose
 *
 * The `unit` project runs with `isolate: false`, and the built-in CEL warning
 * in `@object-ui/core`'s `evalFieldPredicate` dedupes in module state this file
 * cannot reset. A source string shared with any other test file would let that
 * dedupe decide this file's line counts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExpressionEvaluator } from '@object-ui/core';
import {
  UNRESOLVABLE_VISIBILITY_PREFIX,
  __resetVisibilityPredicateWarnings,
} from '@object-ui/react';
import { hasVisibleNavigationItems } from '@object-ui/layout';
import { buildExpressionScope, evaluateVisibility } from './ExpressionProvider';

/** The label this site puts in the reporter's `type` slot — the dedupe-key decision. */
const SURFACE = 'app-shell:visible';

/**
 * The provider's bag, taken from the provider's own builder rather than
 * transcribed. It was a hand-written copy carrying an `app` key, and a copy is
 * how a fixture goes on asserting a root the builder has stopped binding
 * (objectui#8155) — `buildExpressionScope` is the single declaration, so the
 * cells below measure the shipped bag instead of a snapshot of it.
 */
function makeScope(user: Record<string, unknown> = { id: 'u1', positions: ['worker'] }) {
  return buildExpressionScope({ user });
}

function makeEvaluator(user: Record<string, unknown> = { id: 'u1', positions: ['worker'] }) {
  return new ExpressionEvaluator(makeScope(user) as any);
}

type WarnSpy = { mock: { calls: unknown[][] } };
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
const allWarnings = (warn: WarnSpy): string[] => warn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  __resetVisibilityPredicateWarnings();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('objectui#6443 — controls', () => {
  it('POSITIVE CONTROL: the spy observes a line carrying the prefix', () => {
    // Green both ways. Without it every `toHaveLength(0)` below is equally
    // green on a capture that observes nothing at all.
    const warn = spyWarn();
    console.warn(`${UNRESOLVABLE_VISIBILITY_PREFIX} - synthetic control line`);
    expect(reports(warn)).toHaveLength(1);
  });

  it('DEGENERATE CONTROL: unrelated console output does not satisfy the pin', () => {
    // Green both ways. `reports()` must be a filter, not a call counter.
    const warn = spyWarn();
    console.warn('[object-ui] an entirely unrelated warning');
    expect(allWarnings(warn)).toHaveLength(1);
    expect(reports(warn)).toHaveLength(0);
  });

  it('CONTROL — FAIL-OPEN IS UNCHANGED: the excluded role still sees the item', () => {
    // GREEN BOTH WAYS, and that is the point: this card is diagnostics only.
    // The cell guards the future wrong shape where a diagnostic change also
    // flips fail-open to fail-closed — a permission-boundary change wearing an
    // observability costume. It carries NO assertion about the console, so it
    // cannot go red for the reason the discriminating cells do.
    //
    // Asserted on the OBSERVABLE OUTCOME — whether the nav item survives the
    // real guard `UnifiedSidebar` runs — not on the helper's return value alone,
    // because "a fault was reported" is also true of a site that stopped
    // rendering the item entirely.
    spyWarn(); // keep the fault line off the suite's own output
    const evaluator = makeEvaluator({ id: 'u1', positions: ['worker'] });
    const fault = "'org_admin' in nosuchroot6443ctl.positions";

    // The role the predicate was written to exclude is a `worker`.
    expect(evaluateVisibility(fault, evaluator)).toBe(true);
    expect(
      hasVisibleNavigationItems(
        [{ type: 'link', id: 'admin', label: 'Admin', href: '/admin', visible: fault }] as any,
        { evaluateVisibility: (e) => evaluateVisibility(e as any, evaluator) },
      ),
    ).toBe(true);
  });

  it('CONTROL — a HEALTHY predicate stays silent, on BOTH verdicts', () => {
    // Green both ways. The half that makes the loud half mean something: a
    // predicate that says NO is a verdict, not a fault.
    const warn = spyWarn();
    const orgAdmin = makeEvaluator({ id: 'u2', positions: ['org_admin'] });
    const worker = makeEvaluator({ id: 'u1', positions: ['worker'] });
    const visible = { dialect: 'cel', source: "'org_admin' in current_user.positions" };

    expect(evaluateVisibility(visible, orgAdmin)).toBe(true);
    expect(evaluateVisibility(visible, worker)).toBe(false);
    expect(evaluateVisibility("${user.role === 'admin'}", makeEvaluator({ role: 'guest' }))).toBe(false);

    expect(allWarnings(warn)).toHaveLength(0);
  });
});

describe('objectui#6443 — every dialect from the card`s measured table now reports', () => {
  it('BARE STRING — the dialect that printed NOTHING, and the one a live gate broke on', () => {
    // Pairs the log with the OBSERVABLE OUTCOME in one cell, so this cannot go
    // green on a site that reported a fault by refusing to render the item.
    const warn = spyWarn();
    const evaluator = makeEvaluator();
    const fault = 'nosuchroot6443bare.x > 1';

    expect(evaluateVisibility(fault, evaluator)).toBe(true); // verdict unchanged
    expect(
      hasVisibleNavigationItems(
        [{ type: 'link', id: 'reports', label: 'Reports', href: '/r', visible: fault }] as any,
        { evaluateVisibility: (e) => evaluateVisibility(e as any, evaluator) },
      ),
    ).toBe(true); // still visible to the excluded role — fail-open, unchanged

    expect(reports(warn)).toHaveLength(1);
    expect(allWarnings(warn)).toHaveLength(1); // and nothing else was added
  });

  it('CEL ENVELOPE — the generic line is REPLACED by the named one, not added to it', () => {
    // `onFault` transfers reporting to this caller (`warn: false` reaches
    // `evalFieldPredicate`), so the total stays ONE line while its content
    // becomes the line that names the surface, the key and the source.
    const warn = spyWarn();
    const evaluator = makeEvaluator();
    const fault = { dialect: 'cel', source: 'nosuchroot6443cel.x > 1 &&&' };

    expect(evaluateVisibility(fault, evaluator)).toBe(true);
    expect(reports(warn)).toHaveLength(1);
    expect(allWarnings(warn)).toHaveLength(1);
  });

  it('${…} TEMPLATE — one line for three evaluations, where the built-in warns once per evaluation', () => {
    // Two independent directions in one cell: `reports()` 0 -> 1, and the TOTAL
    // 3 -> 1. The second is the un-deduped built-in (objectui#6444) being
    // transferred away from at this site.
    const warn = spyWarn();
    const evaluator = makeEvaluator();
    const fault = '${nosuchroot6443tpl.x > 1}';

    expect(evaluateVisibility(fault, evaluator)).toBe(true);
    expect(evaluateVisibility(fault, evaluator)).toBe(true);
    expect(evaluateVisibility(fault, evaluator)).toBe(true);

    // TOTAL first, on purpose: it is the assertion that MEASURES the built-in
    // flood when this cell is run against the pre-fix site (it reads 3 there,
    // one per evaluation). Asserting `reports()` first would short-circuit
    // before the number this cell exists to show.
    expect(allWarnings(warn)).toHaveLength(1);
    expect(reports(warn)).toHaveLength(1);
  });

  it('the line NAMES the surface, the gate key, the predicate source and the engine reason', () => {
    const warn = spyWarn();
    const evaluator = makeEvaluator();
    const fault = 'nosuchroot6443msg.x > 1';

    evaluateVisibility(fault, evaluator);
    const [line] = reports(warn);
    expect(line).toContain(SURFACE);
    expect(line).toContain('visible:');
    expect(line).toContain(fault);
    expect(line).toContain('Reason:');
  });

  it('the DEFENSIVE catch is loud too: an evaluator that THROWS still fails open, and says so', () => {
    // `evaluateCondition` handles its own faults, so this path needs the
    // evaluator itself to throw. It returned the same fail-open `true` in
    // silence before; it no longer does. This is the cell that keeps the
    // `catch` honest if a future caller ever passes `throwOnError` here.
    const warn = spyWarn();
    const thrower = {
      evaluateCondition() {
        throw new Error('engine exploded 6443');
      },
    } as unknown as ExpressionEvaluator;

    expect(evaluateVisibility('nosuchroot6443throw.x > 1', thrower)).toBe(true);
    const [line] = reports(warn);
    expect(line).toContain('engine exploded 6443');
  });
});

describe('objectui#6443 — the rate limit, measured in both directions', () => {
  it('SAME source, many evaluations across the real area-election pass: ONE line', () => {
    // Not a synthetic loop. This is the composition `UnifiedSidebar` runs:
    // `areas.filter(a => hasVisibleNavigationItems(a.navigation, …))` derives
    // area visibility (objectui#3311) by re-running every item predicate,
    // before the navigation renders them again — and both re-run on every
    // sidebar re-render. The measured re-entry count is asserted, so this cell
    // cannot pass on a site that is entered once.
    const warn = spyWarn();
    const evaluator = makeEvaluator();
    const fault = "'org_admin' in nosuchroot6443dedupe.positions";

    let faultEvaluations = 0;
    const evalVis = (expr: unknown): boolean => {
      if (expr === fault) faultEvaluations += 1;
      return evaluateVisibility(expr as any, evaluator);
    };

    // One faulting entry per area. `type: 'action'` with no action handler is
    // evaluated and then skipped, exactly as `AppSchemaRenderer` wires it for a
    // host that passes no `onAction`, so the pass does not short-circuit on the
    // first item.
    const navigation = [
      { type: 'action', id: 'run', label: 'Run report', visible: fault },
      { type: 'link', id: 'home', label: 'Home', href: '/home' },
    ];
    const areas = [
      { name: 'sales', navigation },
      { name: 'ops', navigation },
      { name: 'admin', navigation },
    ];

    // Two passes = the derivation plus one re-render.
    for (let pass = 0; pass < 2; pass += 1) {
      const visibleAreas = areas.filter((area) =>
        hasVisibleNavigationItems(area.navigation as any, {
          evaluateVisibility: evalVis,
          hasActionHandler: false,
        }),
      );
      expect(visibleAreas).toHaveLength(3);
    }

    expect(faultEvaluations).toBe(6);
    expect(reports(warn)).toHaveLength(1);
    expect(allWarnings(warn)).toHaveLength(1);
  });

  it('TWO DIFFERENT sources: TWO lines — a dedupe that suppressed everything would look identical', () => {
    const warn = spyWarn();
    const evaluator = makeEvaluator();
    const a = 'nosuchroot6443two_a.x > 1';
    const b = 'nosuchroot6443two_b.y == 3';

    evaluateVisibility(a, evaluator);
    evaluateVisibility(b, evaluator);
    evaluateVisibility(a, evaluator);
    evaluateVisibility(b, evaluator);

    const lines = reports(warn);
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes(a))).toBe(true);
    expect(lines.some((l) => l.includes(b))).toBe(true);
  });

  it('ONE rate limit, shared with @object-ui/react: a second evaluator does not buy a second line', () => {
    // The property the shared export exists for. The dedupe `Set` lives in
    // `@object-ui/react`; a local copy in this package would entitle one
    // authored predicate to one line PER PACKAGE.
    const warn = spyWarn();
    const fault = 'nosuchroot6443shared.x > 1';

    evaluateVisibility(fault, makeEvaluator({ id: 'u1' }));
    expect(reports(warn)).toHaveLength(1);
    evaluateVisibility(fault, makeEvaluator({ id: 'u2' }));
    expect(reports(warn)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- *
 * objectui#6487 — the advice paragraph is this tier's, not the node tier's.
 *
 * The card #6443 made visible: once this site started printing, it printed the
 * NODE gate's closing paragraph, telling a nav author to check `record` and
 * `page.<var>`. The bag `ExpressionProvider` builds is
 * `{ current_user, user, ctx: { user }, os: { user }, data, features }` — it
 * contains neither.
 *
 * These cells are the END-TO-END half of the pin: the unit matrix in
 * `@object-ui/react` proves the two paragraphs differ, and these prove the
 * paragraph a REAL faulting nav predicate reaches the console with is this
 * tier's. A fault is asserted to have reached the reporter in the same run, so
 * neither can pass on a site that stopped reporting.
 * -------------------------------------------------------------------------- */

describe('objectui#6487 — the line carries the APP-SHELL tier`s roots', () => {
  it('a faulting nav predicate is NOT told to check `record` or `page.<var>`', () => {
    const warn = spyWarn();
    const evaluator = makeEvaluator();
    const fault = 'nosuchroot6487shell.x > 1';

    expect(evaluateVisibility(fault, evaluator)).toBe(true); // fail-open, unchanged
    const lines = reports(warn);
    expect(lines).toHaveLength(1); // the fault reached the reporter in THIS run
    expect(lines[0]).not.toContain('Page-component predicates bind');
    expect(lines[0]).toContain('Neither `record` nor `page.<var>` exists at this tier.');
  });

  it('it names the roots this provider really binds — including `features`', () => {
    // `features` is the deployment-flag root this provider's own docblock
    // documents for exactly this kind of predicate, and it was unnamed.
    // Asserted against the bag `makeEvaluator` builds, which IS the provider's
    // (`buildExpressionScope`): every root named below is a key of it.
    const warn = spyWarn();
    const evaluator = makeEvaluator();

    evaluateVisibility('nosuchroot6487shellroots.x > 1', evaluator);
    const [line] = reports(warn);
    expect(line).toBeDefined();
    for (const root of ['`current_user`', '`user`', '`ctx.user`', '`os.user`', '`features`']) {
      expect(line).toContain(root);
    }
  });

  /* ------------------------------------------------------------------------ *
   * objectui#8155 — the COUPLING pin. The advice copy lives in
   * `@object-ui/react` and the bag lives here, so neither package can pin the
   * pair alone; this is the only seat that reaches both. Modelled on the
   * three-sided pin PR #8164 left on `ConditionalFormattingEditor.test.tsx`.
   * ------------------------------------------------------------------------ */

  it('objectui#8155 — the printed advice does not name `app`, and the bag does not bind it', () => {
    // Face 1 (copy, `@object-ui/react`) and face 2 (bag, this package) asserted
    // in one run against the REAL line this surface prints. Re-adding `app` to
    // the diagnostic string reddens the first expect; re-adding it to
    // `buildExpressionScope` reddens the second.
    const warn = spyWarn();

    evaluateVisibility('nosuchroot8155copy.x > 1', makeEvaluator());
    const [line] = reports(warn);
    expect(line).toBeDefined();
    expect(line).not.toContain('`app`');
    expect(Object.prototype.hasOwnProperty.call(makeScope(), 'app')).toBe(false);
  });

  it('objectui#8155 — every root the advice names is a root the bag really binds', () => {
    // Face 3, and the one that makes the pair a fence rather than two lists.
    // The defect this card cleans up was precisely an advertised root the bag
    // did not bind, so the invariant — not the spelling — is what is pinned:
    // re-adding `app` to the COPY alone (leaving the bag aligned to the
    // engine) reddens here even though the census cell above is the one that
    // names it. The reverse case, a root bound but not advertised, is legal
    // and deliberate (`data`), so this direction is asserted and not the other.
    const warn = spyWarn();
    const scope = makeScope();

    evaluateVisibility('nosuchroot8155coupling.x > 1', makeEvaluator());
    const [line] = reports(warn);
    expect(line).toBeDefined();

    // Root names as the advice spells them, mapped to the key an author would
    // have to be able to name for the advice to be true. `ctx.user` / `os.user`
    // are member paths, so the root is the segment before the dot.
    const advertised = ['current_user', 'user', 'ctx.user', 'os.user', 'app', 'features', 'record', 'data']
      .filter((root) => (line as string).includes(`\`${root}\``))
      .map((root) => root.split('.')[0]);
    expect(advertised.length).toBeGreaterThan(0); // the line named SOMETHING
    for (const root of advertised) {
      // `record` is named only by the sentence declaring it ABSENT at this
      // tier, which is the one advertised name that must NOT be a key.
      if (root === 'record') {
        expect(Object.prototype.hasOwnProperty.call(scope, root)).toBe(false);
        continue;
      }
      expect(Object.prototype.hasOwnProperty.call(scope, root)).toBe(true);
    }
  });

  it('CONTROL: the first paragraph is UNCHANGED — it is true on this fail-open surface too', () => {
    // Green both ways, deliberately. Only the LAST paragraph is per-tier; the
    // "gate did NOT bite" sentence is true on every surface wired to this
    // reporter, and objectui#6445 owns the separate question of its polarity on
    // the `disabled` gate. A fix that re-tiered the whole message would take
    // this cell red and would be out of this card's scope.
    const warn = spyWarn();
    evaluateVisibility('nosuchroot6487shellctl.x > 1', makeEvaluator());
    const [line] = reports(warn);
    expect(line).toContain('gate did NOT bite');
  });

  it('the surface label, gate key, source and reason all survive the tier split', () => {
    const warn = spyWarn();
    const fault = 'nosuchroot6487shellshape.x > 1';
    evaluateVisibility(fault, makeEvaluator());
    const [line] = reports(warn);
    expect(line).toContain(SURFACE);
    expect(line).toContain('visible:');
    expect(line).toContain(fault);
    expect(line).toContain('Reason:');
  });
});
