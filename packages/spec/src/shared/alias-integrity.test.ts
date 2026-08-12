// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5013 — repo-wide alias-table integrity for every `strictObject(` authoring
 * surface in `packages/spec`.
 *
 * ## What an alias table actually is
 *
 * It is a **claim about the schema**, in two halves:
 *
 * - the key it is filed under is one the shape **rejects** (an alias only ever
 *   runs from the `unrecognized_keys` path, so a key the shape *declares* can
 *   never reach it — that entry is dead code that reads as coverage);
 * - the key it prescribes is one the shape **accepts** (ledger finding 12,
 *   *never suggest a key the schema cannot accept*).
 *
 * Nothing checked either half, and both were false on `main`. `ReportSchema`
 * answered `filter` with *"Did you mean `filter` → `filters`?"* and then
 * rejected `filters` too — a second rejection, with no suggestion the second
 * time, from the campaign built to remove exactly that experience. The other
 * five were dead entries whose keys the shape already declared.
 *
 * ## Why the judgement runs at RUNTIME
 *
 * 批 14 shipped this assertion over its own six files by reading the source
 * object literals with the TypeScript AST, and hand-mapped each `surface`
 * string onto a schema. Three things break that at repo scale, all of them
 * present today and all measured, not hypothesised:
 *
 * 1. **Spreads.** A shape that spreads (`...MetadataProtectionFields`) has keys
 *    no source-literal reader can see, so the target check has to be suppressed
 *    for most of the interesting schemas. `.shape` sees them.
 * 2. **Assembled tables.** Ten call sites build `aliases` (or `surface`) from
 *    something other than a literal — `data/field.zod.ts`, `ui/theme.zod.ts`
 *    and others. The AST reads those as empty and reports them clean.
 *    (`automation/etl.zod.ts` was one of the ten when this was measured; the
 *    whole L2 layer was retired at #6414, which is why the count above is kept
 *    as the measurement it was rather than silently decremented — the argument
 *    is about the AST's blind spot, and it does not get weaker by one file.)
 * 3. **Colliding surfaces.** `'this field group'` names two different schemas
 *    (`data/object.zod.ts`, `studio/object-designer.zod.ts`), so the surface
 *    string is not a key and the hand-map silently judges one against the
 *    other's shape.
 *
 * So the table and the shape are both read off the **same runtime node**:
 * `strictObject` retains its options under a marker symbol, and this file walks
 * the schema graph of every module in `packages/spec/src` to find them. There
 * is no second copy of anything, and no per-surface registration to forget.
 *
 * The AST is still used — for **coverage only**. It enumerates the call sites
 * that exist in the source, and the walk must have reached every one of them.
 * That is the half that makes absence loud: a table the walk cannot reach is a
 * table this gate is not judging, and it fails rather than passing quietly.
 *
 * ## The third claim (#5481)
 *
 * The two claims above are about a table and its *schema*. The third is about a
 * table and *itself*: `strictUnknownKeyError` indexes the alias table by
 * `aliasProbe(key)`, so two keys in one table that normalise identically
 * collapse — **the later one silently wins**. That is not a stylistic
 * redundancy. `these snap settings` listed `grid: 'gridSize'` and, at the end
 * of the same table, `grid_: 'showGrid'`; the probe strips `_`, so `grid: 24`
 * was answered *"Did you mean `grid` → `showGrid`?"* and `showGrid` is a
 * boolean — a second rejection, ledger finding 7's exact shape, from a table
 * whose author had written the correct mapping one line earlier.
 *
 * The other three instances on `main` pointed both keys at the same target, so
 * the overwrite changed nothing and nobody could trip on them — which is the
 * general lesson rather than an exemption: since the probe already folds case
 * and separators, a second spelling of one probe is **never** reachable. It is
 * dead either way; it is only sometimes also a defect.
 *
 * ## The second batch: tables that never had a shape (#5483 → #5593)
 *
 * `strictObject` used not to be the only way to get an alias table. Forty-four
 * call sites predated the helper and called `strictUnknownKeyError` directly,
 * handing it a **hand-transcribed `knownKeys` array** — so there was no `.shape`
 * to judge them against, and they sat outside all three claims above.
 *
 * #5483 shipped a transitional guard: a second registry the factory itself
 * filled, so those tables were judged *somehow* without a single call site being
 * edited. What it could buy differed sharply by claim — claims 1 and 2 were
 * answered against the TRANSCRIPTION, so a drifted array dragged both answers
 * with it, while claim 3 lost nothing (an `aliasProbe` collision is a property
 * of the table alone, and that sweep came back clean at 52 tables).
 *
 * **#5593 migrated all 44 and deleted the registry.** The two weak answers are
 * now strong ones: every table in this repo is judged against the shape its
 * error map actually reads, including the "alias target must not be a tombstone"
 * half that a flat `knownKeys` array cannot express at all. Two consequences
 * worth naming, because both were predicted as failures and one of them was not:
 *
 * - `VARIANT_LEGAL_GUIDANCE` — #5483's exemption for the `children` prescription
 *   that is legally silent on the two nav variants declaring `children` — is
 *   **deleted, by a fix rather than a move**: `ui/app.zod.ts` now files that
 *   prescription only on the seven variants where it can fire, which a
 *   transcription-shaped table could not distinguish. Same demotion-not-tolerance
 *   move #5555 made on the "start expanded" aliases one field over.
 * - `PROSE_ALIAS_TARGETS` **moved instead of dying**, and that is a correction to
 *   the migration's own forecast. The exemption existed because seven nav alias
 *   targets are deliberately prose (`type: 'dashboard' (with dashboardName)`)
 *   rather than key names; migrating the family did not make them key names, so
 *   claim 2 met the same 93 entries from the shape side and the tolerance had to
 *   come with it. It is strictly stronger where it now sits — judged against
 *   `.shape`, with the same staleness test — but it is one exemption this
 *   campaign did not get to delete.
 *
 * ## The ratchet inverted: `strictUnknownKeyError` is now internal-only in-repo
 *
 * The old shrink-only ratchet (`<= 44` direct call sites) is a **hard zero**:
 * the factory stays PUBLISHED for external callers, but inside `packages/spec`
 * the only caller is `strictObject`. A new direct call site would mint a fresh
 * second copy of a key list and land outside the shape-backed audit, so it fails
 * here rather than being counted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect, beforeAll } from 'vitest';
import ts from 'typescript';

import { aliasProbe } from './alias-probe';
import { acceptsNothing, strictObjectDeclarations, type StrictObjectDeclaration } from './strict-object';
import { keySetMatches } from './suggestions.zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_SRC = path.resolve(HERE, '..');

/**
 * The two modules that *define* the helpers rather than using them. Shared by
 * the direct-call AST scan and the shrink-only ratchet so the two can never
 * disagree about what counts as a call site.
 */
const HELPER_MODULES = new Set(['shared/suggestions.zod.ts', 'shared/strict-object.ts']);

// ---------------------------------------------------------------------------
// The file set — one list, shared by the runtime walk and the AST coverage scan
// ---------------------------------------------------------------------------

/** Every non-test TypeScript module under `packages/spec/src`, repo-relative. */
function specModules(dir = SPEC_SRC, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) specModules(full, out);
    else if (
      entry.name.endsWith('.ts')
      && !entry.name.endsWith('.test.ts')
      && !entry.name.endsWith('.bench.ts')   // registers vitest suites on import
      && !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

const MODULES = specModules().sort();

// ---------------------------------------------------------------------------
// Forcing walk — build every schema, so the registry is complete
// ---------------------------------------------------------------------------

const isSchema = (v: unknown): boolean =>
  v != null
  && (typeof v === 'object' || typeof v === 'function')
  && typeof (v as { _zod?: { def?: unknown } })._zod?.def === 'object';

/**
 * A synthetic `unrecognized_keys` issue, used to force an error map that builds
 * itself on first use (see {@link force}).
 *
 * Shaped as the real thing rather than an empty object because the maps it
 * drives read `issue.code` and `issue.keys`. The key is deliberately absurd: if
 * a map ever does something more interesting than build a closure, it does it
 * over a string no schema declares.
 */
const PROBE_ISSUE = {
  code: 'unrecognized_keys',
  keys: ['__alias_integrity_probe__'],
  path: [],
  input: {},
} as never;

/**
 * Touch every node in the zod graph under `root`.
 *
 * `strictObject` records a declaration when it RUNS, and `lazySchema` defers
 * that until first use — so a schema nobody touches never registers. This walk
 * is what makes "nobody touched it" impossible: reading `_zod.def` resolves the
 * lazy proxy, and descending the graph reaches nested shapes that only build
 * when their parent does.
 *
 * **Calling the error map is part of forcing** (#5483). Two schemas defer the
 * map itself, not just the schema: `strictObject` builds it on first rejection
 * (to break the `field.zod` ↔ `suggestions.zod` import cycle) and
 * `data/object.zod.ts` does the same to step around a temporal dead zone. For a
 * direct `strictUnknownKeyError` call that deferral is the difference between a
 * registered table and an invisible one, so the map is invoked here with a
 * synthetic issue — the same code path a rejected key takes, minus the parse.
 * Building a map is pure, and the `strictObject` maps that also get built this
 * way decline to register a second time.
 *
 * Failures are swallowed on purpose: an error map is arbitrary user code and
 * this is a probe, not an assertion. Absence is caught where it means
 * something — the coverage checks below fail if a table the source declares
 * never reached a registry, which is a far more precise complaint than
 * "somebody's error map threw on a synthetic issue".
 *
 * Deliberately generic over `_zod.def` rather than switch-per-zod-type: a node
 * kind this file does not know about (a future wrapper, a pipe, a discriminated
 * union arm) must not silently drop the subtree beneath it. The cost is
 * visiting some internals twice, which `seen` absorbs.
 */
function force(root: unknown, seen: Set<unknown>): void {
  const visit = (node: unknown, depth: number): void => {
    if (depth > 40 || node == null) return;
    if (typeof node !== 'object' && typeof node !== 'function') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (!isSchema(node)) return;

    const def = (node as { _zod: { def: Record<string, unknown> } })._zod.def;
    // Reading `.shape` is what forces an object schema's own lazy members.
    if ((def as { type?: string }).type === 'object') {
      void (node as { shape?: unknown }).shape;
      const map = (def as { error?: unknown }).error;
      if (typeof map === 'function') {
        try { (map as (issue: never) => unknown)(PROBE_ISSUE); } catch { /* see docblock */ }
      }
    }

    for (const value of Object.values(def)) {
      if (typeof value === 'function') {
        // `z.lazy()` stores its body as `getter`; calling it is the only way
        // into a recursive schema's interior.
        if ((def as { type?: string }).type === 'lazy') {
          try { visit((value as () => unknown)(), depth + 1); } catch { /* not a getter */ }
        }
        continue;
      }
      if (isSchema(value)) { visit(value, depth + 1); continue; }
      if (Array.isArray(value)) {
        for (const item of value) if (isSchema(item)) visit(item, depth + 1);
        continue;
      }
      if (value && typeof value === 'object') {
        // `def.shape` (object), `def.entries` / `def.propValues` (unions), …
        for (const inner of Object.values(value as Record<string, unknown>)) {
          if (isSchema(inner)) visit(inner, depth + 1);
        }
      }
    }
  };
  visit(root, 0);
}

/** Every declaration built by the forcing walk, de-duplicated by content. */
let SURFACES: StrictObjectDeclaration[] = [];

beforeAll(async () => {
  const seen = new Set<unknown>();
  for (const file of MODULES) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`could not import ${path.relative(SPEC_SRC, file)}: ${String(error)}`);
    }
    for (const value of Object.values(mod)) force(value, seen);
  }
  // A factory (`actionObject()`) called by two schemas runs its `strictObject`
  // twice, registering two declarations from ONE call site. Same table, same
  // shape, same verdict — collapse them so a failure is reported once.
  //
  // The key includes the SHAPE's key list, not just the surface and aliases,
  // because `ui/app.zod.ts`'s navigation family is the opposite case: one
  // `navItemSurface(variant)` factory feeding nine `strictObject` calls whose
  // tables are genuinely different (same surface template, different shape,
  // different cross-variant aliases). Collapsing on surface alone would judge
  // one of the nine and silently drop eight — the shape is what tells the two
  // situations apart.
  const unique = new Map<string, StrictObjectDeclaration>();
  for (const d of strictObjectDeclarations()) {
    unique.set(
      JSON.stringify([d.options.surface, d.options.aliases ?? {}, Object.keys(d.shape).sort()]),
      d,
    );
  }
  SURFACES = [...unique.values()];
}, 180_000);

// ---------------------------------------------------------------------------
// AST coverage scan — which call sites EXIST (never what they mean)
// ---------------------------------------------------------------------------

interface CallSite {
  file: string;
  line: number;
  surface: string | null;
  /** Alias entries readable as literals. Partial when the table is assembled. */
  aliases: Record<string, string>;
  hasAliases: boolean;
  /** True when `surface` or any alias entry is not a plain literal. */
  assembled: boolean;
}

/**
 * Where the helper keeps its options literal — `strictObject(options, shape)`.
 *
 * A one-entry map since #5593 retired the `strictUnknownKeyError(options)`
 * spelling from this package. Kept as a map rather than inlined because the
 * arity is the load-bearing part (the scan reads `arguments[0]`), and a second
 * helper would arrive with a different one.
 */
const CALLEES = {
  strictObject: 2,
} as const;

function callSites(file: string, callee: keyof typeof CALLEES): CallSite[] {
  const arity = CALLEES[callee];
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const literal = (n: ts.Node): string | null =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null;
  const prop = (o: ts.ObjectLiteralExpression, name: string): ts.Expression | null => {
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name) return p.initializer;
    }
    return null;
  };
  const out: CallSite[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === callee
      && node.arguments.length === arity
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const opts = node.arguments[0];
      const surfaceNode = prop(opts, 'surface');
      const surface = surfaceNode ? literal(surfaceNode) : null;
      const aliasesNode = prop(opts, 'aliases');
      const aliases: Record<string, string> = {};
      let assembled = surfaceNode != null && surface == null;
      if (aliasesNode) {
        if (ts.isObjectLiteralExpression(aliasesNode)) {
          for (const p of aliasesNode.properties) {
            if (!ts.isPropertyAssignment(p)) { assembled = true; continue; }
            const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
            const target = literal(p.initializer);
            if (key && target) aliases[key] = target; else assembled = true;
          }
        } else assembled = true;
      }
      out.push({
        file: path.relative(SPEC_SRC, file),
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        surface,
        aliases,
        hasAliases: aliasesNode != null,
        assembled,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const CALL_SITES = MODULES.flatMap((f) => callSites(f, 'strictObject'));

/**
 * Sites where a module hands a zod shape an `{ error: … }` of its own that
 * decides **`unrecognized_keys`** — the structural signature of a hand-written
 * unknown-key error map (#6805).
 *
 * The criterion is the class's own definition, in two conjuncts, and BOTH are
 * load-bearing:
 *
 * 1. **Attached.** The map is passed as `error` in the params object of a
 *    `z.<factory>(…)` call — the construction-time wiring that makes it *this
 *    shape's* unknown-key voice. A map that is never attached to a shape has no
 *    alias/guidance table for a registry to judge, so it is not what #6416
 *    named. Two live specimens prove the conjunct is doing work rather than
 *    decorating the sentence: `shared/error-map.zod.ts`'s `objectStackErrorMap`
 *    *does* decide `unrecognized_keys`, but it is a per-parse map a CALLER
 *    passes to `safeParse` (a generic "check for typos" fallback carrying no
 *    per-key content), and `carriesUnknownKey` in the same file only *reads*
 *    `issue.code` to rank union branches. Neither is a per-schema table, and
 *    the first draft of this scan flagged both.
 * 2. **Deciding `unrecognized_keys`.** Judged by the code the map branches on,
 *    never by its name. `data/field.zod.ts`'s `uniqueScopeError` is attached
 *    exactly this way — `z.union([…], { error: uniqueScopeError })` — and is
 *    NOT in the class, because it answers `invalid_union`, a value-level
 *    verdict `strictObject`'s guidance channel does not address.
 *
 * AST rather than text throughout, which is the other load-bearing choice: the
 * literal `'unrecognized_keys'` appears in PROSE all over this package
 * (including in the pins that call this function), and a comment is not a node
 * this walk visits.
 */
interface HandwrittenMapSite { readonly line: number; readonly name: string }

function scanSource(file: string, text: string): HandwrittenMapSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  /** True when `node`'s subtree compares something to `'unrecognized_keys'`. */
  const decidesUnknownKeys = (node: ts.Node): boolean => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (
        (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        && n.text === 'unrecognized_keys'
      ) { found = true; return; }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };

  // Module-scope `const x = …` / `function x() {}`, so an `{ error: x }` can be
  // resolved back to the body it names. Same-module only: a map imported from
  // elsewhere is judged where it is DECLARED, by this same scan over that file.
  const declarations = new Map<string, ts.Node>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const sites: HandwrittenMapSite[] = [];
  const visit = (node: ts.Node): void => {
    // `z.object(…)`, `z.union(…)`, `z.never(…)`, … — a zod FACTORY call, which
    // is where a params object binds a map to a shape. Deliberately not any
    // `{ error: … }` anywhere: `schema.safeParse(data, { error: map })` is a
    // caller's choice for one parse, not a property of the shape.
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'z'
    ) {
      for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const p of arg.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          if (!ts.isIdentifier(p.name) || p.name.text !== 'error') continue;
          const init = p.initializer;
          // An identifier is resolved to its declaration; an inline function is
          // its own body. A CALL (`strictObjectError(options, shape)`) is the
          // shared template being invoked — the opposite of hand-written — and
          // its body lives in a helper module this scan does not read.
          const body = ts.isIdentifier(init) ? declarations.get(init.text) : init;
          if (!body || !decidesUnknownKeys(body)) continue;
          sites.push({
            line: source.getLineAndCharacterOfPosition(p.getStart()).line + 1,
            name: ts.isIdentifier(init) ? init.text : '(inline)',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

const handwrittenMapSites = (file: string): HandwrittenMapSite[] =>
  scanSource(file, fs.readFileSync(file, 'utf8'));

// ---------------------------------------------------------------------------
// 1. Coverage — the walk reached every table the source declares
// ---------------------------------------------------------------------------

describe('alias integrity — coverage', () => {
  it('the source really contains alias tables to judge (self-test before the verdict)', () => {
    // A verdict over an empty set is the failure mode this whole file exists to
    // prevent, so the instrument states its own scale first.
    const withAliases = CALL_SITES.filter((c) => c.hasAliases);
    expect(CALL_SITES.length).toBeGreaterThan(200);
    expect(withAliases.length).toBeGreaterThan(140);
    expect(CALL_SITES.some((c) => c.assembled)).toBe(true);
  });

  it('every `strictObject(` call site with an alias table was reached at runtime', () => {
    const bySurface = new Map<string, StrictObjectDeclaration[]>();
    for (const s of SURFACES) {
      const list = bySurface.get(s.options.surface) ?? [];
      list.push(s);
      bySurface.set(s.options.surface, list);
    }
    const unreached: string[] = [];
    for (const site of CALL_SITES) {
      if (!site.hasAliases) continue;
      // Matched on surface AND on the literal entries the AST could read, so a
      // colliding surface string (`'this field group'` names two schemas) still
      // resolves to the right declaration. A site whose `surface` is itself
      // assembled — `actionTranslationSchema(surface)` is called twice with two
      // different strings — is matched on its entries alone.
      const candidates = site.surface ? (bySurface.get(site.surface) ?? []) : SURFACES;
      const matched = candidates.some((c) =>
        Object.entries(site.aliases).every(([k, v]) => c.options.aliases?.[k] === v));
      if (!matched) unreached.push(`${site.file}:${site.line} (${site.surface ?? 'assembled surface'})`);
    }
    expect(unreached, 'these alias tables are not reachable from any module export, so nothing judges them').toEqual([]);
  });

  it('NOTHING in packages/spec calls `strictUnknownKeyError` directly any more (#5593)', () => {
    // This was a shrink-only ratchet at 44 — the pre-helper wiring, which hands
    // the factory a hand-transcribed `knownKeys` array instead of a shape.
    // #5593 migrated the last of them, so it is a hard ZERO and the assertion
    // changed meaning with the number: it no longer measures "how much of this
    // gate runs on the weaker instrument", it forbids the weaker instrument.
    //
    // Not a style rule. A direct call site is a second copy of a key list, and
    // the two claims that matter most — "is this alias key really unknown here"
    // and "is this alias target really a key this shape accepts" — can only be
    // answered against a transcription, which inherits every drift. The
    // tombstone half of the second claim cannot be answered at all: a flat
    // string array has no schemas in it. `strictObject` derives the list from
    // the shape, so there is nothing left to drift.
    //
    // `strictUnknownKeyError` stays PUBLISHED for external callers (it is in
    // `api-surface.json` under `./shared`); this is a rule about THIS package.
    const direct = MODULES.filter((f) => !HELPER_MODULES.has(path.relative(SPEC_SRC, f))).flatMap((f) => {
      const source = fs.readFileSync(f, 'utf8');
      return [...source.matchAll(/\bstrictUnknownKeyError\s*\(/g)].map(() => path.relative(SPEC_SRC, f));
    });
    expect(
      direct.sort(),
      'build the shape with `strictObject(options, shape)` instead — see the header of `strict-object.ts`',
    ).toEqual([]);
  });

  it("the nav-item factory built one table per variant, and `data/object.zod.ts`'s reached the walk", () => {
    // Two coverage facts #5483's direct-call block used to carry, kept because
    // both name a mechanism that can break silently, and both moved into the
    // shape-backed registry at #5593 rather than disappearing with it.
    //
    // (a) `ui/app.zod.ts`'s nine navigation branches share ONE
    //     `navItemSurface(variant)` options factory. Nine variants in, nine
    //     tables out — the count IS the coverage, and it is the assertion that
    //     fails if the de-duplication above ever collapses them onto one.
    const navTables = SURFACES.filter((s) => PROSE_TARGET_SURFACE.test(s.options.surface));
    expect(navTables.length, 'one strict branch per nav-item `type`').toBe(9);

    // (b) `data/object.zod.ts` used to build its error map on FIRST USE, to
    //     step around a temporal dead zone, and needed a synthetic-issue poke in
    //     `force()` to register at all. #5593 removed the deferral — moving
    //     `UNKNOWN_KEY_GUIDANCE` above the shape is what replaced it, because
    //     `strictObject` evaluates its options at construction — so this is now
    //     an ordinary registration. Asserted anyway: if the declaration order
    //     ever gets shuffled back, the module crashes under `OS_EAGER_SCHEMAS=1`
    //     and this names the schema that did it.
    expect(
      SURFACES.map((s) => s.options.surface),
      "`data/object.zod.ts`'s table did not register — check the declaration order of UNKNOWN_KEY_GUIDANCE",
    ).toContain('this object');
  });

  it('the runtime walk sees tables the AST provably cannot read', () => {
    // The reason the judgement is not done by AST, asserted rather than argued.
    const assembled = CALL_SITES.filter((c) => c.hasAliases && c.assembled && Object.keys(c.aliases).length === 0);
    expect(assembled.length).toBeGreaterThan(0);
    for (const site of assembled) {
      const runtime = SURFACES.filter((s) => s.options.surface === site.surface);
      expect(runtime.length, `no runtime table for ${site.file}:${site.line}`).toBeGreaterThan(0);
      expect(
        runtime.some((s) => Object.keys(s.options.aliases ?? {}).length > 0),
        `${site.file}:${site.line} reads as an EMPTY table in source but is non-empty at runtime`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The verdict
// ---------------------------------------------------------------------------

/**
 * `file:line — "surface": \`written\` -> \`target\``.
 *
 * The location is joined back from the AST scan purely so a failure is
 * navigable; it plays no part in the verdict, which is decided entirely by the
 * runtime shape.
 */
const entry = (s: StrictObjectDeclaration, written: string, target: string): string => {
  const site = CALL_SITES.find(
    (c) => c.surface === s.options.surface
      && Object.entries(c.aliases).every(([k, v]) => s.options.aliases?.[k] === v),
  );
  const where = site ? `${site.file}:${site.line}` : '(location unresolved)';
  return `${where} — "${s.options.surface}": \`${written}\` -> \`${target}\``;
};

/**
 * Alias targets that are deliberately **prose, not a key name** — the only
 * place in `packages/spec` where that is true, and an explicit allowlist rather
 * than a relaxed criterion because the two are not the same promise.
 *
 * `ui/app.zod.ts` builds one table per navigation-item `type`, and the
 * commonest nav mistake is not a typo: it is `dashboardName` written on a `url`
 * item — a real key, on the wrong variant. Naming a key there would be wrong
 * twice over (the key IS spelled correctly, and writing it is still not enough
 * without the matching `type`), so the target is a sentence:
 *
 *     Did you mean `dashboardname` → `type: 'dashboard' (with dashboardName)`?
 *
 * Enumerated, not pattern-matched, and paired with the surface family that owns
 * them, so a new prose target anywhere — including a second one on this very
 * surface — fails the target criterion and has to be argued for here. The
 * staleness test below is the other half: an entry nothing uses is deleted, so
 * this list cannot quietly outlive the tables it excuses.
 *
 * The seventh entry arrived by that route. #5555 fixed the defect this gate
 * found — the four "start expanded" spellings redirecting to `expanded` on the
 * eight variants that lack it — and the fix is precisely a demotion from bare
 * key name to prose, so the tolerance that pinned it was deleted and this list
 * grew by one. It is one string for four alias keys because they share a single
 * answer: the key you want lives on `group`.
 *
 * ⚠️ **Written for the direct-call guard at #5483, MOVED here at #5593 — and the
 * move is the correction worth reading.** The migration forecast that this
 * exemption would "lose its basis and go red, and should be deleted rather than
 * rewritten", on the reasoning that its precondition was the tables still being
 * in the direct registry. That reasoning was about where the tables were judged;
 * the FACT it excuses is a property of the tables themselves, and migrating them
 * did not turn seven sentences into key names. Measured on the migration: claim
 * 2 below met the same seven targets from the shape side, 93 entries across the
 * variants, so the exemption came with them. It is strictly stronger here — the
 * criterion it relaxes is now `target in shape` rather than
 * `knownKeys.includes(target)` — but it is the one exemption #5593 did not get
 * to delete. Its sibling, `VARIANT_LEGAL_GUIDANCE`, genuinely died: that one was
 * excusing a limitation of the transcription, and the shape-backed form let
 * `ui/app.zod.ts` file the prescription only where it can fire.
 */
const PROSE_ALIAS_TARGETS: ReadonlySet<string> = new Set([
  "type: 'object' (with objectName)",
  "type: 'page' (with pageName)",
  "type: 'url' (with url)",
  "type: 'dashboard' (with dashboardName)",
  "type: 'report' (with reportName)",
  "type: 'component' (with componentRef)",
  "type: 'group' (with expanded)",
]);

/** The surface family the prose targets are allowed on, and nowhere else. */
const PROSE_TARGET_SURFACE = /^this `[a-z]+` navigation item$/;

const isProseTarget = (surface: string, target: string): boolean =>
  PROSE_TARGET_SURFACE.test(surface) && PROSE_ALIAS_TARGETS.has(target);

/**
 * Alias rows made UNREACHABLE by a `guidanceSet` in the same strict options
 * table (#7889).
 *
 * `strictUnknownKeyError` (`suggestions.zod.ts`) consults three channels per
 * unrecognized key, in order: exact `guidance`, then `guidanceSets`, and only
 * THEN the `aliases` rename fallback. A `guidanceSets` match `continue`s past
 * the alias lookup entirely — it never runs for that key. So an alias row
 * whose WRITTEN key also matches a guidanceSet declared on the same table is
 * dead on arrival: the set answers first, every time, and the alias entry
 * reads as coverage for a spelling nobody is actually helped with.
 *
 * Not hypothetical: PR #7884 had to place its one view-family alias
 * (`disabled → readonly`, `ui/view.zod.ts`) OUTSIDE `VISIBILITY_KEY_PATTERN`'s
 * reach by hand, because nothing checked it — a `visible: 'visibleWhen'` or
 * `showWhen: 'visibleWhen'` row on the same table would have shipped exactly
 * as dead, with every existing gate green (#7889).
 *
 * The pattern-vs-list asymmetry the checks above already draw — an enumerated
 * `keys: string[]` can be judged against the DECLARED shape, a `keys: RegExp`
 * cannot (`VISIBILITY_KEY_PATTERN` deliberately also matches the canonical
 * `visibleWhen`, which the shape declares and which therefore never reaches
 * either channel) — does not apply here. An alias's written key is a concrete
 * authored string, not a member of the shape, so it can be tested against a
 * pattern set exactly as a real rejected key would be: `keySetMatches` is the
 * same function `strictUnknownKeyError` itself calls.
 *
 * Reads only `options.aliases` and `options.guidanceSets` — never `.shape` —
 * so it composes with (and does not duplicate) the declared-key checks above.
 */
function unreachableAliasRows(surfaces: readonly StrictObjectDeclaration[]): string[] {
  const dead: string[] = [];
  for (const s of surfaces) {
    const sets = s.options.guidanceSets ?? [];
    if (sets.length === 0) continue;
    for (const [written, target] of Object.entries(s.options.aliases ?? {})) {
      const set = sets.find((candidate) => keySetMatches(candidate, written));
      if (set) {
        dead.push(
          `"${s.options.surface}": alias \`${written}\` -> \`${target}\` is unreachable — `
          + `guidanceSet \`${set.name}\` already matches \`${written}\` and consumes it before `
          + 'the alias table is ever consulted (drop the alias row, or fold '
          + `\`${written}\` into \`${set.name}\`'s prescription instead)`,
        );
      }
    }
  }
  return dead;
}

describe('alias integrity — every table is a true claim about its schema', () => {
  it('no alias key is itself a declared key (a dead entry that can never fire)', () => {
    // An alias is consulted only from the `unrecognized_keys` path. A key the
    // shape declares is recognised, so the entry is unreachable — and it reads
    // as coverage for a spelling nobody is actually helped with.
    const dead: string[] = [];
    for (const s of SURFACES) {
      const declared = new Set(Object.keys(s.shape));
      for (const [written, target] of Object.entries(s.options.aliases ?? {})) {
        if (declared.has(written)) dead.push(`${entry(s, written, target)} — \`${written}\` is declared here`);
      }
    }
    expect(dead.sort()).toEqual([]);
  });

  it('every alias target is a key the schema really accepts', () => {
    // Two ways to fail, and the second is invisible to the helper's own guard:
    // `knownKeys` filters tombstones out of the edit-distance candidates, but
    // the alias table is consulted BEFORE that fallback and bypasses the filter
    // entirely. Pointing an alias at a tombstone is ledger finding 12 exactly —
    // the author is told to write the one key guaranteed to be rejected next.
    //
    // `extraKeys` counts as accepted, and the reason is the base/extension
    // boundary rather than leniency: strictness and the error map RIDE
    // `.extend()`, so a module-private base's table is consulted on a shape it
    // does not itself declare (`security/sharing.zod.ts`'s base names `type` /
    // `condition`, which only `CriteriaSharingRuleSchema` declares — and that
    // extension is the only surface anything parses). `extraKeys` is the field
    // `strictObject` provides for exactly that, and the suggester already reads
    // it as a candidate, so refusing it here would forbid a pattern the helper
    // documents. It IS the weaker half of this claim — an author-asserted key
    // rather than a shape-backed one — which is why it is named in the failure
    // text below and kept to the extension case.
    const broken: string[] = [];
    for (const s of SURFACES) {
      const shape = s.shape;
      const extra = new Set(s.options.extraKeys ?? []);
      for (const [written, target] of Object.entries(s.options.aliases ?? {})) {
        // The one sanctioned exception, enumerated above: a nav-item target
        // that is a SENTENCE about the `type`, because the key the author wrote
        // is spelled correctly and only the variant is wrong.
        if (isProseTarget(s.options.surface, target)) continue;
        if (extra.has(target)) continue;
        if (!(target in shape)) {
          broken.push(
            `${entry(s, written, target)} — \`${target}\` is not declared here`
            + ' (declare it, retarget the alias, or — only if the table rides `.extend()`'
            + ' onto a surface that DOES declare it — name it in `extraKeys`)',
          );
        } else if (acceptsNothing(shape[target])) {
          broken.push(`${entry(s, written, target)} — \`${target}\` is a tombstone; it accepts nothing`);
        }
      }
    }
    expect(broken.sort()).toEqual([]);
  });

  it('no two alias keys in one table collapse onto the same probe (#5481)', () => {
    // The table is indexed by `aliasProbe(key)`, so a colliding pair does not
    // produce two entries — it produces one, decided by source order, with the
    // earlier key gone before any author can reach it. Judged with the REAL
    // probe (imported, not transcribed): a gate carrying its own copy of the
    // expression would keep passing if the normalisation ever widened.
    const collisions: string[] = [];
    for (const s of SURFACES) {
      const byProbe = new Map<string, string[]>();
      for (const key of Object.keys(s.options.aliases ?? {})) {
        byProbe.set(aliasProbe(key), [...(byProbe.get(aliasProbe(key)) ?? []), key]);
      }
      for (const [probe, keys] of byProbe) {
        if (keys.length < 2) continue;
        // Name the winner explicitly. When the targets differ this is the whole
        // defect (`grid` lost `gridSize` to `showGrid`); when they agree the
        // entry is merely dead, and the fix is the same — keep one spelling.
        const written = keys.map((k) => `\`${k}\` -> \`${s.options.aliases?.[k]}\``).join(', ');
        collisions.push(
          `${entry(s, keys[0], s.options.aliases?.[keys[0]] ?? '?')} — ${keys.length} keys share the probe \`${probe}\`: ${written}`
          + ` — only \`${s.options.aliases?.[keys[keys.length - 1]]}\` survives`,
        );
      }
    }
    expect(collisions.sort()).toEqual([]);
  });

  it('every prose-target exemption is still load-bearing', () => {
    // An allowlist nobody reaches is the silent pass-through this exemption was
    // written to avoid, one release later. If a nav variant is reworded or
    // retired, the stale entries surface here instead of quietly widening what
    // the target criterion above will forgive.
    const used = new Set<string>();
    for (const s of SURFACES) {
      if (!PROSE_TARGET_SURFACE.test(s.options.surface)) continue;
      for (const target of Object.values(s.options.aliases ?? {})) {
        if (PROSE_ALIAS_TARGETS.has(target)) used.add(target);
      }
    }
    expect([...PROSE_ALIAS_TARGETS].filter((x) => !used.has(x)).sort()).toEqual([]);
  });

  it('no guidance SET member is itself a declared key, and no two entries claim one key (#6619)', () => {
    // The set-keyed guidance form arrived with #6619's fold of the three
    // hand-written `$ZodErrorMap`s — maps that, being hand-rolled, no registry
    // saw and nothing judged (#6416's blind spot). Folding them in is only
    // worth it if the sets are held to the same claims the exact channel is:
    //
    // - an enumerated member the shape DECLARES is dead — a declared key never
    //   reaches the `unrecognized_keys` path (tombstones included: writing one
    //   raises `invalid_type` from its `z.never()`, not `unrecognized_keys`);
    // - a member also filed under exact `guidance` is unreachable for that key
    //   (the exact entry always wins — pinned in `strict-object.test.ts`), so
    //   the overlap is at best dead weight and at worst a wrong claim;
    // - two enumerated sets sharing a member means declaration order decides
    //   which prescription the author sees. The precedence is pinned, but no
    //   in-repo table gets to DEPEND on a tie-break being read correctly.
    const broken: string[] = [];
    for (const s of SURFACES) {
      const declared = new Set(Object.keys(s.shape));
      const exact = new Set(Object.keys(s.options.guidance ?? {}));
      const seen = new Map<string, string>();
      for (const set of s.options.guidanceSets ?? []) {
        if (set.keys instanceof RegExp) continue; // judged in the pattern test below
        for (const member of set.keys) {
          if (declared.has(member)) {
            broken.push(`"${s.options.surface}": set \`${set.name}\` lists \`${member}\`, which is declared here`);
          }
          if (exact.has(member)) {
            broken.push(`"${s.options.surface}": set \`${set.name}\` lists \`${member}\`, which exact guidance already answers`);
          }
          const prior = seen.get(member);
          if (prior && prior !== set.name) {
            broken.push(`"${s.options.surface}": \`${member}\` is claimed by both \`${prior}\` and \`${set.name}\``);
          }
          seen.set(member, set.name);
        }
      }
    }
    expect(broken.sort()).toEqual([]);
  });

  it('every pattern-keyed set carries examples that really match it and are really rejected (#6619)', () => {
    // A pattern is an OPEN family, so the dead-entry question cannot be asked
    // of its membership the way it is of a list — the visibility pattern
    // deliberately also matches the canonical `visibleWhen`, which the shape
    // declares and which therefore never arrives at the map. What CAN be
    // asked, and is: the spellings the pattern was written for really match it
    // (a pattern typo fails here), and none of them is a key the shape
    // declares (a pattern fully shadowed by the shape is a phantom check).
    const broken: string[] = [];
    for (const s of SURFACES) {
      for (const set of s.options.guidanceSets ?? []) {
        if (!(set.keys instanceof RegExp)) continue;
        const examples = set.examples ?? [];
        if (examples.length === 0) {
          broken.push(`"${s.options.surface}": pattern set \`${set.name}\` carries no examples — nothing anchors what it is for`);
          continue;
        }
        const declared = new Set(Object.keys(s.shape));
        for (const example of examples) {
          if (!keySetMatches(set, example)) {
            broken.push(`"${s.options.surface}": \`${set.name}\` example \`${example}\` does not match its own pattern`);
          }
          if (declared.has(example)) {
            broken.push(`"${s.options.surface}": \`${set.name}\` example \`${example}\` is a declared key — it can never reach the map`);
          }
        }
      }
    }
    expect(broken.sort()).toEqual([]);
  });

  it('no alias row is dead on arrival because a guidanceSet in the same table already consumes it (#7889)', () => {
    // The live-table verdict. If this ever turns red on a real schema, the fix
    // is at the authoring site (drop the row, or fold the key into the set's
    // prescription) — never here, and never a change to the predicate that
    // makes the row stop being found.
    expect(unreachableAliasRows(SURFACES).sort()).toEqual([]);

    // The acceptance shape's second half: the one existing view-family alias
    // row (`disabled -> readonly` on `FormFieldSchema`, `ui/view.zod.ts:1775`)
    // is confirmed to exist and to sit on `VISIBILITY_STRICT_OPTIONS`'s
    // `VISIBILITY_KEY_PATTERN` table — so the assertion above is judging the
    // real, live, non-trivial case (a table that DOES carry a pattern-matching
    // guidanceSet), not an empty one that would pass vacuously.
    const visibilityTablesWithThisAlias = SURFACES.filter(
      (s) =>
        s.options.aliases?.disabled === 'readonly'
        && (s.options.guidanceSets ?? []).some((set) => set.name === 'VISIBILITY_KEY_PATTERN'),
    );
    expect(
      visibilityTablesWithThisAlias.length,
      'the FormFieldSchema `disabled -> readonly` row should exist and carry VISIBILITY_KEY_PATTERN',
    ).toBeGreaterThan(0);
  });

  it('the guidanceSet-reachability check can actually go red — a planted dead row, no live schema touched (#7889)', () => {
    // Self-test, per the triage ruling: prove the gate can fail before trusting
    // that it passing on the live table means anything. Entirely synthetic —
    // `unreachableAliasRows` only reads `options.aliases` / `options.guidanceSets`,
    // so `shape` is never inspected and can be an empty stand-in.
    const emptyShape = {} as StrictObjectDeclaration['shape'];

    const planted: StrictObjectDeclaration[] = [{
      options: {
        surface: 'synthetic reachability probe',
        history: 'n/a — planted for #7889 self-test',
        aliases: { visibleIf: 'visibleWhen' },
        guidanceSets: [{
          name: 'SYNTHETIC_VIS_PATTERN',
          keys: /vis/i,
          examples: ['visibleIf'],
          prescription: 'n/a',
        }],
      },
      shape: emptyShape,
    }];
    const dead = unreachableAliasRows(planted);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toContain('visibleIf');
    expect(dead[0]).toContain('SYNTHETIC_VIS_PATTERN');

    // Control: the identical alias row with NO guidanceSet on the table is
    // reachable — proves the planted row above went red because of the
    // pattern match, not because of anything else about the shape.
    const reachable: StrictObjectDeclaration[] = [{
      options: {
        surface: 'synthetic reachability probe (no set)',
        history: 'n/a — planted for #7889 self-test',
        aliases: { visibleIf: 'visibleWhen' },
      },
      shape: emptyShape,
    }];
    expect(unreachableAliasRows(reachable)).toEqual([]);

    // Second control: a guidanceSet present but NOT matching the alias key —
    // proves the row is judged by an actual pattern match, not merely by the
    // presence of a guidanceSets array on the table.
    const nonMatching: StrictObjectDeclaration[] = [{
      options: {
        surface: 'synthetic reachability probe (non-matching set)',
        history: 'n/a — planted for #7889 self-test',
        aliases: { disabled: 'readonly' },
        guidanceSets: [{
          name: 'SYNTHETIC_VIS_PATTERN',
          keys: /vis/i,
          examples: ['visibleIf'],
          prescription: 'n/a',
        }],
      },
      shape: emptyShape,
    }];
    expect(unreachableAliasRows(nonMatching)).toEqual([]);
  });

  it('the three #6416 hand-written maps are FOLDED and judged here — the blind spot stays closed (#6619)', () => {
    // The reason #6619 existed: `strictVisibilityError`,
    // `strictWidgetAnalyticsError` and `strictTenancyError` were hand-rolled
    // `$ZodErrorMap`s, so their alias pointers and prescriptions registered in
    // NO registry — unmeasured rather than clean. This assertion is the
    // closure itself: the three surfaces are declarations this file walks, and
    // their prescriptions ride channels every test above judges. Reverting any
    // of them to a hand-written map fails HERE, loudly, instead of quietly
    // re-opening the blind spot.
    const bySurface = new Map(SURFACES.map((s) => [s.options.surface, s]));

    const visibility = [...SURFACES].filter((s) => s.options.surface === 'this view/page schema');
    // Three call sites share the options: FormFieldBase (via strictObjectError),
    // FormSection, PageComponent — distinct shapes, so distinct declarations.
    expect(visibility.length).toBeGreaterThanOrEqual(3);
    for (const v of visibility) {
      expect(v.options.guidanceSets?.map((g) => g.name)).toContain('VISIBILITY_KEY_PATTERN');
    }

    const widget = bySurface.get('this dashboard widget');
    expect(widget, 'DashboardWidgetSchema no longer declares through strictObject').toBeDefined();
    expect(widget!.options.guidanceSets?.map((g) => g.name)).toEqual([
      'LEGACY_WIDGET_ANALYTICS_KEYS',
      'QUARANTINED_WIDGET_KEYS',
      'WIDGET_DRILL_NEAR_KEYS',
    ]);

    const tenancy = bySurface.get('`tenancy`');
    expect(tenancy, 'TenancyConfigSchema no longer declares through strictObject').toBeDefined();
    expect(Object.keys(tenancy!.options.guidance ?? {}).sort()).toEqual(['crossTenantAccess', 'strategy']);
  });

  it('the two maps #6619 MISSED are folded and judged here too (#6805)', () => {
    // #6619's inventory was two short, and both survivors were the same shape
    // as the three above — `unrecognized_keys` prescription tables attached to
    // a `.strict()` object through `{ error: … }`, seen by no registry. The
    // one that mattered is `strictToolError`: it carried
    // `TOOL_RETIRED_KEY_GUIDANCE`, a hand-maintained PER-KEY retirement table,
    // which is the most rot-prone content this audit exists for (the #6756 /
    // #6758 sweep found live prescriptions pointing at keys that no longer
    // exist, in tables nothing was judging either).
    //
    // Recorded as its own case rather than folded into the one above, so the
    // two closures stay separately readable: #6619 closed the instances #6416
    // NAMED, #6805 closed the two it missed, and the class pin below closes the
    // shape so there is no third round.
    const bySurface = new Map(SURFACES.map((s) => [s.options.surface, s]));

    const tool = bySurface.get('the tool definition');
    expect(tool, 'ToolSchema no longer declares through strictObject').toBeDefined();
    expect(Object.keys(tool!.options.guidance ?? {}).sort()).toEqual([
      'active', 'builtIn', 'category', 'permissions', 'requiresConfirmation',
    ]);

    const capabilities = bySurface.get('`enable`');
    expect(capabilities, 'ObjectCapabilities no longer declares through strictObject').toBeDefined();
    expect(Object.keys(capabilities!.options.guidance ?? {}).sort()).toEqual(['mru', 'trash']);
  });

  it('NO module outside the shared helpers writes its own `unrecognized_keys` map (#6805)', () => {
    // The class, not the instances. Both closure pins above name surfaces, so
    // each only holds the line it was written for — #6416 named three, and the
    // inventory that produced the number was two short. A pin over the SHAPE
    // cannot be two short: any new hand-rolled unknown-key map fails here on
    // arrival, whatever it is called and whatever surface it closes.
    //
    // ⚠️ Scoped to `unrecognized_keys` DELIBERATELY, and this is the whole
    // discrimination. `data/field.zod.ts`'s `uniqueScopeError` is a
    // `$ZodErrorMap` too and is NOT in this class: it branches on
    // `invalid_union`, a VALUE-level verdict, which `strictObject`'s guidance
    // channel does not address and could not absorb. A blanket "no error maps
    // outside the helpers" rule would have to carry an exemption for it, and an
    // exemption is exactly the seam an inventory drifts through. Judged by the
    // `issue.code` the map decides on, never by its name.
    //
    // Adjacent to #6635 (a general "a retirement updated some mentions and not
    // others" gate) and deliberately not it: that one compares PROSE mentions
    // of a retired symbol against each other and catches a table whose
    // prescriptions have gone stale; this one is structural and catches a
    // guidance channel that never entered a registry. Neither subsumes the
    // other — after this fold, `TOOL_RETIRED_KEY_GUIDANCE` is visible to the
    // audit and could still name a key that no longer exists, which is #6635's
    // to find and this pin is silent about.
    // ⚠️ Scanned over EVERY module, `HELPER_MODULES` included — deliberately no
    // exemption. The direct-call ratchet above needs one because
    // `strictUnknownKeyError`'s own definition is a call site of itself; this
    // criterion needs none, because the helper does not hand a shape a
    // hand-written map either: `strict-object.ts`'s one
    // `z.object(shape, { error: … })` passes a CALL to the shared factory, and
    // a call is exactly what "not hand-written" looks like. Measured, not
    // assumed — an exemption that excuses nothing reads as coverage for a case
    // nobody checked, which is the failure mode of the inventory this pin
    // replaces.
    const offenders = MODULES
      .flatMap((f) => handwrittenMapSites(f)
        .map((s) => `${path.relative(SPEC_SRC, f)}:${s.line} — \`${s.name}\``));

    expect(
      offenders.sort(),
      'build the shape with `strictObject(options, shape)` and put the prescriptions in '
      + '`guidance` / `guidanceSets` — a hand-rolled map registers in no registry, so its '
      + 'aliases and prescriptions are unmeasured rather than clean (#6416/#6619/#6805)',
    ).toEqual([]);
  });

  it('…and that scan is alive: the pre-fold shape is found, prose and the two out-of-class maps are not (#6805)', () => {
    // Anti-vacuity for the verdict above, which asserts that a search came back
    // EMPTY — the shape that passes just as well when the instrument is dead.
    // Four controls, each closing a different way it could be.
    //
    // Note what is NOT a control here: "the helper modules light up". Under an
    // earlier, coarser criterion (the bare `'unrecognized_keys'` literal) they
    // did, and that reading was the reason the first draft also flagged
    // `objectStackErrorMap`. The tightened criterion asks whether a shape was
    // handed a hand-written map, which the helper never does — so the honest
    // liveness evidence is (a) below, a fresh file the scan has never seen.
    //
    // (a) it recognises the class in a file it has never seen. The specimen is
    //     `strictToolError` and its wiring as they stood on `main` immediately
    //     before this PR folded them, so what is pinned is the real thing
    //     rather than a stylised stand-in — this is the exact source the
    //     verdict must never let back in.
    const specimen = `
      const strictToolError: z.core.$ZodErrorMap = (issue) => {
        if (issue.code !== 'unrecognized_keys') return undefined;
        const keys = (issue as { keys?: readonly string[] }).keys ?? [];
        return \`Unrecognized key(s): \${keys.join(', ')}.\`;
      };
      export const ToolSchema = z.object({
        name: z.string(),
      }, { error: strictToolError }).strict();
    `;
    expect(scanSource('specimen.ts', specimen)).toEqual([{ line: 9, name: 'strictToolError' }]);

    // (b) it is not a grep. This package's docblocks discuss
    //     `unrecognized_keys` by name constantly — including the pin above —
    //     and prose is not a map. A text scan would flag every one of them, and
    //     the verdict would have needed an allowlist, which is the maintenance
    //     shape this pin exists to avoid.
    const prose = `
      /** The alias table is consulted from the unrecognized_keys path only. */
      // A guidance entry answers an 'unrecognized_keys' issue.
      export const NOT_A_MAP = 1;
    `;
    expect(scanSource('prose.ts', prose)).toEqual([]);

    // (c) the ATTACHMENT conjunct earns its place. `objectStackErrorMap`
    //     decides `unrecognized_keys` and is deliberately out of class: it is a
    //     per-parse map a caller passes to `safeParse`, with one generic "check
    //     for typos" sentence and no per-key content, so there is no table for
    //     a registry to judge. The first draft of this scan — literal presence
    //     alone — flagged it and its neighbour `carriesUnknownKey` (a reader,
    //     not a map). Recorded as a MEASURED negative rather than an exemption:
    //     if that file ever does attach a per-schema map, this control does not
    //     protect it.
    const errorMap = path.join(SPEC_SRC, 'shared/error-map.zod.ts');
    const errorMapSource = fs.readFileSync(errorMap, 'utf8');
    expect(errorMapSource, 'objectStackErrorMap no longer decides unknown keys — re-point this control')
      .toContain("issue.code === 'unrecognized_keys'");
    expect(handwrittenMapSites(errorMap)).toEqual([]);

    // (d) the CODE conjunct earns its place, on the live specimen #6805's card
    //     named as out of class. `uniqueScopeError` is attached exactly the way
    //     the class is — `z.union([…], { error: uniqueScopeError })` — so the
    //     scan reaches it and declines it on `issue.code` alone. That is the
    //     discrimination made by the instrument rather than by an exemption,
    //     which is what keeps "do not sweep it in" from decaying into a name.
    const field = path.join(SPEC_SRC, 'data/field.zod.ts');
    const fieldSource = fs.readFileSync(field, 'utf8');
    expect(fieldSource, 'uniqueScopeError is no longer attached — re-point this control')
      .toContain('error: uniqueScopeError,');
    expect(fieldSource, 'uniqueScopeError no longer branches on invalid_union — re-read the class')
      .toContain("issue.code !== 'invalid_union'");
    expect(handwrittenMapSites(field)).toEqual([]);
  });

  it('no guidance key is itself a declared key (the same dead entry, other channel)', () => {
    // `guidance` is consulted from the same `unrecognized_keys` path, so a
    // prescription filed under a key the shape DECLARES is unreachable in
    // exactly the way a dead alias is. Measured clean when this gate was
    // written — asserted so it stays that way, since a guidance entry is the
    // instrument a retirement leans on and a silent one loses the upgrade text.
    const dead: string[] = [];
    for (const s of SURFACES) {
      const declared = new Set(Object.keys(s.shape));
      for (const written of Object.keys(s.options.guidance ?? {})) {
        if (declared.has(written)) {
          dead.push(`"${s.options.surface}": guidance for \`${written}\`, which is declared here`);
        }
      }
    }
    expect(dead.sort()).toEqual([]);
  });
});
