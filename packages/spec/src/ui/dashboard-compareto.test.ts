// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5011 — `dashboard.widgets[].compareTo` converged on the executor's contract.
 *
 * ## What was broken (the shape these pins protect against returning)
 *
 * The widget declared three arms with confident TSDoc — `'previousPeriod'`,
 * `'previousYear'`, `{ offset: '7d' | '1M' | '1y' }` — and the analytics
 * executor implemented a fourth thing: `DatasetSelection.compareTo`, which is
 * `{ kind, dimension? }` and has no `offset` in it anywhere. On the ADR-0021
 * dataset path (the spec's own "single author-facing analytics shape") all three
 * arms failed, in two different ways: the string arms were DROPPED by the
 * renderer, so a widget whose author asked for a comparison rendered its base
 * numbers with the comparison quietly absent; `{ offset }` was forwarded into
 * that contract with no dimension, so the executor threw
 * `compareTo requires a timeDimension "undefined"` and errored the whole widget.
 * All three worked on the legacy inline chart path. Same key, two fates, and the
 * failing one was the blessed path.
 *
 * ## What is pinned here, and why each pin exists
 *
 * The convergence is only worth anything if BOTH halves hold: the widget must
 * declare exactly the executor's shape (nothing to drift), and the retired
 * spellings must be rejected with the upgrade in hand. So the classes are:
 *
 *   1. the converged shape parses THROUGH THE METADATA ROOT, at the real carrier
 *      slot path — a strict schema nobody parses gates nothing (#5000);
 *   2. every retired spelling is rejected AND its prescription reaches the
 *      author at the top level;
 *   3. the slot is NOT a union — the design benefit, asserted rather than
 *      claimed (see the `#5014` block below);
 *   4. what the widget declares and what `DatasetCompareTo` declares are the
 *      same two keys, checked structurally rather than by eye.
 *
 * Every assertion here was run RED first against the pre-#5011 schema.
 */

import { describe, it, expect } from 'vitest';

import { DashboardWidgetSchema } from './dashboard.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import type { DatasetCompareTo } from '../contracts/analytics-service';

/** A minimal ADR-0021 widget, with `compareTo` swapped in. */
const widget = (compareTo: unknown) => ({
  id: 'won_this_quarter',
  type: 'metric',
  dataset: 'opportunity_metrics',
  values: ['total_amount'],
  ...(compareTo === undefined ? {} : { compareTo }),
});

/** Reject and hand back the serialized issues, so a pin reads what an author would. */
function reject(value: unknown): string {
  const r = DashboardWidgetSchema.safeParse(widget(value));
  expect(r.success, `expected compareTo ${JSON.stringify(value)} to be REJECTED`).toBe(false);
  return JSON.stringify(r.success ? [] : r.error.issues);
}

describe('#5011 — compareTo is the executor contract, projected', () => {
  it('accepts `{ kind }` with `dimension` omitted — the executor resolves it', () => {
    const r = DashboardWidgetSchema.safeParse(widget({ kind: 'previousPeriod' }));
    expect(r.success).toBe(true);
    expect(r.success && (r.data as { compareTo?: unknown }).compareTo).toEqual({ kind: 'previousPeriod' });
  });

  it('accepts `{ kind, dimension }` — named explicitly when the selection is ambiguous', () => {
    const r = DashboardWidgetSchema.safeParse(widget({ kind: 'previousYear', dimension: 'close_date' }));
    expect(r.success).toBe(true);
    expect(r.success && (r.data as { compareTo?: unknown }).compareTo)
      .toEqual({ kind: 'previousYear', dimension: 'close_date' });
  });

  it('rejects a kind the executor cannot run', () => {
    // The executor's `shiftRange` implements exactly two windows. A third
    // spelling here would be the whole #5011 defect, reintroduced one value at
    // a time. zod's enum issue does not echo the offending value, so the pin is
    // the ALLOWED set — which is the half that must not grow ahead of the
    // executor.
    for (const bogus of ['previousQuarter', 'previousWeek', 'previousMonth']) {
      const msg = reject({ kind: bogus });
      expect(msg).toContain('"compareTo","kind"');
      expect(msg).toContain('"previousPeriod","previousYear"');
    }
  });

  /**
   * The door. `DashboardWidgetSchema` is only a gate on documents that actually
   * reach it through a metadata root — #5000's lesson, and the reason a strict
   * schema plus a green unit test can still gate nothing. The control proves the
   * probe is not vacuous: the same document with a legal `compareTo` parses.
   */
  it('binds through the `dashboard` metadata root, at the real carrier slot path', () => {
    const dashboard = getMetadataTypeSchema('dashboard');
    expect(dashboard, 'the dashboard root must resolve — this is the parse door').toBeTruthy();
    const doc = (compareTo: unknown) => ({
      name: 'pipeline_dashboard',
      label: 'Pipeline Dashboard',
      widgets: [widget(compareTo)],
    });

    // NEGATIVE CONTROL, run first and required to be GREEN: if the root
    // rejected everything (or accepted everything) the assertion below would be
    // satisfied for the wrong reason.
    const control = dashboard!.safeParse(doc({ kind: 'previousPeriod' }));
    expect(control.success, 'control: the converged shape parses through the root').toBe(true);

    for (const retired of ['previousPeriod', 'previousYear', { offset: '7d' }, { offset: '1y' }]) {
      const r = dashboard!.safeParse(doc(retired));
      expect(r.success, `retired form ${JSON.stringify(retired)} must not survive the root`).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain('widgets');
    }
  });
});

describe('#5011 — every retired spelling is rejected WITH its upgrade', () => {
  it('the bare string arms carry a prescription naming the exact replacement', () => {
    const period = reject('previousPeriod');
    expect(period).toContain('was removed in');
    expect(period).toContain('#5011');
    expect(period).toContain('DROPPED');
    expect(period).toContain("kind: ");
    expect(period).toContain('previousPeriod');
    expect(period).toContain('os migrate meta --from 16');

    const year = reject('previousYear');
    expect(year).toContain('previousYear');
    expect(year).toContain('os migrate meta --from 16');
  });

  /**
   * The `HookBodyCapability` discipline: only the value that really WAS legal
   * gets the retirement text. Telling the author of `previosPeriod` that their
   * value "was removed" would misinform — that is a typo, not an upgrade.
   */
  it('a misspelt string is NOT told it was removed — only the two real spellings are', () => {
    const typo = reject('previosPeriod');
    expect(typo).not.toContain('was removed in');
    const wrongType = reject(7);
    expect(wrongType).not.toContain('was removed in');
  });

  it('`offset` is prescribed, never renamed onto a key that means something else', () => {
    const msg = reject({ offset: '7d' });
    expect(msg).toContain('was removed in');
    expect(msg).toContain('never had an `offset` concept');
    // The prescription must say what to do INSTEAD, both halves: the kind, and
    // (for a duration with no faithful target) the filter window.
    expect(msg).toContain('previousPeriod');
    expect(msg).toContain('filter');
    expect(msg, 'must not suggest a rename for a key with no correct target')
      .not.toContain('`offset` →');
  });

  it("`{ offset: '1y' }` is told its exact equivalent, since it has one", () => {
    expect(reject({ offset: '1y' })).toContain('previousYear');
  });

  it('the words #5042 measured authors spelling `offset` with all reach the same prescription', () => {
    // These were `aliases: { period: 'offset', … }` before the convergence —
    // i.e. an empirical claim about what authors write on this slot. The claim
    // survives; its target does not, so each now resolves to the retirement
    // rather than to a key that no longer exists.
    for (const word of ['period', 'duration', 'interval', 'shift', 'delta', 'by', 'amount', 'value']) {
      expect(reject({ kind: 'previousPeriod', [word]: '7d' }), `${word} must carry the offset prescription`)
        .toContain('was removed in');
    }
  });

  it('renames the near-misses for the two LIVE keys instead of prescribing at them', () => {
    // `type`/`mode` were curated as guidance in #5042 ("the comparison KIND is
    // the union itself, not a key") — that measurement said authors reach for
    // those words here. Now that `kind` IS the key, the same claim is a faithful
    // rename rather than a lecture.
    expect(reject({ type: 'previousPeriod' })).toContain('`type` → `kind`');
    expect(reject({ mode: 'previousPeriod' })).toContain('`mode` → `kind`');
    // The neighbouring vocabulary for "which date column".
    expect(reject({ kind: 'previousYear', field: 'close_date' })).toContain('`field` → `dimension`');
    expect(reject({ kind: 'previousYear', dateField: 'close_date' })).toContain('`dateField` → `dimension`');
    expect(reject({ kind: 'previousYear', timeDimension: 'close_date' })).toContain('`timeDimension` → `dimension`');
  });

  it('the two wrong-layer keys still point one level up', () => {
    expect(reject({ kind: 'previousYear', granularity: 'month' })).toContain('dateGranularity');
    expect(reject({ kind: 'previousYear', filter: { a: 1 } })).toContain('one level up');
  });

  it('an unrecognised key names the surface and echoes itself', () => {
    const msg = reject({ kind: 'previousYear', notACompareKey: 1 });
    expect(msg).toContain('this comparison window');
    expect(msg).toContain('notACompareKey');
  });
});

/**
 * The design benefit, asserted rather than claimed.
 *
 * `compareTo` used to be a union, and #5042 measured what that cost: zod
 * collapses a failed union into ONE top-level `invalid_union` issue whose
 * message is the bare `'Invalid input'`, and `zodIssuesToFields`
 * (`rest/src/rest-server.ts`) maps only top-level issues — so every curated
 * prescription this campaign wrote inside a union arm was produced and never
 * delivered (#5014). The strictness ledger's `dashboard.zod.ts` row carried that
 * caveat.
 *
 * The converged slot is a plain strict object, so its message is top-level and
 * reaches the wire. This pin is what makes that a property of the schema rather
 * than a claim in a comment: reintroduce a union here and it goes red.
 */
describe('#5011 — the converged slot is union-free, so its prescriptions reach the author', () => {
  const issuesFor = (compareTo: unknown) => {
    const r = DashboardWidgetSchema.safeParse(widget(compareTo));
    expect(r.success).toBe(false);
    return r.success ? [] : r.error.issues;
  };

  it('produces NO `invalid_union` issue for any retired spelling', () => {
    for (const retired of ['previousPeriod', 'previousYear', { offset: '7d' }, { kind: 'x', bogus: 1 }]) {
      expect(issuesFor(retired).some((i) => i.code === 'invalid_union'),
        `${JSON.stringify(retired)} must not collapse into a union issue`).toBe(false);
    }
  });

  it('the prescription is the TOP-LEVEL message, not buried in arm errors', () => {
    // The exact thing #5042 could not assert. `'Invalid input'` was the whole
    // message an author used to get.
    const top = issuesFor('previousPeriod').map((i) => i.message).join('\n');
    expect(top).not.toBe('Invalid input');
    expect(top).toContain('was removed in');
    expect(top).toContain('#5011');

    const offsetTop = issuesFor({ offset: '7d' }).map((i) => i.message).join('\n');
    expect(offsetTop).toContain('was removed in');
  });

  it('every issue is rooted at `compareTo`, so a field-level error map can place it', () => {
    for (const i of issuesFor('previousPeriod')) expect(i.path[0]).toBe('compareTo');
    for (const i of issuesFor({ offset: '7d' })) expect(i.path[0]).toBe('compareTo');
  });
});

/**
 * The convergence claim itself: the widget declares the executor's contract, not
 * a lookalike. Checked structurally, because "these two look the same" is
 * exactly the review that failed for a whole major.
 */
describe('#5011 — widget and executor declare ONE vocabulary', () => {
  it('a parsed widget `compareTo` is assignable to `DatasetCompareTo` with no mapping', () => {
    const r = DashboardWidgetSchema.parse(widget({ kind: 'previousYear', dimension: 'close_date' }));
    // No `as`, no re-spelling, no `??` — if the shapes ever diverge this line
    // stops compiling, which is the point.
    const forExecutor: DatasetCompareTo = (r as { compareTo: DatasetCompareTo }).compareTo;
    expect(forExecutor).toEqual({ kind: 'previousYear', dimension: 'close_date' });

    const resolved: DatasetCompareTo =
      (DashboardWidgetSchema.parse(widget({ kind: 'previousPeriod' })) as { compareTo: DatasetCompareTo })
        .compareTo;
    expect(resolved.dimension).toBeUndefined();
  });

  it('declares exactly the two keys the contract does — no widget-side extras', () => {
    const r = DashboardWidgetSchema.safeParse(widget({ kind: 'previousPeriod', dimension: 'd', extra: 1 }));
    expect(r.success, 'a third key would be a second vocabulary starting over').toBe(false);
  });
});
