// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Contract of `acceptRetiredDefaultResidue` — the retired-DEFAULTED-key
 * tolerance stage (#12840; maintainer ruling 2026-08-28, recorded on
 * objectstack-ai/cloud#1685).
 *
 * The class rule under test: a RETIRED key that carried a schema default is
 * refused only when it carries a NON-default value. The retired default — the
 * value every artifact built by a released toolchain has MATERIALIZED in every
 * entry — parses as inert residue and is STRIPPED before the closed shape
 * sees it. These tests run the helper over a SYNTHETIC schema, deliberately:
 * they prove the judgement is reusable for the next defaulted-key retirement
 * (different key names, a non-boolean default) rather than a special case of
 * `allowRestore`/`allowPurge` — the founding case is pinned where it lives, in
 * `security/permission.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { acceptRetiredDefaultResidue, enumWithRetiredValues, retiredKey } from './retired-key';
import { strictObject } from './strict-object';

const GONE_GUIDANCE =
  '`gone` was removed in @objectstack/spec 99 (#0000). Delete the key.';
const MODE_GUIDANCE =
  '`legacyMode` was removed in @objectstack/spec 99 (#0000). Delete the key.';

/** A synthetic "next retirement": one boolean default, one string default. */
const inner = strictObject(
  {
    surface: 'this synthetic surface',
    history: 'Synthetic fixture for the residue-stage contract.',
  },
  {
    keep: z.string().optional(),
    flag: z.boolean().default(true),
    gone: retiredKey(GONE_GUIDANCE),
    legacyMode: retiredKey(MODE_GUIDANCE),
  },
);

/**
 * The residue literals, captured at "retirement time": before their (fictional)
 * retirement, `gone` was `z.boolean().default(false)` and `legacyMode` was
 * `z.enum(…).default('classic')`. The helper never re-reads them from anywhere
 * live — the schema above no longer has them, which is the point.
 */
const schema = acceptRetiredDefaultResidue(inner, {
  gone: false,
  legacyMode: 'classic',
});

describe('acceptRetiredDefaultResidue (#12840)', () => {
  it('accepts each captured retired default and strips it from the output', () => {
    const r = schema.safeParse({ keep: 'x', gone: false, legacyMode: 'classic' });
    expect(r.success).toBe(true);
    expect('gone' in r.data!).toBe(false);
    expect('legacyMode' in r.data!).toBe(false);
    expect(r.data!.keep).toBe('x');
    // The live default machinery is untouched: `flag` still materializes.
    expect(r.data!.flag).toBe(true);
  });

  it('parse → serialize → parse converges to the clean shape (fixpoint, no re-emission)', () => {
    const first = schema.parse({ keep: 'x', gone: false, legacyMode: 'classic' });
    const wire = JSON.parse(JSON.stringify(first)) as Record<string, unknown>;
    expect('gone' in wire).toBe(false);
    expect('legacyMode' in wire).toBe(false);
    const second = schema.parse(wire);
    expect(JSON.parse(JSON.stringify(second))).toEqual(wire);
  });

  it('refuses every non-default value with the tombstone byte-for-byte', () => {
    // `gone` retired at default `false`: `true` refuses. `legacyMode` retired
    // at default `'classic'`: any other string refuses. The refusal must be
    // the tombstone's OWN issue — `expected: 'never'`, guidance as message —
    // proving the stage never rewrites a non-default value on its way in.
    const cases: Array<[string, unknown, string]> = [
      ['gone', true, GONE_GUIDANCE],
      ['legacyMode', 'modern', MODE_GUIDANCE],
    ];
    for (const [key, value, guidance] of cases) {
      const r = schema.safeParse({ [key]: value });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path[i.path.length - 1] === key)!;
      expect(issue).toBeDefined();
      expect((issue as { expected?: string }).expected).toBe('never');
      expect(issue.code).toBe('invalid_type');
      expect(issue.message).toBe(guidance);
    }
  });

  it('compares by identity — a falsy near-miss of the captured default is NOT residue', () => {
    // `gone`'s captured default is `false`; 0 / '' / null are different values
    // and land on the tombstone like any authored value. This is the
    // "captured at retirement time" half of the contract: the tolerance is for
    // the ONE value the released toolchain emitted, not for "falsy".
    for (const wrong of [0, '', null] as const) {
      const r = schema.safeParse({ gone: wrong });
      expect(r.success, `value ${JSON.stringify(wrong)} must NOT be tolerated`).toBe(false);
    }
    // And per-key: `legacyMode`'s default is 'classic', so `false` — the OTHER
    // key's default — is not residue here.
    expect(schema.safeParse({ legacyMode: false }).success).toBe(false);
  });

  it('absence stays clean, and the residue keys never re-materialize', () => {
    const r = schema.parse({ keep: 'y' });
    expect('gone' in r).toBe(false);
    expect('legacyMode' in r).toBe(false);
  });

  it('does not loosen the closed door — unknown keys still refuse through the stage', () => {
    const r = schema.safeParse({ keep: 'x', invented: 1 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('invented');
  });

  it('non-object bodies pass through to the schema untouched', () => {
    expect(schema.safeParse('nope').success).toBe(false);
    expect(schema.safeParse([{ gone: false }]).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });

  it('reads through to the inner authorable shape (walkers and shape consumers)', () => {
    expect(schema.shape).toBe(inner.shape);
    expect(schema.shape.gone.description).toBe(`[REMOVED] ${GONE_GUIDANCE}`);
    // And the runtime node is a preprocess pipe whose OUT side is the closed
    // shape — the orientation `pipeAuthorableSide` resolves (#4488/#5074/#5317),
    // so the authorable-surface / JSON-schema walkers keep governing it.
    const def = (schema as unknown as { _zod: { def: { type: string; out?: unknown } } })._zod.def;
    expect(def.type).toBe('pipe');
    expect((def.out as { _zod: { def: { type: string } } })._zod.def.type).toBe('object');
  });
});

// ============================================================================
// VALUE-level retirement (#17109)
// ============================================================================

/**
 * Contract of `enumWithRetiredValues` — the VALUE-level sibling of the
 * tombstones above (#17109; maintainer ruling 2026-09-09, the generic helper
 * rather than a refinement on the single enum that exposed the gap).
 *
 * The class rule under test: a retired enum MEMBER refuses at parse **by
 * name**, carrying its own migration prescription, while every other member
 * and every unrelated typo is left exactly as `z.enum` had them. Like the
 * residue suite above, these run over a SYNTHETIC vocabulary on purpose —
 * they prove the judgement is general to any `z.enum` (which is what was
 * ruled), not a property of the one enum that will consume it first.
 */

const HEADING_RETIRED =
  '`text.variant: "heading"` was removed in @objectstack/spec 99 (ADR-0000) — a heading is a '
  + 'document level, never a text style, so the renderer had to guess one. Use `h2`, or pick the '
  + 'level you mean. '
  + 'Run `os migrate meta --from 98` to list the mechanical edits for existing sources; apply them by hand.';

/** A second retirement on the SAME enum, and one with no conversion behind it. */
const SUBHEADING_RETIRED =
  '`text.variant: "subheading"` was removed in @objectstack/spec 99 (ADR-0000) — same reason as '
  + '`heading`. Use `h3`, or pick the level you mean.';

const VariantEnum = enumWithRetiredValues(
  ['body', 'caption', 'h1', 'h2', 'h3'],
  { heading: HEADING_RETIRED, subheading: SUBHEADING_RETIRED },
);

describe('enumWithRetiredValues (#17109)', () => {
  it('refuses a retired member with ITS OWN prescription, byte-for-byte', () => {
    for (const [member, prescription] of [
      ['heading', HEADING_RETIRED],
      ['subheading', SUBHEADING_RETIRED],
    ] as const) {
      const r = VariantEnum.safeParse(member);
      expect(r.success).toBe(false);
      // The envelope, not merely "it threw": zod's own enum issue, with the
      // prescription as the message. A second retired member on one enum is
      // the recurrence the ruling named — a hand-rolled ternary does not
      // reach it, so it is pinned rather than assumed.
      expect(r.error!.issues).toHaveLength(1);
      expect(r.error!.issues[0]!.code).toBe('invalid_value');
      expect(r.error!.issues[0]!.message).toBe(prescription);
    }
  });

  it('leaves every live member accepted and every other refusal untouched', () => {
    for (const live of ['body', 'caption', 'h1', 'h2', 'h3']) {
      expect(VariantEnum.parse(live)).toBe(live);
    }
    // A typo is NOT a retirement: telling the author of `headng` that their
    // value "was removed" would misinform, so zod's own message — which lists
    // the legal tokens — is what they keep.
    const typo = VariantEnum.safeParse('headng');
    expect(typo.success).toBe(false);
    expect(typo.error!.issues[0]!.message).not.toBe(HEADING_RETIRED);
    expect(typo.error!.issues[0]!.message).toContain('Invalid option');
  });

  it('never hands back an inherited Object.prototype member as the message', () => {
    // A bare `retired[input]` lookup answers `constructor` with a FUNCTION and
    // `toString` with another — an author's typo turning into a garbage error
    // message, or worse. The helper asks `hasOwnProperty`.
    for (const inherited of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      const r = VariantEnum.safeParse(inherited);
      expect(r.success).toBe(false);
      expect(typeof r.error!.issues[0]!.message).toBe('string');
      expect(r.error!.issues[0]!.message).toContain('Invalid option');
    }
    // Non-string inputs reach the same lookup and must not match either.
    for (const nonString of [5, null, {}, ['heading']]) {
      const r = VariantEnum.safeParse(nonString);
      expect(r.success).toBe(false);
      expect(r.error!.issues[0]!.message).not.toBe(HEADING_RETIRED);
    }
  });

  it('composes with `.optional()` — absence is fine, the member still refuses', () => {
    const shape = z.object({ variant: VariantEnum.optional() });
    expect(shape.safeParse({}).success).toBe(true);
    const r = shape.safeParse({ variant: 'heading' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe(HEADING_RETIRED);
    expect(r.error!.issues[0]!.path).toEqual(['variant']);
  });

  it('composes with `.default(…)` — the default materializes, the member still refuses', () => {
    // The sharp case the first consumer presents: the enum carries a default,
    // so a document that omits the key never meets the refusal at all, while
    // one that WRITES the retired member does. (A retired member that was
    // itself the default is a different population — `acceptRetiredDefaultResidue`.)
    const shape = z.object({ variant: VariantEnum.default('body') });
    expect(shape.parse({})).toEqual({ variant: 'body' });
    expect(shape.parse({ variant: 'h3' })).toEqual({ variant: 'h3' });
    const r = shape.safeParse({ variant: 'heading' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe(HEADING_RETIRED);
  });

  it('excludes the retired member from `z.input` — the tsc channel, same as a key tombstone', () => {
    const live: z.input<typeof VariantEnum> = 'h2';
    // @ts-expect-error — the retirement removes the member from the input
    // union, so an author writing it fails to compile before anything runs.
    const retiredMember: z.input<typeof VariantEnum> = 'heading';
    expect(live).toBe('h2');
    expect(retiredMember).toBe('heading');
  });

  it('refuses at CONSTRUCTION a retirement that could never fire', () => {
    // Still listed: the enum accepts the value, so the prescription is dead
    // declaration — the shape this repo refuses (declared ≠ enforced).
    expect(() => enumWithRetiredValues(['body', 'heading'], { heading: HEADING_RETIRED }))
      .toThrow(/declared retired but still listed/);
    // A wrapper with nothing retired, and a prescription that says nothing.
    expect(() => enumWithRetiredValues(['body'], {}))
      .toThrow(/no retired member declared/);
    expect(() => enumWithRetiredValues(['body'], { heading: '   ' }))
      .toThrow(/empty prescription/);
  });
});
