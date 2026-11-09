// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The seed's load plan: in which order the card's rows go in, and which lookup
 * values wait for a second pass.
 *
 * The references come from the card itself — its declared lookups
 * (`expect.lookups`) between two seeded objects — never from a hand list. A
 * lookup's target object loads before the object that refers to it. Where the
 * lookups lead back to where they start (`department.manager → employee` and
 * `employee.department → department`, which every mid-tier card has) no order
 * satisfies them all, so the seed loads in two passes:
 *
 *   1. every row is inserted with each lookup value that names a row loaded
 *      LATER left out — a lookup to an object later in the order, or a
 *      self-lookup (`employee.manager`) naming a later row of its own object;
 *   2. once every row is in, those values are set, one update per row.
 *
 * Which side of a cycle waits is chosen from the built schema: a lookup the
 * build made `required` cannot be left out of an insert, so only optional ones
 * are deferred. A cycle whose every lookup is required cannot be loaded at all
 * — the data contract says so (`prompts.ts`), and the runner reports such a
 * build as a Build finding naming the cycle. It still loads the seed, so the
 * record holds the app's own answers rather than the runner's prediction of
 * them.
 */

import type { ScenarioCard } from '../schema.js';
import { artifactToEvalGraph } from '../score/index.js';

type Card = ScenarioCard;

/** A declared lookup between two seeded objects: `object.field` names a row of `to`. */
export interface SeedLookup {
  object: string;
  field: string;
  to: string;
}

/** `object.field`, the key a {@link requiredLookups} set and the second-pass tally use. */
export const lookupKey = (l: Pick<SeedLookup, 'object' | 'field'>): string => `${l.object}.${l.field}`;

/** The card's declared lookups whose two ends are both seeded (a self-lookup included): the references its seed must satisfy. */
export function seedLookups(card: Card): SeedLookup[] {
  const seeded = new Set(Object.keys(card.run.seed));
  return (card.expect.lookups ?? []).filter((l) => seeded.has(l.object) && seeded.has(l.to)).map(({ object, field, to }) => ({ object, field, to }));
}

/**
 * The seeded objects grouped into strongly connected sets over the lookups
 * between them (Tarjan, walked depth first from the card's seed order). A set
 * is emitted only after every set it depends on, so the sets arrive
 * dependencies first; the members of a set are in the card's seed order. On a
 * card with no cycle this is the depth-first order the runner always loaded
 * in.
 */
function stronglyConnected(objects: readonly string[], lookups: readonly SeedLookup[]): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let next = 0;
  const visit = (o: string): void => {
    index.set(o, next);
    low.set(o, next);
    next++;
    stack.push(o);
    onStack.add(o);
    for (const l of lookups) {
      if (l.object !== o) continue;
      if (!index.has(l.to)) {
        visit(l.to);
        low.set(o, Math.min(low.get(o)!, low.get(l.to)!));
      } else if (onStack.has(l.to)) {
        low.set(o, Math.min(low.get(o)!, index.get(l.to)!));
      }
    }
    if (low.get(o) === index.get(o)) {
      const group: string[] = [];
      for (let w = stack.pop()!; ; w = stack.pop()!) {
        onStack.delete(w);
        group.push(w);
        if (w === o) break;
      }
      groups.push(group);
    }
  };
  for (const o of objects) if (!index.has(o)) visit(o);
  const pos = new Map(objects.map((o, i) => [o, i]));
  for (const g of groups) g.sort((a, b) => pos.get(a)! - pos.get(b)!);
  return groups;
}

/**
 * The card's reference cycles: per strongly connected set of seeded objects
 * that leads back to itself (two or more objects, or one with a self-lookup),
 * the lookups inside it, in the card's declaration order; the sets in the
 * card's seed order. Read from the card's own lookups, so the build prompt can
 * name them and the load plan can break them.
 */
export function referenceCycles(card: Card): SeedLookup[][] {
  const objects = Object.keys(card.run.seed);
  const lookups = seedLookups(card);
  const pos = new Map(objects.map((o, i) => [o, i]));
  const out: Array<{ first: number; inside: SeedLookup[] }> = [];
  for (const group of stronglyConnected(objects, lookups)) {
    const members = new Set(group);
    const inside = lookups.filter((l) => members.has(l.object) && members.has(l.to));
    if (group.length > 1 || inside.length > 0) out.push({ first: pos.get(group[0]!)!, inside });
  }
  return out.sort((a, b) => a.first - b.first).map((c) => c.inside);
}

/**
 * The lookup fields a built artifact declares `required`, as `object.field`,
 * read through the scorer's one artifact reader. `undefined` when the
 * artifact cannot be read in its spec shape — the score half reports that
 * itself, and the plan then knows no lookup to be required.
 */
export function requiredLookups(artifact: unknown): Set<string> | undefined {
  if (artifact === undefined) return undefined;
  try {
    const graph = artifactToEvalGraph(artifact);
    return new Set(graph.objects.flatMap((o) => o.fields.filter((f) => f.required === true).map((f) => lookupKey({ object: o.name, field: f.name }))));
  } catch {
    return undefined;
  }
}

export interface SeedPlan {
  /** The seeded objects in insert order: a lookup's target before its referrer, wherever a cycle allows. */
  order: string[];
  /** The lookup values the first pass leaves out and the second sets: each names a row loaded after the row holding it. */
  deferred: Array<{ object: string; id: string; field: string; value: string }>;
  /** Reference cycles whose every lookup the build made required: no load order can satisfy them. */
  unseedable: SeedLookup[][];
}

/**
 * The load plan for a card's seed against a built schema whose required
 * lookup fields are `required` (`object.field`; none when the schema is not
 * known).
 *
 * Objects go in dependencies first, one strongly connected set at a time
 * ({@link stronglyConnected}). Inside a reference cycle the members go in by
 * Kahn's algorithm over the lookups between them, in seed order; when every
 * remaining member still waits on another, one is let in early: a member whose
 * waiting lookups are all optional, the fewest waiting first. When every
 * remaining member waits on a required lookup, those required lookups close a
 * cycle the seed cannot load — it is reported in `unseedable`, and a member is
 * let in all the same so the seed still runs. A self-lookup orders nothing; it
 * is resolved row by row.
 *
 * Then every lookup value naming a row that is not yet in at its row's insert
 * is deferred to the second pass.
 */
export function seedPlan(card: Card, required: ReadonlySet<string> = new Set()): SeedPlan {
  const objects = Object.keys(card.run.seed);
  const lookups = seedLookups(card);
  const pos = new Map(objects.map((o, i) => [o, i]));
  const order: string[] = [];
  const unseedable: SeedLookup[][] = [];

  for (const group of stronglyConnected(objects, lookups)) {
    const members = new Set(group);
    const inside = lookups.filter((l) => l.object !== l.to && members.has(l.object) && members.has(l.to));
    const remaining = [...group];
    const done = new Set<string>();
    const waiting = (o: string) => inside.filter((l) => l.object === o && !done.has(l.to));
    const admit = (o: string) => {
      remaining.splice(remaining.indexOf(o), 1);
      done.add(o);
      order.push(o);
    };
    while (remaining.length) {
      const ready = remaining.find((o) => waiting(o).length === 0);
      if (ready) {
        admit(ready);
        continue;
      }
      const byFewest = (cands: string[]) => [...cands].sort((a, b) => waiting(a).length - waiting(b).length || pos.get(a)! - pos.get(b)!)[0]!;
      const optionalOnly = remaining.filter((o) => waiting(o).every((l) => !required.has(lookupKey(l))));
      if (optionalOnly.length) {
        admit(byFewest(optionalOnly));
        continue;
      }
      unseedable.push(requiredCycle(remaining, inside, done, required));
      admit(byFewest(remaining));
    }
  }

  const loadedAt = new Map(order.map((o, i) => [o, i]));
  const rowAt = new Map<string, number>();
  for (const o of order) (card.run.seed[o] ?? []).forEach((row, i) => rowAt.set(`${o}/${row.id}`, i));
  const deferred: SeedPlan['deferred'] = [];
  for (const object of order) {
    (card.run.seed[object] ?? []).forEach((row, i) => {
      for (const l of lookups) {
        if (l.object !== object) continue;
        const value = row[l.field];
        if (typeof value !== 'string') continue;
        const later = l.to === object ? (rowAt.get(`${object}/${value}`) ?? -1) >= i : loadedAt.get(l.to)! > loadedAt.get(object)!;
        if (later) deferred.push({ object, id: row.id, field: l.field, value });
      }
    });
  }
  for (const l of lookups) if (l.object === l.to && required.has(lookupKey(l))) unseedable.push([l]);
  return { order, deferred, unseedable };
}

/** A cycle of required lookups among `remaining` (each of which waits on one), walked from the first. */
function requiredCycle(remaining: readonly string[], inside: readonly SeedLookup[], done: ReadonlySet<string>, required: ReadonlySet<string>): SeedLookup[] {
  const path: SeedLookup[] = [];
  const seenAt = new Map<string, number>();
  for (let o = remaining[0]!; !seenAt.has(o); ) {
    seenAt.set(o, path.length);
    const step = inside.find((l) => l.object === o && !done.has(l.to) && required.has(lookupKey(l)))!;
    path.push(step);
    o = step.to;
  }
  return path.slice(seenAt.get(path[path.length - 1]!.to)!);
}

/** A cycle as the record and the prompt name it: `` `a.x` → `b`, `b.y` → `a` ``. */
export function cycleText(cycle: readonly SeedLookup[]): string {
  return cycle.map((l) => `\`${lookupKey(l)}\` → \`${l.to}\``).join(', ');
}
