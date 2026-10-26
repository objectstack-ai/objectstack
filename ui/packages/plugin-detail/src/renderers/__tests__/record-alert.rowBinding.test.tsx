/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:alert` binds the row through the SHARED helper (objectui#4807), and
 * the helper binds `record.*` only (objectui#5741)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `record:alert` was the last predicate face in the repo still handing
 * `useCondition` a local ROOT-ONLY bag (`{ record }`) instead of the shared
 * `usePredicateRecordContext(record)` that objectui#4075 / #4077 put under the
 * four generic action renderers and app-shell's `DeclaredActionsBar`; #4807
 * moved it onto the helper. objectui#5330 (maintainer, 2026-08-20) then ruled
 * **B** — `record.*` is the canon, the row-action shorthand and legacy `data.*`
 * deprecated — and objectui#5741 (Phase 2, ruled 2026-09-02 / amended
 * 2026-09-05) retired them: the shared helper now binds `{ record: row }` and
 * nothing else, no survey, no special case. What this file measures is what
 * that looks like on THIS renderer, whose `useCondition` call is FAIL-SOFT:
 *
 *   • canon `record.*` gates the banner on the row — true on the matching row,
 *     false on the other.
 *   • row-action shorthand (`status == 'x'`) resolves NOTHING, so the evaluator
 *     throws `status is not defined` and this fail-soft site answers SHOWN on
 *     every row — the same verdict on both rows, i.e. the gate is not consulted.
 *     This is the pre-#4807 signature by design: it is the ruled cost of the
 *     retirement, and the console line is the notice.
 *   • legacy `data.*` does not throw: the ambient scope app-shell mounts
 *     (`providers/ExpressionProvider.tsx`) puts `data: {}` in the bag, and that
 *     `data` is the HOST's own, left standing, so `data.status` reads an
 *     undefined VALUE on the wrong object and the comparison is a constant
 *     `false` — the banner is OFF on every row, silently. Same retirement,
 *     opposite polarity, and no fault to report because nothing faulted.
 *
 * ── Why groups B and C mount different shapes ──────────────────────────────
 *
 * There are TWO gates on the way to this banner and they live at different
 * tiers, each with its own binding:
 *
 *   1. `SchemaRenderer`'s node chain. It hoists `properties.visible` onto the
 *      node and evaluates it on an evaluator that binds `record` (root-only)
 *      and, deliberately, `data` = the DATA-SOURCE ADAPTER — see the docblock
 *      on `SchemaRenderer.tsx`'s `evaluatedSchema`, which states that binding
 *      and why the row must not overwrite it.
 *   2. `record-alert.tsx`'s own `useCondition`, one layer below. THIS is the
 *      tier objectui#4075's rule governs and the tier this card fixes.
 *
 * The two compose as AND (pinned in `record-alert.visibleWhen.evidence.test.tsx`
 * group 4). Group B therefore holds gate 1 open with a declared
 * `visibleWhen: cel('true')` — the node chain tests `visibleWhen` FIRST and
 * returns without ever consulting `visible` — so that every verdict it records
 * is gate 2's, i.e. this renderer's. Group C then drops the isolation and mounts
 * the plain authored shape, so the end-to-end user-visible outcome is pinned too.
 *
 * Group C covers the canon and the shorthand only. The legacy `data.*` spelling
 * is NOT asserted end-to-end, and that is deliberate: through the plain shape
 * gate 1 decides it on the adapter binding above, one tier up and out of this
 * card's reach. Fixing this renderer does not (and must not) move that. See the
 * out-of-scope finding filed alongside this change.
 *
 * ── Non-vacuity ────────────────────────────────────────────────────────────
 *
 * This renderer has four `return null` paths (dismissed, empty record, the
 * props gate, and the node gate above it), so "nothing rendered" is not by
 * itself "the gate said no". Group A is the control: it proves the harness
 * really mounts and paints the banner, and that this exact channel can hide it.
 * Every verdict below is asserted on what a USER sees — is the banner's text in
 * the document — never on computed styles or a predicate's return value.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, type RenderResult } from '@testing-library/react';
import { RecordContextProvider, SchemaRenderer, PredicateScopeProvider } from '@object-ui/react';
import '../../index';

/**
 * The ambient scope app-shell actually mounts on a record page, reproduced from
 * `packages/app-shell/src/providers/ExpressionProvider.tsx` (`data` defaults to
 * `{}` and is `{}` at both of its call sites). The absence of `record` here — and
 * the PRESENCE of an unrelated `data` — are properties of production, not
 * omissions in the fixture: they are precisely what made the two deprecated
 * spellings fail in opposite directions.
 */
const APP_SCOPE = {
  current_user: { id: 'u1', name: 'Ada', email_verified: true },
  user: { id: 'u1', email_verified: true },
  ctx: { user: { id: 'u1' } },
  os: { user: { id: 'u1' } },
  data: {},
  features: { multiOrgEnabled: true },
};

const IN_REVIEW = { id: 'r1', status: 'in_review' };
const DONE = { id: 'r1', status: 'done' };
const TITLE = 'Awaiting review';

const cel = (source: string) => ({ dialect: 'cel', source });

/** Holds SchemaRenderer's node gate open so the verdict recorded is this renderer's. */
const NODE_GATE_OPEN = { visibleWhen: cel('true') };

/**
 * The three spellings objectui#5330 ruled on, written the way an author writes
 * them: a BARE expression string, which is the spec spelling and which
 * `SchemaRenderer`'s per-value `properties` evaluation passes through untouched
 * (only `${…}` values are interpolated there).
 */
const CANON = "record.status == 'in_review'";
const SHORTHAND = "status == 'in_review'";
const LEGACY = "data.status == 'in_review'";

function alertNode(visible?: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'record:alert',
    properties: { title: TITLE, ...(visible === undefined ? {} : { visible }) },
    ...extra,
  };
}

function mount(node: unknown, record: Record<string, unknown>): RenderResult {
  return render(
    <PredicateScopeProvider scope={APP_SCOPE}>
      <RecordContextProvider objectName="showcase_task" recordId="r1" data={record}>
        <SchemaRenderer schema={node as never} />
      </RecordContextProvider>
    </PredicateScopeProvider>,
  );
}

/** What the user sees: is the banner's own text in the document? */
const bannerInDocument = (r: RenderResult) => r.queryByText(TITLE) !== null;

/** Mount the same node against both rows and report the pair of verdicts. */
function verdicts(node: unknown): { onMatchingRow: boolean; onOtherRow: boolean } {
  const onMatchingRow = bannerInDocument(mount(node, IN_REVIEW));
  cleanup();
  const onOtherRow = bannerInDocument(mount(node, DONE));
  cleanup();
  return { onMatchingRow, onOtherRow };
}

afterEach(() => cleanup());

describe('#4807 group A — controls: the harness paints the banner, and this channel can hide it', () => {
  it('with no predicate declared, the banner is on screen for every row', () => {
    // If this goes red, nothing below means anything: a `false` verdict there
    // would be "never rendered", not "the gate said no".
    expect(bannerInDocument(mount(alertNode(), IN_REVIEW))).toBe(true);
    cleanup();
    expect(bannerInDocument(mount(alertNode(), DONE))).toBe(true);
  });

  it('a constant `properties.visible` decides it in both directions', () => {
    // The paired control for group B: same key, same tier, same mount — so a
    // hidden verdict below is this gate's answer and not an inert surface.
    expect(bannerInDocument(mount(alertNode('false', NODE_GATE_OPEN), DONE))).toBe(false);
    cleanup();
    expect(bannerInDocument(mount(alertNode('true', NODE_GATE_OPEN), DONE))).toBe(true);
  });
});

describe('#4807 group B — only the canon binds on this renderer own gate (objectui#5741)', () => {
  // The two rows differ ONLY in `status`, so a pair of opposite verdicts IS the
  // binding: the predicate reached the row. A pair of EQUAL verdicts means the
  // author's gate was never consulted, whichever way it landed — and since
  // objectui#5741 that pair is the RULED outcome for the two retired spellings.

  it('canon `record.*` — the spelling objectui#5330 ruled canonical', () => {
    expect(verdicts(alertNode(CANON, NODE_GATE_OPEN))).toEqual({
      onMatchingRow: true,
      onOtherRow: false,
    });
  });

  it('row-action shorthand `status` — retired by objectui#5741: SHOWN on both rows (fail-soft)', () => {
    // `status` is unbound, the evaluator throws, and this fail-soft call site
    // turns the throw into SHOWN — on the matching row and the other alike.
    expect(verdicts(alertNode(SHORTHAND, NODE_GATE_OPEN))).toEqual({
      onMatchingRow: true,
      onOtherRow: true,
    });
  });

  it('legacy `data.*` — retired by objectui#5741: OFF on both rows (the host `data: {}` answers)', () => {
    // No throw: the ambient `data: {}` from app-shell is the host's own and is
    // left standing, so the comparison is constantly false and the banner never
    // appears — on either row, and with nothing faulting to report.
    expect(verdicts(alertNode(LEGACY, NODE_GATE_OPEN))).toEqual({
      onMatchingRow: false,
      onOtherRow: false,
    });
  });

  it('the row wins over an ambient `record`; a host `data` is left standing (objectui#5741)', () => {
    // `usePredicateRecordContext` binds `{ record: row }` OVER the ambient
    // scope, so a host-supplied `record` never shadows the row — pinned on the
    // user-visible verdict so the precedence cannot regress silently. A host
    // `data`, by contrast, is the host's own now: `data.*` reads IT, on every
    // row, which is what "no longer bound to the row" looks like from here.
    const hostScope = { ...APP_SCOPE, record: DONE, data: IN_REVIEW };
    const withHostScope = (visible: string, record: Record<string, unknown>) =>
      render(
        <PredicateScopeProvider scope={hostScope}>
          <RecordContextProvider objectName="showcase_task" recordId="r1" data={record}>
            <SchemaRenderer schema={alertNode(visible, NODE_GATE_OPEN) as never} />
          </RecordContextProvider>
        </PredicateScopeProvider>,
      );
    expect(bannerInDocument(withHostScope(CANON, IN_REVIEW))).toBe(true);
    cleanup();
    expect(bannerInDocument(withHostScope(CANON, DONE))).toBe(false);
    cleanup();
    // `data.status == 'in_review'` against the HOST's `data` (IN_REVIEW): true
    // whichever row is bound — the row never enters this verdict.
    expect(bannerInDocument(withHostScope(LEGACY, IN_REVIEW))).toBe(true);
    cleanup();
    expect(bannerInDocument(withHostScope(LEGACY, DONE))).toBe(true);
  });
});

describe('#4807 group C — end to end, on the plain authored node', () => {
  // No `visibleWhen` isolation here: this is the shape an author writes, and
  // these are the verdicts a user gets.

  it('canon `record.*` gates the banner on the row', () => {
    expect(verdicts(alertNode(CANON))).toEqual({ onMatchingRow: true, onOtherRow: false });
  });

  it('row-action shorthand does not gate the banner on the row (objectui#5741) — WITHHELD on both rows', () => {
    // `status` is unbound on every runtime record surface (objectui#5741), so
    // a gate spelled this way cannot be evaluated. Since objectui#13299 a
    // declared node predicate that faults fails CLOSED, so the banner is
    // withheld on both rows, and the console line naming the variable is the
    // notice. The canon case above is the control that the gate still works.
    expect(verdicts(alertNode(SHORTHAND))).toEqual({ onMatchingRow: false, onOtherRow: false });
  });
});
