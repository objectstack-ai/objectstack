// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the build-progress PHASE vocabulary (cloud#2172 ruling A).
 *
 * What is actually at stake here is not "does zod reject a bad string" — it is
 * that this vocabulary is CLOSED and that its refusal is LOUD. objectui#7388
 * measured the cost of the alternative: the consumer's reader coerces any
 * value it does not recognise to `'structure'`, so a phase nobody declared
 * renders as a "still building" spinner for the 111 seconds the build spends
 * being verified after it finished. A refusal that merely throws leaves the
 * next author guessing; a refusal that names the accepted set tells them.
 *
 * So the refusal leg asserts the ENVELOPE, not the throw: zod 4 answers an
 * out-of-vocabulary enum value with `invalid_value` and carries the full
 * accepted set on the issue. ⛔ A bare `expect(...).toThrow()` here would stay
 * green against a schema that had degraded to a bare `z.string()` with a
 * refinement, which is exactly the degradation worth catching.
 *
 * The membership leg is the closed-enum pin. Each member was measured against
 * a real end of the channel (provenance is recorded per member on
 * `BUILD_PROGRESS_PHASES` in the source), so this array moving is a claim that
 * someone re-measured — not an edit to wave through.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  BUILD_PROGRESS_PHASES,
  BUILD_PROGRESS_FRAME_TYPE,
  BuildProgressPhaseSchema,
  BuildProgressFrameSchema,
  type BuildProgressPhase,
} from './build-progress.zod';

/**
 * The phases objectui's reader discriminates TODAY
 * (`packages/plugin-chatbot/src/mapMessages.ts` `extractBuildProgress`, and the
 * `ChatBuildProgress['phase']` union in `ChatbotEnhanced.tsx`). Declaring
 * `verify` must not disturb the inherited three — this is the control that has
 * to keep moving, not a restatement of the vocabulary under test.
 */
const PHASES_THE_CONSUMER_ALREADY_RENDERS = ['structure', 'data', 'done'] as const;

describe('BUILD_PROGRESS_PHASES (closed membership)', () => {
  it('is exactly the measured vocabulary, in lifecycle order', () => {
    expect(BUILD_PROGRESS_PHASES).toEqual(['structure', 'data', 'verify', 'done']);
  });

  it('still contains every phase the objectui reader already discriminates', () => {
    for (const phase of PHASES_THE_CONSUMER_ALREADY_RENDERS) {
      expect(BUILD_PROGRESS_PHASES).toContain(phase);
    }
  });

  it('names the post-apply verification phase the card exists to declare', () => {
    expect(BUILD_PROGRESS_PHASES).toContain('verify');
  });
});

describe('BuildProgressPhaseSchema', () => {
  it('parses every declared phase', () => {
    for (const phase of BUILD_PROGRESS_PHASES) {
      const result = BuildProgressPhaseSchema.safeParse(phase);
      expect(result.success).toBe(true);
      expect(result.success && result.data).toBe(phase);
    }
  });

  it('REFUSES an undeclared phase, and the refusal names the accepted set', () => {
    const result = BuildProgressPhaseSchema.safeParse('rebuilding');

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable: an undeclared phase parsed');

    const [issue] = result.error.issues;
    expect(result.error.issues).toHaveLength(1);
    expect(issue.code).toBe('invalid_value');
    // The loud half: the author is told what WAS allowed, not merely that they
    // were wrong. Compared against the exported vocabulary so the two cannot
    // drift apart silently.
    expect((issue as { values?: readonly unknown[] }).values).toEqual([...BUILD_PROGRESS_PHASES]);
  });

  it('REFUSES the neighbouring vocabulary of the sibling blueprint-progress frame', () => {
    // `data-blueprint-progress` is a DIFFERENT channel with its own phases
    // (`designing` / `done`). Folding its vocabulary in here would be the
    // "one enum for two frames" mistake; `designing` must not parse.
    expect(BuildProgressPhaseSchema.safeParse('designing').success).toBe(false);
  });

  it('REFUSES a non-string', () => {
    expect(BuildProgressPhaseSchema.safeParse(3).success).toBe(false);
    expect(BuildProgressPhaseSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('BUILD_PROGRESS_FRAME_TYPE', () => {
  it('is the literal both ends select on', () => {
    // objectui selects parts with `p.type === 'data-build-progress'`; the
    // `data-` prefix is what makes it a custom data part at all.
    expect(BUILD_PROGRESS_FRAME_TYPE).toBe('data-build-progress');
    expect(BUILD_PROGRESS_FRAME_TYPE.startsWith('data-')).toBe(true);
  });
});

describe('BuildProgressFrameSchema', () => {
  it('parses a frame carrying only the required phase', () => {
    const result = BuildProgressFrameSchema.safeParse({ phase: 'verify' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.phase).toBe('verify');
    expect(result.success && result.data.hop).toBeUndefined();
    expect(result.success && result.data.tool).toBeUndefined();
  });

  it('parses a frame carrying both optional fields', () => {
    const result = BuildProgressFrameSchema.safeParse({
      phase: 'verify',
      hop: 4,
      tool: 'verify_build',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toMatchObject({
      phase: 'verify',
      hop: 4,
      tool: 'verify_build',
    });
  });

  it('parses a frame carrying each optional field on its own', () => {
    expect(BuildProgressFrameSchema.safeParse({ phase: 'data', hop: 0 }).success).toBe(true);
    expect(BuildProgressFrameSchema.safeParse({ phase: 'data', tool: 'create_seed' }).success).toBe(true);
  });

  it('is a FLOOR: the panel fields objectui already reads survive the parse', () => {
    // Regression guard for "tighten it to .strict()". Every key below is read
    // by `extractBuildProgress` off this same frame today; refusing or
    // stripping them would break the shipping consumer.
    const shipping = {
      phase: 'structure' as const,
      appLabel: 'CRM',
      items: [{ type: 'object', name: 'contacts' }],
      done: 1,
      total: 4,
      seq: 12,
    };

    const result = BuildProgressFrameSchema.safeParse(shipping);
    expect(result.success).toBe(true);
    expect(result.success && result.data).toMatchObject(shipping);
  });

  it('REFUSES an undeclared phase, locating it at `phase`', () => {
    const result = BuildProgressFrameSchema.safeParse({ phase: 'rebuilding', hop: 1 });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable: a frame with an undeclared phase parsed');

    const [issue] = result.error.issues;
    expect(issue.code).toBe('invalid_value');
    expect(issue.path).toEqual(['phase']);
  });

  it('REFUSES a frame with no phase at all', () => {
    const result = BuildProgressFrameSchema.safeParse({ hop: 2, tool: 'verify_build' });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].path).toEqual(['phase']);
  });

  it('REFUSES a malformed hop and an empty tool name', () => {
    expect(BuildProgressFrameSchema.safeParse({ phase: 'verify', hop: -1 }).success).toBe(false);
    expect(BuildProgressFrameSchema.safeParse({ phase: 'verify', hop: 1.5 }).success).toBe(false);
    expect(BuildProgressFrameSchema.safeParse({ phase: 'verify', tool: '' }).success).toBe(false);
  });
});

describe('BuildProgressPhase (type)', () => {
  it('admits every declared member and is assignable from the array', () => {
    const everyPhase: BuildProgressPhase[] = [...BUILD_PROGRESS_PHASES];
    expect(everyPhase).toHaveLength(BUILD_PROGRESS_PHASES.length);
  });
});

/**
 * The provenance leg — and the one leg whose subject is TEXT on purpose.
 *
 * This module's docblock is not incidental prose. The published
 * `@objectstack/spec` tarball ships the `.zod.ts` sources themselves, and the
 * same text is rendered verbatim into
 * `content/docs/references/ai/build-progress.mdx`. For a CLOSED vocabulary it
 * is the audit trail the "re-measure before you move the array" discipline
 * reads: a reader who cannot tell a MEASUREMENT from a RULING re-cites the
 * ruling as evidence, and the next member goes in on a claim nobody ever made.
 *
 * So what is pinned here is narrow and load-bearing: that the three labels are
 * defined, that `verify` is labelled as the ruling it is rather than as a
 * measurement, and that the liveness watch is still present — ⛔ not the
 * wording around any of them. Nothing else in this file asserts on text.
 */
describe('module docblock provenance', () => {
  const SOURCE = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'build-progress.zod.ts'),
    'utf-8',
  );

  it('defines all three provenance labels', () => {
    for (const label of ['measured on a named reachable source', 'declared by ruling', 'inferred']) {
      expect(SOURCE).toContain(label);
    }
  });

  it('labels `verify` as declared by ruling, and ⛔ never as measured membership', () => {
    // The bullet itself, not the surrounding paragraph: `verify` is in the
    // enum because cloud#2172 ruled it in, which is a good reason and is not
    // an observation of any producer or consumer.
    const bullet = SOURCE.slice(SOURCE.indexOf(' * - `verify`'));
    expect(bullet.slice(0, 200)).toContain('**declared by ruling**');

    // The retired headline claimed every member was measured against a real
    // end of the channel. It was false for `verify` on the day it was written.
    expect(SOURCE).not.toContain('Membership was MEASURED');
    expect(SOURCE).not.toContain('every member below is one a real producer emits');
  });

  it('keeps the liveness watch for the three declared-ahead surfaces', () => {
    expect(SOURCE).toContain('## Liveness watch');
    for (const surface of ['`verify` phase', '`hop`', '`tool`']) {
      expect(SOURCE).toContain(surface);
    }
    // The point of the watch: no gate notices, so the paragraph is the notice.
    expect(SOURCE).toContain('ADR-0049');
    expect(SOURCE).toContain('cloud#2172');
    expect(SOURCE).toContain('objectui#7388 block 2');
  });
});
