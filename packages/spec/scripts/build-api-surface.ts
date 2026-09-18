// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-api-surface.ts — snapshot the PUBLIC API of @objectstack/spec.
 *
 * For a metadata-driven platform the spec package IS the third-party API. A
 * silently removed/renamed export, or a narrowed authoring signature, breaks
 * every consumer pinned to a published release the moment they upgrade (the
 * #2023 class) — and no in-repo consumer catches it, because they all co-evolve
 * with the spec in the same commit. See ADR-0059.
 *
 * One committed artifact, checked in CI:
 *   - api-surface/<entry>.json    — one `name (kind)` row per DECLARED KIND of
 *                                    every export of ONE public entry point
 *                                    (breadth: did an export disappear?). A
 *                                    name declared as both a const and a type
 *                                    is two rows, so either half can go missing
 *                                    loudly. One file per entry point since
 *                                    #5837, so two PRs that touch different entry
 *                                    points do not collide in the merge queue —
 *                                    which is where `merge=os-regen` cannot help,
 *                                    because the queue rebuilds server-side with
 *                                    no custom merge driver. The root entry `.`
 *                                    lands in `root.json`.
 *
 * SCOPE — read before trusting this as a narrowing gate. It is the BREADTH half
 * and nothing more: a row records that an export EXISTS under a kind, so a
 * signature change, a renamed interface field and a dropped union member move no
 * row here at all. The SHAPE half is `api-surface-declarations/<entry>.txt`
 * (scripts/build-api-surface-declarations.ts) — the declaration TEXT of every
 * export, which is where each of those three becomes visible. The authorable KEY
 * surface — which for a metadata-driven platform is the real third-party API —
 * is ratcheted separately by `authorable-surface/` (scripts/build-schemas.ts,
 * #3855). Value-level narrowing (an enum losing a member) is still ungated, per
 * ADR-0059 §5's evidence gate.
 *
 * RETIRED HERE: `api-surface-signatures.json`, a `sha256` of each `defineX`
 * factory's `checker.typeToString()`. It was the only shape pin on this surface
 * and it covered 27 of 5336 declared rows. It is not merely narrow, it is
 * REFERENCE-level — `typeToString` prints `z.input<typeof ActionSchema>` without
 * expanding it, so #3883 narrowed `defineAction`'s input by three keys and the
 * hash did not move. The declaration-text artifact records the same 27 factory
 * declarations (proven covered before the retirement) AND the schemas they point
 * at, whose own expanded blocks are where such a narrowing shows up. ⛔ Do not
 * reintroduce a digest here: an opaque bit that goes red gets accepted, which is
 * the failure mode the text artifact exists to avoid.
 *
 *   pnpm --filter @objectstack/spec gen:api-surface     # regenerate + write
 *   pnpm --filter @objectstack/spec check:api-surface   # CI: fail on any drift
 *
 * A REMOVED export is breaking (bump major). An ADDED export still requires
 * regenerating, so every change is deliberate. Reads the built dist — run after
 * `pnpm --filter @objectstack/spec build`.
 *
 * That last sentence is a PRECONDITION, and since #7122 it is enforced rather
 * than merely documented: both modes refuse to read a dist that is missing or
 * older than `src/`. On a stale dist this script does not fail, it writes a
 * baseline missing every export added since the build — and `--check` then
 * agrees with it against the same stale dist, so the phantom breaking removal is
 * green at every step. See lib/dist-freshness.ts for the mechanism, for why the
 * mtime rule — not `dist/.build-input-hash` — is the primitive that convicts,
 * and for the sibling stamp (`dist/.build-input-hash-dts`) that may acquit a
 * tree whose sources were re-checked-out unchanged.
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDistFreshness } from './lib/dist-freshness';
import {
  API_SURFACE_DIR_NAME,
  aggregateApiSurfaceShards,
  apiSurfaceShardTexts,
  writeShards,
} from './lib/sharded-artifacts';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SURFACE_DIR = resolve(PKG_DIR, API_SURFACE_DIR_NAME);
const CHECK = process.argv.includes('--check');

// BEFORE a single `.d.ts` is read (#7122). Order is the whole point: once
// `ts.createProgram` has run over a stale dist, every answer below it is
// confidently wrong, and both writing it and checking against it are worse than
// stopping here.
const freshness = inspectDistFreshness(
  PKG_DIR,
  CHECK ? 'check' : 'generate',
  `pnpm --filter @objectstack/spec ${CHECK ? 'check' : 'gen'}:api-surface`,
);
if (!freshness.fresh) {
  console.error(freshness.message);
  process.exit(1);
}

/** Public entry points → their built CJS `.d.ts`, read from the exports map. */
function collectEntries(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8'));
  const entries: Record<string, string> = {};
  for (const [sub, val] of Object.entries<any>(pkg.exports ?? {})) {
    if (!sub.startsWith('.')) continue;
    const dts = val?.require?.types ?? val?.import?.types;
    if (typeof dts === 'string' && dts.endsWith('.d.ts')) entries[sub] = resolve(PKG_DIR, dts);
  }
  return entries;
}

/**
 * EVERY kind the symbol's flags declare, not just the first one that matches.
 *
 * TypeScript merges an `export const X` and an `export type X` into ONE symbol
 * whose flags carry BOTH. A first-match-wins lookup therefore reported the
 * merged name as `type` alone and never enumerated the value half, so deleting
 * `export const X` left `X (type)` byte-identical in the shard and this gate
 * green on a removed public value export — the exact removal it exists to make
 * loud (#15919, ablated). One row per declared kind fixes that without touching
 * the row grammar: `Name (kind)` is unchanged, only completeness moves, and the
 * two halves become independently removable.
 *
 * Order is preserved from the old lookup so the shards stay stable, and `other`
 * remains the answer for a symbol matching no branch — never an empty row set.
 */
function kindsOf(flags: ts.SymbolFlags): string[] {
  const kinds: string[] = [];
  if (flags & ts.SymbolFlags.Function) kinds.push('function');
  if (flags & ts.SymbolFlags.Class) kinds.push('class');
  if (flags & ts.SymbolFlags.Enum) kinds.push('enum');
  if (flags & ts.SymbolFlags.Interface) kinds.push('interface');
  if (flags & ts.SymbolFlags.TypeAlias) kinds.push('type');
  if (flags & ts.SymbolFlags.Variable) kinds.push('const');
  if (flags & ts.SymbolFlags.Namespace) kinds.push('namespace');
  return kinds.length > 0 ? kinds : ['other'];
}

const entries = collectEntries();
const program = ts.createProgram(Object.values(entries), {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

function moduleExports(file: string, sub: string): ts.Symbol[] {
  const sf = program.getSourceFile(file);
  const sym = sf && checker.getSymbolAtLocation(sf);
  if (!sym) throw new Error(`Could not resolve module symbol for ${sub} (${file}). Is the package built?`);
  return checker.getExportsOfModule(sym);
}

const unalias = (s: ts.Symbol): ts.Symbol =>
  s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

/** Breadth: `name (kind)` per entry point. */
function buildSurface(): Record<string, string[]> {
  const surface: Record<string, string[]> = {};
  for (const [sub, file] of Object.entries(entries)) {
    surface[sub] = moduleExports(file, sub)
      .flatMap((s) => kindsOf(unalias(s).getFlags()).map((kind) => `${s.getName()} (${kind})`))
      // Code-unit sort (NOT localeCompare): deterministic across CI platforms.
      // A dual-declared name's rows land adjacent under it, `(const)` before
      // `(type)`, so this repair reads as a pure insertion in the shards.
      .sort();
  }
  return surface;
}

const surface = buildSurface();
const surfaceTexts = apiSurfaceShardTexts(surface);

if (!CHECK) {
  const { written, removed } = writeShards(SURFACE_DIR, surfaceTexts);
  const total = Object.values(surface).reduce((n, a) => n + a.length, 0);
  console.log(`Wrote ${API_SURFACE_DIR_NAME}/ (${Object.keys(surface).length} entries, ${total} exports).`);
  // The locality claim, printed: a PR that changed one entry point's exports
  // rewrites one shard, so two such PRs cannot conflict (#5837).
  if (written.length > 0) console.log(`  touched: ${written.map((n) => `${n}.json`).join(', ')}`);
  if (removed.length > 0) console.log(`  removed: ${removed.map((n) => `${n}.json`).join(', ')}`);
  process.exit(0);
}

let breaking = 0;
let additions = 0;

// Breadth check. Reads the whole shard DIRECTORY, never "the shards this run
// would write" — a deleted shard drops its entry point's exports and must read
// as a removal, exactly as deleting those lines from the single file did.
const prevRead = aggregateApiSurfaceShards(SURFACE_DIR);
if (!prevRead) {
  console.error(
    `No snapshot at ${SURFACE_DIR}. Run \`pnpm --filter @objectstack/spec gen:api-surface\` and commit it (breadth).`,
  );
  process.exit(1);
}
const prevSurface = prevRead.surface;
const prevTexts = new Map(prevRead.shards.map((s) => [s.name, s.raw]));
const staleShards = [...surfaceTexts].filter(([name, text]) => prevTexts.get(name) !== text).map(([n]) => n);
const orphanShards = [...prevTexts.keys()].filter((name) => !surfaceTexts.has(name));
if (staleShards.length > 0 || orphanShards.length > 0) {
  for (const sub of new Set([...Object.keys(prevSurface), ...Object.keys(surface)])) {
    const before = new Set(prevSurface[sub] ?? []);
    const after = new Set(surface[sub] ?? []);
    const gone = [...before].filter((x) => !after.has(x));
    const fresh = [...after].filter((x) => !before.has(x));
    if (!gone.length && !fresh.length) continue;
    console.error(`\n  ${sub}`);
    for (const g of gone) { console.error(`    - ${g}`); breaking++; }
    for (const f of fresh) { console.error(`    + ${f}`); additions++; }
  }
  // Bytes can drift with no name moving at all — a hand-edited description, a
  // re-indent. That is still a stale artifact and still has to go red, or the
  // shard stops being generated evidence.
  if (breaking === 0 && additions === 0) {
    console.error(`\n  ${API_SURFACE_DIR_NAME}/ does not match its generated form (export names unchanged):`);
    for (const name of staleShards) console.error(`    ~ ${name}.json`);
    for (const name of orphanShards) console.error(`    - ${name}.json  (no such entry point)`);
    console.error('\nRun `pnpm --filter @objectstack/spec gen:api-surface` and commit the updated shards.');
    process.exit(1);
  }
}

if (breaking === 0 && additions === 0) {
  console.log('@objectstack/spec public API surface unchanged ✓');
  process.exit(0);
}

console.error(`\n@objectstack/spec public API changed: ${breaking} breaking (removed), ${additions} added.`);
if (breaking > 0) {
  console.error('A REMOVED export is a BREAKING change for third parties — bump @objectstack/spec to a new major (or restore it).');
}
console.error('If intentional, run `pnpm --filter @objectstack/spec gen:api-surface` and commit the updated snapshots.');
process.exit(1);
