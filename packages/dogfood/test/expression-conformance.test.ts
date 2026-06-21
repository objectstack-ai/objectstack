// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0058 D7 — the Expression Surface Conformance ledger is a CHECKED artifact.
// These assertions make "every expression-holding declaration is classified in
// exactly one honest state, every COMPILE security surface is reachable by the
// canonical compiler and proven, and no new surface slips in unclassified" a
// green CI gate. A new ExpressionInputSchema field with no ledger row — the
// #1887 class of declared-but-unwired predicate — breaks the build.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { EXPRESSION_SURFACE, type ExprSurface } from './expression-conformance.ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../..');
const SPEC_SRC = join(REPO_ROOT, 'packages/spec/src');

const MODES = new Set(['compile', 'interpret']);
const STATES = new Set(['enforced', 'experimental', 'removed']);
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
  // RLS using/check are expression predicates too (legacy z.string() fields, not
  // ExpressionInputSchema) — classify them explicitly so they cannot drift.
  found.add('security/rls.zod.ts:using');
  found.add('security/rls.zod.ts:check');
  return found;
}

describe('ADR-0058 D7 — expression surface conformance ledger', () => {
  it('has no duplicate ids', () => {
    const ids = EXPRESSION_SURFACE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every row has a valid mode / state / dialect / fail-policy', () => {
    for (const s of EXPRESSION_SURFACE) {
      expect(MODES.has(s.mode), `${s.id}: mode '${s.mode}'`).toBe(true);
      expect(STATES.has(s.state), `${s.id}: state '${s.state}'`).toBe(true);
      expect(DIALECTS.has(s.dialect), `${s.id}: dialect '${s.dialect}'`).toBe(true);
      expect(FAIL_POLICIES.has(s.failPolicy), `${s.id}: failPolicy '${s.failPolicy}'`).toBe(true);
      expect(s.site && s.site.length > 0, `${s.id}: missing site`).toBe(true);
      expect(Array.isArray(s.covers) && s.covers.length > 0, `${s.id}: empty covers`).toBe(true);
    }
  });

  it('every COMPILE row is security fail-closed, names the canonical compiler, and is proven', () => {
    for (const s of EXPRESSION_SURFACE.filter((x) => x.mode === 'compile')) {
      expect(s.failPolicy, `${s.id}: a compile/security surface must fail closed`).toBe('fail-closed');
      // Compiler-reachable: the site must reference the canonical compiler entry.
      expect(/compileCelToFilter|celToFilter|matchesFilterCondition/.test(s.site), `${s.id}: site does not name the canonical compiler`).toBe(true);
      expect(s.proof, `${s.id}: an enforced compile surface must carry a proof`).toBeTruthy();
    }
  });

  it('every referenced proof FILE EXISTS (the proof ratchet)', () => {
    const broken: string[] = [];
    for (const s of EXPRESSION_SURFACE as ExprSurface[]) {
      if (s.proof && !existsSync(join(REPO_ROOT, s.proof))) broken.push(`${s.id} → ${s.proof}`);
    }
    expect(broken, `ledger proofs missing on disk: ${broken.join(', ')}`).toEqual([]);
  });

  it('every experimental/removed row carries a note (honest rationale)', () => {
    const missing = EXPRESSION_SURFACE.filter((s) => s.state !== 'enforced' && !s.note).map((s) => s.id);
    expect(missing, `non-enforced rows missing a note: ${missing.join(', ')}`).toEqual([]);
  });

  // ── THE RATCHET ──────────────────────────────────────────────────────────
  it('classifies EVERY expression surface in the spec — no unclassified declaration', () => {
    const discovered = discoverSurfaces();
    const covered = new Set(EXPRESSION_SURFACE.flatMap((s) => s.covers));

    // (a) every discovered surface is classified by some row
    const unclassified = [...discovered].filter((s) => !covered.has(s)).sort();
    expect(
      unclassified,
      `NEW unclassified expression surface(s) — add a row to expression-conformance.ledger.ts ` +
        `(ADR-0058 D7): ${unclassified.join(', ')}`,
    ).toEqual([]);

    // (b) no stale `covers` entry that no longer exists in the spec
    const stale = [...covered].filter((s) => !discovered.has(s)).sort();
    expect(stale, `STALE ledger covers (surface removed from spec): ${stale.join(', ')}`).toEqual([]);
  });

  it('each surface is covered by EXACTLY ONE row (no double classification)', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const s of EXPRESSION_SURFACE) {
      for (const c of s.covers) {
        if (seen.has(c)) dup.push(`${c} (in ${seen.get(c)} and ${s.id})`);
        else seen.set(c, s.id);
      }
    }
    expect(dup, `surfaces classified by more than one row: ${dup.join(', ')}`).toEqual([]);
  });
});
