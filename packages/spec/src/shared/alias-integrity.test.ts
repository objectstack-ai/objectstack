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
 *    something other than a literal — `data/field.zod.ts`, `ui/theme.zod.ts`,
 *    `automation/etl.zod.ts` and others. The AST reads those as empty and
 *    reports them clean.
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
 * ## The second batch: tables that never had a shape (#5483)
 *
 * `strictObject` is not the only way to get an alias table. The 44 call sites
 * that predate the helper call `strictUnknownKeyError` directly and hand it a
 * **hand-transcribed `knownKeys` array**, so there is no `.shape` to judge them
 * against and no `strictObject` construction to register them. They were
 * outside all three claims above.
 *
 * They are judged now, from a second registry the factory itself fills
 * (`alias-table-registry.ts`) — no call site was touched, which is what keeps
 * the migration in #5593 a separable change rather than one this guard has
 * already half-done. What that buys differs sharply by claim:
 *
 * - claims 1 and 2 are answered against the **transcription**. If the array has
 *   drifted from the schema it describes, both answers inherit the drift. That
 *   gap is exactly what `strictObject` abolishes and only migration closes.
 * - claim 3 loses **nothing**: an `aliasProbe` collision is a property of the
 *   table alone. These 44 were not "measured clean" on it — #5481 postdates the
 *   measurement recorded in #5483, so they were *unmeasured*. Now they are
 *   measured, and the sweep comes back clean at 52 tables.
 *
 * Claim 2 did not come back clean, and the finding is filed rather than fixed
 * here: `ui/app.zod.ts` shares four "start expanded" aliases across all nine
 * navigation-item variants while `expanded` is declared on `group` alone, so on
 * the other eight the suggestion names a key that variant also rejects (#5555).
 * Pinned shrink-only below, structurally, because the fix rewrites author-facing
 * message text in a call site this transitional guard may not touch.
 *
 * The shrink-only ratchet also survives unchanged, because what it discourages
 * — a NEW direct call site, carrying a fresh second copy of a key list — is
 * exactly as undesirable as it was before these tables gained a guard.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect, beforeAll } from 'vitest';
import ts from 'typescript';

import { aliasProbe } from './alias-probe';
import {
  directAliasTableOverflow,
  directAliasTables,
  type DirectAliasTableDeclaration,
} from './alias-table-registry';
import { acceptsNothing, strictObjectDeclarations, type StrictObjectDeclaration } from './strict-object';

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

/** The same, for tables that reached `strictUnknownKeyError` directly (#5483). */
let DIRECT: DirectAliasTableDeclaration[] = [];

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
  const unique = new Map<string, StrictObjectDeclaration>();
  for (const d of strictObjectDeclarations()) {
    unique.set(
      JSON.stringify([d.options.surface, d.options.aliases ?? {}, Object.keys(d.shape).sort()]),
      d,
    );
  }
  SURFACES = [...unique.values()];

  // Same collapse for the direct batch, and for the same reason: the nav-item
  // factory in `ui/app.zod.ts` is ONE call site that runs nine times (once per
  // `type` variant), and each variant is a genuinely different table — same
  // surface template, different `knownKeys`, different cross-variant aliases —
  // so the key has to include the key list, not just the surface and aliases.
  const uniqueDirect = new Map<string, DirectAliasTableDeclaration>();
  for (const d of directAliasTables()) {
    uniqueDirect.set(
      JSON.stringify([
        d.options.surface,
        d.options.aliases ?? {},
        d.options.guidance ? Object.keys(d.options.guidance).sort() : [],
        [...d.options.knownKeys].sort(),
      ]),
      d,
    );
  }
  DIRECT = [...uniqueDirect.values()];
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
 * The two helper spellings, and where each keeps its options literal.
 * `strictObject(options, shape)` vs `strictUnknownKeyError(options)`.
 */
const CALLEES = {
  strictObject: 2,
  strictUnknownKeyError: 1,
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
 * The pre-helper wiring's call sites (#5483) — the helper modules excluded, so
 * `strictObject`'s own internal call is not mistaken for one of them.
 */
const DIRECT_CALL_SITES = MODULES
  .filter((f) => !HELPER_MODULES.has(path.relative(SPEC_SRC, f)))
  .flatMap((f) => callSites(f, 'strictUnknownKeyError'));

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

  it('the surface this gate can only judge by transcription only ever shrinks', () => {
    // `strictObject` is not the only way to get an alias table: the pre-helper
    // wiring calls `strictUnknownKeyError` directly with a hand-transcribed
    // `knownKeys` array. Since #5483 those tables ARE judged — the factory
    // registers them and the block below reads them — so this number is no
    // longer a measure of what nothing watches. It measures what is watched
    // with the WEAKER instrument: three claims, two of them answered against
    // the transcription rather than the shape, so a drifted array drags both
    // answers with it and this file cannot tell.
    //
    // Which leaves the ratchet meaning exactly what it always meant. Migrating
    // one call site to `strictObject` is free and moves it to the shape-backed
    // half; adding a NEW one mints a fresh second copy of a key list and fails
    // here, forcing the choice to be deliberate. The batched migration that
    // takes this to 0 is #5593.
    const uncovered = MODULES.filter((f) => !HELPER_MODULES.has(path.relative(SPEC_SRC, f))).flatMap((f) => {
      const source = fs.readFileSync(f, 'utf8');
      return [...source.matchAll(/\bstrictUnknownKeyError\s*\(/g)].map(() => path.relative(SPEC_SRC, f));
    });
    expect(uncovered.length).toBeLessThanOrEqual(44);
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
    const broken: string[] = [];
    for (const s of SURFACES) {
      const shape = s.shape;
      for (const [written, target] of Object.entries(s.options.aliases ?? {})) {
        if (!(target in shape)) {
          broken.push(`${entry(s, written, target)} — \`${target}\` is not declared here`);
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

// ---------------------------------------------------------------------------
// 3. The same claims over the tables that never had a shape (#5483)
// ---------------------------------------------------------------------------

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
 */
const PROSE_ALIAS_TARGETS: ReadonlySet<string> = new Set([
  "type: 'object' (with objectName)",
  "type: 'page' (with pageName)",
  "type: 'url' (with url)",
  "type: 'dashboard' (with dashboardName)",
  "type: 'report' (with reportName)",
  "type: 'component' (with componentRef)",
]);

/** The surface family the prose targets are allowed on, and nowhere else. */
const PROSE_TARGET_SURFACE = /^this `[a-z]+` navigation item$/;

const isProseTarget = (surface: string, target: string): boolean =>
  PROSE_TARGET_SURFACE.test(surface) && PROSE_ALIAS_TARGETS.has(target);

/**
 * A **defect this gate found**, pinned shrink-only rather than exempted: the
 * four spellings of "start expanded" that `NAV_ITEM_ALIASES` redirects to
 * `expanded` (#5555).
 *
 * `expanded` is declared on the `group` variant alone, but the shared alias
 * table is stamped into all nine, so on the other eight the redirect names a
 * key that variant also rejects — ledger finding 7's second rejection, from the
 * campaign built to end it. The mechanism is visible in the file: the six
 * CROSS-VARIANT payload keys immediately below get prose targets
 * (`type: 'object' (with objectName)`) precisely because a bare key name would
 * mislead; these four are cross-variant too, and were written in the shared
 * table where that was not apparent.
 *
 * Distinguished from {@link PROSE_ALIAS_TARGETS} on purpose. That list says
 * "this is right"; this one says "this is wrong, it is 32 occurrences of one
 * mistake, and the fix belongs to the schema rather than the gate" — the fix
 * rewrites author-facing message text in `ui/app.zod.ts`, which #5483's
 * transitional guard is explicitly not allowed to touch.
 *
 * Structural rather than a list of 32 strings, so the tolerance cannot widen by
 * accident: only this alias key, only this target, only this surface family.
 * The count below is the ratchet.
 */
const EXPANDED_CROSS_VARIANT_KEYS: ReadonlySet<string> = new Set([
  'defaultopen', 'open', 'collapsed', 'isopen',
]);

const isPinnedExpandedDefect = (surface: string, written: string, target: string): boolean =>
  PROSE_TARGET_SURFACE.test(surface)
  && target === 'expanded'
  && EXPANDED_CROSS_VARIANT_KEYS.has(written);

/**
 * Guidance filed once for a table stamped nine times, legal on two of them.
 *
 * `children` really is declared on the `object` and `group` nav variants, so
 * the prescription "`children` is only meaningful on a `group` item…" correctly
 * never fires there — it is written for the other seven, where it does. That is
 * a criterion meeting a variant family, not a dead entry: the shape-backed half
 * of this gate judges one authored table against one shape, and here one
 * authored table is stamped against nine.
 *
 * Exempted rather than pinned as debt because there is nothing to fix — no
 * author is misinformed and no prescription is lost. Enumerated by
 * `(surface, key)` so it cannot cover a second guidance entry that IS dead.
 */
const VARIANT_LEGAL_GUIDANCE: ReadonlySet<string> = new Set([
  'this `object` navigation item::children',
  'this `group` navigation item::children',
]);

/** `file:line — "surface": \`written\` -> \`target\``, for the direct batch. */
const directEntry = (d: DirectAliasTableDeclaration, written: string, target: string): string => {
  const site = DIRECT_CALL_SITES.find(
    (c) => c.surface === d.options.surface
      && Object.entries(c.aliases).every(([k, v]) => d.options.aliases?.[k] === v),
  );
  const where = site ? `${site.file}:${site.line}` : '(location unresolved)';
  return `${where} — "${d.options.surface}": \`${written}\` -> \`${target}\``;
};

describe('alias integrity — direct `strictUnknownKeyError` tables (#5483)', () => {
  it('the direct call sites really registered (self-test before the verdict)', () => {
    // Same guard as the shape-backed half: state the scale before the verdict,
    // so a registration that silently stopped working reads as a failure and
    // not as forty-four clean tables.
    expect(DIRECT_CALL_SITES.length).toBeGreaterThanOrEqual(40);
    // One call site (the nav-item factory) runs nine times, so the registry is
    // legitimately LARGER than the source count. It can never be smaller
    // without a table having gone unjudged.
    expect(DIRECT.length).toBeGreaterThanOrEqual(DIRECT_CALL_SITES.length);
    expect(DIRECT.some((d) => Object.keys(d.options.aliases ?? {}).length > 0)).toBe(true);
    // The registry is capped (it is filled by a PUBLISHED factory — see
    // `alias-table-registry.ts`). Overflow would mean judging a prefix.
    expect(directAliasTableOverflow(), 'the direct registry overflowed; raise CAPACITY').toBe(0);
  });

  it('every direct call site with an alias table was reached at runtime', () => {
    const bySurface = new Map<string, DirectAliasTableDeclaration[]>();
    for (const d of DIRECT) {
      const list = bySurface.get(d.options.surface) ?? [];
      list.push(d);
      bySurface.set(d.options.surface, list);
    }
    const unreached: string[] = [];
    for (const site of DIRECT_CALL_SITES) {
      if (!site.hasAliases) continue;
      const candidates = site.surface ? (bySurface.get(site.surface) ?? []) : DIRECT;
      const matched = candidates.some((d) =>
        Object.entries(site.aliases).every(([k, v]) => d.options.aliases?.[k] === v));
      if (!matched) unreached.push(`${site.file}:${site.line} (${site.surface ?? 'assembled surface'})`);
    }
    expect(unreached, 'these alias tables never reached the registry, so nothing judges them').toEqual([]);
  });

  it('the deferred error maps were forced too', () => {
    // `data/object.zod.ts` builds its map on FIRST USE, to step around a
    // temporal dead zone. Nothing in this file parses anything, so without the
    // synthetic-issue poke in `force()` that table never registers.
    //
    // Measured, not assumed: deleting the poke turns this red AND the coverage
    // check above (that site's `surface` and alias entries are both literals,
    // so the AST can see it and report it unreached). Two failures for one
    // cause — so this assertion is not what makes the poke's absence *visible*,
    // it is what makes it legible. "`this object` is missing" names the
    // mechanism; "some site at object.zod.ts:962 is unreached" sends the next
    // reader looking for a walk bug that is not there.
    expect(
      DIRECT.map((d) => d.options.surface),
      "`data/object.zod.ts`'s deferred map did not register — did the forcing poke stop working?",
    ).toContain('this object');
  });

  it('the nav-item factory registered one table per variant', () => {
    // The one direct site the AST reads as an empty assembled table: both its
    // surface (a template) and its aliases (spreads) are computed. Nine
    // variants in, nine tables out — the count is the coverage.
    const navTables = DIRECT.filter((d) => PROSE_TARGET_SURFACE.test(d.options.surface));
    expect(navTables.length).toBe(9);
  });

  it('no alias key is itself a known key (a dead entry that can never fire)', () => {
    // Claim 1, answered against the transcribed `knownKeys` rather than a
    // shape. Weaker — a key list that has drifted from its schema drags the
    // answer with it — but it is the list the SUGGESTER reads, so a hit here is
    // a real dead entry either way.
    const dead: string[] = [];
    for (const d of DIRECT) {
      const known = new Set(d.options.knownKeys);
      for (const [written, target] of Object.entries(d.options.aliases ?? {})) {
        if (known.has(written)) {
          dead.push(`${directEntry(d, written, target)} — \`${written}\` is a known key here`);
        }
      }
    }
    expect(dead.sort()).toEqual([]);
  });

  it('every alias target is a key the table claims to accept', () => {
    // Claim 2. The tombstone half of the shape-backed version has no analogue
    // here: `knownKeys` is a flat array with no schemas in it, so "this target
    // is declared but accepts nothing" is invisible until the call site
    // migrates (#5593).
    const broken: string[] = [];
    const pinned: string[] = [];
    for (const d of DIRECT) {
      const known = new Set(d.options.knownKeys);
      for (const [written, target] of Object.entries(d.options.aliases ?? {})) {
        if (known.has(target) || isProseTarget(d.options.surface, target)) continue;
        const report = `${directEntry(d, written, target)} — \`${target}\` is not a known key here`;
        if (isPinnedExpandedDefect(d.options.surface, written, target)) pinned.push(report);
        else broken.push(report);
      }
    }
    expect(broken.sort()).toEqual([]);
    // The known defect, ratcheted (#5555). Shrink-only: fixing a variant drops
    // the number, and nothing else can raise it — `isPinnedExpandedDefect` is
    // structural, so a new broken target anywhere (including a fifth spelling
    // of "expanded" on this very family) lands in `broken` above instead.
    expect(pinned.length, 'the pinned #5555 tolerance grew; it may only shrink').toBeLessThanOrEqual(32);
  });

  it('every prose-target exemption is still load-bearing', () => {
    // An allowlist nobody reaches is the silent pass-through this exemption was
    // written to avoid, one release later. If a nav variant is reworded, or the
    // family migrates to `strictObject`, the stale entries surface here instead
    // of quietly widening what claim 2 will forgive.
    const used = new Set<string>();
    for (const d of DIRECT) {
      if (!PROSE_TARGET_SURFACE.test(d.options.surface)) continue;
      for (const target of Object.values(d.options.aliases ?? {})) {
        if (PROSE_ALIAS_TARGETS.has(target)) used.add(target);
      }
    }
    expect([...PROSE_ALIAS_TARGETS].filter((t) => !used.has(t)).sort()).toEqual([]);
  });

  it('no two alias keys in one table collapse onto the same probe (#5481)', () => {
    // Claim 3, and the only one that loses NOTHING for lack of a shape: the
    // probe reads the alias table alone. This dimension was never measured on
    // these 44 tables — #5481 postdates #5483's "measured clean" note, which
    // covered the other two claims — so this assertion is the measurement, not
    // a re-statement of one.
    const collisions: string[] = [];
    for (const d of DIRECT) {
      const byProbe = new Map<string, string[]>();
      for (const key of Object.keys(d.options.aliases ?? {})) {
        byProbe.set(aliasProbe(key), [...(byProbe.get(aliasProbe(key)) ?? []), key]);
      }
      for (const [probe, keys] of byProbe) {
        if (keys.length < 2) continue;
        const written = keys.map((k) => `\`${k}\` -> \`${d.options.aliases?.[k]}\``).join(', ');
        collisions.push(
          `${directEntry(d, keys[0], d.options.aliases?.[keys[0]] ?? '?')} — ${keys.length} keys share the probe \`${probe}\`: ${written}`
          + ` — only \`${d.options.aliases?.[keys[keys.length - 1]]}\` survives`,
        );
      }
    }
    expect(collisions.sort()).toEqual([]);
  });

  it('no guidance key is itself a known key (the same dead entry, other channel)', () => {
    const dead: string[] = [];
    for (const d of DIRECT) {
      const known = new Set(d.options.knownKeys);
      for (const written of Object.keys(d.options.guidance ?? {})) {
        if (!known.has(written)) continue;
        if (VARIANT_LEGAL_GUIDANCE.has(`${d.options.surface}::${written}`)) continue;
        dead.push(`"${d.options.surface}": guidance for \`${written}\`, which is a known key here`);
      }
    }
    expect(dead.sort()).toEqual([]);
  });

  it('every variant-legal guidance exemption is still load-bearing', () => {
    // Same staleness rule the prose targets get: an exemption nobody reaches is
    // deleted, not left widening what the criterion above forgives.
    const reached = new Set<string>();
    for (const d of DIRECT) {
      const known = new Set(d.options.knownKeys);
      for (const written of Object.keys(d.options.guidance ?? {})) {
        if (known.has(written)) reached.add(`${d.options.surface}::${written}`);
      }
    }
    expect([...VARIANT_LEGAL_GUIDANCE].filter((e) => !reached.has(e)).sort()).toEqual([]);
  });
});
