/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5687 — a node-gate `data.*` predicate the adapter cannot answer is
 * LOUD, and nothing else moves.
 *
 * Maintainer ruling, 2026-08-22, option A: the node tier keeps its documented
 * `data` = adapter semantics. No verdict changes, no interpolation changes —
 * objectui#5330's row binding does NOT extend to this tier. Instead the
 * objectui#5454 reporter posture is extended to this NON-throwing path, so an
 * author sees the constant-false instead of shipping it.
 *
 * ## The pin is a TRIPLE, not a pair
 *
 * Two of the three cases here are negatives, and they are the half that keeps
 * the report honest:
 *
 *   1. the card's reproduction shape (`properties: { visible: "data.status ==
 *      'draft'" }`) reports — and still hides, on every row;
 *   2. a canonical `record.*` predicate stays SILENT;
 *   3. a genuine adapter read (`${data.total}` against an adapter that HAS
 *      `total`) stays SILENT.
 *
 * Drop any one and the file is green on an implementation that reports
 * everything, or nothing.
 *
 * ## The control that decides WHICH discriminator is implemented
 *
 * "Reports the repro" is satisfied by three mutually incompatible triggers.
 * `same predicate text, adapter ANSWERS it` (group 2c) is what separates them:
 * it holds the predicate source and the `false` verdict fixed and moves only
 * whether the adapter has the key. A "references `data.`" trigger fails it; a
 * "the predicate is constant-false" trigger fails it; only "a `data.*` read the
 * bound object does not answer" passes it.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Deleting the `reportAdapterOnlyDataPredicate` call in `SchemaRenderer`'s
 * `evaluateVisibilityPredicate` turns RED exactly the four positive cases in
 * group 1 and the dedupe case, and leaves every silence case and every verdict
 * assertion green — that asymmetry IS leg-3-of-#5454's property, restated: the
 * change moves the silence, not the answer. Removing the `unresolved.length`
 * guard instead turns RED the silence cases (2a/2b/2c/3a/3b) while group 1 stays
 * green, which is the false-positive direction the ruling refuses.
 *
 * ## objectui#9308 — WHICH object `data` names moved; the triple did not
 *
 * The 2026-08-22 ruling above said the node tier "keeps its documented
 * `data` = adapter semantics". The 2026-09-13 ruling on objectui#9308 retired
 * exactly that: the renderer binds no `data` root, and the only `data` at this
 * tier is one a HOST published through `PredicateScopeProvider`. The three
 * cases this docblock names are unchanged in SHAPE — repro reports, `record.*`
 * stays silent, an answered read stays silent — but the object that answers,
 * and the object the diagnostic resolves against, is now that host `data`.
 * `ADAPTER` is still injected on every mount and is inert; group 2c is what
 * keeps the re-aim honest, because it moves a key the adapter never has.
 *
 * The population with NO `data` anywhere — the real app-shell shape — does not
 * reach this file's diagnostic at all: the predicate throws `data is not
 * defined` and objectui#5454's reporter takes it. That leg, and the verdict
 * move it carries, is pinned in `SchemaRenderer.dataRootUnbound-9308.test.tsx`.
 *
 * ## objectui#5756 — the KNOWN LIMIT below is now FIXED, not pinned as a gap
 *
 * The 2026-08-22 "no interpolation changes" ruling quoted above was **this
 * card's own scope constraint**, not a standing ban — objectui#5756 is the
 * deliberate carrier for the `${…}`-inside-`properties` surface it fenced off.
 * The test immediately below used to assert ZERO reports for that spelling;
 * it now asserts ONE, and its describe-group comment is updated to match. What
 * still stands, unchanged by #5756: no verdict changed (see `#5756 group 5`
 * below for the byte-identical-verdict control), and every OTHER case in this
 * file — the two negatives this docblock names, the record.* bucket, the
 * production build — stays exactly as pinned here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import {
  __resetVisibilityPredicateWarnings,
  ADAPTER_ONLY_DATA_PREDICATE_PREFIX,
  UNRESOLVABLE_VISIBILITY_PREFIX,
} from '../utils/visibilityDiagnostic';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { RecordContextProvider } from '../context/RecordContext';
import { PredicateScopeProvider } from '../hooks/useExpression';

const NAME = 'probe-5687';
const TYPE = 'element:probe-5687';

const Probe = (props: { content?: unknown }) => (
  <div data-testid="probe" data-content={props.content === undefined ? 'absent' : String(props.content)} />
);

/**
 * The data-source ADAPTER — what `SchemaRendererContext` carries.
 *
 * ⭐ Since objectui#9308 it is INERT for every assertion in this file: the
 * renderer no longer publishes it as the `data` root. It is still injected on
 * every mount below, and that is the point — the groups that stay silent do so
 * because the SCOPE answers, never because this object does. Note it carries
 * `total` while group 2's scope carries `total` too: if the re-aim were ever
 * reverted, group 2 would go on passing for the wrong reason, which is why
 * group 2c moves `status` and this object deliberately never gains one.
 */
const ADAPTER = { total: 99 };
/** The host-published `data` group 2c asks for. */
const DATA_WITH_STATUS = { total: 99, status: 'draft' };
/** …and the polarity that makes group 2c's `false` a verdict, not an absence. */
const DATA_WITH_OTHER_STATUS = { total: 99, status: 'published' };

const DRAFT = { id: 'r1', status: 'draft' };
const PUBLISHED = { id: 'r2', status: 'published' };

const cel = (source: string) => ({ dialect: 'cel', source });

/**
 * A HOST scope that publishes its own `data` root through the documented
 * channel (`PredicateScopeProvider`).
 *
 * ⚠️ This is NOT what app-shell's `ExpressionProvider` mounts, and the comment
 * that used to say so was stale: `buildExpressionScope` returns
 * `{ current_user, user, ctx, os, features }` and has published no `data` since
 * objectui#8166. Keeping an (empty) `data` here is deliberate — since
 * objectui#9308 the renderer binds no `data` of its own, so a host publication
 * is the ONLY way this file's subject (a `data.*` read the bound `data` cannot
 * answer) is reachable at all. The other population — no `data` anywhere, the
 * real app-shell shape — is objectui#5454's leg and is pinned in
 * `SchemaRenderer.dataRootUnbound-9308.test.tsx` leg 7.
 */
const APP_SCOPE = {
  current_user: { id: 'u1', email_verified: true },
  user: { id: 'u1', email_verified: true },
  data: {},
  features: {},
};

/** The same host scope, publishing a `data` root that DOES answer. */
const scopeWithData = (data: Record<string, unknown>) => ({ ...APP_SCOPE, data });

function mount(
  schema: Record<string, unknown>,
  record?: Record<string, unknown>,
  adapter: unknown = ADAPTER,
  scope: Record<string, unknown> = APP_SCOPE,
) {
  const tree = (
    <PredicateScopeProvider scope={scope}>
      <SchemaRendererContext.Provider value={{ dataSource: adapter } as never}>
        <SchemaRenderer schema={{ type: TYPE, ...schema } as never} />
      </SchemaRendererContext.Provider>
    </PredicateScopeProvider>
  );
  return render(
    record === undefined
      ? tree
      : (
        <RecordContextProvider objectName="showcase_task" recordId={String(record.id)} data={record}>
          {tree}
        </RecordContextProvider>
      ),
  );
}

const shown = () => screen.queryByTestId('probe') !== null;

/**
 * The structural shape a `console.warn` spy presents, spelled locally.
 * `ReturnType<typeof vi.spyOn>` erases the argument tuple, so the callbacks
 * below lose their types under `noImplicitAny`.
 */
type WarnSpy = { mock: { calls: unknown[][] } };

/** Lines carrying THIS leg's prefix. */
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map(c => String(c[0])).filter(m => m.includes(ADAPTER_ONLY_DATA_PREDICATE_PREFIX));
/** Lines carrying the objectui#5454 leg's prefix — a different fault. */
const unresolvableReports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map(c => String(c[0])).filter(m => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

beforeEach(() => {
  ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
  __resetVisibilityPredicateWarnings();
});
afterEach(() => {
  cleanup();
  ComponentRegistry.unregister?.(NAME, 'element');
  vi.restoreAllMocks();
});

describe('#5687 group 1 — the card\'s reproduction shape is reported', () => {
  it('THE acceptance criterion: `properties: { visible: "data.status == \'draft\'" }` warns, and still hides on EVERY row', () => {
    const warn = spyWarn();
    // The exact shape the card names. `properties.visible` is hoisted onto the
    // node by the memo and lands on the `visible` leg of the chain.
    mount({ properties: { visible: "data.status == 'draft'" } }, DRAFT);
    // Verdict UNCHANGED — the ruling refuses a verdict change, and this is the
    // constant-false the author would otherwise have shipped.
    expect(shown()).toBe(false);
    const msg = reports(warn)[0];
    expect(msg).toBeDefined();
    expect(msg).toContain(TYPE);
    expect(msg).toContain('visible');
    expect(msg).toContain("data.status == 'draft'");
    // The read that could not be answered, named — not just "something is wrong".
    expect(msg).toContain('data.status');
    // The two sentences that make it actionable rather than merely noted.
    expect(msg).toContain('CONSTANT');
    expect(msg).toContain('record.status');
  });

  it('… and hides on the OTHER row too, which is what "on every row" means', () => {
    // The row polarity pair. A gate that depends on the row would differ here;
    // this one cannot, and that is the defect.
    const warn = spyWarn();
    mount({ properties: { visible: "data.status == 'draft'" } }, DRAFT);
    expect(shown()).toBe(false);
    cleanup();
    mount({ properties: { visible: "data.status == 'draft'" } }, PUBLISHED);
    expect(shown()).toBe(false);
    expect(reports(warn).length).toBeGreaterThan(0);
  });

  it('the paired control: the same node with NO gate renders on both rows', () => {
    // Without this, "hidden" above could be "this node never renders" —
    // `SchemaRenderer` has several other paths to rendering nothing.
    const warn = spyWarn();
    mount({}, DRAFT);
    expect(shown()).toBe(true);
    cleanup();
    mount({}, PUBLISHED);
    expect(shown()).toBe(true);
    expect(reports(warn)).toHaveLength(0);
  });

  it('the `${…}` template dialect reports too — at the tier where it survives to the gate', () => {
    // A node-level key is NOT pre-evaluated by the memo (only `content`,
    // `props` and `properties` are), so the template reaches the chain with its
    // `data.` text intact. This is the spelling `@object-ui/types`' own protocol
    // comments use (`hidden?: string; // expression: "${data.role != 'admin'}"`).
    const warn = spyWarn();
    mount({ visibleWhen: "${data.status == 'draft'}" }, DRAFT);
    expect(shown()).toBe(false);
    expect(reports(warn)).toHaveLength(1);
  });

  it('FIXED by objectui#5756: a `${…}` template INSIDE `properties` now reports too', () => {
    // Was a structural consequence of an ordering: the memo evaluates every
    // `properties.*` value BEFORE the hoist ("Evaluating first is what makes
    // one key mean one thing"), and measured on `@object-ui/core`'s evaluator:
    //
    //   evaluate("data.status == 'draft'")   -> "data.status == 'draft'"  (verbatim)
    //   evaluate("${data.status == 'draft'}") -> false                    (boolean)
    //
    // So the bare string — the card's pinned repro — arrived at the gate with
    // its `data.` text intact and was already reported, while the template
    // arrived as a plain `false` with nothing left to detect. objectui#5756
    // reaches it by diagnosing INSIDE the `properties` evaluation loop, on the
    // RAW pre-evaluation text, before it collapses — see
    // `winningVisibilityKey` in `SchemaRenderer.tsx`.
    //
    // The verdict is UNCHANGED: the block is still hidden on every row. Only
    // the silence moved — see `#5756 group 5` below for the control that pins
    // this as byte-identical, not merely "still hidden".
    const warn = spyWarn();
    mount({ properties: { visible: "${data.status == 'draft'}" } }, DRAFT);
    expect(shown()).toBe(false);
    const msg = reports(warn)[0];
    expect(msg).toBeDefined();
    expect(msg).toContain(TYPE);
    expect(msg).toContain('visible');
    expect(msg).toContain("${data.status == 'draft'}");
    expect(msg).toContain('data.status');
    cleanup();
    mount({ properties: { visible: "${data.status == 'draft'}" } }, PUBLISHED);
    expect(shown()).toBe(false); // constant across rows, exactly as in group 1
    // Deduped across both mounts — same (type, key, source) triple, matching
    // group 1's "deduped" case exactly, not a second implementation of it.
    expect(reports(warn)).toHaveLength(1);
  });

  it('a node-level `visibleWhen` written the deprecated way reports on ITS key', () => {
    const warn = spyWarn();
    mount({ visibleWhen: "data.status == 'draft'" }, DRAFT);
    expect(shown()).toBe(false);
    expect(reports(warn)[0]).toContain('visibleWhen');
  });

  it('the NON-negated `hidden` leg reports too, and keeps its own inverted answer', () => {
    // `hidden` is not negated: a constant-`false` there means the node stays
    // SHOWN by a gate that was meant to hide it. Equally constant, equally
    // silent before this change — and the verdict is untouched here as well.
    const warn = spyWarn();
    mount({ hidden: "data.status == 'draft'" }, DRAFT);
    expect(shown()).toBe(true);
    expect(reports(warn)[0]).toContain('hidden');
  });

  it('deduped: one line per (node type, key, predicate), not one per render', () => {
    // Matches objectui#5454's posture exactly — same Set, same key shape.
    const warn = spyWarn();
    mount({ properties: { visible: "data.status == 'draft'" } }, DRAFT);
    cleanup();
    mount({ properties: { visible: "data.status == 'draft'" } }, PUBLISHED);
    expect(reports(warn)).toHaveLength(1);
  });
});

describe('#5687 group 2 — a genuine adapter read stays SILENT', () => {
  it('2a: `${data.total}` in a props bag still interpolates, and says nothing', () => {
    // A props-bag interpolation never reaches the visibility chain at all —
    // asserted here so the claim is measured, not inferred from where the call
    // site happens to sit. objectui#9308: the object it interpolates from is
    // the host's scope `data`, not the adapter.
    const warn = spyWarn();
    mount({ properties: { content: '${data.total}' } }, DRAFT, ADAPTER, scopeWithData({ total: 99 }));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-content', '99');
    expect(reports(warn)).toHaveLength(0);
  });

  it('2b: a `data.*` VISIBILITY gate the host scope answers is silent, on both polarities', () => {
    // The harder half of 2a: this one DOES reach the reporter's call site, and
    // is silent because the bound `data` answers the read.
    const warn = spyWarn();
    mount({ properties: { visible: 'data.total > 0' } }, DRAFT, ADAPTER, scopeWithData({ total: 99 }));
    expect(shown()).toBe(true);
    cleanup();
    mount({ properties: { visible: 'data.total > 100' } }, DRAFT, ADAPTER, scopeWithData({ total: 99 }));
    // A correctly-hiding gate. This is also the case that DISQUALIFIES a
    // "the predicate is constant-false" trigger: the verdict here is `false`,
    // exactly as in group 1, and it must stay silent.
    expect(shown()).toBe(false);
    expect(reports(warn)).toHaveLength(0);
  });

  it('2c: SAME predicate text, SAME `false` verdict — silent once the bound `data` has the key', () => {
    // The control that picks the discriminator. Only the bound `data` moves;
    // the adapter is the same object in both halves and in group 1.
    const warn = spyWarn();
    mount({ properties: { visible: "data.status == 'draft'" } }, DRAFT, ADAPTER, scopeWithData(DATA_WITH_STATUS));
    expect(shown()).toBe(true);
    cleanup();
    mount({ properties: { visible: "data.status == 'draft'" } }, DRAFT, ADAPTER, scopeWithData(DATA_WITH_OTHER_STATUS));
    expect(shown()).toBe(false); // a real verdict, from a real read
    expect(reports(warn)).toHaveLength(0);
  });

  it('2d: a predicate that merely QUOTES `data.status` reads nothing and says nothing', () => {
    // The scan is lexical, so string literals are stripped before it runs.
    // Not hypothetical: examples/schema-catalog carries `data.features` inside
    // a JS snippet in a `content` string.
    const warn = spyWarn();
    mount({ properties: { visible: "record.status == 'data.status'" } }, DRAFT);
    expect(shown()).toBe(false);
    expect(reports(warn)).toHaveLength(0);
  });
});

describe('#5687 group 3 — the `record.*` bucket is NOT this card, and cannot be caught by it', () => {
  it('3a: a canonical `record.*` predicate reaches opposite verdicts and stays silent', () => {
    // objectui#5401 → umbrella #5454 bound `record` at this tier. Same
    // evaluator, different identifier, different correct fix. This leg must be
    // structurally incapable of firing on it.
    const warn = spyWarn();
    mount({ properties: { visible: "record.status == 'draft'" } }, DRAFT);
    expect(shown()).toBe(true);
    cleanup();
    mount({ properties: { visible: "record.status == 'draft'" } }, PUBLISHED);
    expect(shown()).toBe(false);
    expect(reports(warn)).toHaveLength(0);
  });

  it('3b: an UNBOUND `record.*` predicate is still the OTHER reporter\'s case, not this one', () => {
    // With no row mounted, `record.status` cannot resolve. That is #5454's
    // fault, reported by #5454's function. This leg must add nothing — two
    // reports for one predicate would be the "two adjacent reporters" outcome.
    const warn = spyWarn();
    mount({ visibleWhen: cel("record.status == 'draft'") }, undefined);
    // Withheld: a declared predicate that faults fails closed (objectui#13299).
    expect(shown()).toBe(false);
    expect(unresolvableReports(warn).length).toBeGreaterThan(0);
    expect(reports(warn)).toHaveLength(0);
  });

  it('3c: `metadata.*` is not `data.*` — a longer identifier that merely ENDS in "data"', () => {
    // The loose-sweep trap, mechanised. `metadata` is not this evaluator's
    // `data` root, so nothing here is a `data.*` read — even though the raw
    // source text does contain the substring `data.`.
    //
    // `metadata` is BOUND in the scope on purpose, and the ablation is why.
    // Written without it the predicate THROWS ("metadata is not defined"),
    // lands in the objectui#5454 catch, and never reaches this leg at all — so
    // it was green for a reason that had nothing to do with the boundary it
    // claims to check, and survived the "report on any `data.` mention"
    // ablation that it exists to kill. Measured, then fixed.
    const warn = spyWarn();
    const scopeWithMetadata = { ...APP_SCOPE, metadata: { status: 'published' } };
    mount(
      { properties: { visible: "metadata.status == 'draft'" } },
      DRAFT,
      ADAPTER,
      scopeWithMetadata,
    );
    expect(shown()).toBe(false); // a real verdict off a real read — not a throw
    expect(reports(warn)).toHaveLength(0);
    expect(unresolvableReports(warn)).toHaveLength(0);
  });

  it('3d: `record.data.*` is the ROW\'s own field, not this evaluator\'s `data` root', () => {
    const warn = spyWarn();
    mount({ properties: { visible: "record.data.status == 'draft'" } }, { id: 'r3', data: { status: 'x' } });
    expect(reports(warn)).toHaveLength(0);
  });

  it('3e: a CEL envelope reading `data.*` already throws — reported ONCE, by #5454', () => {
    // Measured on this base: `{ dialect: 'cel' }` routes to `evalFieldPredicate`,
    // whose bag binds values under `record.`, so `data.status` FAULTS and
    // `throwOnError` raises. The card's premise ("this path never throws") holds
    // for the bare-string and template dialects only. This leg runs after a
    // clean evaluation, so it cannot double-report — pinned here rather than
    // argued.
    const warn = spyWarn();
    mount({ visibleWhen: cel("data.status == 'draft'") }, DRAFT);
    expect(unresolvableReports(warn).length).toBeGreaterThan(0);
    expect(reports(warn)).toHaveLength(0);
  });
});

describe('#5687 group 4 — production is untouched', () => {
  it('a PRODUCTION build reaches the SAME verdicts and prints nothing', async () => {
    // THIS leg — objectui#5687's adapter-only `data.*` report — is dev-only,
    // and stays so: its own ruling (2026-08-22, option A) scoped it there, and
    // it does not describe a fault at all (the predicate evaluated perfectly,
    // against the wrong object). The SIBLING leg no longer is: objectui#6038
    // took the `__DEV__` gate off `reportUnresolvableVisibilityPredicate`, so
    // a FAULTING predicate is reported in production too. That is why every
    // assertion below filters on `ADAPTER_ONLY_DATA_PREDICATE_PREFIX` rather
    // than counting raw `console.warn` calls. A gate that changed the ANSWER
    // would be a fork, and none of these verdicts moved.
    //
    // The dynamic import lives in the test BODY, not a hook: it has to read
    // module state that only exists after `resetModules` + `stubEnv`, which is
    // the case `object-ui/no-dynamic-import-in-test-hook` exempts.
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const warn = spyWarn();
      const [core, prod, ctx, rec, expr] = await Promise.all([
        import('@object-ui/core'),
        import('../SchemaRenderer'),
        import('../context/SchemaRendererContext'),
        import('../context/RecordContext'),
        import('../hooks/useExpression'),
      ]);
      core.ComponentRegistry.register(NAME, Probe as never, { namespace: 'element', skipFallback: true } as never);
      const mountProd = (
        schema: Record<string, unknown>,
        record: Record<string, unknown>,
        scope: Record<string, unknown> = APP_SCOPE,
      ) => render(
        <expr.PredicateScopeProvider scope={scope}>
          <ctx.SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
            <rec.RecordContextProvider objectName="showcase_task" recordId={String(record.id)} data={record}>
              <prod.SchemaRenderer schema={{ type: TYPE, ...schema } as never} />
            </rec.RecordContextProvider>
          </ctx.SchemaRendererContext.Provider>
        </expr.PredicateScopeProvider>,
      );

      // The repro shape: same constant-false, same hidden block.
      mountProd({ properties: { visible: "data.status == 'draft'" } }, DRAFT);
      expect(shown()).toBe(false);
      cleanup();
      // The genuine answered read: same interpolation (objectui#9308 — from the
      // host-published `data`, not from the adapter).
      mountProd({ properties: { content: '${data.total}' } }, DRAFT, scopeWithData({ total: 99 }));
      expect(screen.getByTestId('probe')).toHaveAttribute('data-content', '99');
      cleanup();
      // The canonical spelling: same two verdicts.
      mountProd({ properties: { visible: "record.status == 'draft'" } }, DRAFT);
      expect(shown()).toBe(true);
      cleanup();
      mountProd({ properties: { visible: "record.status == 'draft'" } }, PUBLISHED);
      expect(shown()).toBe(false);
      cleanup();
      // objectui#5756: the TEMPLATE spelling of the repro — same constant-false,
      // same hidden block, and (unlike dev) no report is even attempted, since
      // the whole diagnostic block is behind `if (__DEV__)`.
      mountProd({ properties: { visible: "${data.status == 'draft'}" } }, DRAFT);
      expect(shown()).toBe(false);
      // …and none of this module's output, on any of them.
      expect(warn.mock.calls.map(c => String(c[0])).filter(m => m.includes(ADAPTER_ONLY_DATA_PREDICATE_PREFIX))).toHaveLength(0);
      core.ComponentRegistry.unregister?.(NAME, 'element');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

/**
 * objectui#5756 — the two design points the card left to this seat, each
 * pinned as its own case, plus the control the dispatch required explicitly:
 * a value-level (not just verdict-level) proof that interpolation itself is
 * untouched.
 */
describe('#5756 group 5 — the design points this card left open', () => {
  it('5a: an OUTRANKED `properties.visible` template stays silent — a co-declared `visibleWhen` decides instead', () => {
    // Mirrors #5454's own leg semantics: `evaluateVisibilityPredicate` is only
    // ever CALLED on the leg `shouldHide`'s early-return chain actually
    // consults, so an outranked leg's predicate — however broken — was never
    // going to be diagnosed by that reporter either. This card's early call
    // site (inside the `properties` loop) has to earn that same restraint on
    // purpose, via `winningVisibilityKey`, rather than reporting every
    // `${…}`-templated visibility key present regardless of whether the chain
    // ever reaches it.
    const warn = spyWarn();
    mount(
      { visibleWhen: 'true', properties: { visible: "${data.status == 'draft'}" } },
      DRAFT,
    );
    // `visibleWhen` wins the precedence chain and says SHOW — the outranked
    // `properties.visible` template decides NOTHING about what's on screen.
    expect(shown()).toBe(true);
    // Neither leg reports: `visibleWhen: 'true'` has no `data.` text to flag,
    // and `properties.visible`'s template — despite being exactly the card's
    // repro shape — is never even looked at, because it never wins.
    expect(reports(warn)).toHaveLength(0);
  });

  it('5b: a GENUINE answered read spelled as a `properties` TEMPLATE stays silent, on both polarities', () => {
    // The template-dialect sibling of group 2b — extending that silence to
    // the spelling this card's diagnostic newly reaches, so the new call site
    // does not turn every properties-authored template gate into noise.
    const warn = spyWarn();
    mount({ properties: { visible: '${data.total > 0}' } }, DRAFT, ADAPTER, scopeWithData({ total: 99 }));
    expect(shown()).toBe(true); // 99 > 0
    cleanup();
    mount({ properties: { visible: '${data.total > 100}' } }, DRAFT, ADAPTER, scopeWithData({ total: 99 }));
    expect(shown()).toBe(false); // 99 > 100 is a REAL verdict, not an absence
    expect(reports(warn)).toHaveLength(0);
  });

  it('5c: the NON-negated `hidden` leg, template-in-properties, reports and keeps its inverted answer', () => {
    // The template-dialect sibling of group 1's `hidden` case. `hidden` is not
    // negated, so a predicate that evaluates to `false` (the adapter has no
    // `status`, so `undefined == 'draft'` is `false`) means "do NOT hide" —
    // the node stays SHOWN, same as the bare-string spelling.
    const warn = spyWarn();
    mount({ properties: { hidden: "${data.status == 'draft'}" } }, DRAFT);
    expect(shown()).toBe(true);
    const msg = reports(warn)[0];
    expect(msg).toBeDefined();
    expect(msg).toContain('hidden');
    expect(msg).toContain('data.status');
  });

  it('5d: a template-in-properties predicate that FAULTS reports via the #5454 (unresolvable) leg, not the #5687/#5756 (adapter-only) one', () => {
    // The two reporters stay two reporters for this spelling too: a genuine
    // fault (undefined identifier) is #5454's case, and this leg's dedupe Set
    // is shared but keyed by reporter name, so the two cannot silence one
    // another for the same predicate.
    const warn = spyWarn();
    mount({ properties: { visible: '${totallyUndefinedIdentifierXYZ}' } }, DRAFT);
    expect(shown()).toBe(false); // withheld: a faulting declared gate fails closed (objectui#13299)
    expect(unresolvableReports(warn).length).toBeGreaterThan(0);
    expect(reports(warn)).toHaveLength(0);
  });

  it('5e: interpolation-unchanged CONTROL — the evaluated `properties.visible` value the schema carries is a plain, real boolean, not something the diagnostic call altered', () => {
    // The dispatch's explicit ask: prove the diagnostic is read-only, at the
    // VALUE level, not only at the verdict (`shown()`) level every other case
    // here already pins. `SchemaValueProbe` reads `props.schema.properties.*`
    // directly — the exact value `newSchema.properties` carries after BOTH
    // the evaluation loop AND the new diagnostic call have run — so this is
    // the evaluated value a hypothetical OTHER renderer reading the raw
    // `properties` bag (rather than the hoisted top-level key) would see.
    //
    // The predicate is the card's repro with the polarity FLIPPED
    // (`!=` instead of `==`) rather than reused verbatim: the repro's own
    // spelling evaluates to `false`, which would hide the probe itself and
    // leave nothing mounted to read a value off of. `data.status` is still
    // unresolved on this adapter either way — `unresolvedDataPaths` scans
    // text, not verdicts — so the diagnostic still fires; only the verdict
    // this control reads off flips, on purpose, to `true`.
    const VALUE_PROBE_NAME = 'probe-5756-value';
    const VALUE_PROBE_TYPE = 'element:probe-5756-value';
    const SchemaValueProbe = (props: { schema?: { properties?: Record<string, unknown> } }) => (
      <div
        data-testid="value-probe"
        data-visible={String(props.schema?.properties?.visible)}
        data-visible-type={typeof props.schema?.properties?.visible}
      />
    );
    ComponentRegistry.register(VALUE_PROBE_NAME, SchemaValueProbe as never, { namespace: 'element', skipFallback: true } as never);
    try {
      const warn = spyWarn();
      render(
        <PredicateScopeProvider scope={APP_SCOPE}>
          <SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
            <RecordContextProvider objectName="showcase_task" recordId="r1" data={DRAFT}>
              <SchemaRenderer schema={{ type: VALUE_PROBE_TYPE, properties: { visible: "${data.status != 'draft'}" } } as never} />
            </RecordContextProvider>
          </SchemaRendererContext.Provider>
        </PredicateScopeProvider>,
      );
      const el = screen.getByTestId('value-probe');
      // A plain JS `true` — `evaluator.evaluate("${data.status != 'draft'}")`'s
      // OWN answer, exactly as it was before this card, not a string, not the
      // literal template text, and not some sentinel the diagnostic left behind.
      expect(el).toHaveAttribute('data-visible-type', 'boolean');
      expect(el).toHaveAttribute('data-visible', 'true');
      // The diagnostic still ran (this IS the winning, properties-sourced,
      // `${…}`-templated key) — the control is that it ran WITHOUT touching
      // the value above, not that it didn't run.
      expect(reports(warn)).toHaveLength(1);
    } finally {
      ComponentRegistry.unregister?.(VALUE_PROBE_NAME, 'element');
    }
  });
});
