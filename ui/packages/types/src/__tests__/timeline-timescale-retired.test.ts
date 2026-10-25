/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the `timeScale` alias is REFUSED, not silently defaulted
 * (objectui#6355).
 *
 * ## The failure this pin exists to prevent
 *
 * `timeScale` was this renderer's pre-spec spelling of the gantt axis bucket.
 * `scale` is canonical (objectui#6170 maintainer ruling 2026-08-25: it is
 * `@objectstack/spec` `ui/TimelineConfig.json`'s axis key AND the renderer's
 * preferred read), and objectui#6355's ruling (2026-08-27) retires the alias
 * immediately, with no phased window.
 *
 * Dropping `resolveTimelineScale`'s `?? schema.timeScale` fallback is the whole
 * behavioural change, and on its own it is the WRONG shape: a stored document
 * that spells only `timeScale` would stop being read and fall through to the
 * renderer's historical `month` default. The chart silently changes bucket and
 * NOTHING errors — the same class of silent axis breakage objectui#2942 closed,
 * running in the other direction.
 *
 * So the deliverable is not "`scale` works". It is: **an old-spelling document
 * is refused loudly at the authoring boundary.** That is what the two halves of
 * the tombstone buy, and it is what this file pins.
 *
 * ## Why the tombstone, and not simply deleting the key
 *
 * `BaseSchema` is `.passthrough()` on the Zod side and carried a
 * `[key: string]: any` index signature on the TS side until objectui#8347
 * (objectui#5155 / objectui#6269 owned that ceiling). An UNDECLARED key is
 * therefore accepted by the Zod half, unvalidated (and was by the TS half; since
 * objectui#8347 only through a widened value). Deleting `timeScale` outright
 * would hand the old spelling exactly the silent no-op this card exists to
 * prevent: it would parse green, type-check green through a widened value, and
 * do nothing.
 *
 * Keeping the key declared as `?: never` / `z.never().optional()` is what makes
 * the retirement audible. That is this package's tombstone convention —
 * {@link StaticTableColumn} (objectui#5474), `crud.ts` `confirm`
 * (objectui#4314) — and it is lockstep: both halves or neither, because either
 * half alone leaves the other surface silently accepting the retired spelling.
 * `absent` stays valid on both halves, so every document that never wrote the
 * alias is untouched.
 */

import { describe, it, expect } from 'vitest';
import { TimelineSchema } from '../zod/data-display.zod.js';
import type { TimelineSchema as TimelineSchemaTS } from '../data-display.js';

/** The exact document class this card protects: gantt, axis spelled the OLD way, no `scale`. */
const TIMESCALE_ONLY_DOCUMENT = {
  type: 'timeline',
  variant: 'gantt',
  timeScale: 'day',
  rowLabel: 'Projects',
  items: [{ label: 'Backend', items: [{ title: 'API', startDate: '2024-01-01', endDate: '2024-01-31' }] }],
} as const;

describe('timeScale is RETIRED — the old spelling is refused, not silently defaulted (objectui#6355)', () => {
  it('REFUSES a timeScale-only document, naming the retired key', () => {
    // The pin. Before the retirement this document parsed GREEN (`timeScale`
    // was `TimelineScaleSchema.optional()`), which is why this assertion is red
    // on the pre-fix tree. Asserting the ENVELOPE — not merely `success:false` —
    // so the pin cannot be satisfied by an unrelated rejection: a document that
    // failed for its `items` shape would read identically otherwise.
    const result = TimelineSchema.safeParse(TIMESCALE_ONLY_DOCUMENT);
    expect(result.success, 'a timeScale-only document was ACCEPTED — it will silently revert to the month default').toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'timeScale');
    expect(issue, 'parse failed, but not on the `timeScale` path').toBeTruthy();
    expect(issue?.code).toBe('invalid_type');
    expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
  });

  it('the refusal CARRIES the remediation text, not zod\'s generic message (objectui#6931)', () => {
    // Until objectui#6931 this key answered with zod's own
    // `"Invalid input: expected never, received string"` — which names the key
    // (via the path asserted above) but not the remedy, so the author was told
    // WHAT is wrong and never `scale`. `retirementTombstone()` writes the
    // guidance once into the parse message and `.describe()` both.
    const result = TimelineSchema.safeParse(TIMESCALE_ONLY_DOCUMENT);
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find((i) => i.path[0] === 'timeScale');
    expect(issue?.message).not.toContain('Invalid input: expected never, received ');
    expect(issue?.message).toBe('RETIRED (objectui#6355) — author scale instead');
    // ONE string, BOTH channels: the parse message an author reads and the
    // `.describe()` metadata that feeds generated JSON-Schema are the SAME
    // text — asserted derived, so the two cannot drift apart.
    expect(issue?.message).toBe(
      (TimelineSchema.shape.timeScale as { description?: string }).description,
    );
    // Accept set untouched by the message change: same code the bare
    // `z.never()` reported, pinned beside `expected: 'never'` above.
    expect(issue?.code).toBe('invalid_type');
  });

  it('ACCEPTS the same document migrated to the canonical `scale`', () => {
    // Counter-probe. Without it the assertion above is satisfied by any schema
    // that refuses everything, and the pin would prove nothing about the KEY.
    const { timeScale: _retired, ...rest } = TIMESCALE_ONLY_DOCUMENT;
    const result = TimelineSchema.safeParse({ ...rest, scale: 'day' });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('leaves a document that never wrote the alias untouched', () => {
    // `absent` stays valid — `.optional()` on the tombstone. The retirement
    // narrows exactly one spelling and nothing else.
    expect(TimelineSchema.safeParse({ type: 'timeline' }).success).toBe(true);
    expect(TimelineSchema.safeParse({ type: 'timeline', variant: 'gantt', scale: 'quarter' }).success).toBe(true);
  });

  it('keeps `timeScale` DECLARED — a tombstone, not a deletion', () => {
    // The route guard, and the reason this is a tombstone at all. `BaseSchema`
    // is `.passthrough()`, so removing the key from the mirror would make the
    // old spelling parse green again and do nothing — the silent reversion,
    // reintroduced by the very edit meant to remove it.
    expect(
      Object.keys(TimelineSchema.shape),
      'timeScale left the mirror — under .passthrough() the retired spelling becomes a SILENT no-op',
    ).toContain('timeScale');
  });
});

describe('timeScale is RETIRED — the TS half of the tombstone (objectui#6355)', () => {
  it('refuses the retired spelling at compile time', () => {
    // The mirror twin's compile-time half. On the pre-fix tree `timeScale` is
    // `TimelineScale | undefined`, so `'month'` is a LEGAL assignment, the
    // directive below is unused, and `tsc` fails the build with TS2578 naming
    // the key — this leg is red before the fix in `type-check`, not in vitest,
    // which strips types. `tsconfig.test.json` compiles this file, so the
    // directive is real enforcement (objectui#3009).

    // @ts-expect-error — `timeScale` is RETIRED (objectui#6355): declared `?: never`, so no value is authorable.
    const retired: TimelineSchemaTS['timeScale'] = 'month';

    // Counter-probe on the same surface: the canonical key still accepts the
    // whole vocabulary, so the directive above pins the KEY's retirement and
    // not a blanket narrowing of the node.
    const canonical: TimelineSchemaTS['scale'] = 'month';

    expect([retired, canonical]).toHaveLength(2);
  });

  it('refuses the retired spelling in the form authors actually write', () => {
    // The assertion above reads the MEMBER's type. This one writes a DOCUMENT,
    // which is the shape an author (or an AI generating metadata) produces, and
    // it is the leg that proved the tombstone survives `BaseSchema`'s
    // `[key: string]: any` while it stood (objectui#8347 removed it): if the
    // index signature had won, `timeScale` would have widened back to `any`
    // here and the directive would have gone unused (TS2578).

    const retiredDocument: TimelineSchemaTS = {
      type: 'timeline',
      variant: 'gantt',
      // The directive belongs on the PROPERTY, not on the `const`: excess-property
      // checking reports the error at the member, so a directive one line up
      // suppresses nothing and goes unused (TS2578) while the real error stands.
      // @ts-expect-error — `timeScale` is RETIRED (objectui#6355); the document must name `scale`.
      timeScale: 'month',
    };

    // The migrated document — same node, canonical key — still type-checks.
    const migratedDocument: TimelineSchemaTS = {
      type: 'timeline',
      variant: 'gantt',
      scale: 'month',
    };

    expect([retiredDocument, migratedDocument]).toHaveLength(2);
  });
});
