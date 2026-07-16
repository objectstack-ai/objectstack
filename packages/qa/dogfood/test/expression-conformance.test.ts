// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0058 D7 — the Expression Surface Conformance ledger is a CHECKED artifact.
// Refactored onto the reusable ADR-0060 `checkLedger` helper: one call asserts
// the shared invariants AND the ratchet (re-discover every ExpressionInputSchema
// field in packages/spec/src + the RLS using/check predicates; fail if any is
// unclassified). The expression-specific invariants (mode/dialect/fail-policy,
// compile rows name the canonical compiler) stay here.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { checkLedger } from '@objectstack/verify';
import { EXPRESSION_SURFACE } from './expression-conformance.ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const SPEC_SRC = join(REPO_ROOT, 'packages/spec/src');

const MODES = new Set(['compile', 'interpret']);
const FAIL_POLICIES = new Set(['compile-error', 'fail-closed', 'fail-soft-log', 'throw']);
const DIALECTS = new Set(['cel', 'cron', 'template', 'js']);

/** Re-discover every expression surface in the spec — the SAME scan the ledger encodes. */
function discoverSurfaces(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    // `withFileTypes` reads the entry type from the single readdir syscall — no
    // stat-then-read window (avoids a file-system TOCTOU race; CodeQL).
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith('.zod.ts')) {
        const rel = relative(SPEC_SRC, p);
        for (const line of readFileSync(p, 'utf8').split('\n')) {
          const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*ExpressionInputSchema\b/);
          if (m) found.add(`${rel}:${m[1]}`);
        }
      }
    }
  };
  walk(SPEC_SRC);
  // RLS using/check are expression predicates too (legacy z.string() fields).
  found.add('security/rls.zod.ts:using');
  found.add('security/rls.zod.ts:check');
  return found;
}

describe('ADR-0058 D7 — expression surface conformance ledger', () => {
  it('is a sound conformance ledger + ratchet (ADR-0060 checkLedger)', () => {
    const problems = checkLedger(EXPRESSION_SURFACE, {
      proofRoot: REPO_ROOT,
      discover: discoverSurfaces,
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every row has a valid expression mode / dialect / fail-policy', () => {
    for (const s of EXPRESSION_SURFACE) {
      expect(MODES.has(s.mode), `${s.id}: mode '${s.mode}'`).toBe(true);
      expect(DIALECTS.has(s.dialect), `${s.id}: dialect '${s.dialect}'`).toBe(true);
      expect(FAIL_POLICIES.has(s.failPolicy), `${s.id}: failPolicy '${s.failPolicy}'`).toBe(true);
    }
  });

  it('every COMPILE row is fail-closed and names the canonical compiler', () => {
    for (const s of EXPRESSION_SURFACE.filter((x) => x.mode === 'compile')) {
      expect(s.failPolicy, `${s.id}: a compile/security surface must fail closed`).toBe('fail-closed');
      expect(
        /compileCelToFilter|celToFilter|matchesFilterCondition/.test(s.enforcement),
        `${s.id}: enforcement does not name the canonical compiler`,
      ).toBe(true);
      expect(s.proof, `${s.id}: an enforced compile surface must carry a proof`).toBeTruthy();
    }
  });
});
