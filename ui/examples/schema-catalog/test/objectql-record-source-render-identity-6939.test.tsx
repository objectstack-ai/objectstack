/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939, the `object-map` + `object-gantt` group — the GANTT half of
 * the render pin. `ObjectGanttSchema` used to require `objectName`, a key the
 * renderer reads THIRD (`getDataConfig` in `plugin-gantt/src/ObjectGantt.tsx`:
 * `data`, then `staticData`, then `objectName`), so the three `staticData`-only
 * catalog entries below drew correctly and were refused by `safeValidateSchema`.
 * The repair makes `objectName` optional behind a refinement; the validator-side
 * contract is pinned in `packages/types/src/__tests__/objectql-record-source-
 * refinement-6939.test.ts`, and the `object-map` tiles are pinned in
 * `packages/plugin-map/src/ObjectMap.catalogRecordSource-6939.test.tsx`.
 *
 * ## Why the render half is the discriminating half
 *
 * From objectui#6318's triage: a "correction" that renders identically proves
 * the SCHEMA was wrong, not the fixture. So the repair has to clear the mirror
 * image of that bar — the validator's verdict must change and the renderer's
 * output must NOT. The numbers in `PRE_REPAIR` were measured on `origin/main`
 * at `d88e20f55`, BEFORE the mirror was touched, through THIS file's harness.
 *
 * ## The harness, and why it is named
 *
 * A bare `SchemaRenderer` is not enough here: `ObjectGantt` calls
 * `useSchemaContext`, so without a `SchemaRendererProvider` the tile is the
 * error boundary — 4 elements reading `Component "object-gantt" failed to
 * render` — and an identity pin over THAT is the vacuous pin this file must
 * not be. Measured through the provider-wrapped bare renderer below, the three
 * tiles draw 407 / 354 / 436 elements. The docs-gallery harness
 * (`catalog-gallery-render.test.tsx`, provider + `SidebarProvider` + a padded
 * wrapper) gives different absolute counts for the same tile; identity within
 * ONE harness is the claim that discriminates. `Date` is frozen because the
 * chart carries a Today marker and a date-stamped export name — the pin must
 * not move with the calendar.
 *
 * Three readings per tile, because a count alone cannot tell a swapped element
 * from an equal one: element count, a tag census, and the text — the visible
 * text as a literal (the chart's own `<style>` block is part of `textContent`
 * and is folded into the hash instead, at ~2.7 KB it is not a readable pin),
 * plus a SHA-256 of the full `textContent`, style block included.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import '@object-ui/components';
import '@object-ui/plugin-gantt';
import { SchemaRenderer, SchemaRendererProvider, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

const IDS = [
  'plugin-gantt/construction-project-phases',
  'plugin-gantt/project-timeline-with-dependencies',
  'plugin-gantt/sprint-development-timeline',
] as const;

/**
 * Measured on `origin/main` @ `d88e20f55` through `measure()` below, mirror
 * untouched. `sha256` is over the full `textContent`; `visibleText` is the
 * same string with the chart's `<style>` element's text removed.
 *
 * `visibleText` and `sha256` re-measured through `measure()` at `fd4059c`, after
 * objectui#12110 item 5 added the year to a task's dates outside the current
 * year (these tiles are 2023/2024, the clock is frozen in 2026): the task-list
 * date lines read `2/1/24 → 2/14/24` where they read `2/1 → 2/14`, and with those
 * year segments removed the text equals the `d88e20f55` reading exactly.
 * `elements` and `tags` are the `d88e20f55` readings, unchanged.
 */
const PRE_REPAIR: Record<(typeof IDS)[number], {
  elements: number;
  tags: Record<string, number>;
  sha256: string;
  visibleText: string;
}> = {
  'plugin-gantt/construction-project-phases': {
    elements: 407,
    tags: { DIV: 185, STYLE: 1, BUTTON: 26, svg: 19, path: 52, SPAN: 112, circle: 2, line: 5, rect: 1, defs: 1, marker: 3 },
    sha256: '4c6e64c406493520094108eb3d50029fd97c4cefa45c748f30f5a517cf2504f9',
    visibleText:
      'January 2024DayWeekMonthQuarterYearTodayThis weekThis monthTask NameJan 2024Feb 2024Mar 2024' +
      '25T26F27S28S29M30T31W1T2F3S4S5M6T7W8T9F10S11S12M13T14W15T16F17S18S19M20T21W22T23F24S25S26M27T28W29T1F2S3S' +
      'Site Preparation2/1/24 → 2/14/24Foundation2/15/24 → 3/15/24Framing3/16/24 → 4/30/24Electrical & Plumbing5/1/24 → 5/31/24Interior Finishing6/1/24 → 7/15/24' +
      'Site Preparation100%Foundation75%Framing30%Electrical & Plumbing0%Interior Finishing0%',
  },
  'plugin-gantt/project-timeline-with-dependencies': {
    elements: 354,
    tags: { DIV: 156, STYLE: 1, BUTTON: 24, svg: 17, path: 44, SPAN: 100, circle: 2, line: 5, rect: 1, defs: 1, marker: 3 },
    sha256: 'd9ec16c55958f4e3e5793422c52f695f3b5c6604eece02eb863bfad56a26fdfe',
    visibleText:
      'December 2023DayWeekMonthQuarterYearTodayThis weekThis monthTask NameDec 2023Jan 2024Feb 2024' +
      '25M26T27W28T29F30S31S1M2T3W4T5F6S7S8M9T10W11T12F13S14S15M16T17W18T19F20S21S22M23T24W25T26F27S28S29M30T31W1T' +
      'Design Phase1/1/24 → 1/15/24Development1/16/24 → 2/28/24Testing3/1/24 → 3/15/24' +
      'Design Phase100%Development60%Testing0%',
  },
  'plugin-gantt/sprint-development-timeline': {
    elements: 436,
    tags: { DIV: 200, STYLE: 1, BUTTON: 27, svg: 20, path: 58, SPAN: 118, circle: 2, line: 5, rect: 1, defs: 1, marker: 3 },
    sha256: '8e96bcc1bce4d3b56018ad01f7460838b41c754d2ce0f9192e4b2019b53d3297',
    visibleText:
      'December 2023DayWeekMonthQuarterYearTodayThis weekThis monthTask NameDec 2023Jan 2024Feb 2024' +
      '25M26T27W28T29F30S31S1M2T3W4T5F6S7S8M9T10W11T12F13S14S15M16T17W18T19F20S21S22M23T24W25T26F27S28S29M30T31W1T' +
      'Sprint Planning1/1/24 → 1/3/24User Authentication1/4/24 → 1/10/24Dashboard UI1/4/24 → 1/12/24API Integration1/11/24 → 1/18/24Testing & QA1/19/24 → 1/25/24Deployment1/26/24 → 1/28/24' +
      'Sprint Planning100%User Authentication100%Dashboard UI85%API Integration40%Testing & QA0%Deployment0%',
  },
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
});
afterAll(() => vi.useRealTimers());

/** Render one entry through the provider-wrapped bare renderer and measure what it drew. */
async function measure(schema: unknown) {
  const { container, unmount } = render(
    // No host DataSource: every entry authors `staticData`, which the
    // renderer wraps into its own in-memory ValueDataSource. The provider
    // itself is load-bearing (`useSchemaContext`).
    <SchemaRendererProvider dataSource={undefined}>
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </SchemaRendererProvider>,
  );
  // The chart loads its inline rows through a ValueDataSource, so its first
  // paint is the loading placeholder; measure only once that is gone.
  await waitFor(() => expect(container.textContent ?? '').not.toContain('Loading Gantt chart...'));
  const nodes = Array.from(container.querySelectorAll('*'));
  const text = container.textContent ?? '';
  const styleText = Array.from(container.querySelectorAll('style')).map((el) => el.textContent ?? '');
  const tags = nodes.reduce<Record<string, number>>((h, el) => ((h[el.tagName] = (h[el.tagName] ?? 0) + 1), h), {});
  const out = {
    elements: nodes.length,
    tags,
    sha256: createHash('sha256').update(text).digest('hex'),
    visibleText: styleText.reduce((t, s) => t.replace(s, ''), text),
    text,
  };
  unmount();
  return out;
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('objectui#6939 — the three gantt entries the mirror refused now validate', () => {
  it.each(IDS)('%s validates under safeValidateSchema', (id) => {
    // Each reported `: Invalid input` (the union's own top-level issue)
    // before this card, for a key the renderer reads third.
    expect(reasons(getExample(id).schema)).toEqual([]);
  });
});

describe('objectui#6939 — and the repair moved the validator, not the renderer', () => {
  it.each(IDS)('%s renders exactly what it rendered before', async (id) => {
    const after = await measure(getExample(id).schema);
    const before = PRE_REPAIR[id];
    expect(after.elements).toBe(before.elements);
    expect(after.tags).toEqual(before.tags);
    expect(after.visibleText).toBe(before.visibleText);
    expect(after.sha256).toBe(before.sha256);
  });

  it.each(IDS)('%s anti-vacuity: the tile drew its AUTHORED tasks, not an error box', async (id) => {
    // An entry that renders nothing — or the error boundary — satisfies
    // "identical" trivially. The authored titles on screen prove the rows
    // reached the chart through `staticData`, the source the mirror ignored.
    // Since objectui#10859 batch 6 each entry writes its props in the spec's
    // `properties` bag, which `SchemaRenderer` hoists onto the node before
    // `ObjectGantt` reads it — so the PRE_REPAIR readings above, taken on the
    // flat spelling, hold for the bag too.
    const schema = getExample(id).schema as {
      properties: { staticData: Record<string, string>[]; gantt: { titleField: string } };
    };
    const m = await measure(schema);
    expect(m.elements).toBeGreaterThan(100);
    expect(m.text).not.toContain('failed to render');
    for (const row of schema.properties.staticData) {
      expect(m.visibleText).toContain(row[schema.properties.gantt.titleField]);
    }
  });
});
