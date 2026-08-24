// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { SysActivity } from './index.js';

/**
 * #11507 — the declaration of `sys_activity.type` must say what the column
 * actually is: an OPEN, author-extensible vocabulary whose declared options are
 * the platform's BUILT-IN set.
 *
 * ## The ruling this file executes
 *
 * Maintainer, 2026-08-24, on #11507 (direction 4 of the four the card framed),
 * verbatim: 「四维分析一致的，接手你的建议。」 Recorded on the card as:
 *
 *   > the column is an open, author-extensible vocabulary. […] make the
 *   > declaration honest (the select's declared options become the built-in set
 *   > with documented open-vocabulary semantics — not a closed enum the runtime
 *   > never enforces); ADR-0052 §5b.2 stays a sanctioned write path […]
 *   > Downstream: every closed map over this vocabulary is now the bug.
 *
 * Directions 2 (rule the producer non-conformant) and 3 (enforce the vocabulary)
 * were NOT ruled. Nothing here should be read as a step toward either.
 *
 * ## Why the declaration was dishonest, in one paragraph
 *
 * Three things were true at once. The field is a `select` over a fixed list —
 * which normally means "anything else is `invalid_option`". Every field on this
 * object is `readonly: true` and `validateRecord` skips readonly fields on both
 * write branches, so that check never runs. And ADR-0052 §5b.2's
 * `activityMilestones[].type` (`z.string().optional()` in `object.zod.ts`) is a
 * shipped, documented, author-facing channel that forwards ANY string into the
 * column — `audit-writers.ts`: `if (milestone.type) activityType = milestone.type`.
 * An author (a human, and far more often an AI writing metadata) who reads the
 * declaration builds the model "writing another value will be rejected", and
 * that model is false. The status quo was more dangerous than either end state,
 * which is what the four-facet analysis said and what the ruling adopted.
 *
 * ## The mechanism, and why this one
 *
 * `FieldSchema` has no key that means "open vocabulary" — no `openVocabulary`,
 * no `restricted`, no `allowCustomValues` (measured below, third case, so the
 * next author does not have to guess). Adding one is a `packages/spec` change
 * and therefore a different seat's card, not something to invent here. The slot
 * the spec DOES declare for exactly this is the field's own `description`
 * ("Tooltip/Help text", `field.zod.ts` — the documentation slot, distinct from
 * `placeholder` and `inlineHelpText`), and it is carried BY THE CONTRACT: the
 * exported `SysActivity` is the output of `ObjectSchema.create()`, i.e. of a
 * real parse, so what this file reads is metadata that ships — to the metadata
 * API, to the i18n bundles, to whatever an author or an AI reads about this
 * field — and not a source comment that stops at the file boundary.
 *
 * So: the source docblock carries the reasoning, and the `description` carries
 * the contract. This file pins the second, because only the second travels.
 */

/** The `type` field as it is actually declared (post-parse). */
function typeField(): { type?: string; description?: unknown; options?: unknown } {
  return ((SysActivity as { fields?: Record<string, Record<string, unknown>> })
    .fields?.type ?? {}) as { type?: string; description?: unknown; options?: unknown };
}

/** Option values declared by the `type` select field. */
function typeValues(): string[] {
  const options = (typeField().options ?? []) as Array<string | { value?: string }>;
  return options.map((o) => (typeof o === 'string' ? o : String(o.value)));
}

describe('[#11507] sys_activity.type is an OPEN vocabulary and the declaration says so', () => {
  /**
   * The half of the ruling that is easy to lose: "open" does NOT mean
   * "undeclared". The declared options are the BUILT-IN set — the values the
   * platform itself writes and the values a picker/filter offers — and they
   * stay declared. A future author who reads "open vocabulary" and deletes the
   * option list would take the built-in set, the labels, the i18n leaves and
   * the census pin with it.
   */
  it('keeps a declared built-in set — an open vocabulary is not an absent one', () => {
    const field = typeField();
    expect(
      field.type,
      'sys_activity.type stopped being a `select`. The #11507 ruling made the vocabulary '
        + 'OPEN, not undeclared: the declared options are the platform built-in set and '
        + 'they stay. Widening the column to a bare `text` deletes the built-in set, its '
        + 'labels and its i18n leaves, and leaves authors nothing to extend FROM.',
    ).toBe('select');
    expect(
      typeValues().length,
      'sys_activity.type declares no options. See above: open ≠ undeclared (#11507).',
    ).toBeGreaterThan(0);
  });

  /**
   * The load-bearing assertion, and the deliverable of #11507. The three
   * markers are the three things an author must be able to learn FROM THE
   * DECLARATION ITSELF:
   *   - the declared list is the BUILT-IN set (not the whole legal set);
   *   - the vocabulary is OPEN (an author may contribute a value);
   *   - the sanctioned way to do that is ADR-0052 §5b.2, which stays a write
   *     path per the ruling — not a rejection path.
   *
   * Asserted as markers rather than as an exact string: the wording is meant to
   * be improvable, the three facts are not.
   */
  it('declares open-vocabulary semantics in the CONTRACT, not only in a source comment', () => {
    const description = typeField().description;
    const hint =
      'sys_activity.type carries no open-vocabulary documentation in its declaration. '
      + 'Per the 2026-08-24 maintainer ruling on #11507 this column is an OPEN, '
      + 'author-extensible vocabulary: the declared options are the BUILT-IN set, an '
      + 'author-contributed value (ADR-0052 §5b.2 `activityMilestones[].type`, or an '
      + "app action's own `insert`) is legitimate, and it is stored verbatim — nothing "
      + 'rejects it, because every field here is `readonly` and `validateRecord` skips '
      + 'readonly fields. A bare option list without that sentence tells an author — '
      + 'most often an AI writing metadata — that another value would be REJECTED, '
      + 'which is false. Put it back in `description` (the contract carries it; a '
      + 'source comment does not).';

    expect(typeof description, hint).toBe('string');
    const text = String(description);
    expect(text.length, hint).toBeGreaterThan(0);
    for (const marker of [/built-in/i, /open vocabulary/i, /ADR-0052/]) {
      expect(marker.test(text), `${hint}\nMissing from the description: ${marker}`).toBe(true);
    }
  });

  /**
   * WHY the mechanism above is prose in `description` rather than a declared
   * flag: there is no flag. Measured, not assumed — and written so it goes RED
   * the day the spec grows one, which is the day this declaration should move
   * the semantics into it (and the day the objectui-side consumer can read the
   * openness mechanically instead of being told).
   *
   * Note what this does NOT claim: that such a key should not exist. Declaring
   * one is a `packages/spec` decision and belongs to the spec seat.
   */
  it('has no declared spec key for open/closed vocabulary — `description` is the available slot', () => {
    const probes = ['openVocabulary', 'restricted', 'allowCustomValues', 'extensible'];
    for (const key of probes) {
      const candidate = JSON.parse(JSON.stringify(SysActivity)) as {
        fields: Record<string, Record<string, unknown>>;
      };
      candidate.fields.type[key] = true;
      const parsed = ObjectSchema.safeParse(candidate);
      expect(
        parsed.success,
        `FieldSchema now accepts \`${key}\` on a field. If \`packages/spec\` grew a real `
          + 'open/closed-vocabulary declaration, this file is the pin that says so: move '
          + "sys_activity.type's open-vocabulary semantics onto that key (keeping the "
          + 'description as help text), and tell the objectui consumer card — a machine-'
          + 'readable flag is what lets a renderer stop guessing (#11507).',
      ).toBe(false);
    }
  });
});
