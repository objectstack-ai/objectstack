/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6445 — the `disabled` / `disabledOn` node gate reports a faulting
 * predicate, in BOTH builds, and says something TRUE about what its fail-soft
 * default did.
 *
 * ## The silence this closes
 *
 * Six legs of `SchemaRenderer`'s visibility chain (`visibleWhen`, `visible`,
 * `visibleOn`, `visibility`, `hidden`, `hiddenOn`; `visibility` was retired by
 * objectui#12654) route through
 * `evaluateVisibilityPredicate` and report. These two called
 * `evaluateCondition` BARE — the only uninstrumented predicate pair in the
 * file — so a faulting `disabled` predicate had never been reported in any
 * build, in any dialect that does not report on its own.
 *
 * And it is the pair whose fail-soft default BITES. `evaluateCondition` answers
 * an unevaluable predicate with `true`; on the negated visibility legs that
 * means SHOWN, here it means GREYED OUT. So the user sees a control they cannot
 * use and the author has nothing to grep for — the support ticket the card
 * names ("the Save button is greyed out and I don't know why").
 *
 * ## Observability only — the polarity is NOT this card's to move
 *
 * `evaluateCondition`'s `true` for an unevaluable predicate is existing shipped
 * behaviour, preserved deliberately (the neighbouring family #3862/#3955 landed
 * fail-soft on purpose). Every case below therefore pins the VERDICT beside the
 * line: a faulting `disabled` still disables. A run that made this file green by
 * flipping the gate would fail those pins.
 *
 * ## Why the dedupe is pinned in BOTH directions, and across gates
 *
 * The reporter is rate-limited per `(type, key, predicate source)`
 * (`visibilityDiagnostic.ts`), and #6444 added a second, independent rate limit
 * inside `ExpressionEvaluator` for its own built-in lines. "A warning was
 * emitted" is green on an implementation that emitted fifty; "exactly one was
 * emitted" is green on one that suppresses EVERYTHING after the first line ever
 * printed. Neither pin alone can tell a working dedupe from a broken one, so
 * every dedupe case here pins both halves, and two cases pin the direction this
 * new call site made possible: the SAME predicate source authored on `disabled`
 * and on `visibleWhen` (and on `disabled` and `disabledOn`) must produce TWO
 * lines. Without those, a key that collapsed the gates together would look
 * exactly like a working rate limit.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Restoring the bare `evaluator.evaluateCondition(newSchema.disabled)` on both
 * legs — the two lines this card replaces — turns RED every report-count pin in
 * groups 1, 2, 4 and 5 (their counts fall to 0; the CEL and `${…}` cases keep a
 * count but the line becomes the evaluator's own generic one, which carries
 * neither prefix, so the prefix-filtered view is empty there too) and leaves
 * every VERDICT pin and the whole of group 3 GREEN. That asymmetry is the card
 * restated: the change moves the silence, not the answer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Module scope as well as after each `vi.resetModules()` below: the cold transform is
// paid once during collection, and every re-import after a reset re-evaluates the cached
// transform instead of compiling inside a clocked window (AGENTS.md, flaky-test discipline).
import '@object-ui/core';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import {
  ADAPTER_ONLY_DATA_PREDICATE_PREFIX,
  ADAPTER_ONLY_ENABLEMENT_PREDICATE_PREFIX,
  UNRESOLVABLE_ENABLEMENT_PREFIX,
  UNRESOLVABLE_VISIBILITY_PREFIX,
} from '../utils/visibilityDiagnostic';

const NAME = 'probe-6445';
const TYPE = 'element:probe-6445';

/**
 * Records the `disabled` prop EXACTLY as it arrives — `absent` when the
 * renderer forwarded nothing — so every case can pin the VERDICT beside the
 * console line. `_disabled` is not an internal marker: it is re-injected as a
 * real `disabled` prop, which is what the user's greyed-out control is made of.
 */
const Probe = (props: { disabled?: unknown }) => (
  <div
    data-testid="probe"
    data-disabled-prop={props.disabled === undefined ? 'absent' : String(props.disabled)}
  />
);

/**
 * A HOST scope that publishes its own `data` root through
 * `PredicateScopeProvider`.
 *
 * ⚠️ NOT what app-shell's `ExpressionProvider` mounts — the comment that said
 * so was stale: `buildExpressionScope` has published no `data` since
 * objectui#8166. Since objectui#9308 the renderer binds no `data` either, so a
 * host publication is the only way the adapter-only leg is reachable at all
 * (with no `data` anywhere the predicate throws and objectui#5454's reporter
 * takes it instead).
 */
const APP_SCOPE = {
  current_user: { id: 'u1' },
  user: { id: 'u1' },
  data: {},
  features: {},
};
/** The same host scope, publishing a `data` root that DOES answer. */
const scopeWithData = (data: Record<string, unknown>) => ({ ...APP_SCOPE, data });
/**
 * The injected adapter. Inert since objectui#9308 — kept so every mount still
 * crosses the real seam, and so a reverted re-aim would be visible rather than
 * silently green.
 */
const ADAPTER = { total: 99 };
const ROW = { id: 'r1', status: 'open' };

/**
 * Predicates that genuinely FAULT, one per dialect, measured on the built
 * evaluator. An unbound ROOT identifier is the shape objectstack#11254 hit and
 * the shape an AI-authored predicate reaches for; `record.bad(` is a parse
 * error, the only fault the CEL engine reports as `[parse]`.
 */
const FAULT_BARE = 'nosuchroot.locked == true';
const FAULT_BARE_2 = 'anotherbadroot.frozen == true';
/**
 * A DISTINCT source per development cell — not tidiness, a measurement.
 *
 * objectui#6444 added `warnedEvaluationFaults` to `ExpressionEvaluator`: module
 * state, keyed on `[site, source]`, that suppresses the evaluator's OWN built-in
 * line after the first report of a source. `inProduction` gets a fresh module
 * graph per case (`vi.resetModules`), so that `Set` starts empty there; the
 * development cases run on the STATIC graph and share one `Set` for the whole
 * file.
 *
 * So a dev cell reusing another dev cell's source could have the built-in line
 * suppressed on its behalf — and a total-count pin would then read `1` on a
 * build that reports the fault TWICE (our line plus the evaluator's), which is
 * the regression those pins exist to catch. Reported to the dispatch as the
 * in-file instance of exactly the hazard #6444's dev found in the pre-existing
 * suite. A unique source per dev cell makes the pin unmaskable rather than
 * order-dependent.
 */
const FAULT_BARE_DEV = 'devonlybadroot.locked == true';
const FAULT_BARE_PARITY = 'parityrootmissing.locked == true';
const FAULT_TEMPLATE = '${nosuchroot.locked == true}';
const FAULT_CEL = { dialect: 'cel', source: 'record.bad(' };
/** Predicates that resolve cleanly — the silence that makes the noise mean something. */
const HEALTHY_DISABLING = "record.status == 'open'";
const HEALTHY_ENABLING = "record.status == 'closed'";

type WarnSpy = { mock: { calls: unknown[][] } };
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
/** The ENABLEMENT-prefix-filtered view most assertions read. */
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_ENABLEMENT_PREFIX));
/** The sibling gate's view, for the cross-gate cases. */
const visibilityReports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
/**
 * The objectui#6504 leg's view — the enablement-gate extension of #5687's
 * adapter-only constant-predicate diagnostic. A DIFFERENT fault class than
 * `reports` above: this one names a predicate that evaluated PERFECTLY,
 * against the wrong object, not one that could not be evaluated at all.
 */
const adapterOnlyReports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(ADAPTER_ONLY_ENABLEMENT_PREDICATE_PREFIX));
/** The sibling (objectui#5687, visibility-gate) leg's view of the SAME diagnostic family. */
const adapterOnlyVisibilityReports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(ADAPTER_ONLY_DATA_PREDICATE_PREFIX));
/** Everything the console was asked to print, filtered by nothing. */
const allWarnings = (warn: WarnSpy): string[] => warn.mock.calls.map((c) => String(c[0]));

/**
 * The line a development build could print beside these diagnostics without it
 * being ours — `SchemaRenderer` runs `validateSchemaOnce` in dev only.
 *
 * HISTORY, because the numbers below moved with it (objectui#6505): when this
 * file was written, core's `BASE_SCHEMA_RULES` declared `disabled` "must be a
 * boolean", so every EXPRESSION-valued `disabled` — the authoring form this
 * whole card is about — was ALSO reported as an invalid schema. That false
 * positive is gone: the rule now accepts a declared predicate, and the dev
 * build prints nothing here. Production was never affected — that validator is
 * a no-op there — which is why the production cases below always pinned the
 * RAW total.
 *
 * The by-name subtraction stays, and is not now-redundant belt-and-braces: it
 * is what makes every `nonValidatorWarnings` assertion in this file invariant
 * under whatever core's validator decides to say. That property is why this
 * file survived objectui#6505 with ONE number changed instead of a re-audit —
 * "the total was 2" would have gone equally green on a build that printed our
 * line twice, and would have said nothing about which line was which.
 */
const DEV_SCHEMA_VALIDATOR_NOISE = '[ObjectUI] Invalid schema detected:';
/** Everything printed that is NOT the known dev-only validator line. */
const nonValidatorWarnings = (warn: WarnSpy): string[] =>
  allWarnings(warn).filter((m) => !m.includes(DEV_SCHEMA_VALIDATOR_NOISE));

/**
 * Mount `schemas` in a PRODUCTION module graph.
 *
 * `__DEV__` in `SchemaRenderer` is an IIFE evaluated at module load, so the env
 * has to be stubbed before the import — hence `resetModules` and a dynamic
 * import in the test BODY (the case `object-ui/no-dynamic-import-in-test-hook`
 * exempts). The dedupe `Set` is module state of that same fresh graph, so the
 * reset has to come from the fresh graph too: resetting the statically-imported
 * copy would clear a DIFFERENT `Set`, and every count below would then be
 * measuring the previous case's leakage rather than this case's behaviour.
 */
async function inProduction(
  fn: (mount: (schemas: Record<string, unknown>[], scope?: Record<string, unknown>) => void) => void | Promise<void>,
): Promise<void> {
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
    core.ComponentRegistry.register(NAME, Probe as never, {
      namespace: 'element',
      skipFallback: true,
    } as never);
    const mount = (schemas: Record<string, unknown>[], scope: Record<string, unknown> = APP_SCOPE) =>
      render(
        <expr.PredicateScopeProvider scope={scope}>
          <ctx.SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
            <rec.RecordContextProvider objectName="showcase_task" recordId={ROW.id} data={ROW}>
              {schemas.map((s, i) => (
                <prod.SchemaRenderer key={i} schema={{ type: TYPE, ...s } as never} />
              ))}
            </rec.RecordContextProvider>
          </ctx.SchemaRendererContext.Provider>
        </expr.PredicateScopeProvider>,
      );
    await fn(mount);
    core.ComponentRegistry.unregister?.(NAME, 'element');
  } finally {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

/** Mount one schema in the ordinary (development) module graph. */
async function inDevelopment(
  fn: (mount: (schemas: Record<string, unknown>[], scope?: Record<string, unknown>) => void) => void | Promise<void>,
): Promise<void> {
  const [core, dev, ctx, rec, expr, diag] = await Promise.all([
    import('@object-ui/core'),
    import('../SchemaRenderer'),
    import('../context/SchemaRendererContext'),
    import('../context/RecordContext'),
    import('../hooks/useExpression'),
    import('../utils/visibilityDiagnostic'),
  ]);
  diag.__resetVisibilityPredicateWarnings();
  core.ComponentRegistry.register(NAME, Probe as never, {
    namespace: 'element',
    skipFallback: true,
  } as never);
  try {
    const mount = (schemas: Record<string, unknown>[], scope: Record<string, unknown> = APP_SCOPE) =>
      render(
        <expr.PredicateScopeProvider scope={scope}>
          <ctx.SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
            <rec.RecordContextProvider objectName="showcase_task" recordId={ROW.id} data={ROW}>
              {schemas.map((s, i) => (
                <dev.SchemaRenderer key={i} schema={{ type: TYPE, ...s } as never} />
              ))}
            </rec.RecordContextProvider>
          </ctx.SchemaRendererContext.Provider>
        </expr.PredicateScopeProvider>,
      );
    await fn(mount);
  } finally {
    core.ComponentRegistry.unregister?.(NAME, 'element');
    cleanup();
  }
}

/** The forwarded `disabled` prop of the FIRST probe, or `null` if none rendered. */
const disabledProp = (): string | null => {
  const el = screen.queryAllByTestId('probe')[0];
  return el ? el.getAttribute('data-disabled-prop') : null;
};
const shownCount = () => screen.queryAllByTestId('probe').length;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- *
 * Group 0 — the controls that decide whether the rest of the file means
 * anything. Both are about the CAPTURE, not about the renderer.
 * -------------------------------------------------------------------------- */

describe('#6445 group 0 — capture controls', () => {
  it('POSITIVE CONTROL: the spy really observes a line carrying the enablement prefix', () => {
    // Without this, every `toHaveLength(0)` in this file is equally green on a
    // capture that observes nothing at all.
    const warn = spyWarn();
    console.warn(`${UNRESOLVABLE_ENABLEMENT_PREFIX} - synthetic control line`);
    expect(reports(warn)).toHaveLength(1);
  });

  it('DEGENERATE CONTROL: unrelated console output does NOT satisfy the pin', () => {
    const warn = spyWarn();
    console.warn('[object-ui] some entirely unrelated warning');
    console.warn(`${UNRESOLVABLE_VISIBILITY_PREFIX} - a line from the OTHER gate`);
    expect(allWarnings(warn)).toHaveLength(2);
    // The sibling gate's line must not stand in for this one — that is the
    // whole reason the two prefixes are separate constants.
    expect(reports(warn)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- *
 * Group 1 — THE acceptance criterion, per dialect and per key.
 * -------------------------------------------------------------------------- */

describe('#6445 group 1 — a faulting `disabled` gate is loud, and still disables', () => {
  it('THE acceptance criterion: a BARE-STRING `disabled` fault warns in a production build (it printed NOTHING before)', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: FAULT_BARE }]);

      // VERDICT FIRST — observability only. The control is still greyed out,
      // which is exactly the property that made the silence expensive.
      expect(disabledProp()).toBe('true');

      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      // The line has to identify the predicate, the gate and the node, or it is
      // not a diagnostic — it is an alarm with no address.
      expect(lines[0]).toContain(TYPE);
      expect(lines[0]).toContain('n1');
      expect(lines[0]).toContain('disabled');
      expect(lines[0]).toContain(FAULT_BARE);
      expect(lines[0]).toContain('Reason:');
      // ONE fault, ONE line: nothing else was printed alongside it.
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('the `disabledOn` alias reports too — the same wiring, not a copy of it', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabledOn: FAULT_BARE }]);
      expect(disabledProp()).toBe('true');
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('disabledOn');
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('a `{ dialect: "cel" }` envelope fault warns ONCE — the engine\'s generic line is replaced, not joined', async () => {
    // The canonical engine already printed its own line here. The risk of this
    // wiring was two lines for one fault; the total-count pin refuses it.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: FAULT_CEL }]);
      expect(disabledProp()).toBe('true');
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('record.bad(');
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('a `${…}` template fault warns ONCE across many evaluations — that dialect used to print one line PER evaluation', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', disabled: FAULT_TEMPLATE },
        { id: 'n2', disabled: FAULT_TEMPLATE },
        { id: 'n3', disabled: FAULT_TEMPLATE },
      ]);
      expect(shownCount()).toBe(3);
      expect(disabledProp()).toBe('true');
      expect(reports(warn)).toHaveLength(1);
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('development reports it too — one wiring, not a `__DEV__` branch', async () => {
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: FAULT_BARE_DEV }]);
      expect(disabledProp()).toBe('true');
      expect(reports(warn)).toHaveLength(1);
      expect(reports(warn)[0]).toContain(FAULT_BARE_DEV);
      // ONE fault, ONE line of ours — subtracted by NAME rather than by count,
      // so a second copy of OUR line could never hide inside the allowance.
      expect(nonValidatorWarnings(warn)).toHaveLength(1);
      // The RAW total was 2 when this cell was written: ours, plus core's
      // `disabled must be a boolean` line for this very node. That second line
      // was a FALSE POSITIVE — an expression-valued `disabled` is the authoring
      // form the protocol declares — and objectui#6505 removed it, so the dev
      // build now prints exactly one line here. The count is lowered to the
      // measured reality and NOT loosened: this still pins that nothing else
      // reaches the console, which is the whole reason the raw total is worth
      // asserting beside the by-name one above.
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 2 — the rate limit: BOTH halves, and both gates.
 * -------------------------------------------------------------------------- */

describe('#6445 group 2 — deduped per predicate SOURCE and per GATE', () => {
  it('COLLAPSING HALF: three nodes with DIFFERENT ids and the SAME source produce exactly ONE line', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'alpha', disabled: FAULT_BARE },
        { id: 'beta', disabled: FAULT_BARE },
        { id: 'gamma', disabled: FAULT_BARE },
      ]);
      expect(shownCount()).toBe(3);
      expect(reports(warn)).toHaveLength(1);
    });
  });

  it('COLLAPSING HALF: re-rendering the same faulting predicate does NOT add a line', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: FAULT_BARE }]);
      cleanup();
      mount([{ id: 'n1', disabled: FAULT_BARE }]);
      cleanup();
      mount([{ id: 'n1', disabled: FAULT_BARE }]);
      expect(reports(warn)).toHaveLength(1);
    });
  });

  it('COLLAPSING HALF: a two-hundred-row list of ONE broken predicate is one line, not two hundred', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount(Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, disabled: FAULT_BARE })));
      expect(shownCount()).toBe(200);
      expect(reports(warn)).toHaveLength(1);
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('SEPARATING HALF: a SECOND distinct predicate source still warns — without this, a dedupe that suppresses everything looks identical', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', disabled: FAULT_BARE },
        { id: 'n2', disabled: FAULT_BARE_2 },
      ]);
      const lines = reports(warn);
      expect(lines).toHaveLength(2);
      expect(lines.some((l) => l.includes(FAULT_BARE))).toBe(true);
      expect(lines.some((l) => l.includes(FAULT_BARE_2))).toBe(true);
    });
  });

  it('SEPARATING HALF, across KEYS: the same source on `disabled` and on `disabledOn` is two lines', async () => {
    // `key` is in the dedupe key, so the two legs of this gate cannot silence
    // each other. An author who wrote the same broken predicate on both hears
    // about both.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', disabled: FAULT_BARE },
        { id: 'n2', disabledOn: FAULT_BARE },
      ]);
      const lines = reports(warn);
      expect(lines).toHaveLength(2);
      expect(lines.some((l) => l.includes('  disabled: '))).toBe(true);
      expect(lines.some((l) => l.includes('  disabledOn: '))).toBe(true);
    });
  });

  it('SEPARATING HALF, across GATES: the same source on `disabled` and on `visibleWhen` is two lines, one per gate', async () => {
    // The direction this new call site made possible. Both gates share one
    // reporter and one `Set`; if the key ever stopped separating them, the
    // second gate to render would go silent — and every "exactly one line" pin
    // above would still pass. This case is what makes those pins mean
    // "deduped", not "swallowed".
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', disabled: FAULT_BARE },
        { id: 'n2', visibleWhen: FAULT_BARE },
      ]);
      expect(reports(warn)).toHaveLength(1);
      expect(visibilityReports(warn)).toHaveLength(1);
      expect(allWarnings(warn)).toHaveLength(2);
    });
  });

  it('… and in the other mount order, which is the half a shared `Set` could still get wrong', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', visibleWhen: FAULT_BARE },
        { id: 'n2', disabled: FAULT_BARE },
      ]);
      expect(reports(warn)).toHaveLength(1);
      expect(visibilityReports(warn)).toHaveLength(1);
      expect(allWarnings(warn)).toHaveLength(2);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 3 — the silence that makes the noise mean something.
 * -------------------------------------------------------------------------- */

describe('#6445 group 3 — nothing else became loud', () => {
  it('a HEALTHY `disabled` predicate prints nothing, on either verdict', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: HEALTHY_DISABLING }]);
      expect(disabledProp()).toBe('true');
      cleanup();
      mount([{ id: 'n2', disabled: HEALTHY_ENABLING }]);
      expect(disabledProp()).toBe('absent');
      expect(allWarnings(warn)).toHaveLength(0);
    });
  });

  it('the objectui#3862 EMPTY shapes stay enabled and never reach the evaluator — the BLANK ones are now diagnosed (objectui#8069)', async () => {
    // `hasDeclaredPredicate` still decides this one line earlier, so these rows
    // are not FAULTS: nothing reaches this file's enablement reporter. What
    // changed is ADR-0137 D4 ("a gate predicate that is blank ... is
    // diagnosed, never a silent `true`"): the fold itself now reports a BLANK
    // one through core's `[blank]` channel — once per blank spelling, since
    // that key-neutral fold names no node. `null` is not blank text and stays
    // silent. The verdicts are objectui#3862's, unchanged.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'e1', disabled: '' },
        { id: 'e2', disabled: null },
        { id: 'e3', disabled: '   ' },
        { id: 'e4', disabled: { dialect: 'cel', source: '' } },
        { id: 'e5', disabledOn: '' },
      ]);
      expect(shownCount()).toBe(5);
      expect(disabledProp()).toBe('absent');
      expect(reports(warn)).toHaveLength(0);
      const blank = allWarnings(warn).filter((m) => m.includes('[blank]'));
      // `''` and `{ source: '' }` are one blank spelling; `'   '` is another.
      expect(blank).toHaveLength(2);
      expect(allWarnings(warn)).toHaveLength(blank.length);
    });
  });

  it('literal `disabled: true` / `false` and a node with no gate print nothing', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: true }]);
      expect(disabledProp()).toBe('true');
      cleanup();
      mount([{ id: 'n2', disabled: false }]);
      expect(disabledProp()).toBe('absent');
      cleanup();
      mount([{ id: 'n3' }]);
      expect(disabledProp()).toBe('absent');
      expect(allWarnings(warn)).toHaveLength(0);
    });
  });

  it('SUPERSEDED by objectui#6504: an adapter-only `data.*` `disabled` predicate now reports, on the enablement leg — not this fault one', async () => {
    // Was pinned SILENT until the 2026-08-27 ruling (option A) extended
    // objectui#5687's diagnostic to this gate. This predicate never FAULTS —
    // it evaluates perfectly, against the wrong object — so it must never
    // appear on THIS file's `reports()` (the #6445 fault leg); see group 6
    // below for the positive coverage of the new leg.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: "data.status == 'locked'" }]);
      expect(disabledProp()).toBe('absent');
      expect(reports(warn)).toHaveLength(0);
      expect(visibilityReports(warn)).toHaveLength(0);
      // It DOES now report — on its own leg and its own prefix.
      expect(adapterOnlyReports(warn)).toHaveLength(1);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 6 — objectui#6504: the enablement leg of #5687's adapter-only
 * constant-predicate diagnostic. A DIFFERENT fault class than groups 0-5
 * above: nothing here FAULTS (the predicate evaluates perfectly, against the
 * wrong object), so none of it belongs on `reports()` / `UNRESOLVABLE_ENABLEMENT_PREFIX`.
 * -------------------------------------------------------------------------- */

describe('#6504 group 6 — the adapter-only diagnostic, extended to `disabled` / `disabledOn`', () => {
  it('THE acceptance criterion: the card\'s repro shape reports, dev-only, and the verdict is untouched (constant-FALSE direction)', async () => {
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: "data.status == 'locked'" }]);
      // Verdict UNCHANGED — `undefined == 'locked'` is `false`, so the control
      // is NOT disabled here. This diagnostic never moves a verdict.
      expect(disabledProp()).toBe('absent');
      const lines = adapterOnlyReports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(TYPE);
      expect(lines[0]).toContain('n1');
      expect(lines[0]).toContain('disabled');
      expect(lines[0]).toContain("data.status == 'locked'");
      expect(lines[0]).toContain('data.status');
      expect(lines[0]).toContain('CONSTANT');
      // No fault of any kind was reported alongside it.
      expect(reports(warn)).toHaveLength(0);
    });
  });

  it('the DANGEROUS direction the ruling named: a constant `true` greys the control out, silently, on every row', async () => {
    // `data.locked` is undefined on the adapter — one of the deliberate-absence
    // idioms `unresolvedDataPaths`'s own docblock names — so `== null` is
    // `true`: the exact "hands the gate a constant `true`" shape objectui#6504
    // was filed about. This is the case that was previously unreported in
    // EVERY build, with nothing on the console.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: 'data.locked == null' }]);
      expect(disabledProp()).toBe('true');
      expect(adapterOnlyReports(warn)).toHaveLength(1);
    });
  });

  it('the copy is the constant-`true` sentence, NOT a reuse of the visibility copy', async () => {
    // The card's whole design content. "A constant `false` hides the node" is
    // written about a different gate and would be false here; the correct
    // sentence for THIS gate is about a constant `true` greying it out.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: 'data.locked == null' }]);
      const line = adapterOnlyReports(warn)[0];
      expect(line).toContain('constant `true`');
      expect(line).toContain('DISABLED');
      expect(line).toContain('greyed out');
      expect(line).not.toContain('hides the');
      expect(line).not.toContain(ADAPTER_ONLY_DATA_PREDICATE_PREFIX);
      // Still names the deprecated spelling and the fix, same as the sibling.
      expect(line).toContain('record.status');
      expect(line).toContain('objectui#5330');
    });
  });

  it('and the sibling (visibility) leg still prints ITS OWN copy, unchanged — the SAME source, two gates, two different sentences', async () => {
    // The card's other correctness requirement, restated as a same-mount
    // control: `evaluateVisibilityPredicate`'s call site (objectui#5687,
    // untouched by this card) and `evaluateEnablementPredicate`'s (new) fire
    // side by side on the literal same predicate TEXT, and must not cross-talk
    // — each keeps its own prefix and its own consequence sentence.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'nA', visibleWhen: "data.status == 'locked'" },
        { id: 'nB', disabled: "data.status == 'locked'" },
      ]);
      const visLine = adapterOnlyVisibilityReports(warn);
      const enLine = adapterOnlyReports(warn);
      expect(visLine).toHaveLength(1);
      expect(enLine).toHaveLength(1);
      expect(visLine[0]).toContain('nA');
      expect(visLine[0]).toContain('hides the');
      expect(visLine[0]).not.toContain('DISABLED');
      expect(enLine[0]).toContain('nB');
      expect(enLine[0]).toContain('DISABLED');
      expect(enLine[0]).not.toContain('hides the');
    });
  });

  it('FALSE-POSITIVE CONTROL: a genuinely row-dependent `record.*` predicate on `disabled` never fires this leg', async () => {
    // The direction the ruling refuses: a diagnostic that accuses correct
    // usage is worse than none. `record.status` is BOUND at this tier
    // (unlike `data.*`), so this reaches opposite verdicts on the two rows —
    // structurally incapable of being a `data.*` constant.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: HEALTHY_DISABLING }]);
      expect(disabledProp()).toBe('true'); // ROW.status === 'open'
      expect(adapterOnlyReports(warn)).toHaveLength(0);
      expect(reports(warn)).toHaveLength(0);
    });
  });

  it('a GENUINE answered read on `disabled` stays silent — the half that makes the noise mean something', async () => {
    await inDevelopment((mount) => {
      const warn = spyWarn();
      // objectui#9308 — answered by the HOST-published `data`, not the adapter.
      mount([{ id: 'n1', disabled: 'data.total > 0' }], scopeWithData({ total: 99 }));
      expect(disabledProp()).toBe('true'); // a REAL verdict, from a real read
      expect(adapterOnlyReports(warn)).toHaveLength(0);
    });
  });

  it('`disabledOn` reports too — the same wiring as `disabled`, not a copy of it', async () => {
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabledOn: "data.status == 'locked'" }]);
      expect(adapterOnlyReports(warn)[0]).toContain('disabledOn');
    });
  });

  it('⛔ C excluded: a PRODUCTION build reaches the SAME verdict and stays silent — this leg is dev-only, exactly as its sibling is', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: 'data.locked == null' }]);
      // Same verdict as the dev case above — this diagnostic never moves one.
      expect(disabledProp()).toBe('true');
      expect(adapterOnlyReports(warn)).toHaveLength(0);
      expect(
        allWarnings(warn).filter((m) => m.includes(ADAPTER_ONLY_ENABLEMENT_PREDICATE_PREFIX)),
      ).toHaveLength(0);
    });
  });

  it('COLLAPSING HALF: two nodes with different ids and the SAME source produce exactly ONE line', async () => {
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', disabled: "data.status == 'locked'" },
        { id: 'n2', disabled: "data.status == 'locked'" },
      ]);
      expect(adapterOnlyReports(warn)).toHaveLength(1);
    });
  });

  it('SEPARATING HALF, across GATES: the SAME source on `disabled` and on `visibleWhen` is two lines, one per gate', async () => {
    // `key` is part of the dedupe tuple, so the two legs of this diagnostic
    // family cannot silence each other for the identical predicate source —
    // the direction objectui#6445's own dedupe suite pins for the FAULT
    // diagnostic, restated here for the adapter-only one this card adds.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', disabled: "data.status == 'locked'" },
        { id: 'n2', visibleWhen: "data.status == 'locked'" },
      ]);
      expect(adapterOnlyReports(warn)).toHaveLength(1);
      expect(adapterOnlyVisibilityReports(warn)).toHaveLength(1);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 4 — the words. This is the card's design content: the visibility
 * reporter's copy is written for a gate that did NOT bite, and this one DOES.
 * -------------------------------------------------------------------------- */

/** The exact consequence + advice an author reads on THIS gate. */
const ENABLEMENT_TAIL =
  'The node was treated as its safe default, which on THIS gate is the one\n' +
  'that BITES: the node renders DISABLED - on screen, greyed out, refusing\n' +
  'input - and that is indistinguishable from a gate the author meant to\n' +
  'close. No pixel says a predicate failed, so this line is the only thing\n' +
  'that will ever name the one that did it.\n' +
  'Page-component predicates bind `record` (the row on a record page),\n' +
  '`current_user`, and page state as `page.<var>`. Check those roots and the\n' +
  'CEL syntax.';

/** The shipped visibility copy, which must not move. */
// The `visibleWhen` leg fails CLOSED since objectui#13299, so a declared
// predicate that faults prints the `'withholding'` consequence, which names
// the withheld thing as "an element", not a navigation entry (objectui#13303).
const VISIBILITY_TAIL =
  'The element was treated as its safe default, which on THIS gate is the\n' +
  'one that BITES: an element whose visibility predicate cannot be evaluated\n' +
  'is WITHHELD - not drawn - until it can be, so a missing element may be\n' +
  'this fault rather than a gate that said no.\n' +
  'Page-component predicates bind `record` (the row on a record page),\n' +
  '`current_user`, and page state as `page.<var>`. Check those roots and the\n' +
  'CEL syntax.';

describe('#6445 group 4 — the message is true for THIS polarity', () => {
  it('the enablement line names the node, the key, the source and the consequence — word for word', async () => {
    // Asserted against a literal rather than against the formatter: a pin that
    // re-derives the message from the code under test goes green on any wording,
    // including wording that is false.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'save-btn', disabled: FAULT_BARE }]);
      const line = reports(warn)[0];
      expect(line.startsWith(
        `${UNRESOLVABLE_ENABLEMENT_PREFIX} - node "${TYPE}" (id: "save-btn")\n` +
          `  disabled: ${JSON.stringify(FAULT_BARE)}\n` +
          '  Reason: ',
      )).toBe(true);
      expect(line.endsWith(ENABLEMENT_TAIL)).toBe(true);
    });
  });

  it('it does NOT reuse the visibility copy — the sentence that would be FALSE here is absent', async () => {
    // The card's whole design content. "The gate did NOT bite" is written about
    // a gate whose fail-soft default shows the node; here the default greys the
    // control out, and telling the author otherwise sends them hunting for a
    // rendering bug instead of at their own predicate.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: FAULT_BARE }]);
      const line = reports(warn)[0];
      expect(line).not.toContain('gate did NOT bite');
      expect(line).not.toContain(UNRESOLVABLE_VISIBILITY_PREFIX);
      expect(line).not.toContain('reads on screen');
    });
  });

  it('and the visibility gate still prints its own copy', async () => {
    // The other half of the same claim: this card added a second message, it
    // did not edit the first. The visibility leg's copy moved later, with its
    // verdict, to the fail-closed `'withholding'` paragraph (objectui#13299);
    // it is still its OWN copy, not the enablement one.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', visibleWhen: FAULT_BARE }]);
      const line = visibilityReports(warn)[0];
      expect(line.startsWith(
        `${UNRESOLVABLE_VISIBILITY_PREFIX} - node "${TYPE}" (id: "n1")\n` +
          `  visibleWhen: ${JSON.stringify(FAULT_BARE)}\n` +
          '  Reason: ',
      )).toBe(true);
      expect(line.endsWith(VISIBILITY_TAIL)).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 5 — dev and production print the IDENTICAL line.
 * -------------------------------------------------------------------------- */

describe('#6445 group 5 — one message, both builds', () => {
  it('the same fault produces the same bytes in development and in production', async () => {
    // What makes "no `__DEV__` split on this gate" a fact rather than a comment:
    // a build-specific message would be a second diagnostic to keep in sync,
    // and the two would drift.
    let devLine = '';
    await inDevelopment((mount) => {
      const warn = spyWarn();
      // Its OWN source (see `FAULT_BARE_DEV`'s docblock): the dev leg runs on
      // the static module graph this file shares, so reusing another dev cell's
      // source would make this comparison order-dependent.
      mount([{ id: 'n1', disabled: FAULT_BARE_PARITY }]);
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      devLine = lines[0];
      expect(disabledProp()).toBe('true');
    });

    // Restore before spying again: `vi.spyOn` on an already-spied method hands
    // back the SAME spy, so a second `spyWarn()` would carry the dev call into
    // the production reading and the count below would be off by one.
    vi.restoreAllMocks();

    let prodLine = '';
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: FAULT_BARE_PARITY }]);
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      prodLine = lines[0];
      expect(disabledProp()).toBe('true');
    });

    expect(prodLine).toBe(devLine);
  });
});
