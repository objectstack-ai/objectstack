// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0058 D7 — the Expression Surface Conformance ledger is a CHECKED artifact.
// Refactored onto the reusable ADR-0060 `checkLedger` helper: one call asserts
// the shared invariants AND the ratchet (re-discover every expression-declaring
// field in packages/spec/src — see EXPRESSION_INPUT_SCHEMAS — plus the RLS
// using/check predicates; fail if any is unclassified). Discovery is by SCHEMA
// NAME, so a slot that moves to a narrower schema leaves the scan unless that
// schema is registered: #7327 is the worked example. Discovery is also by
// POSITION since #15500 — the key is `file:Schema.field` and two positions
// sharing one key FAIL rather than merge. The expression-specific invariants
// (mode/dialect/fail-policy, compile rows name the canonical compiler) stay
// here.

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
 *
 * The two DIALECT-typed inputs were missing for as long as they have existed
 * (#15027). `CronExpressionInputSchema` and `TemplateExpressionInputSchema` are
 * siblings of `ExpressionInputSchema` — same envelope, a different default
 * dialect on the bare-string arm — so every slot typed with one of them was a
 * declared expression surface that this scan could NEVER match: the pattern
 * requires a listed name to start immediately after the colon, and neither was
 * listed. The ledger therefore reported a complete classification over a
 * population with zero `cron` and zero `template` rows in it, while the spec
 * declared 12 such positions. Structurally blind, not merely un-updated — which
 * is why the roster and the rows classifying them landed on one commit.
 */
const EXPRESSION_INPUT_SCHEMAS = [
  'ExpressionInputSchema',
  'SettingsVisibilityInputSchema',
  'CronExpressionInputSchema',
  'TemplateExpressionInputSchema',
];
const DECLARES_EXPRESSION = new RegExp(
  String.raw`^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:${EXPRESSION_INPUT_SCHEMAS.join('|')})\b`,
);

/**
 * One DECLARING POSITION of an expression surface in the spec.
 *
 * The ratchet's unit of accountability is the position, not the name: a
 * position is what an author writes and what a reader has to classify. The
 * `key` is only a NAME for it, and the ledger can be honest exactly as far as
 * that name is 1:1 with positions.
 */
interface Declaration {
  /** Ratchet key — `file:Schema.field`, relative to packages/spec/src. */
  key: string;
  /** Path relative to packages/spec/src. */
  file: string;
  /** Enclosing top-level declaration (see `TOP_LEVEL_DECL`). */
  schema: string;
  field: string;
  line: number;
}

/**
 * The enclosing top-level declaration a position belongs to.
 *
 * Column 0 ONLY, deliberately: these files routinely wrap a schema as
 * `export const FieldSchema = lazySchema(() => { const base = strictObject({…`,
 * and the indented inner `const base` must never win over `FieldSchema`.
 */
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:const|function|class)\s+([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Re-discover every expression-declaring POSITION in the spec — the SAME scan
 * the ledger encodes, but without the dedup that used to hide half of it.
 *
 * A ratchet key was `file:field` until #15500, so N declarations of one field
 * name in one file were ONE key and one ledger row classified all of them —
 * silently, because the collapse happened inside a `Set` before anything could
 * object. Measured at `61821e54cf5`: 44 declaring positions reduced to 34 keys,
 * and 10 keys carried two positions each. Two of those pairs were genuinely the
 * same surface twice (the cron ones), and the rest were not: one key covered
 * both the server-enforced `FieldSchema.requiredWhen` transition gate and the
 * `InlineGridColumnSchema.requiredWhen` cell whose own describe says nothing on
 * the write path reads it. The ledger could not represent the difference, and
 * the ratchet could not notice that it had never asked.
 *
 * The key is now `file:Schema.field`, which separates all 44 positions today.
 * ⚠️ That is a measurement, NOT a guarantee: two same-named fields in two
 * different inline `z.object({…})` blocks under ONE top-level const would
 * attribute to the same schema name and collide again. So the naming scheme is
 * not what makes this sound — the COLLISION ASSERTION below is. It holds for
 * any naming scheme, which is why it is the durable half of the repair and the
 * finer key is only what makes it pass today.
 *
 * A line number is deliberately not part of the key: it is not an identity, and
 * a key that moved whenever an unrelated edit shifted lines would rot every
 * ledger row on contact.
 */
function discoverDeclarations(): Declaration[] {
  const found: Declaration[] = [];
  const walk = (dir: string) => {
    // `withFileTypes` reads the entry type from the single readdir syscall — no
    // stat-then-read window (avoids a file-system TOCTOU race; CodeQL).
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith('.zod.ts')) {
        const file = relative(SPEC_SRC, p);
        let schema = '(top-level)';
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          const decl = line.match(TOP_LEVEL_DECL);
          if (decl) schema = decl[1];
          const m = line.match(DECLARES_EXPRESSION);
          if (m) found.push({ key: `${file}:${schema}.${m[1]}`, file, schema, field: m[1], line: i + 1 });
        });
      }
    }
  };
  walk(SPEC_SRC);
  // RLS using/check are expression predicates too (legacy z.string() fields, so
  // no roster schema types them and the scan above cannot see them). Spelled
  // schema-qualified like every other key so the ledger has ONE key vocabulary.
  for (const field of ['using', 'check']) {
    found.push({
      key: `security/rls.zod.ts:RowLevelSecurityPolicySchema.${field}`,
      file: 'security/rls.zod.ts',
      schema: 'RowLevelSecurityPolicySchema',
      field,
      line: 0,
    });
  }
  return found;
}

function discoverSurfaces(): Set<string> {
  return new Set(discoverDeclarations().map((d) => d.key));
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

  // The structural half of #15500. Before this existed, two declarations of one
  // field name in one file collapsed inside a `Set` and the ratchet reported
  // the file green — the same defect class the ledger header claims to prevent
  // ("a NEW expression surface that nobody classified breaks the build"),
  // reached through GRANULARITY instead of roster membership. A gate that says
  // "these positions share a key and I cannot tell them apart" is honest; one
  // that quietly re-keys moves coverage with nobody reading the diff.
  it('every declaring POSITION has its own ratchet key — no silent collapse', () => {
    const declarations = discoverDeclarations();
    // Positive control. An aborted or mis-rooted scan returns nothing, which
    // would make the assertion below vacuously green — precisely the "reports
    // green because it never looked" failure this card is about.
    expect(
      declarations.length,
      'discovery returned NO declarations — the scan did not run, so the collision check below proves nothing',
    ).toBeGreaterThan(0);

    const byKey = new Map<string, Declaration[]>();
    for (const d of declarations) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);

    const collisions = [...byKey.entries()]
      .filter(([, ds]) => ds.length > 1)
      .map(([key, ds]) =>
        `${key}: ${ds.length} declaring positions share ONE ratchet key, so a single ledger row `
        + 'classifies all of them and the ratchet cannot tell them apart — '
        + `${ds.map((d) => `${d.file}:${d.line}`).join(', ')}. `
        + 'Give the colliding declarations distinguishable keys, then classify each on its own row.');
    expect(collisions, collisions.join('\n')).toEqual([]);
  });
});
