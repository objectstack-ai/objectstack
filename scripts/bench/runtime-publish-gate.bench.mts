// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * Runtime publish-gate benchmark (#9851) — what one `active` metadata publish
 * costs at the shipped gate, as a function of the tenant's stored objects.
 *
 * ── The three modes ─────────────────────────────────────────────────────────
 *
 *   --mode total     (default) the whole-gate cost table. #9851's reading.
 *   --mode per-rule  (#9905) the same total, ATTRIBUTED across the rules the
 *                    door dispatches.
 *   --mode closure   (#9905) the whole-gate cost when the `objects` collection
 *                    is narrowed to the written item's reference closure.
 *
 * ⛔ `--mode closure` measures a HYPOTHETICAL. It narrows what the rules are
 * handed HERE, in this script, and changes nothing about the shipped gate —
 * which always receives the whole collection. Its closure deriver is a
 * deliberately generous over-approximation written to bound the saving, NOT a
 * proposed implementation: how (or whether) the shipped gate should scope its
 * input is an open maintainer decision (#9612 / #9613), and one that this
 * measurement exists to inform rather than to pre-empt.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Two published measurements of THIS operation disagreed by 16-25x with a
 * non-constant ratio, and neither could be re-run: both came from throwaway
 * harnesses that no longer exist. #9851 reconciled them — the disagreement is
 * entirely the SHAPE OF THE SEEDED `objects` COLLECTION, not the span, not the
 * warmup, and not a code change between the two refs — and left this file so
 * the next reading is reproducible instead of re-litigated.
 *
 *   npx tsx scripts/bench/runtime-publish-gate.bench.mts
 *   npx tsx scripts/bench/runtime-publish-gate.bench.mts --type object
 *   npx tsx scripts/bench/runtime-publish-gate.bench.mts --objects 21,105,420 --iterations 50
 *
 * Requires `pnpm --filter '@objectstack/lint^...' build && pnpm --filter
 * @objectstack/lint build` first: the gate is imported straight from
 * `packages/lint/dist/runtime.js` — the built artifact the `./runtime` export
 * points at, reached by path because this script is outside the workspace
 * graph — so an unbuilt or stale `dist` reports the cost of the OLD registry
 * (this is the `ablation-dist-preflight` hazard; the run prints the rules it
 * actually dispatched, so a stale build shows up as a changed rule list rather
 * than as a silently wrong number).
 *
 * ⚠️ Not a CI gate. Wall-clock numbers are machine-dependent and this asserts
 * no threshold; it prints, and the operator compares.
 *
 * ── THE TIMED SPAN — inside vs outside ──────────────────────────────────────
 *
 * INSIDE the timed region: exactly one call to `runRuntimeAuthoringRules()` —
 * the whole shipped gate for one write. That is `buildRuntimeWriteSnapshots`
 * (baseline + candidate) plus the differential TWO passes of every rule that
 * declares the written type in `runtimeTypes`, plus the fingerprint set-diff.
 *
 * OUTSIDE: seeding and cloning the stack, module load, and everything
 * `saveMetaItem` wraps around the gate — the per-type Zod `safeParse`,
 * persistence, hooks, audit, the HTTP envelope.
 *
 * ⭐ That exclusion is measured, not assumed to be small: the gate call alone
 * reproduces the whole-`saveMetaItem` figure published as #9851's Reading A to
 * within ~8%, so the gate IS substantially the whole per-publish bill and the
 * span is NOT what separated the two published readings.
 *
 * ── WARMUP POLICY ───────────────────────────────────────────────────────────
 *
 * `--warmup` iterations (default 5) run and are discarded, then `--iterations`
 * (default 30) are timed and the MEDIAN is reported, with min/max so a noisy
 * machine is visible. ⭐ Measured on this workload, warm and cold agree to
 * within noise (a cold 3-iteration median lands inside the warm min/max band at
 * both sizes), because a single iteration is already tens of milliseconds of
 * the same loop — long enough for the JIT to settle mid-iteration. So warmup is
 * kept for hygiene, NOT because it moves the number: it is not the explanation
 * for any two harnesses disagreeing here.
 *
 * ── THE SEEDED STACK — the parameter that actually drives the cost ───────────
 *
 * The gate's context is the bounded 4-collection `RuntimeStackContext`
 * (`objects` / `permissions` / `books` / `datasets`); only `objects` is varied
 * here, because that is the collection both published readings varied and the
 * one a tenant grows. Two shapes ship, and running BOTH is the point:
 *
 *   real  — the shipped `examples/app-showcase` object declarations (22 of
 *           them), cloned under suffixed names up to N. Real authored surface:
 *           formula fields, validation rules, predicates, lookups — i.e. the
 *           expression-bearing keys `validateStackExpressions` walks.
 *   stub  — synthetic 5-field objects carrying no expressions at all.
 *
 * ⭐ Same gate, same N, same warmup: `real` costs ~25x `stub`. **Per-publish
 * cost is a function of the tenant's authored object SURFACE, not of its object
 * COUNT** — count is only a proxy, and the proxy's constant is what the two
 * published readings silently disagreed about. A number quoted as "X ms at N
 * objects" without its stack shape is therefore not reproducible, and any
 * acceptance threshold derived from one must name the shape it was set against.
 *
 * ⚠️ `real` imports the showcase app LIVE, so its absolute numbers drift as
 * that app is edited. Deliberate — it is the only real, spec-parsed corpus in
 * the repo, and a frozen copy would silently stop describing shipped metadata.
 * Quote the ref you measured at.
 */

import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  buildRuntimeWriteSnapshots,
} from '../../packages/lint/dist/runtime.js';
import * as showcaseObjects from '../../examples/app-showcase/src/data/objects/index.js';
import { allFlows } from '../../examples/app-showcase/src/automation/flows/index.js';

// Ambient `process` / `console`, declared to exactly the members used below.
// `scripts/**` is inside the ROOT tsconfig's program, and that config carries
// `lib: ['ES2020']` with no `types` — so Node's globals are absent and every
// use of them is a root-ledger tsc error (measured: 19 from this file alone,
// which is how it first landed). tsx provides the real objects at run time.
// Same shape and same reason as the ambient `process` in
// `examples/app-showcase/objectstack.config.ts`: narrow the declaration to
// what is actually called rather than widening the root's type surface, so
// this file pays its own way through `pnpm check:type-check-debt` instead of
// pushing a shrink-only ratchet back up.
declare const process: {
  argv: string[];
  hrtime: { bigint(): bigint };
};
declare const console: { log(...args: unknown[]): void };

type AnyRec = Record<string, any>;

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const WRITE_TYPE = arg('type', 'flow');
const SIZES = arg('objects', '21,420').split(',').map((s) => Number(s.trim())).filter(Boolean);
const ITERATIONS = Number(arg('iterations', '30'));
const WARMUP = Number(arg('warmup', '5'));
const MODE = arg('mode', 'total');

/** The shipped showcase object declarations — the `real` seed's source corpus. */
const SHOWCASE_OBJECTS = (Object.values(showcaseObjects) as AnyRec[])
  .filter((o) => o && typeof o.name === 'string');

/** A real shipped flow, used as the written item for a `flow` publish. */
const SHOWCASE_FLOW = (allFlows as AnyRec[]).find((f) => f.name === 'showcase_task_completed')
  ?? (allFlows as AnyRec[])[0];

/** A minimal clean object body, used as the written item for an `object` publish. */
const WRITTEN_OBJECT: AnyRec = {
  name: 'bench_written_object',
  label: 'Bench Written Object',
  sharingModel: 'ReadWrite',
  fields: { name: { type: 'text', label: 'Name' } },
};

/**
 * N objects cloned from the shipped showcase corpus, names suffixed to stay unique.
 *
 * ⚠️ The clone is `JSON.parse(JSON.stringify(...))`, so any FUNCTION-valued key
 * in a showcase declaration is dropped rather than copied. Harmless for what is
 * measured here — the runtime gate receives `sys_metadata` bodies, which are
 * JSON at rest, so a JSON round-trip is the shape the real door sees — but it
 * does mean this seed is a lower bound on a declaration whose authored surface
 * lives partly in functions. Stated because the file's honesty about its own
 * seed is the thing that makes a number taken from it re-runnable.
 */
function seedReal(n: number): AnyRec[] {
  const out: AnyRec[] = [];
  for (let i = 0; out.length < n; i++) {
    const src = SHOWCASE_OBJECTS[i % SHOWCASE_OBJECTS.length]!;
    const clone = JSON.parse(JSON.stringify(src)) as AnyRec;
    const generation = Math.floor(i / SHOWCASE_OBJECTS.length);
    if (generation > 0) clone.name = `${src.name}_c${generation}`;
    out.push(clone);
  }
  return out;
}

/** N synthetic 5-field objects carrying no expressions. */
function seedStub(n: number): AnyRec[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `bench_object_${i}`,
    label: `Bench Object ${i}`,
    fields: {
      name: { type: 'text', label: 'Name' },
      amount: { type: 'number', label: 'Amount' },
      active: { type: 'boolean', label: 'Active' },
      due: { type: 'date', label: 'Due' },
      notes: { type: 'textarea', label: 'Notes' },
    },
  }));
}

const SHAPES: Record<string, (n: number) => AnyRec[]> = { real: seedReal, stub: seedStub };

const ms = () => Number(process.hrtime.bigint()) / 1e6;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function run(objects: AnyRec[], item: AnyRec) {
  return runRuntimeAuthoringRules({ type: WRITE_TYPE, item, context: { objects } });
}

function measure(objects: AnyRec[], item: AnyRec) {
  for (let i = 0; i < WARMUP; i++) run(objects, item);
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = ms();
    run(objects, item);
    samples.push(ms() - t0);
  }
  return { median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
}

const item = WRITE_TYPE === 'flow' ? SHOWCASE_FLOW : WRITTEN_OBJECT;

// The rules actually dispatched, printed BEFORE any timing: a stale `dist/`, or
// a rule ablated off the runtime surface, changes this line — so a number that
// moved for a registry reason can never be read as a number that moved for a
// performance reason.
const dispatched = run(SHAPES.real!(1), item).rulesRun;
console.log(`runtime publish gate — write type '${WRITE_TYPE}'`);
console.log(`  rules dispatched (${dispatched.length}): ${dispatched.join(', ') || '<none>'}`);
console.log(`  timed span: one runRuntimeAuthoringRules() call (differential two-pass)`);
console.log(`  warmup ${WARMUP} discarded, ${ITERATIONS} timed, median reported`);
if (dispatched.length === 0) {
  console.log(`  ⚠️ no rule gates '${WRITE_TYPE}' at the runtime surface — every number below is gate overhead only`);
}

/** Median wall-clock of `fn`, same warmup/iteration policy as {@link measure}. */
function timeMedian(fn: () => void): number {
  for (let i = 0; i < WARMUP; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = ms();
    fn();
    samples.push(ms() - t0);
  }
  return median(samples);
}

/** #9851's reading: the whole-gate cost table, both shapes, every N. */
function totalMode() {
  console.log('');
  console.log('  shape  N objects   median      min       max');
  const table: Record<string, Record<number, number>> = {};
  for (const shape of Object.keys(SHAPES)) {
    table[shape] = {};
    for (const n of SIZES) {
      const r = measure(SHAPES[shape]!(n), item);
      table[shape]![n] = r.median;
      console.log(
        `  ${shape.padEnd(6)} ${String(n).padStart(9)}   ${r.median.toFixed(2).padStart(7)} ms `
        + `${r.min.toFixed(2).padStart(7)}   ${r.max.toFixed(2).padStart(7)}`,
      );
    }
  }

  console.log('');
  for (const n of SIZES) {
    const real = table.real![n]!;
    const stub = table.stub![n]!;
    console.log(`  N=${n}: real / stub = ${(real / stub).toFixed(1)}x — same gate, same N, different authored surface`);
  }
  console.log('');
  console.log('  ⇒ per-publish cost tracks authored object SURFACE, not object COUNT.');
  console.log('    Quote the stack shape with any number taken from this gate (#9851).');
}

/**
 * #9905 deliverable 2 — the same total, attributed across the dispatched rules.
 *
 * Each rule is timed over BOTH gate passes (baseline + candidate), because that
 * is what one publish actually costs it, and the snapshots come from the gate's
 * own exported {@link buildRuntimeWriteSnapshots} rather than a mirror — so the
 * shares are attributed against the real construction.
 *
 * ⭐ The UNATTRIBUTED line is the anti-vacuity check and is printed even when it
 * is uninteresting: per-rule shares that do not add up to the measured total
 * mean the attribution is wrong, and that is the finding. Confirm the top share
 * independently by ablating that rule off the door (`runtimeTypes`), rebuilding,
 * and checking the total moves by roughly its share — `rules dispatched` above
 * changes with it, so a stale `dist/` cannot masquerade as a saving.
 */
function perRuleMode() {
  const rules = runtimeAuthoringRulesFor(WRITE_TYPE);
  const ctx = { sduiManifest: undefined };
  for (const shape of Object.keys(SHAPES)) {
    for (const n of SIZES) {
      const objects = SHAPES[shape]!(n);
      const snapshots = buildRuntimeWriteSnapshots({ type: WRITE_TYPE, item, context: { objects } });
      if (!snapshots) continue;
      const total = timeMedian(() => { run(objects, item); });
      const per = rules
        .map((r) => ({
          name: r.name,
          ms: timeMedian(() => {
            try { r.run(snapshots.baseline, ctx); } catch { /* the gate reports throws as findings */ }
            try { r.run(snapshots.candidate, ctx); } catch { /* idem */ }
          }),
        }))
        .sort((a, b) => b.ms - a.ms);
      const sum = per.reduce((acc, p) => acc + p.ms, 0);
      const pct = (x: number) => `${((x / total) * 100).toFixed(1).padStart(5)}%`;
      console.log('');
      console.log(`  shape=${shape} N=${n} — whole-gate total ${total.toFixed(2)} ms`);
      for (const p of per) console.log(`    ${p.name.padEnd(32)} ${p.ms.toFixed(2).padStart(8)} ms  ${pct(p.ms)}`);
      console.log(`    ${'Σ attributed'.padEnd(32)} ${sum.toFixed(2).padStart(8)} ms  ${pct(sum)}`);
      console.log(`    ${'unattributed (snapshot + diff)'.padEnd(32)} ${(total - sum).toFixed(2).padStart(8)} ms  ${pct(total - sum)}`);
    }
  }
}

/** Every string anywhere in a value — the closure seed scan, deliberately broad. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

/**
 * The transitive reference closure of the written item over `objects`: every
 * object NAMED anywhere in the item, expanded through the included objects'
 * declared relational edges (`fields[].reference`) to a fixed point.
 *
 * Over-approximating on purpose — it seeds from any string that happens to equal
 * an object name, so it can only ever be too LARGE. A saving measured against it
 * is therefore a lower bound on what an exact closure would buy, which is the
 * safe direction for a number that argues FOR narrowing.
 */
function referenceClosure(written: AnyRec, objects: AnyRec[]): AnyRec[] {
  const byName = new Map<string, AnyRec>();
  for (const o of objects) if (typeof o.name === 'string') byName.set(o.name, o);
  const reached = new Set(allStrings(written).filter((s) => byName.has(s)));
  const frontier = [...reached];
  while (frontier.length > 0) {
    const owner = byName.get(frontier.pop()!)!;
    for (const field of Object.values((owner.fields ?? {}) as AnyRec)) {
      const ref = (field as AnyRec)?.reference;
      for (const target of Array.isArray(ref) ? ref : [ref]) {
        if (typeof target === 'string' && byName.has(target) && !reached.has(target)) {
          reached.add(target);
          frontier.push(target);
        }
      }
    }
  }
  return [...reached].map((name) => byName.get(name)!);
}

/**
 * #9905 deliverable 1 — what NARROWING the objects collection would buy, timed.
 *
 * Prints `|closure| / N` (the size ratio, which is NOT the saving) next to the
 * measured saving (which is), and re-runs the gate on the narrowed collection to
 * confirm the differential VERDICT is unchanged — a saving that changes the
 * verdict is not a saving, it is PR #7886's phantom-findings failure.
 */
function closureMode() {
  const stable = (r: { errors: AnyRec[]; advisories: AnyRec[] }) =>
    [...r.errors, ...r.advisories].map((f) => `${f.rule}|${f.where}|${f.path}|${f.message}`).sort().join('\n');
  for (const shape of Object.keys(SHAPES)) {
    for (const n of SIZES) {
      const objects = SHAPES[shape]!(n);
      const closure = referenceClosure(item as AnyRec, objects);
      const full = timeMedian(() => { run(objects, item); });
      const scoped = timeMedian(() => { run(closure, item); });
      const agree = stable(run(objects, item)) === stable(run(closure, item));
      console.log('');
      console.log(`  shape=${shape} N=${n}: |closure| = ${closure.length}  (closure/N = ${((closure.length / n) * 100).toFixed(1)}%)`);
      console.log(`    members: ${closure.map((o) => String(o.name)).join(', ') || '<none>'}`);
      console.log(`    whole gate: full ${full.toFixed(2)} ms → closure ${scoped.toFixed(2)} ms — saving ${(((full - scoped) / full) * 100).toFixed(1)}%`);
      console.log(`    differential verdict unchanged: ${agree ? 'YES' : 'NO — narrowing changed the answer'}`);
    }
  }
}

if (MODE === 'per-rule') perRuleMode();
else if (MODE === 'closure') closureMode();
else totalMode();
