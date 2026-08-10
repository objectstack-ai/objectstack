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
 * Two committed artifacts, both checked in CI:
 *   - api-surface/<entry>.json    — every exported `name (kind)` for ONE public
 *                                    entry point (breadth: did an export
 *                                    disappear?). One file per entry point since
 *                                    #5837, so two PRs that touch different entry
 *                                    points do not collide in the merge queue —
 *                                    which is where `merge=os-regen` cannot help,
 *                                    because the queue rebuilds server-side with
 *                                    no custom merge driver. The root entry `.`
 *                                    lands in `root.json`.
 *   - api-surface-signatures.json — a stable hash of each `defineX` factory's
 *                                    resolved signature. Scoped to the factories to
 *                                    stay low-noise; full per-export signatures
 *                                    would churn on every internal type tweak.
 *                                    Deliberately NOT sharded: 1.3KB, one line
 *                                    per factory, never a conflict surface.
 *
 * SCOPE — read before trusting these as a narrowing gate. Both artifacts describe
 * the TYPESCRIPT surface. The hash is of `checker.typeToString()`, which prints a
 * type REFERENCE (`z.input<typeof ActionSchema>`) and does not expand it, so
 * adding or removing a key inside a schema does not move it: #3883 narrowed
 * `defineAction`'s input by three keys and this snapshot did not change. The
 * authorable KEY surface — which for a metadata-driven platform is the real
 * third-party API — is ratcheted separately by `authorable-surface/`
 * (scripts/build-schemas.ts, #3855). Value-level narrowing (an enum losing a
 * member) is still ungated, per ADR-0059 §5's evidence gate.
 *
 *   pnpm --filter @objectstack/spec gen:api-surface     # regenerate + write
 *   pnpm --filter @objectstack/spec check:api-surface   # CI: fail on any drift
 *
 * A REMOVED export or a CHANGED factory signature is breaking (bump major). An
 * ADDED export still requires regenerating, so every change is deliberate. Reads
 * the built dist — run after `pnpm --filter @objectstack/spec build`.
 *
 * That last sentence is a PRECONDITION, and since #7122 it is enforced rather
 * than merely documented: both modes refuse to read a dist that is missing or
 * older than `src/`. On a stale dist this script does not fail, it writes a
 * baseline missing every export added since the build — and `--check` then
 * agrees with it against the same stale dist, so the phantom breaking removal is
 * green at every step. See lib/dist-freshness.ts for the mechanism and for why
 * the mtime rule, not `dist/.build-input-hash`, is the primitive that covers it.
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
const SIG_SNAPSHOT = resolve(PKG_DIR, 'api-surface-signatures.json');
const CHECK = process.argv.includes('--check');

// BEFORE a single `.d.ts` is read (#7122). Order is the whole point: once
// `ts.createProgram` has run over a stale dist, every answer below it is
// confidently wrong, and both writing it and checking against it are worse than
// stopping here.
const freshness = inspectDistFreshness(PKG_DIR, CHECK ? 'check' : 'generate');
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

function kindOf(flags: ts.SymbolFlags): string {
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Enum) return 'enum';
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type';
  if (flags & ts.SymbolFlags.Variable) return 'const';
  if (flags & ts.SymbolFlags.Namespace) return 'namespace';
  return 'other';
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
      .map((s) => `${s.getName()} (${kindOf(unalias(s).getFlags())})`)
      // Code-unit sort (NOT localeCompare): deterministic across CI platforms.
      .sort();
  }
  return surface;
}

/** Depth: hash of each `defineX` factory's resolved signature (from root). */
function buildSignatures(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of moduleExports(entries['.'], '.')) {
    const name = s.getName();
    if (!/^define[A-Z]/.test(name)) continue;
    const resolved = unalias(s);
    if (!(resolved.getFlags() & ts.SymbolFlags.Function)) continue;
    const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
    if (!decl) continue;
    const type = checker.getTypeOfSymbolAtLocation(resolved, decl);
    const str = checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias);
    out[name] = 'sha256:' + createHash('sha256').update(str).digest('hex').slice(0, 16);
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

const surface = buildSurface();
const signatures = buildSignatures();
const surfaceTexts = apiSurfaceShardTexts(surface);
const sigStr = JSON.stringify(signatures, null, 2) + '\n';

if (!CHECK) {
  const { written, removed } = writeShards(SURFACE_DIR, surfaceTexts);
  writeFileSync(SIG_SNAPSHOT, sigStr);
  const total = Object.values(surface).reduce((n, a) => n + a.length, 0);
  console.log(
    `Wrote ${API_SURFACE_DIR_NAME}/ (${Object.keys(surface).length} entries, ${total} exports) ` +
      `and api-surface-signatures.json (${Object.keys(signatures).length} factories).`,
  );
  // The locality claim, printed: a PR that changed one entry point's exports
  // rewrites one shard, so two such PRs cannot conflict (#5837).
  if (written.length > 0) console.log(`  touched: ${written.map((n) => `${n}.json`).join(', ')}`);
  if (removed.length > 0) console.log(`  removed: ${removed.map((n) => `${n}.json`).join(', ')}`);
  process.exit(0);
}

function read(path: string, hint: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    console.error(`No snapshot at ${path}. Run \`pnpm --filter @objectstack/spec gen:api-surface\` and commit it (${hint}).`);
    process.exit(1);
  }
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

// Depth check (factory signatures).
const prevSig: Record<string, string> = JSON.parse(read(SIG_SNAPSHOT, 'depth'));
if (JSON.stringify(prevSig, null, 2) + '\n' !== sigStr) {
  for (const name of new Set([...Object.keys(prevSig), ...Object.keys(signatures)])) {
    if (!(name in signatures)) { console.error(`\n  signature removed: ${name}`); breaking++; }
    else if (!(name in prevSig)) { console.error(`\n  signature added: ${name}`); additions++; }
    else if (prevSig[name] !== signatures[name]) { console.error(`\n  signature changed: ${name}  (${prevSig[name]} → ${signatures[name]})`); breaking++; }
  }
}

if (breaking === 0 && additions === 0) {
  console.log('@objectstack/spec public API surface + factory signatures unchanged ✓');
  process.exit(0);
}

console.error(`\n@objectstack/spec public API changed: ${breaking} breaking (removed/narrowed), ${additions} added.`);
if (breaking > 0) {
  console.error('A REMOVED export or a CHANGED factory signature is a BREAKING change for third parties — bump @objectstack/spec to a new major (or restore it).');
}
console.error('If intentional, run `pnpm --filter @objectstack/spec gen:api-surface` and commit the updated snapshots.');
process.exit(1);
