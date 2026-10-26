// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3359 / objectstack#5010 ruling B — a dataset-bound metric card must
 * honour its declared `DashboardWidgetSchema.widgets[].colorVariant`.
 *
 * Why it never did: `dataset` is REQUIRED on the widget schema, so every legal
 * widget renders through `DatasetWidget` (DashboardRenderer's two dispatch
 * sites), and `DatasetWidget` read the key nowhere — 16 real authorizations
 * (platform-objects' `system_overview` ×7, app-showcase's dashboards ×9, every
 * one a dataset-bound `metric`) all painted the same. Captured on
 * objectui origin/main@f9d70a72e, `colorVariant: 'success'` and no declaration
 * at all produced DOM identical character-for-character:
 *
 *   PROBE_UNDECLARED and PROBE_SUCCESS both →
 *   `…<span class="text-2xl font-semibold tabular-nums">510000</span>…`
 *
 * The two halves of this file pin OPPOSITE directions on purpose:
 *
 *  - the **default** (undeclared) markup is asserted byte-for-byte. It was
 *    green BEFORE this change and stays green after — a no-regression pin, not
 *    evidence of the feature. Reverting the change must NOT turn it red;
 *  - the **per-variant** assertions were RED before (every variant produced the
 *    default markup) and are green after. Those are the feature's evidence.
 *
 * The vocabulary parity block reads the enum out of `@objectstack/spec/ui` at
 * test time rather than restating it, so a spec token added or retired fails
 * here instead of silently becoming a variant the renderer ignores.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// The parity guard reads the spec's own enum — a direct spec import, as in
// widget-dispatch-spec-parity.test.ts. `@objectstack/spec` is this package's
// devDependency; the schema is deliberately NOT re-exported by
// `@object-ui/types` (decision (a) of objectui#2561), so this is the supported
// way to reach it.
import { WidgetColorVariantSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import { DatasetWidget } from '../DatasetWidget';
import { VARIANT_ICON_CLASSES, VARIANT_TEXT_CLASSES, metricAccentTextClass } from '../colorVariants';

afterEach(cleanup);

/** The spec's own token list, read at test time (see the parity block below). */
const specVariants: string[] = enumOptions(WidgetColorVariantSchema);

/**
 * The metric card's markup with NO `colorVariant` declared, exactly as
 * origin/main@f9d70a72e renders it. Spelled out in full (not a snapshot file)
 * so a regression shows up as a diff in the test source review, and so nobody
 * can "fix" it by deleting an obsolete snapshot.
 */
const BASELINE_UNDECLARED =
  '<div class="flex h-full w-full flex-col items-start justify-center gap-1 p-2">'
  + '<span class="text-2xl font-semibold tabular-nums">510000</span>'
  + '<span class="text-xs text-muted-foreground">revenue</span>'
  + '</div>';

const renderMetric = async (widgetExtras: Record<string, unknown> = {}, rows = [{ revenue: 510000 }]) => {
  const src = { queryDataset: vi.fn(async () => ({ rows })) };
  const { container } = render(
    <DatasetWidget
      widget={{ type: 'metric', dataset: 'sales', values: ['revenue'], ...widgetExtras }}
      dataSource={src}
    />,
  );
  await screen.findByText('510000');
  return container;
};

/** The big number's class attribute — where a chrome-less KPI carries its accent. */
const valueClass = (container: HTMLElement) =>
  container.querySelector('span.tabular-nums')?.getAttribute('class') ?? '';

const BASE_VALUE_CLASS = 'text-2xl font-semibold tabular-nums';

/**
 * The mapping this issue delivers, restated independently of the
 * implementation: spec token → the accent appended to the value's classes.
 * `default` is absent deliberately — the enum's own name for "no accent".
 */
const EXPECTED_ACCENT: Record<string, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  teal: 'text-teal-600 dark:text-teal-400',
  orange: 'text-orange-600 dark:text-orange-400',
  purple: 'text-purple-600 dark:text-purple-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-rose-600 dark:text-rose-400',
};

describe('DatasetWidget metric card — the declared colorVariant (#3359)', () => {
  // ── No-regression half: green before AND after this change ───────────────
  it('renders the pre-change markup byte-for-byte when no colorVariant is declared', async () => {
    const container = await renderMetric();
    expect(container.innerHTML).toBe(BASELINE_UNDECLARED);
  });

  it("treats the enum's own 'default' as no accent — identical bytes to undeclared", async () => {
    const container = await renderMetric({ colorVariant: 'default' });
    expect(container.innerHTML).toBe(BASELINE_UNDECLARED);
  });

  // An off-spec token gets NO accent and NO aliasing. The designer's swatch
  // picker carries three display-only aliases (`green`/`red`/`amber`) so it can
  // still paint a swatch for a legacy stored value; honouring them HERE would
  // give the renderer a vocabulary the spec does not have — a second de-facto
  // contract for AI-authored metadata to drift into (AGENTS.md #0.1). The spec
  // enum rejects them where the metadata is authored and published; a cosmetic
  // key is also the wrong place to fail a whole widget, hence "no accent"
  // rather than an error.
  it.each(['chartreuse', 'green', 'red', 'amber', '', '#ff0000'])(
    'ignores the off-spec token %j — no accent, no alias, baseline bytes',
    async (token) => {
      const container = await renderMetric({ colorVariant: token });
      expect(container.innerHTML).toBe(BASELINE_UNDECLARED);
    },
  );

  it('leaves a non-string colorVariant alone instead of throwing', async () => {
    const container = await renderMetric({ colorVariant: { token: 'blue' } });
    expect(container.innerHTML).toBe(BASELINE_UNDECLARED);
  });

  // ── Feature half: RED before this change, green after ────────────────────
  it.each(Object.entries(EXPECTED_ACCENT))(
    'tints the value with the %s accent',
    async (variant, accent) => {
      const container = await renderMetric({ colorVariant: variant });
      expect(valueClass(container)).toBe(`${BASE_VALUE_CLASS} ${accent}`);
      // The declared variant changes ONLY the value's colour — the layout, the
      // measure label and the value text are untouched.
      expect(container.innerHTML).toBe(
        BASELINE_UNDECLARED.replace(BASE_VALUE_CLASS, `${BASE_VALUE_CLASS} ${accent}`),
      );
    },
  );

  it('renders all eight enum values distinguishably (七个强调色 + default)', async () => {
    const seen: string[] = [];
    for (const variant of specVariants) {
      const container = await renderMetric({ colorVariant: variant });
      seen.push(valueClass(container));
      cleanup();
    }
    // 8 tokens → 8 distinct class strings: `default` keeps the bare base class,
    // each accent token adds its own. No two variants render alike.
    expect(new Set(seen).size).toBe(specVariants.length);
    expect(seen[specVariants.indexOf('default')]).toBe(BASE_VALUE_CLASS);
  });

  it('keeps the comparison trend row untouched by the accent', async () => {
    const rows = [{ revenue: 510000, revenue__compare: 400000 }];
    const plain = await renderMetric({ compareTo: { kind: 'previousPeriod' } }, rows);
    const plainHtml = plain.innerHTML;
    cleanup();
    // The delta row renders (that is what makes this case worth pinning) …
    expect(plainHtml).toContain('data-testid="dataset-compare-trend"');
    const tinted = await renderMetric({ compareTo: { kind: 'previousPeriod' }, colorVariant: 'danger' }, rows);
    // … and the tinted render differs from it in exactly one place: the value's
    // class attribute. The trend's own up/down colouring is data-driven and must
    // not inherit the widget's accent.
    expect(tinted.innerHTML).toBe(
      plainHtml.replace(BASE_VALUE_CLASS, `${BASE_VALUE_CLASS} ${EXPECTED_ACCENT.danger}`),
    );
  });
});

// ── Vocabulary parity: spec enum ↔ the renderer's tables ───────────────────
describe('colorVariant vocabulary is the spec enum, not a renderer invention', () => {
  it('reads a non-empty enum from the spec', () => {
    // Without this the parity assertions below could pass vacuously against an
    // empty list — the failure mode that makes a "green" parity test worthless.
    expect(specVariants, 'could not read WidgetColorVariantSchema.options from the spec').not.toEqual([]);
  });

  it('the accent tables cover exactly the spec tokens', () => {
    expect(Object.keys(VARIANT_TEXT_CLASSES).sort()).toEqual([...specVariants].sort());
    expect(Object.keys(VARIANT_ICON_CLASSES).sort()).toEqual([...specVariants].sort());
  });

  it('every spec token except `default` resolves to an accent', () => {
    for (const token of specVariants) {
      const resolved = metricAccentTextClass(token);
      if (token === 'default') expect(resolved).toBeUndefined();
      else expect(resolved, `spec token ${token} has no accent class`).toBeTruthy();
    }
  });

  it('the accent classes are pairwise distinct', () => {
    const accents = specVariants.filter((t) => t !== 'default').map((t) => metricAccentTextClass(t));
    expect(new Set(accents).size).toBe(accents.length);
  });

  // The tokens the 16 live authorizations actually use (system_overview +
  // app-showcase). Every one must resolve, or this issue's own metadata is
  // still unenforced after the fix.
  it('resolves every token the shipped dashboards authorize', () => {
    for (const token of ['blue', 'teal', 'orange', 'purple', 'success', 'warning', 'danger']) {
      expect(specVariants, `${token} is no longer a spec token`).toContain(token);
      expect(metricAccentTextClass(token)).toBe(EXPECTED_ACCENT[token]);
    }
  });
});
