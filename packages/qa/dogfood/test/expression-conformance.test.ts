// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0058 D7 — the Expression Surface Conformance ledger is a CHECKED artifact.
// Refactored onto the reusable ADR-0060 `checkLedger` helper: one call asserts
// the shared invariants AND the ratchet (re-discover every expression-declaring
// field in packages/spec/src — see EXPRESSION_INPUT_SCHEMAS — plus the RLS
// using/check predicates; fail if any is unclassified). Discovery is by SCHEMA
// NAME, so a slot that moves to a narrower schema leaves the scan unless that
// schema is registered: #7327 is the worked example. The
// expression-specific invariants (mode/dialect/fail-policy,
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
// `settings-visibility` is not one of the spec's `ExpressionDialect` members on
// purpose (#7327): it is a closed non-CEL grammar with its own evaluator, and
// the ledger's job is to say what a surface IS, not what its schema used to
// claim. See the `settings-visibility` row.
const DIALECTS = new Set(['cel', 'cron', 'template', 'js', 'settings-visibility']);

/**
 * Schemas that DECLARE an expression surface. `ExpressionInputSchema` is the
 * shared one; a slot whose accepted grammar is narrower gets its own schema and
 * must be listed here too, or the ratchet silently stops watching it.
 *
 * That is not hypothetical — it is how this scan behaves by construction, and
 * #7327 hit it: narrowing the settings `visible` slots off `ExpressionInputSchema`
 * dropped them out of discovery and turned their ledger entry stale. A new
 * narrowed alias belongs in this list on the same commit that introduces it.
 */
const EXPRESSION_INPUT_SCHEMAS = ['ExpressionInputSchema', 'SettingsVisibilityInputSchema'];
const DECLARES_EXPRESSION = new RegExp(
  String.raw`^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:${EXPRESSION_INPUT_SCHEMAS.join('|')})\b`,
);

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
          const m = line.match(DECLARES_EXPRESSION);
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
