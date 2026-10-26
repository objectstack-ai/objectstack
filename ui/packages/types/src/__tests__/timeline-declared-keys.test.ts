/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — the eight presentational keys `TimelineRenderer` reads that
 * `TimelineSchema` did not declare (objectui#6170).
 *
 * ## What was wrong
 *
 * `TimelineSchema` declared `events` (REQUIRED), `orientation` and `position`,
 * and nothing else. `TimelineRenderer`
 * (`plugin-timeline/src/renderer.tsx:250`) is annotated `schema:
 * TimelineSchema` and reads nine keys off it — `variant`, `items`,
 * `dateFormat`, `onItemClick`, `minDate`, `maxDate`, `rowLabel`, `scale`,
 * `timeScale` — and NONE of the three that were declared. So the exported type
 * matched neither what authors write, nor what the designer offers (the
 * registration's own `inputs`), nor what the renderer reads; those three agreed
 * with each other all along.
 *
 * The divergence was invisible to `tsc` because `BaseSchema` carried
 * `[key: string]: any`, so every undeclared key resolved as `any` and the
 * annotation constrained nothing. Its most visible casualty was the docs page's
 * own TypeScript example, which did not compile — `events` was required and
 * nothing on the page ever writes it. That example is pinned below.
 *
 * Eight of the nine are declared. `onItemClick` is deliberately NOT: it is a
 * runtime slot `ObjectTimeline` installs when it composes the schema it hands
 * to `TimelineRenderer`, and this package keeps callback-shaped keys off the
 * authored surface (`RuntimeOnlyDeclared` in `zod-mirror-parity.test.ts`).
 *
 * ## What the pin has teeth against, and what it does not
 *
 * Same ceiling as objectui#5903's gantt pin, and stated here rather than left
 * to be assumed. `BaseSchema` is `.passthrough()` on the zod side and carried
 * an index signature on the TS side until objectui#8347 (objectui#5155 /
 * objectui#6269 owned that ceiling; this card did not touch it), so:
 *
 *   - an UNDECLARED key is still accepted by the zod half (and was by the TS
 *     half while the signature stood). Declaring these eight did NOT buy
 *     rejection of a misspelling there;
 *   - a DECLARED key IS validated. `variant: 'diagonal'` type-checked and
 *     parsed green before this card and is refused now — that is the accept-set
 *     narrowing landed here;
 *   - on the TS side a read site could never be the detector while the index
 *     signature typed `schema.variant` as `any` either way. So the compile-time
 *     pin is the `@ts-expect-error` block at the bottom: when written, removing a
 *     declaration made its member resolve to `any`, the wrong-typed assignment
 *     started succeeding, and the now-unused directive failed the build
 *     (TS2578) NAMING the key. Since objectui#8347 a removal makes the indexed
 *     access itself an error, which the directive swallows, so a deletion is
 *     caught by the well-typed counter-probe instead (its literal names every
 *     key). `tsconfig.test.json` compiles this file, so that is real
 *     enforcement and not decoration (objectui#3009).
 *
 * ## The three keys that were declared and never read — now RETIRED
 *
 * `events` / `orientation` / `position` had zero read points. Stage 1 of
 * objectui#6170 made `events` required → OPTIONAL, the smallest change that let
 * the documented authoring form compile, and pinned all three here as STILL
 * DECLARED so the removal would be a deliberate edit against a red test rather
 * than a silent drift. Stage 2 (the maintainer ruling's ADR-0049
 * enforce-or-remove route, taken as REMOVE) has now made that edit: all three
 * are `?: never` / `retirementTombstone()` tombstones. What this file keeps of
 * them is the part that is still ITS claim — they stay declared, and absent
 * stays valid; the refusals themselves, with their counter-probes, are pinned
 * in `timeline-dead-keys-retired-6170.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { TimelineConfigSchema } from '@objectstack/spec/ui';
import { TimelineSchema } from '../zod/data-display.zod.js';
import type { TimelineSchema as TimelineSchemaTS, TimelineScale } from '../data-display.js';

const MINIMAL = { type: 'timeline' } as const;

/** Unwrap ZodOptional/ZodDefault/description wrappers down to the inner enum schema. */
function unwrap(schema: any): any {
  let cur = schema;
  while (cur?._def?.innerType) cur = cur._def.innerType;
  return cur;
}

/**
 * The keys this card declared, each with a value its declared type refuses.
 *
 * `timeScale` was the eighth. objectui#6355 RETIRED it, so it is no longer a
 * declared key carrying a vocabulary — it is a `?: never` / `z.never()`
 * tombstone, for which "refuses a wrong-typed value" and "accepts a well-typed
 * value" are the wrong assertions in both directions: the first would pass for
 * a reason that has nothing to do with this card, and the second cannot pass at
 * all. Its retirement has its own pin, `timeline-timescale-retired.test.ts`,
 * which also
 * carries the counter-probes. Removing it here rather than editing its value in
 * place is deliberate: it is the fixture that pinned the branch that was
 * deleted.
 */
const DECLARED: ReadonlyArray<readonly [string, unknown]> = [
  ['variant', 'diagonal'],
  ['items', 'not-an-array'],
  ['dateFormat', 'medieval'],
  ['scale', 'fortnight'],
  ['rowLabel', 5],
  ['minDate', 20240101],
  ['maxDate', 20241231],
];

describe('TimelineSchema — the eight presentational keys are declared (objectui#6170)', () => {
  it('the mirror declares every one of them', () => {
    const shape = Object.keys(TimelineSchema.shape);
    for (const [key] of DECLARED) expect(shape, `mirror is missing ${key}`).toContain(key);
  });

  it('declares them all OPTIONAL — a bare `{ type: "timeline" }` still parses', () => {
    // Requiredness is the half the zod-mirror-parity ratchet compares against
    // `../data-display.ts`, where all eight are `?:`. A mirror that required one
    // would reject every timeline already published — including the three
    // fixtures in `examples/schema-catalog/src/schemas/plugin-timeline/`.
    const result = TimelineSchema.safeParse(MINIMAL);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('materialises NO defaults — an omitted key stays absent after parse', () => {
    // `variant` and `dateFormat` default IN THE RENDERER, by destructuring
    // (`variant = 'vertical'`). A `.default()` here would arrive downstream as
    // an explicit author choice; the two spellings are not interchangeable.
    const result = TimelineSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const [key] of DECLARED) expect(key in result.data, `${key} must stay absent`).toBe(false);
  });

  it('refuses a wrong-typed value on each declared key (declared-key validation under passthrough)', () => {
    for (const [key, bad] of DECLARED) {
      const result = TimelineSchema.safeParse({ ...MINIMAL, [key]: bad });
      expect(result.success, `${key} accepted ${JSON.stringify(bad)}`).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.path[0] === key);
      expect(issue, `${key} failed, but not on the ${key} path`).toBeTruthy();
    }
  });

  it('accepts a well-typed value on each declared key', () => {
    // Counter-probe for the assertion above: it must be the VALUE being refused,
    // not the key. A pin that only ever sees red proves nothing.
    const good = {
      ...MINIMAL,
      variant: 'gantt',
      items: [{ label: 'Backend', items: [{ title: 'API', startDate: '2024-01-01', endDate: '2024-01-31' }] }],
      dateFormat: 'iso',
      scale: 'quarter',
      rowLabel: 'Projects',
      minDate: '2024-01-01',
      maxDate: '2024-12-31',
    };
    const result = TimelineSchema.safeParse(good);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('does NOT reject an undeclared key — objectui#5155’s ceiling, measured not assumed', () => {
    // Declaring the eight bought validation of DECLARED keys, not rejection of
    // undeclared ones: `BaseSchema` is `.passthrough()`. Anyone reading this
    // card as "misspellings now fail" is reading it wrong, and this pin says so
    // in the one place that cannot rot.
    const misspelled = TimelineSchema.safeParse({ ...MINIMAL, varient: 'gantt', timescale: 'month' });
    expect(misspelled.success).toBe(true);
  });
});

describe('TimelineSchema — `scale` is canonical and shares the spec vocabulary', () => {
  // The renderer resolves `scale` and accepts six values (`resolveTimelineScale`,
  // pinned against the spec by
  // `plugin-timeline/src/__tests__/timeline-scale-spec-parity.test.ts`; the
  // `timeScale` alias it used to also read is retired, objectui#6355). This is
  // the third leg of that agreement: the exported TYPE offers the same six.
  const specScales: string[] = unwrap(TimelineConfigSchema.shape.scale).options;

  it('reads a non-empty scale enum from the spec', () => {
    expect(specScales, 'could not read TimelineConfigSchema.shape.scale options').not.toEqual([]);
  });

  it('`scale` accepts exactly the spec vocabulary — and is the only key that does', () => {
    // It used to loop over `['scale', 'timeScale']`. The alias is RETIRED
    // (objectui#6355) and now refuses every one of these values; that half is
    // pinned in `timeline-timescale-retired.test.ts`.
    for (const value of specScales) {
      const result = TimelineSchema.safeParse({ ...MINIMAL, scale: value });
      expect(result.success, `scale refused spec scale '${value}'`).toBe(true);
    }
  });

  it('the registry `inputs` three-value timeScale enum is NOT the contract', () => {
    // Before objectui#6170 the designer offered `timeScale: day | week | month`
    // and the type offered neither key. `hour` / `quarter` / `year` were
    // authorable, rendered correctly, and were undiscoverable from both
    // surfaces. That designer input is gone entirely now — objectui#6355 retired
    // the alias and dropped its control; `scale` offers all six.
    for (const value of ['hour', 'quarter', 'year']) {
      expect(TimelineSchema.safeParse({ ...MINIMAL, scale: value }).success, value).toBe(true);
    }
  });
});

describe('TimelineSchema — the three unread keys stay DECLARED, now as tombstones (objectui#6170 stage 2)', () => {
  it('`events` / `orientation` / `position` remain in the mirror', () => {
    // Still true after the retirement, and still load-bearing: a tombstone that
    // left the mirror would let the retired key parse green under
    // `.passthrough()` and do nothing — see the ADR-0049 note in data-display.ts.
    const shape = Object.keys(TimelineSchema.shape);
    for (const key of ['events', 'orientation', 'position']) {
      expect(shape, `${key} left the mirror — see the ADR-0049 note in data-display.ts`).toContain(key);
    }
  });

  it('`events` is not REQUIRED — the stage-1 widening survives the stage-2 tombstone', () => {
    // It was required until objectui#6170's stage 1. That is why the docs
    // page's own TypeScript example did not compile. Stage 2 retires the key;
    // absence has to stay valid, or every timeline would be refused.
    expect(TimelineSchema.safeParse({ type: 'timeline', items: [] }).success).toBe(true);
  });

  // The third test that stood here — "still validates them when authored" —
  // asserted `orientation: 'diagonal'`, `position: 'centre'` and
  // `events: 'nope'` were refused. Under the tombstones it would still pass,
  // but for a different reason (`never` refuses every value, the well-typed
  // ones included), so keeping it would read as vocabulary enforcement while
  // measuring the retirement. The refusal is pinned by its own envelope and
  // counter-probes in `timeline-dead-keys-retired-6170.test.ts`, as
  // `timeScale`'s is in `timeline-timescale-retired.test.ts`.
});

describe('TimelineSchema (TS) — compile-time pin on the same keys', () => {
  it('accepts the docs page’s own TypeScript example', () => {
    // `content/docs/plugins/plugin-timeline.mdx` — the "TypeScript Support"
    // block, verbatim. Before objectui#6170 this exact object was
    // `TS2741: Property 'events' is missing … but required in type
    // 'TimelineSchema'`. The page taught an authoring form its own published
    // type refused.
    const timelineSchema: TimelineSchemaTS = {
      type: 'timeline',
      variant: 'vertical',
      items: [
        { time: '2024-01-15', title: 'Event', description: 'Description', variant: 'success' },
      ],
    };
    expect(timelineSchema.items).toHaveLength(1);
  });

  it('refuses a wrong-typed value on every declared key', () => {
    // Each directive below failed the build (TS2578, "unused '@ts-expect-error'")
    // the moment its key stopped being declared, while the member resolved to
    // `any` through `BaseSchema`'s index signature. Since objectui#8347 a removal
    // makes the indexed access itself an error, which its directive swallows, so
    // the deletion signal comes from the well-typed counter-probe below; each
    // directive still fails the build if its member is widened to accept the
    // value.

    // @ts-expect-error — `variant` is declared `'vertical' | 'horizontal' | 'gantt' | undefined`.
    const variant: TimelineSchemaTS['variant'] = 'diagonal';
    // @ts-expect-error — `dateFormat` is declared `'short' | 'long' | 'iso' | undefined`.
    const dateFormat: TimelineSchemaTS['dateFormat'] = 'medieval';
    // @ts-expect-error — `scale` is declared `TimelineScale | undefined`.
    const scale: TimelineSchemaTS['scale'] = 'fortnight';
    // `timeScale` used to sit here as the deprecated alias with the same six
    // values. It is RETIRED (objectui#6355) and its directive would now hold for
    // a different reason — `never` refuses `'fortnight'` the way it refuses
    // every value — so keeping it here would read as vocabulary enforcement
    // while measuring the tombstone. The tombstone has its own pin, with its own
    // counter-probe: `timeline-timescale-retired.test.ts`.
    // @ts-expect-error — `rowLabel` is declared `string | undefined`.
    const rowLabel: TimelineSchemaTS['rowLabel'] = 5;
    // @ts-expect-error — `minDate` is declared `string | undefined` (schemas are JSON).
    const minDate: TimelineSchemaTS['minDate'] = 20240101;
    // @ts-expect-error — `maxDate` is declared `string | undefined`.
    const maxDate: TimelineSchemaTS['maxDate'] = 20241231;
    // `orientation` and `position` used to sit here with their old vocabularies.
    // Both are RETIRED (objectui#6170 stage 2) and typed `?: never`, so their
    // directives would now hold for a different reason, exactly as `timeScale`'s
    // did — they are pinned, with counter-probes, in
    // `timeline-dead-keys-retired-6170.test.ts`.

    expect([
      variant, dateFormat, scale, rowLabel, minDate, maxDate,
    ]).toHaveLength(6);
  });

  it('accepts the well-typed value on every declared key', () => {
    // Counter-probe for the directives above: without this, a declaration
    // narrowed to `never` would satisfy every one of them.
    const ok: TimelineSchemaTS = {
      type: 'timeline',
      variant: 'gantt',
      items: [{ label: 'Backend', items: [{ title: 'API', startDate: '2024-01-01', endDate: '2024-01-31' }] }],
      dateFormat: 'iso',
      scale: 'quarter',
      rowLabel: 'Projects',
      minDate: '2024-01-01',
      maxDate: '2024-12-31',
    };
    expect(ok.rowLabel).toBe('Projects');
  });

  it('`TimelineScale` is the one axis vocabulary, not a second spelling', () => {
    const every: TimelineScale[] = ['hour', 'day', 'week', 'month', 'quarter', 'year'];
    // @ts-expect-error — the type is closed; a seventh bucket is not authorable.
    const extra: TimelineScale = 'fortnight';
    expect([...every, extra]).toHaveLength(7);
  });
});
