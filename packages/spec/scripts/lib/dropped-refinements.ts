// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dropped-refinement ratchet (#18670) — a `.refine()` whose rule reaches the
 * runtime and NOT the published JSON Schema, held to a declared population
 * instead of nothing at all.
 *
 * ## The blind spot this closes, stated exactly
 *
 * `z.toJSONSchema()` has no projection for a `custom` check. Measured on zod
 * 4.4.3, the version this package resolves: a plain record, the same record
 * with a `.refine()`, and the same record with an ABORTING `.refine()` all
 * produce byte-identical output. So every rule written as a refinement is
 * enforced by the runtime and absent from `packages/spec/json-schema/**` — the
 * tree that ships inside the `@objectstack/spec` tarball (`files[]`), that
 * `content/docs/references/**` renders from, and that an author or an AI
 * validates against.
 *
 * The direction of the gap is what makes it a trap rather than a nit. The
 * published surface is **WIDER** than the runtime: a document the file accepts
 * can be refused at parse time, and the author's validator says yes right up to
 * the moment the platform says no. #16431 (a) already closed the mirror image —
 * a projection NARROWER than the Zod type, recorded on the artifact as
 * `x-unprojectable-branches` — and the sibling reasoning is quoted there: "a
 * schema that is NARROWER than its Zod type with nothing saying so is the same
 * silence this card was filed about". This is the other side of it, and the
 * silent direction is this one.
 *
 * ## What this module is, and what it deliberately is NOT
 *
 * It is a **visibility ratchet**, exactly like `unemitted-schemas.ts`: it
 * reports what is already true and refuses GROWTH of the population. It
 * narrows nothing itself and removes no refinement — the baseline is anchored
 * to the tree as it stands.
 *
 * The **fix** is a separate module and a separate decision, taken for #18670
 * item 2: `refinement-projection.ts` publishes a CLOSED, named list of
 * refinements, and this module now measures against that same projection (see
 * `projectOrNull`). So the two halves compose in one direction only — a rule the
 * closed list emits reads `projected` here and its ledger row goes; every other
 * rule reads `dropped` and stays declared. ⛔ Neither half may be used to talk
 * the other out of its reading: a site is `dropped` because THIS build's file
 * says nothing about it, not because a PR body says the projection handles it.
 *
 * ## Why the verdict is MEASURED per instance, never assumed
 *
 * `collectDroppedRefinements` does not trust the sentence at the top of this
 * docblock. For every node carrying a `custom` check it builds the same node
 * WITHOUT those checks — `clone()` recomputes the constraint bag from the
 * check list, which is what makes the comparison meaningful — and compares the
 * two projections byte for byte. Identical means the rule reached no reader;
 * different means zod projected something after all and the node is reported as
 * `projected`, not as a gap. A detector that asserted the drop instead of
 * measuring it would keep reading as current through the zod upgrade that fixes
 * it, which is the failure mode it exists to prevent one level down.
 *
 * ## Shrink-only in BOTH directions
 *
 * Same discipline as `unemitted-schemas.baseline.json`:
 *
 *   - a published schema with dropped refinements that is NOT recorded fails
 *     the build — a new gap has to be a reviewed line in a diff;
 *   - a recorded `sites` list the build does not observe ALSO fails, in either
 *     direction and path by path. A ledger that keeps naming a site the tree no
 *     longer has stopped describing the tree, and the next gap arrives inside a
 *     list nobody re-read.
 *
 * ## Why the ledger is HAND-EDITED and has no `gen:` script
 *
 * Identical to `unemitted-schemas.baseline.json`: a generator would let a new
 * gap be admitted by running a command instead of by a decision. Where THAT
 * ledger requires a non-empty per-entry `reason`, this one requires a non-empty
 * `sites` list and has no `reason` field at all — the reason is the same for
 * every site here and is written once, above and in the ledger's own
 * `description`, so a per-entry copy would be exactly the prose a required
 * `reason` exists to prevent (`DroppedRefinementsEntry` below argues that in
 * full). Both refuse the same thing: an entry recording only MEMBERSHIP, which
 * lets the next gap slip in behind a repaired one with nobody able to see which
 * was replaced.
 */
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
// The closed list of refinements that DO reach the published file (#18670 item
// 2), and the zod-check primitives both halves turn on. Imported rather than
// re-derived because the differential below is only a statement about the real
// published artifact if it runs the generator's own projection — see that
// module's header.
import {
  CUSTOM_CHECK_KIND,
  checkKindOf,
  customChecksOf,
  projectableRefinementsOf,
  refinementProjectionOverride,
  zodDefOf,
} from './refinement-projection';

/** File name of the committed ledger, resolved against the package root. */
export const DROPPED_REFINEMENTS_BASELINE_FILE = 'dropped-refinements.baseline.json';

/**
 * Re-exported so this module stays the one import for the census vocabulary.
 * Its declaration — and the argument for why it is the ONE string this whole
 * instrument turns on — lives in `refinement-projection.ts`, beside the two
 * other readers of a zod check.
 */
export { CUSTOM_CHECK_KIND };

/** How deep the graph walk goes before it stops descending. */
const MAX_DEPTH = 14;

/** One node that carries at least one refinement, and what became of it. */
export interface RefinementSite {
  /**
   * Where the node sits under its export, in reading order — `''` for the
   * export itself, else e.g. `condition.anyOf[0]` or `properties.rate`.
   */
  readonly path: string;
  /** The zod def type of the node, e.g. `record`, `object`, `string`. */
  readonly nodeType: string;
  /** How many `custom` checks this node carries. */
  readonly count: number;
  /**
   * True when any of them carries the check-level `abort` flag —
   * `.refine(fn, { abort: true })` — i.e. stops the parse outright.
   *
   * ⚠️ A `ctx.addIssue({ fatal: true })` written INSIDE a `superRefine` body is
   * a property of the issue raised at parse time, not of the check the graph
   * carries, so it reads `false` here. That is a report detail and never the
   * verdict: such a site is still a DROP, which is what everything downstream
   * turns on.
   */
  readonly aborting: boolean;
  /**
   * `dropped` — removing the refinements leaves the projection byte-identical.
   * `projected` — the projection changed, so the rule DID reach a reader.
   * `undecidable` — the node has no JSON form in either io direction, so the
   * comparison has no two sides. Reported, never counted as a gap.
   */
  readonly verdict: 'dropped' | 'projected' | 'undecidable';
  /**
   * Which arms of the closed projectable list (#18670 item 2) this node's
   * refinements were DECLARED as, in declaration order — empty for every rule
   * outside that list, which is what keeps it `dropped`.
   *
   * Reported so the generator can say which PATTERN closed a site rather than
   * only that the count moved: a projection arm that silently stops emitting
   * shows up here as a site that went back to `dropped` with its pattern still
   * named, which reads differently from a refinement somebody deleted.
   */
  readonly declaredPatterns: readonly string[];
}

/** Every refinement site under one published schema. */
export interface RefinementCensusEntry {
  /** `category/SchemaName` — the published file, e.g. `system/TraceSamplingConfig`. */
  readonly defKey: string;
  /** Sites whose rule reached no reader. The population this ratchet holds closed. */
  readonly dropped: readonly RefinementSite[];
  /** Sites zod projected something for. Reported so a zod upgrade is VISIBLE. */
  readonly projected: readonly RefinementSite[];
  /** Sites with no JSON form on either side of the comparison. */
  readonly undecidable: readonly RefinementSite[];
}

/** One recorded member of the accepted population. */
export interface DroppedRefinementsEntry {
  /**
   * The paths, under this published schema, at which a refinement is dropped —
   * the same strings the artifact's `x-dropped-refinements` names. Re-checked
   * against every build, in both directions.
   *
   * ⚠️ The unit is the SITE and not a count, deliberately. A count cannot tell
   * "a refinement moved" from "one arrived and one left", and a ledger of 237
   * numbers is a ledger nobody can read a diff of. The reason each site is
   * here is the same for all of them and is written once, in this module's
   * docblock and in the ledger's own `description`: zod has no projection for a
   * `custom` check. A per-entry `reason` repeated 682 times would be prose that
   * says nothing about the entry it sits on, which is the failure a required
   * `reason` exists to prevent, arrived at from the other side.
   */
  readonly sites: readonly string[];
}

/** The committed ledger's shape. */
export interface DroppedRefinementsBaseline {
  readonly entries: Readonly<Record<string, DroppedRefinementsEntry>>;
}

function checkAborts(check: unknown): boolean {
  const def = (check as { _zod?: { def?: Record<string, unknown> } } | null)?._zod?.def;
  return def?.abort === true || def?.fatal === true;
}

/**
 * The same node with its `custom` checks removed.
 *
 * `clone()` re-runs the type's initialiser over the check list, so the
 * constraint bag is rebuilt rather than copied — that is what makes the
 * comparison in `verdictFor` mean anything (a clone that merely copied the bag
 * would report every node as `dropped`, including `.min(1)`, and the lit
 * control in the census would not catch it because the control asserts the
 * opposite direction). The `.describe()` text lives in `z.globalRegistry`,
 * keyed by instance, so it is carried across by hand: without it every
 * described node reads as `projected` on a description that was never in
 * question.
 */
function withoutCustomChecks(schema: z.ZodType): z.ZodType | null {
  const def = zodDefOf(schema);
  if (!def || !Array.isArray(def.checks)) return null;
  const kept = def.checks.filter((c) => checkKindOf(c) !== CUSTOM_CHECK_KIND);
  const cloneable = schema as unknown as { clone?: (d: unknown) => z.ZodType };
  if (typeof cloneable.clone !== 'function') return null;
  const stripped = cloneable.clone({ ...def, checks: kept });
  const meta = z.globalRegistry.get(schema);
  if (meta) z.globalRegistry.add(stripped, meta);
  return stripped;
}

/**
 * `toJSONSchema` in the generator's own io ladder, or `null` when neither side
 * has a JSON form.
 *
 * ⭐ It passes the generator's `override` (#18670 item 2). Without it this
 * function would measure a projection nothing publishes: a node whose rule the
 * closed list DOES emit would read byte-identical on both sides of the
 * differential and stay in the ledger for ever, and the shrink-only ledger's
 * whole use — a row deletion is the observable proof a site closed — would be
 * unreachable. With it, `dropped` means "this build's own published file states
 * nothing about this rule".
 */
function projectOrNull(schema: z.ZodType): string | null {
  for (const io of ['output', 'input'] as const) {
    try {
      return JSON.stringify(
        z.toJSONSchema(schema, { target: 'draft-2020-12', io, override: refinementProjectionOverride }),
      );
    } catch {
      // Try the other direction — the generator does the same, for the same reason.
    }
  }
  return null;
}

function verdictFor(schema: z.ZodType): RefinementSite['verdict'] {
  const stripped = withoutCustomChecks(schema);
  if (!stripped) return 'undecidable';
  const before = projectOrNull(schema);
  const after = projectOrNull(stripped);
  if (before === null || after === null) return 'undecidable';
  return before === after ? 'dropped' : 'projected';
}

/**
 * Every schema a def references, each with the path segment that reaches it.
 *
 * Generic on purpose — it reads the def's own plain values rather than
 * enumerating node kinds, so a kind zod adds later is walked rather than
 * silently skipped (the reasoning `zodChildSchemas` records, #5317).
 *
 * ⛔ It deliberately does NOT follow `_zod.parent`. A check-clone's parent is
 * the SAME node one refinement earlier, so following it would report
 * `x.refine(a).refine(b)` as two sites, one of which no parent schema embeds.
 */
function labelledChildren(schema: z.ZodType): Array<{ label: string; schema: z.ZodType }> {
  const out: Array<{ label: string; schema: z.ZodType }> = [];
  const def = zodDefOf(schema);
  if (!def) return out;
  const seen = new Set<unknown>();
  const walk = (label: string, value: unknown): void => {
    if (value == null) return;
    if (value instanceof z.ZodType) {
      out.push({ label, schema: value });
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${label}[${i}]`, item));
      return;
    }
    if (value instanceof Map) {
      for (const [key, item] of value) walk(`${label}.${String(key)}`, item);
      return;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      for (const [key, item] of Object.entries(value)) walk(label ? `${label}.${key}` : key, item);
    }
  };
  for (const [key, value] of Object.entries(def)) {
    // `checks` is the node's own rule list, not an edge to a child schema.
    // A `_`-prefixed def key is zod's own memo — `_cachedInner` on a `lazy`
    // node holds the resolved target, and descending into it walks a SECOND
    // instance of a graph the `getter` edge below already reaches. Measured on
    // the shipped tree: all 80 sites this walk classified `projected` were
    // reached through `_cachedInner`, and every one of them was the recursive
    // `$ref` layout differing between two instances of the same schema — a
    // difference in the ARTIFACT, never in what the refinement constrains.
    if (key === 'checks' || key.startsWith('_')) continue;
    walk(key, value);
  }
  if (def.type === 'lazy' && typeof def.getter === 'function') {
    try {
      const inner = (def.getter as () => unknown)();
      if (inner instanceof z.ZodType) out.push({ label: 'lazy', schema: inner });
    } catch {
      // An unresolvable lazy getter has no graph to traverse.
    }
  }
  return out;
}

/**
 * Strip the two def-shape segments that carry no information for a reader —
 * `shape` (an object's property bag) and `innerType` (an optional / default /
 * nullable / readonly wrapper, which stacks, so this is a per-segment filter
 * and not a regex: `.optional().default()` produces `innerType.innerType.` and
 * a single global replace leaves the second one standing) — and keep every
 * segment that does say something. `element`, `options[i]`, `valueType`,
 * `in`/`out` and `left`/`right` all say WHERE under the published document the
 * rule sits, which is the census question.
 */
function readablePath(raw: string): string {
  return raw
    .split('.')
    .filter((segment) => segment !== '' && segment !== 'shape' && segment !== 'innerType')
    .join('.');
}

/**
 * The identity two references to the SAME schema node share in BOTH
 * schema-evaluation modes — the node's zod internals (`_zod`), with a
 * `lazySchema()` Proxy resolved to the internals it stands for.
 *
 * ⛔ Not the schema instance, which is not mode-invariant. `lazySchema()`
 * (`src/shared/lazy-schema.ts`) returns the real schema under
 * `OS_EAGER_SCHEMAS=1` — how `gen:schema` and `check:authorable-surface` run —
 * and a Proxy over it otherwise. Keyed on the instance, a sub-schema reached
 * once directly and once through a `lazySchema()` edge is ONE node to the eager
 * walk and TWO to the lazy one, so the census — and the ledger comparison built
 * on it — differed between two runs of the same generator over the same tree.
 * Measured on `ui/View`, whose `list`/`listViews.valueType` and
 * `form`/`formViews.valueType` pairs each reach one schema by both routes: 11
 * dropped sites eager, 13 lazy.
 *
 * ⛔ And not the `def` either, which over-collapses in the other direction:
 * `clone()` with no argument produces a SECOND instance carrying the FIRST's
 * def object, so two nodes the eager walk counts separately become one. Keyed
 * on the def, the shipped tree lost `…options[3].object.fields.valueType` from
 * `system/ChangeSet` and `system/MigrationOperation` — a reading the accepted
 * ledger does not make. `_zod` is per instance and the def is not, so `_zod` is
 * the narrower key, and it moves nothing in eager mode: no Proxy exists there,
 * and every other node maps to its own internals one-to-one.
 *
 * The Proxy is resolved by shape, not by asking it: its `_zod` facade is
 * `Object.create(realInternals, { processJSONSchema })`, so the real internals
 * ARE its prototype — and a real `_zod` descends from `Object.prototype`, which
 * owns no `def`. Looped rather than unwrapped once, so a Proxy over a Proxy
 * resolves the whole way down.
 */
function identityOf(schema: z.ZodType): unknown {
  let internals = (schema as unknown as { _zod?: object })._zod;
  if (!internals || typeof internals !== 'object') return schema;
  for (let hop = 0; hop < MAX_DEPTH; hop += 1) {
    const proto = Object.getPrototypeOf(internals) as object | null;
    if (!proto || proto === Object.prototype) break;
    if (!Object.prototype.hasOwnProperty.call(proto, 'def')) break;
    internals = proto;
  }
  return internals;
}

/**
 * Walk one published schema and classify every refinement under it.
 *
 * The visited set is per export and holds node IDENTITIES, so a shared
 * sub-schema is reported once per published file that reaches it — which is the
 * census question ("which published files does the gap land on"), not "how many
 * distinct nodes exist", and not "by how many routes".
 */
export function collectDroppedRefinements(defKey: string, root: z.ZodType): RefinementCensusEntry {
  const dropped: RefinementSite[] = [];
  const projected: RefinementSite[] = [];
  const undecidable: RefinementSite[] = [];
  const visited = new Set<unknown>();

  const queue: Array<{ schema: z.ZodType; path: string; depth: number }> = [
    { schema: root, path: '', depth: 0 },
  ];
  while (queue.length > 0) {
    const { schema, path, depth } = queue.shift()!;
    if (visited.has(identityOf(schema))) continue;
    visited.add(identityOf(schema));

    const customs = customChecksOf(schema);
    if (customs.length > 0) {
      const site: RefinementSite = {
        path: readablePath(path),
        nodeType: String(zodDefOf(schema)?.type ?? 'unknown'),
        count: customs.length,
        aborting: customs.some(checkAborts),
        verdict: verdictFor(schema),
        declaredPatterns: projectableRefinementsOf(schema).map((declared) => declared.pattern),
      };
      if (site.verdict === 'dropped') dropped.push(site);
      else if (site.verdict === 'projected') projected.push(site);
      else undecidable.push(site);
    }

    if (depth >= MAX_DEPTH) continue;
    for (const child of labelledChildren(schema)) {
      if (visited.has(identityOf(child.schema))) continue;
      queue.push({
        schema: child.schema,
        path: path ? `${path}.${child.label}` : child.label,
        depth: depth + 1,
      });
    }
  }

  const byPath = (a: RefinementSite, b: RefinementSite): number => a.path.localeCompare(b.path);
  return {
    defKey,
    dropped: [...dropped].sort(byPath),
    projected: [...projected].sort(byPath),
    undecidable: [...undecidable].sort(byPath),
  };
}

/** How many refinement sites one census entry drops. */
export function droppedCount(entry: RefinementCensusEntry): number {
  return entry.dropped.length;
}

/** One ledger entry whose recorded site list is not the one this build observes. */
export interface MiscountedEntry {
  readonly defKey: string;
  /** Sites this build sees that the ledger does not name — new gaps. */
  readonly added: readonly string[];
  /** Sites the ledger names that this build does not see — closed, or moved. */
  readonly removed: readonly string[];
  /** What the corrected entry should say, in full. */
  readonly observedSites: readonly string[];
}

/** Everything the gate found wrong with the ledger, in one pass. */
export interface DroppedRefinementProblems {
  /** Drops nobody declared — the growth this ratchet refuses. */
  readonly undeclared: readonly RefinementCensusEntry[];
  /** Declared with a site set this build does not observe, in either direction. */
  readonly miscounted: readonly MiscountedEntry[];
  /** Recorded, but the schema drops nothing now. Delete the line. */
  readonly repaired: readonly string[];
  /** Recorded, but no such schema is published any more. Delete the line. */
  readonly vanished: readonly string[];
  /** Recorded with an empty `sites` list — a membership bit pretending to be a ledger. */
  readonly unreasoned: readonly string[];
}

/** True when nothing above needs saying. */
export function hasDroppedRefinementProblems(p: DroppedRefinementProblems): boolean {
  return (
    p.undeclared.length > 0 ||
    p.miscounted.length > 0 ||
    p.repaired.length > 0 ||
    p.vanished.length > 0 ||
    p.unreasoned.length > 0
  );
}

/**
 * Adjudicate one build's observed population against the committed ledger.
 *
 * `publishedKeys` is every def key this build emitted, which is what separates
 * "this schema was repaired" from "this schema is no longer published" — two
 * states whose remedy is the same line deletion but whose PR description is not.
 */
export function checkDroppedRefinements(args: {
  readonly census: readonly RefinementCensusEntry[];
  readonly publishedKeys: ReadonlySet<string>;
  readonly baseline: DroppedRefinementsBaseline;
}): DroppedRefinementProblems {
  const { census, publishedKeys, baseline } = args;
  const observed = new Map(census.filter((e) => e.dropped.length > 0).map((e) => [e.defKey, e]));

  const undeclared = [...observed.values()].filter((e) => !(e.defKey in baseline.entries));
  const miscounted: MiscountedEntry[] = [];
  const repaired: string[] = [];
  const vanished: string[] = [];
  const unreasoned: string[] = [];

  for (const [defKey, entry] of Object.entries(baseline.entries)) {
    if (entry.sites.length === 0) unreasoned.push(defKey);
    const seen = observed.get(defKey);
    if (seen) {
      const observedSites = seen.dropped.map((site) => site.path);
      const recorded = new Set(entry.sites);
      const added = observedSites.filter((site) => !recorded.has(site));
      const seenSet = new Set(observedSites);
      const removed = entry.sites.filter((site) => !seenSet.has(site));
      // A repeated path is a real second site on the same node position, so the
      // lengths are compared as well as the sets — two sites at one path differ
      // from one, and a set difference alone cannot see it.
      if (added.length > 0 || removed.length > 0 || observedSites.length !== entry.sites.length) {
        miscounted.push({ defKey, added, removed, observedSites });
      }
      continue;
    }
    if (publishedKeys.has(defKey)) repaired.push(defKey);
    else vanished.push(defKey);
  }

  return { undeclared, miscounted, repaired, vanished, unreasoned };
}

/** Read the committed ledger, or `null` when the file is absent. */
export function readDroppedRefinementsBaseline(pkgDir: string): DroppedRefinementsBaseline | null {
  const file = path.join(pkgDir, DROPPED_REFINEMENTS_BASELINE_FILE);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: unknown };
  const entries = parsed.entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    throw new Error(`${DROPPED_REFINEMENTS_BASELINE_FILE}: "entries" must be an object of key -> { sites: string[] }`);
  }
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    const entry = value as Partial<DroppedRefinementsEntry>;
    if (!Array.isArray(entry?.sites) || entry.sites.some((site) => typeof site !== 'string')) {
      throw new Error(`${DROPPED_REFINEMENTS_BASELINE_FILE}: entry "${key}" needs a \`sites\` array of path strings`);
    }
  }
  return { entries: entries as Readonly<Record<string, DroppedRefinementsEntry>> };
}
