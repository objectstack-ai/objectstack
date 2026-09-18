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
import os from 'os';
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
import { lazySchema } from '../src/shared/lazy-schema';

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

  it('one node reached by TWO routes is ONE site — a shared sub-schema, counted once', () => {
    // ⚠️ The rule sits on the SHARED node itself, not on a property under it.
    // With it one level down, the property schema is the same instance by both
    // routes and the walk dedupes on that alone — an assertion that holds
    // whatever the identity is, which is no assertion at all (measured: the
    // first draft of this pin passed against the defect it was written for).
    const Shared = z.object({ q: z.string() }).refine((v) => v.q !== '', 'non-empty');
    const entry = collectDroppedRefinements('t/TwoRoutes', z.object({ first: Shared, second: Shared }));
    // Reported at the route it was reached by first, and not again at the other
    // — the census question is which published FILE the gap lands on.
    expect(entry.dropped.map((s) => s.path)).toEqual(['first']);
  });

  it('a `lazySchema()` edge is the SAME node as the schema it stands for', () => {
    // The mode-dependence this pin exists for. `lazySchema()` returns the real
    // schema under `OS_EAGER_SCHEMAS=1` — how `gen:schema` and
    // `check:authorable-surface` run — and a Proxy over it otherwise. Keyed on
    // the INSTANCE, the walk saw one node in the first case and two in the
    // second, so the same generator over the same tree produced two different
    // censuses and the committed ledger only held under one of them. `ui/View`
    // measured 11 dropped sites eager and 13 lazy; `@objectstack/spec#test:repo`
    // spawns the generator WITHOUT the flag, which is where it surfaced.
    //
    // This file runs in the `local` project, which does not set the flag, so
    // the Proxy is the live shape here and the assertion is about it.
    const Shared = z.object({ q: z.string() }).refine((v) => v.q !== '', 'non-empty');
    const entry = collectDroppedRefinements(
      't/LazyEdge',
      z.object({ direct: Shared, viaLazy: lazySchema(() => Shared) }),
    );
    expect(entry.dropped.map((s) => s.path)).toEqual(['direct']);
  });

  it('LIT CONTROL — two DISTINCT nodes carrying the same rule are two sites', () => {
    // Without it, the two assertions above pass just as well on a walk that
    // dedupes structurally and reports one site per export however many nodes
    // carry the rule.
    const mk = (): z.ZodType => z.object({ q: z.string() }).refine((v) => v.q !== '', 'non-empty');
    const entry = collectDroppedRefinements('t/TwoNodes', z.object({ first: mk(), second: mk() }));
    expect(entry.dropped.map((s) => s.path)).toEqual(['first', 'second']);
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
  const site = (path: string) => ({ path, nodeType: 'string', count: 1, aborting: false, verdict: 'dropped' as const, declaredPatterns: [] });
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

describe("the reader's refusal names the shape the reader ACCEPTS", () => {
  // The trap (#18747): the shape diagnostic used to say the entries are
  // `key -> { count, reason }` while the very next check in the same function
  // requires `sites: string[]` and the shipped `DroppedRefinementsEntry` has no
  // `count` and no `reason` at all. An author — or an AI — repairing a broken
  // ledger by following that sentence writes a ledger the SAME function refuses
  // again. So the pin is a closed loop, not a wording match: whatever the
  // refusal names has to be what the reader then takes.
  const withLedger = <T,>(json: string, fn: (pkgDir: string) => T): T => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-dropped-refinements-'));
    try {
      fs.writeFileSync(path.join(dir, DROPPED_REFINEMENTS_BASELINE_FILE), json, 'utf8');
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const refusalFor = (json: string): string =>
    withLedger(json, (dir) => {
      try {
        readDroppedRefinementsBaseline(dir);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('the reader accepted a ledger it should have refused');
    });

  it('the shape diagnostic names `sites`', () => {
    // `entries` as an array is the branch that prints the shape.
    expect(refusalFor('{ "entries": [] }')).toContain('sites');
  });

  it('a ledger written to that shape is then ACCEPTED — the loop closes', () => {
    const accepted = withLedger('{ "entries": { "a/One": { "sites": ["x"] } } }', (dir) =>
      readDroppedRefinementsBaseline(dir),
    );
    expect(accepted?.entries['a/One'].sites).toEqual(['x']);
  });

  it('LIT CONTROL — the shape the OLD diagnostic named is refused, and the refusal still says `sites`', () => {
    // Without this leg the two assertions above pass on a reader that accepts
    // anything: this is the ledger an author following the old sentence wrote.
    const message = refusalFor('{ "entries": { "a/One": { "count": 1, "reason": "zod drops custom checks" } } }');
    expect(message).toContain('sites');
  });

  it('the shape diagnostic names no key the entry shape does not have', () => {
    const message = refusalFor('{ "entries": [] }');
    expect(message).not.toContain('count');
    expect(message).not.toContain('reason');
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
