// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the dropped-refinement detector and its ratchet (#18670).
 *
 * ── What is being pinned, and why a pin rather than a comment ─────────────
 * The detector's whole claim is that a rule written as `.refine()` reaches the
 * runtime and NOT the published JSON Schema. That claim rests on a property of
 * zod — `toJSONSchema()` has no arm for a `custom` check — which is exactly the
 * kind of thing a dependency bump repairs without telling anyone. So the
 * premise is asserted here beside a LIT CONTROL that must keep hitting: a
 * `.min(1)` moves the projected bytes. A run where BOTH are identical is an
 * instrument that has stopped measuring, not a tree with no refinements, and
 * only the control can tell those two apart.
 *
 * ── The detector must be able to FIRE and to STAY SILENT ─────────────────
 * Both halves are asserted, on synthetic graphs and on the live one: a schema
 * carrying a refinement produces a site at a named path, and a schema whose
 * only constraint is projectable produces none. A detector that reports every
 * node, or no node, passes neither half.
 *
 * ── The two false readings measured while building it ────────────────────
 *   1. `clone()` recomputes the constraint bag from the check list — which is
 *      what makes the differential meaningful — but it does NOT carry the
 *      `.describe()` text, which lives in `z.globalRegistry` keyed by instance.
 *      Without the meta copy, every described node reads as `projected` on a
 *      description that was never in question.
 *   2. Walking a `lazy` node's `_cachedInner` memo reaches a SECOND instance of
 *      the same graph, whose recursive `$ref` layout differs from the first's.
 *      All 80 sites the first build of this walker called `projected` were that
 *      — a difference in the artifact, never in what the refinement constrains.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  DROPPED_REFINEMENTS_BASELINE_FILE,
  checkDroppedRefinements,
  collectDroppedRefinements,
  hasDroppedRefinementProblems,
  readDroppedRefinementsBaseline,
} from './lib/dropped-refinements';
import { ContextTokenSchema } from '../src/data/context-tokens.zod';
import { AggregationFunction } from '../src/data/query.zod';

const PKG_DIR = path.resolve(__dirname, '..');
const project = (schema: z.ZodType): string =>
  JSON.stringify(z.toJSONSchema(schema, { target: 'draft-2020-12' }));

describe('the premise: zod projects no `custom` check', () => {
  it('a plain record, a refined one and an ABORTING refined one are byte-identical', () => {
    const plain = z.record(z.string(), z.unknown());
    const refined = z.record(z.string(), z.unknown()).refine((v) => !('dialect' in v), 'no dialect');
    const aborting = z.record(z.string(), z.unknown()).superRefine((v, ctx) => {
      if ('dialect' in v) {
        ctx.addIssue({ code: 'custom', message: 'no dialect', fatal: true });
        return z.NEVER;
      }
      return undefined;
    });
    expect(project(refined)).toBe(project(plain));
    expect(project(aborting)).toBe(project(plain));
  });

  it('LIT CONTROL — a constraint zod DOES project moves the bytes', () => {
    // Without this, the assertion above passes just as well on a broken
    // `toJSONSchema` that returns `{}` for everything.
    expect(project(z.string().min(1))).not.toBe(project(z.string()));
    expect(project(z.string().min(1))).toContain('"minLength":1');
  });

  it('the runtime enforces the rule the projection dropped', () => {
    const refined = z.record(z.string(), z.unknown()).refine((v) => !('dialect' in v), 'no dialect');
    expect(refined.safeParse({ dialect: 'cel' }).success).toBe(false);
    expect(z.record(z.string(), z.unknown()).safeParse({ dialect: 'cel' }).success).toBe(true);
  });
});

describe('the detector FIRES', () => {
  it('names the path of a refinement on a property', () => {
    const entry = collectDroppedRefinements(
      't/Refined',
      z.object({ a: z.string().refine((v) => v.trim().length > 0, 'non-blank') }),
    );
    expect(entry.dropped.map((s) => s.path)).toEqual(['a']);
    expect(entry.dropped[0].verdict).toBe('dropped');
    expect(entry.dropped[0].nodeType).toBe('string');
    expect(entry.projected).toHaveLength(0);
  });

  it('reports a refinement on the export itself at the empty path', () => {
    const entry = collectDroppedRefinements('t/Root', z.object({ a: z.string() }).refine(() => true));
    expect(entry.dropped.map((s) => s.path)).toEqual(['']);
  });

  it('says when a refinement ABORTS the parse, and when it does not', () => {
    const aborting = collectDroppedRefinements(
      't/Abort',
      z.object({ a: z.string() }).refine(() => false, { abort: true }),
    );
    expect(aborting.dropped).toHaveLength(1);
    expect(aborting.dropped[0].aborting).toBe(true);

    const plain = collectDroppedRefinements('t/Plain', z.object({ a: z.string() }).refine(() => false));
    expect(plain.dropped[0].aborting).toBe(false);
  });

  it('⚠️ an `abort` spelled INSIDE the function body is invisible to the flag', () => {
    // `ctx.addIssue({ fatal: true })` is a property of the issue the function
    // raises at parse time, not of the check the graph carries — so the flag
    // reads `false` for it. Pinned rather than left to be rediscovered: the
    // flag is a report detail and never the verdict, and the site is still a
    // DROP, which is the reading everything downstream turns on.
    const entry = collectDroppedRefinements(
      't/FatalInBody',
      z.object({ a: z.string() }).superRefine((_v, ctx) => {
        ctx.addIssue({ code: 'custom', message: 'no', fatal: true });
      }),
    );
    expect(entry.dropped).toHaveLength(1);
    expect(entry.dropped[0].aborting).toBe(false);
    expect(entry.dropped[0].verdict).toBe('dropped');
  });

  it('fires on the LIVE graph — ContextTokenSchema carries a refinement no reader sees', () => {
    const entry = collectDroppedRefinements('data/ContextToken', ContextTokenSchema);
    expect(entry.dropped.length).toBeGreaterThanOrEqual(1);
    expect(entry.projected).toHaveLength(0);
    // And the rule really is enforced on the other side of the gap.
    expect(ContextTokenSchema.safeParse('not-a-context-token').success).toBe(false);
  });
});

describe('the detector STAYS SILENT', () => {
  it('a schema whose only constraints project reports nothing', () => {
    const entry = collectDroppedRefinements('t/Clean', z.object({ a: z.string().min(1), b: z.number().int() }));
    expect(entry.dropped).toHaveLength(0);
    expect(entry.projected).toHaveLength(0);
    expect(entry.undecidable).toHaveLength(0);
  });

  it('is silent on the LIVE graph for a schema with no refinement', () => {
    const entry = collectDroppedRefinements('data/AggregationFunction', AggregationFunction);
    expect(entry.dropped).toHaveLength(0);
    expect(entry.projected).toHaveLength(0);
  });
});

describe('the differential isolates the refinement, not the node', () => {
  it('a node carrying BOTH a projectable constraint and a refinement is still a drop', () => {
    const entry = collectDroppedRefinements('t/Mixed', z.object({ a: z.string().min(3).refine(() => true) }));
    expect(entry.dropped.map((s) => s.path)).toEqual(['a']);
    // The projected half is untouched — the verdict is about the refinement.
    expect(project(z.string().min(3).refine(() => true))).toContain('"minLength":3');
  });

  it('a described node is a drop, not a projection (the meta-copy regression)', () => {
    const entry = collectDroppedRefinements(
      't/Described',
      z.object({ a: z.string().refine(() => true).describe('what this field means') }),
    );
    expect(entry.projected).toHaveLength(0);
    expect(entry.dropped.map((s) => s.path)).toEqual(['a']);
  });

  it('a recursive schema reports its refinement ONCE (the `_cachedInner` regression)', () => {
    type Node = { name: string; child?: Node };
    const NodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.object({
        name: z.string().refine((v) => v.trim().length > 0, 'non-blank'),
        child: NodeSchema.optional(),
      }),
    );
    // Resolve the lazy the way the generator does, so `_cachedInner` is populated.
    z.toJSONSchema(NodeSchema, { target: 'draft-2020-12' });
    const entry = collectDroppedRefinements('t/Recursive', NodeSchema);
    expect(entry.dropped).toHaveLength(1);
    expect(entry.projected).toHaveLength(0);
  });
});

describe('the ratchet adjudicates against the ledger', () => {
  const site = (path: string) => ({ path, nodeType: 'string', count: 1, aborting: false, verdict: 'dropped' as const });
  const census = (defKey: string, paths: string[]) => ({
    defKey,
    dropped: paths.map(site),
    projected: [],
    undecidable: [],
  });

  it('is green when the ledger names exactly what the build sees', () => {
    const problems = checkDroppedRefinements({
      census: [census('a/One', ['x'])],
      publishedKeys: new Set(['a/One']),
      baseline: { entries: { 'a/One': { sites: ['x'] } } },
    });
    expect(hasDroppedRefinementProblems(problems)).toBe(false);
  });

  it('refuses a drop nobody declared', () => {
    const problems = checkDroppedRefinements({
      census: [census('a/One', ['x'])],
      publishedKeys: new Set(['a/One']),
      baseline: { entries: {} },
    });
    expect(problems.undeclared.map((e) => e.defKey)).toEqual(['a/One']);
  });

  it('names a site that ARRIVED and one that LEFT, separately', () => {
    const problems = checkDroppedRefinements({
      census: [census('a/One', ['x', 'z'])],
      publishedKeys: new Set(['a/One']),
      baseline: { entries: { 'a/One': { sites: ['x', 'y'] } } },
    });
    expect(problems.miscounted).toHaveLength(1);
    expect(problems.miscounted[0].added).toEqual(['z']);
    expect(problems.miscounted[0].removed).toEqual(['y']);
    expect(problems.miscounted[0].observedSites).toEqual(['x', 'z']);
  });

  it('sees a second site at the SAME path — a set difference alone cannot', () => {
    const problems = checkDroppedRefinements({
      census: [census('a/One', ['x', 'x'])],
      publishedKeys: new Set(['a/One']),
      baseline: { entries: { 'a/One': { sites: ['x'] } } },
    });
    expect(problems.miscounted).toHaveLength(1);
    expect(problems.miscounted[0].observedSites).toEqual(['x', 'x']);
  });

  it('separates a REPAIRED schema from a VANISHED one', () => {
    const problems = checkDroppedRefinements({
      census: [],
      publishedKeys: new Set(['a/Repaired']),
      baseline: { entries: { 'a/Repaired': { sites: ['x'] }, 'a/Gone': { sites: ['y'] } } },
    });
    expect(problems.repaired).toEqual(['a/Repaired']);
    expect(problems.vanished).toEqual(['a/Gone']);
  });

  it('refuses an entry that records membership and no sites', () => {
    const problems = checkDroppedRefinements({
      census: [census('a/One', ['x'])],
      publishedKeys: new Set(['a/One']),
      baseline: { entries: { 'a/One': { sites: [] } } },
    });
    expect(problems.unreasoned).toEqual(['a/One']);
  });
});

describe('the committed ledger', () => {
  it('names at least one site per entry, and its header totals match its body', () => {
    const baseline = readDroppedRefinementsBaseline(PKG_DIR);
    expect(baseline).not.toBeNull();
    const entries = Object.entries(baseline!.entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const [defKey, entry] of entries) {
      expect(entry.sites.length, `${defKey} records no site`).toBeGreaterThan(0);
    }
    const raw = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, DROPPED_REFINEMENTS_BASELINE_FILE), 'utf8'),
    ) as { measured: { publishedSchemasWithDroppedRefinements: number; droppedRefinementSites: number } };
    expect(raw.measured.publishedSchemasWithDroppedRefinements).toBe(entries.length);
    expect(raw.measured.droppedRefinementSites).toBe(
      entries.reduce((sum, [, entry]) => sum + entry.sites.length, 0),
    );
  });
});
