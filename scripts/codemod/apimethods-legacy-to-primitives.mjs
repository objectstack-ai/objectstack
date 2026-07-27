#!/usr/bin/env node
/**
 * Codemod / migration reporter: legacy `apiMethods` values → six primitives
 * ========================================================================
 *
 * Part of #3543 (P2 of #3391): the `ApiMethod` enum shrank to the six
 * primitives (`get/list/create/update/delete/bulk`). The eight legacy values
 * (`upsert/aggregate/history/search/restore/purge/import/export`) are DERIVED
 * from the primitives by the server's single derivation table and can no
 * longer be authored:
 *
 *     enable: { apiMethods: ['get', 'list', 'export'] }        // legacy
 *     enable: { apiMethods: ['get', 'list'] }                  // → export derives from list
 *
 * At runtime a stored legacy value is STRIPPED at parse (canonicalize-and-warn,
 * never a hard failure) — stripping only ever NARROWS exposure. Where the strip
 * would lose intent (a legacy value not derivable from the primitives you
 * declared), the fix is to declare the underlying primitives — which WIDENS the
 * authored whitelist. That widening must be an explicit, reviewable edit, which
 * is exactly what this tool reports.
 *
 * WHY THIS IS A REPORTER, NOT AN AUTO-REWRITER
 * --------------------------------------------
 * Same doctrine as `view-to-viewitem.mjs`: a regex/AST rewrite of arbitrary
 * user code (spread arrays, computed values, imported fragments) is unsafe for
 * marginal value — and a tool that silently WIDENS an API-exposure whitelist is
 * a security hazard. The runtime already tolerates legacy values (strip +
 * warn), so migration is not time-critical. This tool SCANS for `apiMethods`
 * whitelists containing legacy values and REPORTS, per site, the exact
 * replacement whitelist, so a human applies and reviews the edit.
 *
 * Replacement rules (per legacy value, closure-preserving):
 *   upsert    → create, update            (upsert ⊆ create ∧ update)
 *   import    → create, update            (import ⊆ create ∨ update; both cover every writeMode)
 *   export    → list                      (export ⊆ list)
 *   aggregate → list                      (aggregate ⊆ list)
 *   search    → list                      (search ⊆ list ∧ searchable)
 *   history   → get                       (history ⊆ get ∧ trackHistory)
 *   restore   → (drop)                    (never derives — `enable.trash` retired, #2377)
 *   purge     → (drop)                    (never derives — `enable.trash` retired, #2377)
 *
 * If the replacement whitelist ends up naming all six primitives, the report
 * suggests deleting the `apiMethods` key entirely (equivalent to default-open,
 * and it keeps tracking future primitives).
 *
 * Usage:
 *   node scripts/codemod/apimethods-legacy-to-primitives.mjs [dir ...]      # human report
 *   node scripts/codemod/apimethods-legacy-to-primitives.mjs --json [dir …] # machine output
 *
 * Default scan roots: examples/ and packages/ . Scans *.ts, *.js, *.json,
 * *.yml, *.yaml. Zero third-party deps.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const roots = argv.filter((a) => !a.startsWith('--'));
const scanRoots = (roots.length ? roots : ['examples', 'packages']).map((r) =>
  resolve(repoRoot, r),
);

const PRIMITIVES = ['get', 'list', 'create', 'update', 'delete', 'bulk'];
const LEGACY_TO_PRIMITIVES = {
  upsert: ['create', 'update'],
  import: ['create', 'update'],
  export: ['list'],
  aggregate: ['list'],
  search: ['list'],
  history: ['get'],
  restore: [],
  purge: [],
};
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml']);

/** Recursively collect scannable files, skipping node_modules/dist/.cache. */
function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.cache' || entry.startsWith('.git')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, out);
    else if (SCAN_EXTS.has(extname(entry))) out.push(p);
  }
  return out;
}

/**
 * Find `apiMethods` whitelists in a source text. Matches the common authored
 * shapes — TS/JS (`apiMethods: [ … ]`), JSON (`"apiMethods": [ … ]`), and
 * YAML flow arrays (`apiMethods: [ … ]`). Block-style YAML lists and computed
 * arrays are not matched; the runtime strip still covers them.
 */
function findWhitelists(text) {
  const results = [];
  const re = /(["']?)apiMethods\1\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const values = [...m[2].matchAll(/["']([a-zA-Z_]+)["']/g)].map((v) => v[1]);
    const legacy = values.filter((v) => v in LEGACY_TO_PRIMITIVES);
    if (legacy.length === 0) continue;
    const line = text.slice(0, m.index).split('\n').length;
    const replacement = [];
    for (const v of values) {
      for (const r of v in LEGACY_TO_PRIMITIVES ? LEGACY_TO_PRIMITIVES[v] : [v]) {
        if (!replacement.includes(r)) replacement.push(r);
      }
    }
    const ordered = PRIMITIVES.filter((p) => replacement.includes(p));
    results.push({
      line,
      current: values,
      legacy,
      replacement: ordered,
      widens: ordered.some((p) => !values.includes(p)),
      suggestDelete: ordered.length === PRIMITIVES.length,
      becomesDenyAll: ordered.length === 0,
    });
  }
  return results;
}

const findings = [];
for (const root of scanRoots) {
  for (const file of collectFiles(root)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('apiMethods')) continue;
    for (const hit of findWhitelists(text)) {
      findings.push({ file: relative(repoRoot, file), ...hit });
    }
  }
}

if (jsonMode) {
  console.log(JSON.stringify(findings, null, 2));
  process.exit(findings.length ? 1 : 0);
}

if (findings.length === 0) {
  console.log('✅ No legacy apiMethods values found — nothing to migrate.');
  process.exit(0);
}

console.log(`Found ${findings.length} apiMethods whitelist(s) with legacy value(s) (#3543):\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    current:  [${f.current.join(', ')}]  (legacy: ${f.legacy.join(', ')})`);
  if (f.becomesDenyAll) {
    console.log(
      '    ⚠ replacement is EMPTY — [] means DENY-ALL (fully closed API). If the object',
    );
    console.log(
      '      should stay reachable, declare the primitives it needs; if it is engine-owned,',
    );
    console.log('      [] (with apiEnabled: false) is likely what you want. Review required.');
  } else if (f.suggestDelete) {
    console.log(
      `    suggest:  delete the apiMethods key — [${f.replacement.join(', ')}] names all six`,
    );
    console.log('              primitives, which is default-open and tracks future primitives.');
  } else {
    console.log(`    replace:  [${f.replacement.join(', ')}]`);
  }
  if (f.widens) {
    console.log(
      '    ⚠ WIDENS the authored whitelist (a legacy verb needed primitives you had not',
    );
    console.log('      declared). Review that the added primitives are intended to be exposed.');
  }
  console.log('');
}
console.log(
  'Legacy verbs are DERIVED at runtime (upsert ⊆ create∧update; import ⊆ create∨update;\n' +
    'export/aggregate/search ⊆ list; history ⊆ get∧trackHistory; restore/purge never — #2377).\n' +
    'Stored metadata with legacy values keeps parsing (stripped + warned), so migrate at your\n' +
    'own pace — but the strip only NARROWS; apply the replacements above to preserve intent.',
);
process.exit(1);
