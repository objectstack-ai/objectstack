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

import { acceptRetiredDefaultResidue, retiredKey } from './retired-key';
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
