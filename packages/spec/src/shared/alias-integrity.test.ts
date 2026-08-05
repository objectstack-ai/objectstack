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
 * ## What it deliberately does not judge
 *
 * - Tables reaching `strictUnknownKeyError` directly, which carry a transcribed
 *   `knownKeys` array instead of a shape — measured clean, pinned shrink-only
 *   below, extension tracked as #5483.
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
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect, beforeAll } from 'vitest';
import ts from 'typescript';

import { aliasProbe } from './alias-probe';
import { acceptsNothing, strictObjectDeclarations, type StrictObjectDeclaration } from './strict-object';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_SRC = path.resolve(HERE, '..');

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
 * Touch every node in the zod graph under `root`.
 *
 * `strictObject` records a declaration when it RUNS, and `lazySchema` defers
 * that until first use — so a schema nobody touches never registers. This walk
 * is what makes "nobody touched it" impossible: reading `_zod.def` resolves the
 * lazy proxy, and descending the graph reaches nested shapes that only build
 * when their parent does.
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
    if ((def as { type?: string }).type === 'object') void (node as { shape?: unknown }).shape;

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

function callSites(file: string): CallSite[] {
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
      && node.expression.text === 'strictObject'
      && node.arguments.length === 2
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

const CALL_SITES = MODULES.flatMap(callSites);

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

  it('the surface this gate does NOT cover only ever shrinks', () => {
    // `strictObject` is not the only way to get an alias table: the pre-helper
    // wiring calls `strictUnknownKeyError` directly with a hand-transcribed
    // `knownKeys` array, and those tables never reach the registry this gate
    // reads. Measured at 44 call sites when the gate was written, and measured
    // CLEAN on both criteria at the same time — so this is a coverage boundary,
    // not hidden debt. It is pinned shrink-only rather than left implicit
    // because an uncovered table that nobody can see growing is precisely the
    // "green check over source nothing read" failure the campaign keeps paying
    // for: migrating one to `strictObject` is free, adding a NEW one fails here
    // and forces the choice to be deliberate. Extending the judgement over them
    // is #5483 — they carry a transcribed key list rather than a shape, so it
    // is a different measurement, not more of this one.
    const uncovered = MODULES.filter((f) => {
      const rel = path.relative(SPEC_SRC, f);
      return rel !== 'shared/suggestions.zod.ts' && rel !== 'shared/strict-object.ts';
    }).flatMap((f) => {
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
