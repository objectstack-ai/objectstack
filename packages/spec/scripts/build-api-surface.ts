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
 *   - api-surface.json            — every exported `name (kind)` per public entry
 *                                    point (breadth: did an export disappear?).
 *   - api-surface-signatures.json — a stable hash of each `defineX` factory's
 *                                    resolved signature. Scoped to the factories to
 *                                    stay low-noise; full per-export signatures
 *                                    would churn on every internal type tweak.
 *
 * SCOPE — read before trusting these as a narrowing gate. Both artifacts describe
 * the TYPESCRIPT surface. The hash is of `checker.typeToString()`, which prints a
 * type REFERENCE (`z.input<typeof ActionSchema>`) and does not expand it, so
 * adding or removing a key inside a schema does not move it: #3883 narrowed
 * `defineAction`'s input by three keys and this snapshot did not change. The
 * authorable KEY surface — which for a metadata-driven platform is the real
 * third-party API — is ratcheted separately by `authorable-surface.json`
 * (scripts/build-schemas.ts, #3855). Value-level narrowing (an enum losing a
 * member) is still ungated, per ADR-0059 §5's evidence gate.
 *
 *   pnpm --filter @objectstack/spec gen:api-surface     # regenerate + write
 *   pnpm --filter @objectstack/spec check:api-surface   # CI: fail on any drift
 *
 * A REMOVED export or a CHANGED factory signature is breaking (bump major). An
 * ADDED export still requires regenerating, so every change is deliberate. Reads
 * the built dist — run after `pnpm --filter @objectstack/spec build`.
 */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SURFACE_SNAPSHOT = resolve(PKG_DIR, 'api-surface.json');
const SIG_SNAPSHOT = resolve(PKG_DIR, 'api-surface-signatures.json');
const CHECK = process.argv.includes('--check');

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
const surfaceStr = JSON.stringify(surface, null, 2) + '\n';
const sigStr = JSON.stringify(signatures, null, 2) + '\n';

if (!CHECK) {
  writeFileSync(SURFACE_SNAPSHOT, surfaceStr);
  writeFileSync(SIG_SNAPSHOT, sigStr);
  const total = Object.values(surface).reduce((n, a) => n + a.length, 0);
  console.log(`Wrote api-surface.json (${Object.keys(surface).length} entries, ${total} exports) and api-surface-signatures.json (${Object.keys(signatures).length} factories).`);
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

// Breadth check.
const prevSurface: Record<string, string[]> = JSON.parse(read(SURFACE_SNAPSHOT, 'breadth'));
if (JSON.stringify(prevSurface, null, 2) + '\n' !== surfaceStr) {
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
