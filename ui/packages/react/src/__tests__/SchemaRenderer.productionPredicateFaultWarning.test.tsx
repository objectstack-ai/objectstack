/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6038 — a node-gate predicate that FAULTS is loud in a PRODUCTION
 * build, once per distinct predicate source.
 *
 * Maintainer ruling, 2026-08-25, in-session batch adjudication (verbatim:
 * 「就全部接受，然后继续下一批」) => option B: "production bundles emit a
 * rate-limited, deduplicated warning (one per distinct failing predicate) when
 * a `visibleWhen` / node-gate predicate faults, replacing the current
 * `__DEV__`-only silence. […] A is rejected — the silence is no longer an
 * accepted property." Observability only: the fail-open semantics were NOT this
 * card's to change, so every case below pins the verdict alongside the line.
 * objectui#13299 later moved that verdict: a declared node predicate that
 * faults now fails CLOSED, and the verdict pins below were flipped with it.
 *
 * ## What "the silence" actually was — measured, not assumed
 *
 * The card states production prints nothing. Measured on the built evaluator
 * against `origin/main`, that is true of ONE dialect of three, and the other
 * two fail in opposite directions:
 *
 *   | dialect                | production console, before |
 *   |------------------------|----------------------------|
 *   | bare string            | NOTHING                    |
 *   | `{ dialect: 'cel' }`   | 1 generic line, deduped    |
 *   | `${…}` template        | 1 generic line PER EVALUATION (never deduped) |
 *
 * So the bare-string dialect — the one objectstack#11254 measured a real gate
 * breaking on — was silent, while the template dialect was the flood the
 * ruling's rate-limit clause exists to prevent. Both are now ONE node-bearing
 * line per distinct source, which is why several cases below pin the TOTAL
 * `console.warn` count and not merely the count of matching lines: an
 * implementation that added our line beside the generic one would satisfy
 * "warned once" while doubling what a production console actually shows.
 *
 * ## The two halves of a rate limit, and why one of them is not optional
 *
 * "A warning was emitted" is green on an implementation that emitted fifty, and
 * "exactly one warning was emitted" is green on an implementation that
 * suppresses EVERYTHING after the first line ever printed. Neither pin alone
 * can tell a working dedupe from a broken one, so every dedupe case here pins
 * both: N evaluations of one source => exactly 1 line, AND a second DISTINCT
 * source still => its own line.
 *
 * ## Controls
 *
 * - **Positive control** (`capture` group): the spy sees a line this test emits
 *   itself. Without it, every `toHaveLength(0)` in the file is also green when
 *   the capture is simply broken.
 * - **Degenerate control** (`capture` group): unrelated `console.warn` output
 *   does NOT satisfy the pin — the assertions read a PREFIX-FILTERED view, so
 *   noise from anywhere else in the render cannot stand in for the diagnostic.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 * Restoring `if (!__DEV__) return evaluator.evaluateCondition(raw);` — the line
 * this card replaces — turns RED every production case in groups 1-3 (their
 * report counts fall to 0, except the CEL and template cases, whose GENERIC
 * lines reappear and whose total-warn pins therefore also move), and leaves
 * every verdict assertion and the whole of group 4 GREEN. That asymmetry is
 * the card restated: the change moves the silence, not the answer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { UNRESOLVABLE_VISIBILITY_PREFIX } from '../utils/visibilityDiagnostic';

const NAME = 'probe-6038';
const TYPE = 'element:probe-6038';

const Probe = () => <div data-testid="probe" />;

/** The ambient scope app-shell's `ExpressionProvider` really mounts. */
const APP_SCOPE = {
  current_user: { id: 'u1' },
  user: { id: 'u1' },
  data: {},
  features: {},
};
const ADAPTER = { total: 99 };
const ROW = { id: 'r1', status: 'open' };

/**
 * Predicates that genuinely FAULT, one per dialect, measured on the built
 * evaluator. An unbound ROOT identifier is the shape #11254 hit and the shape
 * an AI-authored predicate reaches for; `record.bad(` is a parse error, which
 * is the only fault the CEL engine reports as `[parse]`.
 */
const FAULT_BARE = 'nosuchroot.x > 1';
const FAULT_BARE_2 = 'anotherbadroot.y == 3';
const FAULT_TEMPLATE = '${nosuchroot.x > 1}';
const FAULT_CEL = { dialect: 'cel', source: 'record.bad(' };
/** A predicate that resolves cleanly — the silence that makes the noise mean something. */
const HEALTHY = "record.status == 'open'";

type WarnSpy = { mock: { calls: unknown[][] } };
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
/** The PREFIX-FILTERED view every assertion reads. */
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
/** Everything the console was asked to print, filtered by nothing. */
const allWarnings = (warn: WarnSpy): string[] => warn.mock.calls.map((c) => String(c[0]));

/**
 * Mount `schemas` in a PRODUCTION module graph.
 *
 * `__DEV__` in `SchemaRenderer` is an IIFE evaluated at module load, so the env
 * has to be stubbed before the import — hence `resetModules` and a dynamic
 * import in the test BODY (the case `object-ui/no-dynamic-import-in-test-hook`
 * exempts). The dedupe `Set` is module state of that same fresh graph, so the
 * reset has to come from the fresh graph too: resetting the statically-imported
 * copy would clear a DIFFERENT `Set` and every count below would be measuring
 * leakage from the previous case.
 */
async function inProduction(
  fn: (mount: (schemas: Record<string, unknown>[]) => void) => void | Promise<void>,
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
    const mount = (schemas: Record<string, unknown>[]) =>
      render(
        <expr.PredicateScopeProvider scope={APP_SCOPE}>
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

describe('#6038 group 0 — capture controls', () => {
  it('POSITIVE CONTROL: the spy really observes a line carrying the prefix', () => {
    // Without this, every `toHaveLength(0)` in this file is equally green on a
    // capture that observes nothing at all.
    const warn = spyWarn();
    console.warn(`${UNRESOLVABLE_VISIBILITY_PREFIX} - synthetic control line`);
    expect(reports(warn)).toHaveLength(1);
  });

  it('DEGENERATE CONTROL: unrelated console output does NOT satisfy the pin', () => {
    // The assertions read a prefix-filtered view precisely so that noise — a
    // React key warning, a deprecation notice, another diagnostic — can never
    // stand in for this diagnostic. A test that counted raw `console.warn`
    // calls would pass on a build that emitted only the noise.
    const warn = spyWarn();
    console.warn('[object-ui] some entirely unrelated warning');
    console.warn('Warning: each child in a list should have a unique "key" prop.');
    expect(allWarnings(warn)).toHaveLength(2);
    expect(reports(warn)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- *
 * Group 1 — THE acceptance criterion, per dialect.
 * -------------------------------------------------------------------------- */

describe('#6038 group 1 — a faulting node gate is loud in production', () => {
  it('THE acceptance criterion: a BARE-STRING `visibleWhen` fault warns in a production build (it printed NOTHING before)', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', visibleWhen: FAULT_BARE }]);

      // Verdict FIRST. The gate fails CLOSED since objectui#13299 (it failed
      // open when this card landed, which is what made the silence dangerous).
      expect(shownCount()).toBe(0);

      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      // The line has to identify the predicate, the gate and the node, or it
      // is not a diagnostic — it is an alarm with no address.
      expect(lines[0]).toContain(TYPE);
      expect(lines[0]).toContain('n1');
      expect(lines[0]).toContain('visibleWhen');
      expect(lines[0]).toContain(FAULT_BARE);
      expect(lines[0]).toContain('Reason:');
      // ONE fault, ONE line: nothing else was printed alongside it.
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('a `{ dialect: "cel" }` envelope fault warns ONCE — the generic line is replaced, not joined', async () => {
    // Before this card the CEL branch already printed the canonical engine's
    // own generic line here. The risk of this card was two lines for one fault;
    // the total-count pin is what refuses it.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', visibleWhen: FAULT_CEL }]);
      expect(shownCount()).toBe(0);
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('record.bad(');
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('a `${…}` template fault warns ONCE across many evaluations — it used to print one line PER evaluation', async () => {
    // The flood direction. Three nodes carrying the same broken template used
    // to produce three generic lines and would produce three per re-render.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', visibleWhen: FAULT_TEMPLATE },
        { id: 'n2', visibleWhen: FAULT_TEMPLATE },
        { id: 'n3', visibleWhen: FAULT_TEMPLATE },
      ]);
      expect(shownCount()).toBe(0);
      expect(reports(warn)).toHaveLength(1);
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('the `hidden` leg — the NON-negated polarity — reports too, and still hides', async () => {
    // `hidden` / `hiddenOn` are the two legs whose fail-soft `true` means HIDE.
    // A fault there removes the node, which is the louder screen symptom and
    // the quieter console one; it must not be a second silence.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hidden: FAULT_BARE }]);
      expect(shownCount()).toBe(0);
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('hidden');
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 2 — the rate limit: BOTH halves.
 * -------------------------------------------------------------------------- */

describe('#6038 group 2 — deduped per predicate SOURCE, not per render and not per node instance', () => {
  it('three nodes with DIFFERENT ids and the SAME predicate source produce exactly ONE line', async () => {
    // This is the "not the call-site instance" half. The ids differ, so a key
    // that included the node instance (or the schema object) would emit three.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'alpha', visibleWhen: FAULT_BARE },
        { id: 'beta', visibleWhen: FAULT_BARE },
        { id: 'gamma', visibleWhen: FAULT_BARE },
      ]);
      expect(shownCount()).toBe(0);
      expect(reports(warn)).toHaveLength(1);
    });
  });

  it('re-rendering the same faulting predicate does NOT add a line — the "not per render" half', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', visibleWhen: FAULT_BARE }]);
      cleanup();
      mount([{ id: 'n1', visibleWhen: FAULT_BARE }]);
      cleanup();
      mount([{ id: 'n1', visibleWhen: FAULT_BARE }]);
      expect(reports(warn)).toHaveLength(1);
    });
  });

  it('a SECOND distinct predicate source still warns — without this, a dedupe that suppresses everything looks identical', async () => {
    // The half that a "warned at least once" test cannot see. An implementation
    // that printed one line ever, for the life of the page, passes every pin
    // above and fails this one.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'n1', visibleWhen: FAULT_BARE },
        { id: 'n2', visibleWhen: FAULT_BARE_2 },
      ]);
      expect(shownCount()).toBe(0);
      const lines = reports(warn);
      expect(lines).toHaveLength(2);
      expect(lines.some((l) => l.includes(FAULT_BARE))).toBe(true);
      expect(lines.some((l) => l.includes(FAULT_BARE_2))).toBe(true);
    });
  });

  it('a two-hundred-row list of ONE broken predicate is one line, not two hundred', async () => {
    // The scenario the ruling's own cost table names ("一个列表里几百行会淹没
    // 控制台"). It is the same property as the case above, at the scale that
    // decides whether option B is usable.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount(Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, visibleWhen: FAULT_BARE })));
      expect(shownCount()).toBe(0);
      expect(reports(warn)).toHaveLength(1);
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 3 — the silence that makes the noise mean something.
 * -------------------------------------------------------------------------- */

describe('#6038 group 3 — nothing else became loud', () => {
  it('a HEALTHY predicate prints nothing, on either verdict', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', visibleWhen: HEALTHY }]);
      expect(shownCount()).toBe(1);
      cleanup();
      mount([{ id: 'n2', visibleWhen: "record.status == 'closed'" }]);
      expect(shownCount()).toBe(0);
      expect(allWarnings(warn)).toHaveLength(0);
    });
  });

  it('a node with NO gate at all prints nothing and renders', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1' }]);
      expect(shownCount()).toBe(1);
      expect(allWarnings(warn)).toHaveLength(0);
    });
  });

  it('objectui#5687 stays DEV-ONLY: an adapter-only `data.*` predicate is silent in production', async () => {
    // Deliberately NOT extended by this card. That leg reports a predicate that
    // evaluated perfectly against the wrong object — not a fault — and its own
    // ruling (2026-08-22, option A) scoped it to development. Pinned here so
    // "production is louder" cannot quietly become "production reports
    // everything the dev build reports".
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', visibleWhen: "data.status == 'draft'" }]);
      // Verdict: the constant-false still hides, exactly as documented.
      expect(shownCount()).toBe(0);
      expect(allWarnings(warn)).toHaveLength(0);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 4 — development is unchanged, and says the same words.
 * -------------------------------------------------------------------------- */

describe('#6038 group 4 — dev and production print the IDENTICAL line', () => {
  it('the same fault produces the same message in a development build', async () => {
    // Two builds, one message. This is what makes "the `__DEV__` gate now
    // decides HOW the fault is detected, not WHETHER it is reported" a fact
    // rather than a comment: a production-only message would be a second
    // diagnostic to keep in sync, and they would drift.
    const { __resetVisibilityPredicateWarnings } = await import('../utils/visibilityDiagnostic');
    const { SchemaRenderer } = await import('../SchemaRenderer');
    const { SchemaRendererContext } = await import('../context/SchemaRendererContext');
    const { RecordContextProvider } = await import('../context/RecordContext');
    const { PredicateScopeProvider } = await import('../hooks/useExpression');
    const { ComponentRegistry } = await import('@object-ui/core');
    ComponentRegistry.register(NAME, Probe as never, {
      namespace: 'element',
      skipFallback: true,
    } as never);
    __resetVisibilityPredicateWarnings();

    const warn = spyWarn();
    render(
      <PredicateScopeProvider scope={APP_SCOPE}>
        <SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
          <RecordContextProvider objectName="showcase_task" recordId={ROW.id} data={ROW}>
            <SchemaRenderer schema={{ type: TYPE, id: 'n1', visibleWhen: FAULT_BARE } as never} />
          </RecordContextProvider>
        </SchemaRendererContext.Provider>
      </PredicateScopeProvider>,
    );
    const devLines = reports(warn);
    expect(devLines).toHaveLength(1);
    expect(devLines[0]).toContain(TYPE);
    expect(devLines[0]).toContain(FAULT_BARE);
    // Dev fails closed too (objectui#13299) — the verdict is one behaviour,
    // not two.
    expect(shownCount()).toBe(0);
    ComponentRegistry.unregister?.(NAME, 'element');

    // Restore before spying again: `vi.spyOn` on an already-spied method hands
    // back the SAME spy, so a second `spyWarn()` here would carry the dev call
    // into the production reading and every count below would be off by the
    // lines this half already made. (Measured — it is how this case first
    // failed, at 2 lines instead of 1.)
    vi.restoreAllMocks();

    // …and the production graph's line for the same fault, word for word.
    let prodLine = '';
    await inProduction((mount) => {
      const prodWarn = spyWarn();
      mount([{ id: 'n1', visibleWhen: FAULT_BARE }]);
      const lines = reports(prodWarn);
      expect(lines).toHaveLength(1);
      prodLine = lines[0];
    });
    expect(prodLine).toBe(devLines[0]);
  });
});
