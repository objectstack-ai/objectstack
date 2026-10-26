/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ComponentInput`'s five inert authoring keys are ADR-0049 RETIREMENT
 * TOMBSTONES, and the refusal is LOUD (objectui#5905).
 *
 * (The file name says "constraint keys" because the first four were retired
 * together and all four read like constraint slots. The fifth, `inputType`, is
 * a control-kind hint rather than a constraint; it joined them later and by its
 * own ruling — see the section below. The name is kept so the file's history
 * stays greppable.)
 *
 * ## What was measured
 *
 * `min` / `max` / `step` / `placeholder` were declared on `ComponentInput` and
 * read by nothing, on either path:
 *
 *   - no consumer reads them off a `ComponentInput` value; and
 *   - the manifest serializer (`packages/sdui-parser/src/index.ts`) forwards
 *     a fixed key list per input, `of` included since objectui#8067 — `name`,
 *     `type`, `of`, `required`, `enum`, `binding`, `description` — so an
 *     authored value could not reach the
 *     published `sdui.manifest.json` even in principle.
 *
 * A structural census over EVERY `inputs:` array in the repository found zero
 * authoring sites for the four; the same pass, over the same regions, counted
 * 926 `name`, 926 `type` and 161 `description` sites, so the instrument was
 * demonstrably not blind. Authorship from OUTSIDE this repository is not
 * measurable from here (the limit objectui#5674 recorded for
 * `PluginComponentInput`) — and that unmeasurable half is precisely what the
 * tombstone serves: an outside write becomes a NAMED REFUSAL carrying its own
 * remedy instead of a silent drop.
 *
 * ## Why tombstones and not deletions
 *
 * `ComponentInputSchema` is a NON-STRICT `z.object`, so a deleted key would be
 * silently STRIPPED — one silent no-op traded for another. The tombstone keeps
 * the key declared and unwritable: `?: never` on the interface (a `tsc` error
 * at the authoring site) and `retirementTombstone()` on the mirror (a parse
 * refusal whose message IS the migration note). Both halves are pinned below,
 * plus the CONTRAST against a genuinely undeclared key, so nobody can "simplify"
 * the tombstones into deletions without this file going red.
 *
 * ## `inputType` IS here now — the fork closed, and how
 *
 * The fifth key objectui#5905 named used to be live and writable, because the
 * repository AUTHORED it: `packages/plugin-markdown/src/index.tsx` declared
 * `inputType: 'textarea'` on its `content` input. That was
 * declared-and-DROPPED — a different defect from the declared-and-unread four
 * — so it needed a ruling rather than a removal, and its liveness was pinned
 * here to keep the fork visible.
 *
 * The ruling landed: maintainer, 2026-08-31 (objectui#5905, director seat
 * summon 6, decision batch #14), option B. The write was measured as a NO-OP
 * (the serializer dropped it; a structural census over every `inputs:` array
 * found no reader), so it was DELETED at zero capability cost and the key
 * joined the tombstones. Option A — teach `sdui-parser` to forward it — is
 * REFUSED on record: a write nothing reads is not demand for a feature.
 *
 * The two controls that pinned the fork's LIVE half are FLIPPED below rather
 * than deleted (`keeps inputType WRITABLE` and `inputType still parses green`).
 * A control is restated on success, never deleted into a vacuum — deleting them
 * would leave the closure asserted by nothing at all.
 *
 * The `@ts-expect-error` directives are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, so re-widening the
 * declaration fails the build on the unused directive.
 */

import { describe, it, expect } from 'vitest';
import type { ComponentInput } from '../base';
import { ComponentInputSchema } from '../zod/base.zod';

/** The five retired keys, with a value an author would plausibly have written. */
const RETIRED = {
  min: 0,
  max: 100,
  step: 1,
  placeholder: 'Type here…',
  // Retired later than the four above, by its own ruling (2026-08-31). The
  // value is the exact one `plugin-markdown` used to author, so the loop below
  // exercises the real historical write rather than an invented one.
  inputType: 'textarea',
} as const;

type RetiredKey = keyof typeof RETIRED;

/**
 * A fully live input — every key here is declared AND forwarded by the serializer.
 * (`label` used to sit here as a live key; it became a tombstone of the same
 * shape under objectui#7493 / objectui#7781, pinned in
 * `component-input-retired-keys-7493.test.ts`.)
 */
const LIVE_INPUT = {
  name: 'content',
  type: 'string',
  required: true,
  description: 'A positive integer — the contract rejects 0 and fractional values',
} as const;

const shapeOf = (schema: unknown): Record<string, unknown> =>
  (schema as { shape: Record<string, unknown> }).shape;

const describeOf = (schema: unknown, key: string): string | undefined =>
  (shapeOf(schema)[key] as { description?: string } | undefined)?.description;

/* ── type-level pins: the `tsc` channel ──────────────────────────────────── */

describe('the interface tombstones make authoring a `tsc` error', () => {
  it('refuses each retired key at the authoring site', () => {
    const input: ComponentInput = {
      name: 'content',
      type: 'string',
      // @ts-expect-error `min` is a retirement tombstone (objectui#5905)
      min: 0,
      // @ts-expect-error `max` is a retirement tombstone (objectui#5905)
      max: 100,
      // @ts-expect-error `step` is a retirement tombstone (objectui#5905)
      step: 1,
      // @ts-expect-error `placeholder` is a retirement tombstone (objectui#5905)
      placeholder: 'Type here…',
    };
    expect(input.name).toBe('content');
  });

  it('refuses `inputType` too — the fork objectui#5905 reported is now CLOSED', () => {
    // FLIPPED, not deleted. This control used to carry NO directive and assert
    // `input.inputType === 'textarea'`, pinning the key's liveness while the
    // fork was open. Its own comment named the trigger: "If this line ever
    // needs a directive, the fork was closed — say so on the card." The
    // maintainer closed it on 2026-08-31 (objectui#5905, option B), so the
    // directive is here and this is that saying-so.
    //
    // The directive IS the assertion: this package type-checks its tests
    // through `tsconfig.test.json`, so re-widening the declaration fails the
    // build on the now-unused directive.
    const input: ComponentInput = {
      name: 'content',
      type: 'string',
      // @ts-expect-error `inputType` is a retirement tombstone (objectui#5905, ruled 2026-08-31)
      inputType: 'textarea',
    };
    expect(input.name).toBe('content');
  });
});

/* ── the mirror refuses, and the refusal carries its remedy ──────────────── */

describe('the zod tombstones REFUSE, loudly (objectui#5905)', () => {
  it('a fully live input still parses GREEN — the non-vacuity control, in this test', () => {
    // Without this, a mirror that refused everything would satisfy every
    // assertion below by accident.
    const control = ComponentInputSchema.safeParse(LIVE_INPUT);
    expect(control.success).toBe(true);
    if (control.success) {
      expect(control.data.name).toBe('content');
      expect(control.data.description).toBe(LIVE_INPUT.description);
    }
  });

  it('`inputType` now parses RED — the same fork half, restated on the ruling', () => {
    // FLIPPED, not deleted: this asserted `success === true` while the fork was
    // open. The parameterised loop below covers `inputType` as well, now that
    // it is in `RETIRED`; this case is kept because it is the one a reader
    // diffs against the old file to see the fork close.
    const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, inputType: 'textarea' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => String(i.path[0]) === 'inputType');
      expect(issue?.code).toBe('invalid_type');
      expect(issue?.message).toContain('RETIRED (objectui#5905)');
    }
  });

  for (const key of Object.keys(RETIRED) as RetiredKey[]) {
    it(`refuses \`${key}\`, names it in the path, and answers with its own guidance`, () => {
      const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, [key]: RETIRED[key] });
      expect(result.success, key).toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => String(i.path[0]) === key);
      expect(issue, `no issue addressed to \`${key}\``).toBeDefined();

      // The accept-set contract: same address, same code a bare `z.never()`
      // reports. A `refine`-based spelling would report `custom` and was
      // rejected for exactly that reason (objectui#6105).
      expect(issue!.code, key).toBe('invalid_type');
      expect(issue!.path, key).toEqual([key]);

      // The message is the migration note, not zod's generic string.
      expect(issue!.message, key).not.toContain('Invalid input: expected never, received ');
      expect(issue!.message, key).toContain('RETIRED (objectui#5905)');
      expect(issue!.message, key).toContain(`\`ComponentInput.${key}\``);
      expect(issue!.message, key).toContain('`description`');

      // ONE string, BOTH channels — the invariant `retirementTombstone()`
      // exists to make unbreakable. Asserted derived (nothing hand-copied to
      // rot), which is why the literal anchors above sit beside it: two empty
      // strings are also equal.
      expect(issue!.message, key).toBe(describeOf(ComponentInputSchema, key));
    });
  }

  it('`placeholder` answers with the full string, including the `BaseSchema` disambiguation', () => {
    // One member pinned as a LITERAL so the derived assertions above cannot all
    // drift together. `BaseSchema.placeholder` is a different, live key — an
    // author who trips this one must not read it as that one being retired.
    const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, placeholder: 'Type here…' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'RETIRED (objectui#5905) — `ComponentInput.placeholder` was never read, and never published: '
        + 'the manifest serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and '
        + 'this is not one of them, so an authored value was silently dropped. Delete the key; put the '
        + 'hint in `description`, which IS published. `BaseSchema.placeholder`, the node-level prop, is '
        + 'a DIFFERENT key and is unaffected.',
      );
    }
  });
});

/* ── the contrast a deletion would have produced ─────────────────────────── */

describe('a tombstone is not a deletion — the contrast, measured in one run', () => {
  it('an UNDECLARED key is silently stripped, which is what deleting these four would have bought', () => {
    const result = ComponentInputSchema.safeParse({ ...LIVE_INPUT, notAKeyAtAll: 'anything' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('notAKeyAtAll');
  });

  it('the five stay in the mirror\'s shape — a tombstone is DECLARED, just unwritable', () => {
    for (const key of Object.keys(RETIRED)) {
      expect(shapeOf(ComponentInputSchema)).toHaveProperty(key);
      expect(describeOf(ComponentInputSchema, key)).toContain('RETIRED (objectui#5905)');
    }
  });
});
