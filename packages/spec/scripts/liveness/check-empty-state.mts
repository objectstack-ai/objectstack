// #3896 follow-up — the empty-state gate (CLI entry).
//
//   pnpm --filter @objectstack/spec check:empty-state
//   pnpm --filter @objectstack/spec check:empty-state -- --dump   # inventory, seeding aid
//
// See empty-state.mts for what it enforces and why, and
// packages/spec/liveness/README.md § "Empty-state semantics" for the author-facing
// version.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMPTY_STATE_REGISTRY } from './empty-state-registry.mts';
import { checkEmptyState } from './empty-state.mts';

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, '../..'); // packages/spec
const repoRoot = resolve(specRoot, '../..');
const packagesRoot = resolve(repoRoot, 'packages');

// Build output, dependencies and caches are copies — scanning them would report
// the same statement several times and flag paths nobody edits.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage', '.git']);

/**
 * The authorable surface: everything an author — very often a model — reads as
 * the contract.
 *
 * TWO kinds of file, and the second is the reason this gate exists at all:
 *
 * - `packages/spec/src/**\/*.zod.ts` — the schema surface.
 * - `**\/*.object.ts` — platform-object definitions, wherever they live (plugins,
 *   `platform-objects`, `metadata-core`, the `create-objectstack` templates).
 *   The sentence that shipped #3896 — *"leave empty to share every record"* — was
 *   the `description` of `sys_sharing_rule.criteria_json`, which lives in
 *   `plugin-sharing`. A gate scoped to `packages/spec` could not see the crime
 *   scene. Templates are included deliberately: a starter file is the highest-
 *   leverage thing a model copies from.
 */
function collectAuthorableFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectAuthorableFiles(join(dir, entry.name), out);
      continue;
    }
    if (entry.name.endsWith('.test.ts')) continue;
    const full = join(dir, entry.name);
    const rel = relative(repoRoot, full);
    if (entry.name.endsWith('.object.ts')) out.push(full);
    else if (entry.name.endsWith('.zod.ts') && rel.startsWith(join('packages', 'spec', 'src'))) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dump = args.includes('--dump');

const files = collectAuthorableFiles(packagesRoot).sort();
const sources = new Map<string, string>(
  files.map((f) => [relative(repoRoot, f), readFileSync(f, 'utf8')]),
);

const { hits, findings, notes } = checkEmptyState({
  sources,
  registry: EMPTY_STATE_REGISTRY,
  exists: (p) => existsSync(join(repoRoot, p)),
});

if (dump) {
  console.log(`Permissive-empty statements across ${sources.size} schema files:\n`);
  for (const h of hits) {
    console.log(`  ${h.file}:${h.line}  [${h.property ?? '<unresolved>'}]`);
    console.log(`    ${h.text}`);
  }
  process.exit(0);
}

if (asJson) {
  console.log(JSON.stringify({ scanned: sources.size, hits, findings, notes }, null, 2));
  process.exit(findings.length > 0 ? 1 : 0);
}

console.log(`Empty-state gate — ${sources.size} schema files, ${hits.length} permissive-empty statements.`);

const byKind = new Map<string, typeof findings>();
for (const f of findings) {
  const list = byKind.get(f.kind) ?? [];
  list.push(f);
  byKind.set(f.kind, list);
}

const HEADINGS: Record<string, string> = {
  unregistered: 'UNCLASSIFIED — a permissive empty state nobody signed off on',
  unresolved: 'UNRESOLVED — statement could not be tied to a property',
  stale: 'STALE — registered, but the statement is gone',
  'missing-rationale': 'NO RATIONALE',
  'missing-evidence': 'NO EVIDENCE — access gates must cite their enforcement site',
  'rotted-evidence': 'ROTTED EVIDENCE',
};

for (const [kind, list] of byKind) {
  console.log(`\n${HEADINGS[kind] ?? kind} (${list.length}):`);
  for (const f of list) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`  ✗ ${where}${f.property ? ` — ${f.property}` : ''}`);
    console.log(`      ${f.message}`);
  }
}

if (notes.length > 0) {
  console.log(`\nNotes — narrative, not enforced (${notes.length}):`);
  for (const n of notes) console.log(`  · ${n.file}:${n.line} — ${n.message}`);
}

if (findings.length === 0) {
  const counts = EMPTY_STATE_REGISTRY.reduce<Record<string, number>>((acc, e) => {
    acc[e.semantics] = (acc[e.semantics] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  console.log(`✓ all classified (${summary})`);
  process.exit(0);
}

console.log(`\n${findings.length} finding(s) — see packages/spec/scripts/liveness/empty-state-registry.mts`);
process.exit(1);
