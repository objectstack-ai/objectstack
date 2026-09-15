// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DashboardWidgetSchema } from './dashboard.zod';
import { AppSchema } from './app.zod';
import { ChartConfigSchema } from './chart.zod';
import { PageSchema, PageComponentSchema } from './page.zod';
import { ReportChartSchema } from './report.zod';
import { ListViewSchema } from './view.zod';

/**
 * The two `aria` tombstones must not point at each other (#6756).
 *
 * `shared/retired-key.ts` states the contract these strings live under — "an
 * agent bumping `@objectstack/spec` sees THIS string, not our docs site" — so a
 * tombstone's enumeration of the surfaces that still carry the shape is
 * CONTRACT, not prose. Both of these went stale in the same major, in a mutual
 * loop no gate could see:
 *
 *   - `dashboard.widgets[].aria` (#5010) told the author `AriaProps` "stays
 *     live on `app.aria`" — and `App.aria` is a `retiredKey()` tombstone
 *     removed in that same 17.0.0. The natural repair (lift the block up to the
 *     app) hit a second tombstone, and running the `os migrate meta --from 16`
 *     the same message recommends two lines later would then have STRIPPED it:
 *     the `app-dead-authoring-keys-removed` conversion lists `aria`.
 *   - `App.aria`, reciprocally, said "declare `aria` on the component/widget".
 *     The component half is right; the widget half named the key #5010 retired.
 *
 * This is #6630's class on a second surface, so the assertion shape is
 * deliberately copied from `shared/retry-policy.test.ts`: pin the enumeration
 * in BOTH directions, and refuse to buy either direction by weakening the
 * prescription itself.
 *
 * There is no ADR-0112 `code`/`status` envelope to assert on this rejection
 * class. `retiredKey()` is a Zod `never` whose issue carries the guidance as
 * its `message`, so here the wording IS the whole contract (#5240).
 *
 * ⚠️ Two halves, two directions — stated up front because only one of them can
 * go red on the defect this file was written for:
 *
 *   - The TEXTUAL half (`the tombstone names ...`) is the live one. Restore
 *     either guidance string to its pre-#6756 wording and it goes RED.
 *   - The STRUCTURAL half (`really accepts` / `really rejects`) is GREEN before
 *     and after, by design: #6756 is a `domain:spec-surface` text fix whose
 *     admission test is that acceptance is byte-for-byte unchanged, so nothing
 *     here may flip. It is not decoration — it is the ground truth the textual
 *     half is checked against, and the anti-vacuity guard: it is what makes
 *     "names `page.components[].aria`" mean "names a surface that exists"
 *     rather than "contains a string we also typed into the test".
 */
describe('the `aria` tombstones name only live `AriaProps` carriers (#6756)', () => {
  // One authored value of the shared shape, reused on every surface below so
  // the comparison is like-for-like.
  const ARIA = { ariaLabel: 'Total orders' } as const;

  const widgetWithAria = {
    id: 'w1', type: 'metric', dataset: 'orders', values: ['total'], aria: ARIA,
  };
  const appWithAria = {
    name: 'sales_app', label: 'Sales', navigation: [], aria: ARIA,
  };
  const chartWithAria = { type: 'bar', aria: ARIA };
  const reportChartWithAria = { type: 'bar', xAxis: 'region', yAxis: 'revenue', aria: ARIA };

  const messageOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) => {
    expect(result.success, 'the tombstone must still REJECT — a passing parse means the key came back').toBe(false);
    return result.error!.issues.map((i) => i.message).join('\n');
  };

  it('the widget tombstone still fires, and points at surfaces that survived 17.0.0', () => {
    const message = messageOf(DashboardWidgetSchema.safeParse(widgetWithAria));

    // Anti-vacuity. Deleting the tombstone outright does not silence this file:
    // `DashboardWidgetSchema` is a `strictObject`, so the key would still be
    // refused — but as a generic unrecognized-key guidance that cannot contain
    // the prescription's own opening clause. Wording drift fails the assertions
    // below; DISAPPEARANCE fails this one.
    expect(
      message,
      'the widget `aria` prescription must still be reachable through the parse',
    ).toContain('`dashboard.widgets[].aria` was removed');

    // Every surface that still declares `aria: AriaPropsSchema` and is graded
    // `live` in the liveness ledger, spelled the way an author writes it. A
    // prescription NARROWER than the truth is the #4964 defect.
    for (const live of ['`page.aria`', '`page.components[].aria`', 'list view `aria`']) {
      expect(message, `the prescription must still name ${live}`).toContain(live);
    }

    // ...and nothing retired. WIDER than the truth is the #6756 defect itself:
    // `app.aria` is `dead` in `liveness/app.json` and stripped by the
    // protocol-17 `app-dead-authoring-keys-removed` conversion, so naming it
    // sent the author to a door that does not exist. Matched by idiom (any
    // mention at all), not by the exact sentence that used to carry it.
    expect(
      message,
      'the prescription must not point at `app.aria`, retired in this same major',
    ).not.toMatch(/app\.aria/i);

    // None of the above may be bought by weakening the prescription itself.
    expect(message).toContain('author a `title`');
    // The conversion STRIPS this key (`stripKeys(..., [... 'aria'])`). The
    // key's fate is the body's job ("Delete the key."), asserted above; the
    // `os migrate meta` sentence states what the TOOL does and is the house
    // sentence (#6856 route D — superseding the #6854 `to remove it` pin,
    // an accepted cost of that ruling). Class-wide shape enforcement lives in
    // `shared/retired-key-migrate-sentence.test.ts`; this pin holds the one
    // site that already flipped once.
    expect(message).toContain('Delete the key.');
    expect(message).toContain('os migrate meta --from 16');
    expect(message).toMatch(/to list the mechanical edits for existing sources; apply them by hand\.$/);
  });

  it('the App.aria tombstone points at a page component, not at the retired widget surface', () => {
    const message = messageOf(AppSchema.safeParse(appWithAria));

    // Anti-vacuity, same shape as above.
    expect(
      message,
      'the `App.aria` prescription must still be reachable through the parse',
    ).toContain('`App.aria` was removed');

    expect(message, 'the prescription must name the surviving carrier').toContain('`page.components[].aria`');

    // The reciprocal half of the loop. "component/widget" read as an
    // instruction sends half its readers at `dashboard.widgets[].aria`, which
    // #5010 retired in this same 17.0.0.
    expect(
      message,
      'the prescription must not send the author to a dashboard widget',
    ).not.toMatch(/widget/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Ground truth. Green before #6756 and green after — see the file docblock.
  // These two assert the FACTS the prose above is checked against, so that the
  // `toContain` list cannot drift into naming a surface that stopped existing
  // (which is precisely how #6756 happened).
  // ─────────────────────────────────────────────────────────────────────────

  it('every surface the tombstones name really accepts `AriaProps`', () => {
    expect(PageSchema.safeParse({
      name: 'sales_home', label: 'Home', regions: [], aria: ARIA,
    }).success, '`page.aria`').toBe(true);

    expect(PageComponentSchema.safeParse({
      type: 'steedos-labs.related-list', properties: {}, aria: ARIA,
    }).success, '`page.components[].aria`').toBe(true);

    expect(ListViewSchema.safeParse({
      type: 'grid', columns: ['name'], aria: ARIA,
    }).success, 'the list view `aria`').toBe(true);
  });

  it('and the two surfaces retired in 17.0.0 really reject it', () => {
    expect(AppSchema.safeParse(appWithAria).success, '`app.aria` is a tombstone').toBe(false);
    expect(
      DashboardWidgetSchema.safeParse(widgetWithAria).success,
      '`dashboard.widgets[].aria` is a tombstone',
    ).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // The third member of the family (#17751): `ChartConfig.aria`, the
  // block-local spelling that outlived the other two by DEPTH — it sits inside
  // `dashboard.widgets[].chartConfig`, an undrilled container, so no sweep had
  // ever classified a key inside it. Joined to this file rather than pinned
  // apart, because the failure this file exists for is a tombstone naming a
  // surface that stopped existing, and every new `aria` tombstone enlarges the
  // set of prescriptions that can go stale at each other.
  //
  // ONE DIFFERENCE from its two siblings, stated so the assertion below is not
  // read as a copy: this prescription legitimately contains the word `widgets`,
  // because `dashboard.widgets[].chartConfig.aria` is one of the three
  // coordinates the RETIRED key was authored at. The `App.aria` test above can
  // therefore refuse `/widget/i` outright and this one cannot — it refuses the
  // retired DESTINATION by its exact spelling instead.
  // ─────────────────────────────────────────────────────────────────────────

  it('the chart-config tombstone fires and prescribes only live carriers', () => {
    const message = messageOf(ChartConfigSchema.safeParse(chartWithAria));

    // Anti-vacuity, the widget test's shape: `ChartConfigSchema` is a
    // `strictObject`, so deleting the tombstone still REFUSES the key — as a
    // generic unrecognized-key rejection that cannot carry this opening clause.
    // Wording drift fails the assertions below; DISAPPEARANCE fails this one.
    expect(
      message,
      'the chart `aria` prescription must still be reachable through the parse',
    ).toContain('`ChartConfig.aria`');
    expect(message).toContain('was removed');

    // The working accessible-name channel on this very shape. Naming it is the
    // whole reason this key could be REMOVED rather than enforced, so a
    // prescription that loses it has lost the ruling's reasoning.
    expect(
      message,
      'the prescription must name the sibling channel that IS applied',
    ).toContain('`description`');

    // Every surface that still declares `aria: AriaPropsSchema` and is graded
    // `live` in the ledger — the same three the widget twin names, asserted
    // against the same ground truth below.
    for (const live of ['`page.aria`', '`page.components[].aria`', 'list view `aria`']) {
      expect(message, `the prescription must still name ${live}`).toContain(live);
    }

    // ...and nothing retired, matched by exact spelling (see the block note).
    expect(
      message,
      'the prescription must not point at `app.aria`, retired in 17.0.0',
    ).not.toMatch(/app\.aria/i);
    expect(
      message,
      'the prescription must not point at `dashboard.widgets[].aria`, retired in 17.0.0',
    ).not.toMatch(/dashboard\.widgets\[\]\.aria(?!\.)/i);

    // None of the above bought by weakening the prescription itself.
    expect(message).toContain('Delete the key.');
    expect(message).toContain('os migrate meta --from 17');
    expect(message).toMatch(/to list the mechanical edits for existing sources; apply them by hand\.$/);
  });

  it('the tombstone rides the `.extend()` onto ReportChart', () => {
    // `ReportChartSchema` is `ChartConfigSchema.extend({ xAxis, yAxis })`, which
    // copies the retired property into its own walked shape — which is why the
    // retirement registers TWO keys, `ui/ChartConfig:aria` and
    // `ui/ReportChart:aria`. If the extension ever stopped carrying it, a report
    // author would meet a bare unrecognized-key error with no upgrade in it.
    const message = messageOf(ReportChartSchema.safeParse(reportChartWithAria));
    expect(message).toContain('`ChartConfig.aria`');
    expect(message).toContain('`report.blocks[].chart.aria`');
  });

  it('the two former alias spellings refuse instead of renaming onto the tombstone', () => {
    // `accessibility` and `ariaProps` were `aliases` FOR `aria`. Left as
    // aliases they would answer "did you mean `aria`?" — the one key this shape
    // is now guaranteed to reject, which is the ledger's finding-7 shape and
    // what `shared/alias-integrity.test.ts` refuses by name. Deleted outright
    // they would fall to the edit-distance fallback, which excludes tombstones
    // from its candidate list, so both spellings would carry no upgrade at all.
    for (const written of ['accessibility', 'ariaProps']) {
      const message = messageOf(ChartConfigSchema.safeParse({ type: 'bar', [written]: ARIA }));
      expect(message, `\`${written}\` must still be answered`).toContain(`\`${written}\``);
      expect(message, `\`${written}\` must carry the retirement`).toContain('was removed in @objectstack/spec 17');
      expect(message, `\`${written}\` must name the live channel`).toContain('`description`');
      expect(
        message,
        `\`${written}\` must not be renamed onto the tombstone`,
      ).not.toMatch(/did you mean/i);
    }
  });
});
