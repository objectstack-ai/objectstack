// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the `check:generated` LEDGER against package.json — the reconciliation
// that decides whether every `check:`/`gen:` script in this package is actually
// covered by a gate, or has quietly dropped out of coverage.
//
// WHY IT IS WORTH A TEST AND NOT JUST A CI STEP. The reconciliation has been
// dormant or unsatisfied three times now, and each time the cost was a CI lap
// rather than a local one:
//
//   • #4177 and #4232 landed unclassified scripts while nothing in CI ran the
//     reconciliation at all, so `main` carried a wrapper that exited red before
//     running a single gate.
//   • #4291 fixed that by wiring `--reconcile-only` into lint.yml's unfiltered
//     required job — which is exactly where #5286's own first push then died,
//     because the two scripts it added (`check:test-typecheck`,
//     `gen:test-typecheck-debt`) were in neither ledger bucket. `tsc` passed;
//     the step after it did not.
//
// So the negative direction of this reconciliation is not hypothetical — it is
// the reason this file exists, observed in production twice. What was missing
// was a signal BEFORE the push: `pnpm --filter @objectstack/spec test` did not
// read the ledger, so a script added in one file and unclassified in another was
// invisible until a runner said so ten minutes later. This closes that gap.
//
// It runs the real script in place: `--reconcile-only` reads package.json and
// the ledger arrays and exits — no gates, no build, no writes, sub-second — so
// there is nothing to sandbox and no way for it to differ from what CI runs.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');

function runReconcile(): { status: number | null; output: string } {
  const require = createRequire(import.meta.url);
  const tsx = require.resolve('tsx/cli');
  const result = spawnSync(process.execPath, [tsx, path.join(HERE, 'check-generated.ts'), '--reconcile-only'], {
    cwd: SPEC,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('check:generated --reconcile-only', () => {
  const scripts: Record<string, string> = JSON.parse(fs.readFileSync(path.join(SPEC, 'package.json'), 'utf8')).scripts;
  const checks = Object.keys(scripts).filter((n) => n.startsWith('check:'));
  const gens = Object.keys(scripts).filter((n) => n.startsWith('gen:'));

  it('classifies every check:/gen: script this package declares', () => {
    const { status, output } = runReconcile();
    // The failure text is the useful part when this goes red: it names the
    // unclassified script and asks the classifying question.
    expect(output).not.toMatch(/is in neither GATED nor NO_GENERATOR/);
    expect(output).not.toMatch(/it is not in UNGATED_GENERATORS/);
    expect(status, output).toBe(0);
  });

  it('reports the same script counts package.json actually declares', () => {
    // Derived from package.json rather than hardcoded, so adding a gate does not
    // churn this test — only FAILING to classify one does.
    const { output } = runReconcile();
    expect(output).toContain(`${checks.length} check: + ${gens.length} gen: scripts`);
    expect(output).toContain('all classified');
  });

  it('covers the explicit, manual-only anchor generator (#5358)', () => {
    // `gen:authorable-surface-base` is the third classification this ledger
    // carries, and the one most likely to be mis-filed by a later change:
    // UNGATED_GENERATORS would claim nothing verifies its artifact (false —
    // check:authorable-surface proves the anchor authentic), while a GATED entry
    // would put it in reach of `--fix`, which is the side effect #5358 removed.
    expect(scripts['gen:authorable-surface-base']).toBeDefined();
    expect(scripts['gen:authorable-surface-base']).toContain('--update-base');
    const { status, output } = runReconcile();
    expect(status, output).toBe(0);
    expect(output).toContain('1 explicit manual-only generators');
  });

  it('covers the test-layer typecheck gate and its writer (#5286)', () => {
    // The specific pair that failed CI on this branch. Named here so a later
    // change that drops either script also has to come back through this file.
    expect(scripts['check:test-typecheck']).toBeDefined();
    expect(scripts['gen:test-typecheck-debt']).toBeDefined();
    expect(runReconcile().status).toBe(0);
  });
});
