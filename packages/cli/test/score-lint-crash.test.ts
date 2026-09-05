// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `scoreMetadata` must never publish a clean verdict for a rubric that did not
 * run.
 *
 * ## Why the linter is mocked here rather than driven
 *
 * The crash IS reachable on a schema-valid stack — a localized `label`
 * (`{ en: …, 'zh-CN': … }`) on an app, or on a view's `list`, parses clean and
 * makes the label-case rule throw a `TypeError`. That is a defect in the rule,
 * filed on its own; pinning it here would make this suite depend on a bug
 * staying unfixed, and the day someone repairs the rule these assertions would
 * go green for the wrong reason — or be deleted to make them pass.
 *
 * What this file pins is the SCORER's contract, which holds for any throw from
 * any rule: a crash is recorded, never swallowed into `issues: []`. So the
 * linter is replaced by one that throws on demand, and the control below runs
 * the same harness with a linter that returns cleanly — a mock that always
 * failed would satisfy every assertion here for no reason at all.
 */

import { describe, expect, it, vi } from 'vitest';

const lint = vi.hoisted(() => ({
  /** When set, the stand-in `lintConfig` throws this instead of returning. */
  throws: null as unknown,
}));

vi.mock('../src/commands/lint.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/commands/lint.js')>();
  return {
    ...actual,
    lintConfig: () => {
      if (lint.throws !== null) throw lint.throws;
      return [];
    },
  };
});

const { scoreMetadata, LINT_CRASHED_RULE, SCORE_WEIGHTS } = await import('../src/lint/score.js');
const { runMetadataEval } = await import('../src/lint/metadata-eval.js');

/** Schema-valid and, to the stand-in linter, clean. */
const STACK = {
  objects: [
    {
      name: 'invoice',
      label: 'Invoice',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Invoice Number', required: true } },
    },
  ],
};

/** Schema-INVALID (`namespace` fails its pattern), so the parse half has a verdict. */
const SCHEMA_INVALID_STACK = {
  manifest: { id: 'bad', namespace: 'X', version: '1.0.0', name: 'Bad', type: 'app' as const },
};

function withLinterThrowing<T>(thrown: unknown, fn: () => T): T {
  lint.throws = thrown;
  try {
    return fn();
  } finally {
    lint.throws = null;
  }
}

/**
 * The async twin. ⚠️ Not a stylistic variant of the above: the sync helper
 * restores `lint.throws` when `fn` RETURNS, which for an async `fn` is the
 * moment it hands back a pending promise — before a single line of the work
 * being measured has run. Awaiting inside the `try` is what keeps the stand-in
 * throwing for the whole run.
 */
async function withLinterThrowingAsync<T>(thrown: unknown, fn: () => Promise<T>): Promise<T> {
  lint.throws = thrown;
  try {
    return await fn();
  } finally {
    lint.throws = null;
  }
}

describe('scoreMetadata — when the linter crashes', () => {
  it('CONTROL: the same harness with a linter that returns cleanly still scores 100 / A', () => {
    const r = scoreMetadata(STACK);
    expect(r.lintError).toBeUndefined();
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.valid).toBe(true);
    expect(r.counts.errors).toBe(0);
    expect(r.issues).toEqual([]);
  });

  it('refuses the verdict instead of scoring 100 / A / valid', () => {
    const r = withLinterThrowing(new TypeError('boom'), () => scoreMetadata(STACK));

    // The headline: nothing about this may read like a clean stack.
    expect(r.score).toBe(0);
    expect(r.grade).toBe('F');
    expect(r.valid).toBe(false);
  });

  it('records the crash in every carrier a consumer might read', () => {
    const r = withLinterThrowing(new TypeError('boom'), () => scoreMetadata(STACK));

    expect(r.lintError).toBe('boom');
    expect(r.counts.errors).toBe(1);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ severity: 'error', rule: LINT_CRASHED_RULE });
    // The message must say the rubric did not RUN — "no issues found" is the
    // exact reading this whole change exists to prevent.
    expect(r.issues[0].message).toContain('did not run');
    expect(r.issues[0].message).toContain('boom');
  });

  it('keeps the schema verdict, which the crash must not mask', () => {
    const r = withLinterThrowing(new TypeError('boom'), () => scoreMetadata(SCHEMA_INVALID_STACK));

    expect(r.counts.schemaErrors).toBeGreaterThan(0);
    expect(r.schemaErrors.some((m) => m.includes('namespace'))).toBe(true);
    expect(r.lintError).toBe('boom');
  });

  it('stringifies a non-Error throw rather than reporting "undefined"', () => {
    const r = withLinterThrowing('plain string failure', () => scoreMetadata(STACK));

    expect(r.lintError).toBe('plain string failure');
    expect(r.issues[0].message).toContain('plain string failure');
  });

  it('is not a lint error in disguise: a real lint error scores by the rubric and sets no lintError', () => {
    // One `error`-severity issue costs exactly its weight — the crash path is a
    // different claim from "the linter found one error", and the two must not
    // land on the same output.
    const r = scoreMetadata({
      objects: [{ name: 'BadName', label: 'Bad', fields: { name: { type: 'text', label: 'Name' } } }],
    });
    expect(r.lintError).toBeUndefined();
    expect(r.score).toBeGreaterThan(100 - SCORE_WEIGHTS.error * 2);
  });
});

describe('the eval harness reads the refusal without a new field', () => {
  const CORPUS = [{ id: 'crashing_case', prompt: 'anything', fixture: STACK }];

  it('CONTROL: the same case passes when the linter returns cleanly', async () => {
    const report = await runMetadataEval(CORPUS, { minScore: 75 });
    expect(report.results[0].passed).toBe(true);
    expect(report.ok).toBe(true);
  });

  it('fails the case whose linter crashed, and contributes 0 to the mean', async () => {
    const report = await withLinterThrowingAsync(new TypeError('boom'), () =>
      runMetadataEval(CORPUS, { minScore: 75 }),
    );

    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].score.lintError).toBe('boom');
    expect(report.meanScore).toBe(0);
    expect(report.ok).toBe(false);
  });

  it('still fails it when the score bar is lowered to 0 — the synthetic error is what holds', async () => {
    // `passed` reads `score >= minScore && counts.errors === 0 &&
    // counts.schemaErrors === 0`. At `--eval-min 0` the score half stops
    // discriminating, so the crash has to be an `error` in `counts` or the case
    // passes again. This is why the refusal is not carried by the number alone.
    const report = await withLinterThrowingAsync(new TypeError('boom'), () =>
      runMetadataEval(CORPUS, { minScore: 0 }),
    );

    expect(report.results[0].score.score).toBeGreaterThanOrEqual(0);
    expect(report.results[0].score.counts.errors).toBe(1);
    expect(report.results[0].passed).toBe(false);
    expect(report.ok).toBe(false);
  });
});
