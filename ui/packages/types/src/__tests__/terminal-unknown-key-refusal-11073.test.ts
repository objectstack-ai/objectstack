/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11073 — the terminal unknown-key refusal where a strict object meets
 * a PLAIN union (the seat's Q3 ruling: restore the objectui#9256 / #11022
 * behaviour with the spec's own mechanism, and measure the blast radius FIRST).
 *
 * `zod/node-derivation.ts` (`closeStrictUnionArms`) carries the why. This file
 * re-derives, on every run, the two facts that make it safe to ship:
 *
 *   1. THE CENSUS, on both faces — the node face (`@object-ui/types/zod`) and the
 *      strict authoring face (`StrictAnyComponentSchema`): every plain union
 *      objectui owns has NO strict object arm left open. A union added later
 *      with a strict arm and no `closeStrictUnionArms` turns this red by name.
 *   2. THE VERDICT DIFFERENTIAL — each closed union against its OPEN twin (the
 *      same arms rebuilt as ordinary `ZodObject`s from the same def), over a
 *      corpus derived from the arms themselves. The ruling's stop condition was
 *      "if any accept set moves, stop and report the list": the list is pinned
 *      EMPTY here, while the error SHAPE is pinned to move at least once — the
 *      lit control that the mechanism is doing something at all.
 *
 * Measured when this landed (node face): 29 plain objectui unions with a strict
 * arm, 1106 probes, 0 accept-set moves, 187 error-shape moves. The counts are
 * floors below, not equalities: a union gained is not a regression, and the
 * zero is the assertion that matters.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
// The strict authoring face is read through this same barrel
// (`NodeFace.StrictAnyComponentSchema`), never from `strict-authoring-face`
// itself: objectui#8345 pins the barrel as the only entry into that module's
// cycle, test files included.
import * as NodeFace from '../zod/index.zod';

type Z = z.ZodType & { _zod: { def: Record<string, any>; constr?: { name?: string } } };

const isZ = (v: unknown): v is Z =>
  !!v && (typeof v === 'object' || typeof v === 'function') && !!(v as Z)._zod?.def;

/** Every schema node directly under `s` — options, shape members, wrappers, lazy targets. */
function children(s: Z): Z[] {
  const def = s._zod.def;
  const out: Z[] = [];
  for (const [key, value] of Object.entries(def)) {
    if (key === 'getter') continue;
    if (isZ(value)) out.push(value);
    else if (Array.isArray(value)) for (const x of value) { if (isZ(x)) out.push(x); }
    else if (key === 'shape' && value && typeof value === 'object') for (const x of Object.values(value)) if (isZ(x)) out.push(x);
  }
  if (def.type === 'lazy') {
    try { out.push(def.getter()); } catch { /* an unresolvable getter reaches nothing */ }
  }
  return out;
}

function reach(roots: unknown[]): Set<Z> {
  const seen = new Set<Z>();
  const stack = roots.filter(isZ);
  while (stack.length) {
    const s = stack.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    stack.push(...children(s));
  }
  return seen;
}

const WRAPPERS = ['optional', 'nullable', 'default', 'prefault', 'readonly', 'nonoptional'];
const unwrap = (s: Z): Z => {
  let x = s;
  for (let i = 0; i < 10; i++) {
    const t = x._zod.def.type;
    if (WRAPPERS.includes(t)) x = x._zod.def.innerType;
    else if (t === 'lazy') { try { x = x._zod.def.getter(); } catch { break; } }
    else break;
  }
  return x;
};
const isStrict = (o: Z): boolean => o._zod.def.type === 'object' && o._zod.def.catchall?._zod?.def?.type === 'never';
const isClosed = (o: Z): boolean => (o._zod.constr?.name ?? '') === 'ZodClosedObject';

/** Nodes the spec owns — its unions are the spec's to close, not objectui's. */
const SPEC_MODULES = [
  '@objectstack/spec', '@objectstack/spec/ui', '@objectstack/spec/data', '@objectstack/spec/automation',
  '@objectstack/spec/shared', '@objectstack/spec/api', '@objectstack/spec/system', '@objectstack/spec/ai',
  '@objectstack/spec/security', '@objectstack/spec/identity',
];
async function specOwnedNodes(): Promise<Set<Z>> {
  const roots: unknown[] = [];
  for (const m of SPEC_MODULES) {
    const mod = (await import(/* @vite-ignore */ m)) as Record<string, unknown>;
    roots.push(...Object.values(mod).filter(isZ));
  }
  return reach(roots);
}

/** A representative value for `s`, shallow — enough to steer a union to one arm. */
function sample(s: Z, depth = 0): unknown {
  if (!isZ(s) || depth > 3) return 'x';
  const d = s._zod.def;
  switch (d.type) {
    case 'string': return 'x';
    case 'number': case 'int': case 'bigint': return 1;
    case 'boolean': return true;
    case 'literal': return (d.values ?? [])[0];
    case 'enum': return Object.values(d.entries ?? {})[0];
    case 'array': return [sample(d.element, depth + 1)];
    case 'object': {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d.shape ?? {})) {
        const u = unwrap(v as Z);
        if (u._zod.def.type === 'never') continue;
        o[k] = sample(u, depth + 1);
      }
      return o;
    }
    case 'union': return sample(d.options[0], depth + 1);
    case 'lazy': try { return sample(d.getter(), depth + 1); } catch { return {}; }
    case 'record': return {};
    case 'pipe': return sample(d.in, depth);
    default:
      return WRAPPERS.includes(d.type) ? sample(d.innerType, depth) : 'x';
  }
}

interface FaceReading {
  plainUnionsWithStrictArm: number;
  openStrictArms: string[];
  probes: number;
  acceptMoves: string[];
  errorShapeMoves: number;
}

/** The census and the differential, over every plain union `nodes` reaches that the spec does not own. */
function readFace(nodes: Set<Z>, specOwned: Set<Z>): FaceReading {
  const reading: FaceReading = { plainUnionsWithStrictArm: 0, openStrictArms: [], probes: 0, acceptMoves: [], errorShapeMoves: 0 };
  let n = 0;
  for (const u of nodes) {
    const d = u._zod.def;
    if (d.type !== 'union' || d.discriminator !== undefined || specOwned.has(u)) continue;
    const arms = (d.options as Z[]).map(unwrap);
    if (!arms.some(isStrict)) continue;
    n += 1;
    reading.plainUnionsWithStrictArm += 1;
    arms.forEach((arm, i) => {
      if (isStrict(arm) && !isClosed(arm)) reading.openStrictArms.push(`union #${n} arm ${i}: ${Object.keys(arm._zod.def.shape).join(',')}`);
    });

    // The OPEN twin: every closed arm rebuilt as an ordinary ZodObject from the same def.
    // The union itself is rebuilt from ITS def too, so a check the union carries
    // (objectui#8069: the form field-rule triad's blank refusal, a `.superRefine`
    // over the shared predicate wire) stays on both sides and the differential
    // still measures the arms alone — `z.union(options)` would drop `def.checks`,
    // the loss `node-derivation.ts`'s `cloneWithDef` exists to prevent. It is rebuilt
    // with ITS constructor for the same reason: the widget `component` slot routes a
    // closed component type to its arm before the union runs (objectui#11709), and a
    // plain `z.ZodUnion` twin would drop that routing and read it as an arm's move.
    const twin = new ((u._zod as { constr?: unknown }).constr as any)({
      ...d,
      options: (d.options as Z[]).map((o) => (isStrict(o) && isClosed(o) ? new (z.ZodObject as any)({ ...o._zod.def }) : o)),
    });

    const corpus: unknown[] = [undefined, null, '', 'x', 0, 1, true, [], {}, { zzUnknown: 1 }];
    const samples = arms.filter((o) => o._zod.def.type === 'object').map((o) => sample(o) as Record<string, unknown>);
    for (const s of samples) {
      corpus.push(s, { ...s, zzUnknown: 1 });
      for (const k of Object.keys(s)) {
        corpus.push({ [k]: s[k] }, { [k]: s[k], zzUnknown: 1 });
        const minus = { ...s };
        delete minus[k];
        corpus.push(minus);
      }
    }
    for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) corpus.push({ ...samples[i], ...samples[j] });
    for (const o of arms) if (o._zod.def.type !== 'object') corpus.push(sample(o));

    for (const input of corpus) {
      reading.probes += 1;
      const closed = u.safeParse(input);
      const open = twin.safeParse(input);
      if (closed.success !== open.success) {
        reading.acceptMoves.push(`union #${n}: ${JSON.stringify(input)?.slice(0, 120)} closed=${closed.success} open=${open.success}`);
      } else if (!closed.success && !open.success) {
        const shape = (r: typeof closed) => JSON.stringify((r as any).error.issues.map((i: any) => [i.code, i.path]));
        if (shape(closed) !== shape(open)) reading.errorShapeMoves += 1;
      }
    }
  }
  return reading;
}

describe('objectui#11073 — terminal unknown-key refusal on plain unions: census and blast radius', () => {
  it('node face: no strict arm of a plain objectui union is left open, and no accept set moves', async () => {
    const specOwned = await specOwnedNodes();
    const reading = readFace(reach(Object.values(NodeFace)), specOwned);
    // Non-vacuity: the census found the population the ruling is about.
    expect(reading.plainUnionsWithStrictArm).toBeGreaterThanOrEqual(20);
    expect(reading.probes).toBeGreaterThan(500);
    // 1. The census.
    expect(reading.openStrictArms, 'a plain union with an OPEN strict arm — wrap its options in closeStrictUnionArms').toEqual([]);
    // 2. The ruling's stop condition, pinned empty.
    expect(reading.acceptMoves, 'the terminal refusal moved an ACCEPT set — the Q3 stop condition').toEqual([]);
    // …and the lit control: the mechanism changes the error shape somewhere.
    expect(reading.errorShapeMoves).toBeGreaterThan(0);
  });

  it('strict authoring face: the same census and the same differential', async () => {
    const specOwned = await specOwnedNodes();
    const reading = readFace(reach([NodeFace.StrictAnyComponentSchema]), specOwned);
    expect(reading.plainUnionsWithStrictArm).toBeGreaterThan(0);
    expect(reading.openStrictArms, 'a plain union with an OPEN strict arm on the strict face').toEqual([]);
    expect(reading.acceptMoves, 'the terminal refusal moved an ACCEPT set on the strict face').toEqual([]);
  });

  it('the instruments discriminate: an open twin IS reported open, and a closed arm is not', () => {
    const strictArm = z.object({ a: z.string() }).strict() as unknown as Z;
    expect(isStrict(strictArm)).toBe(true);
    expect(isClosed(strictArm)).toBe(false);
    const reading = readFace(reach([z.union([strictArm as any, z.string()])]), new Set());
    expect(reading.openStrictArms).toHaveLength(1);
  });
});
