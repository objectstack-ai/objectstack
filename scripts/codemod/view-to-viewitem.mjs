#!/usr/bin/env node
/**
 * Codemod / migration reporter: `defineView` → `defineViewItem`
 * ============================================================
 *
 * Part of ADR-0017 (Object has-many View). Helps teams move from the
 * aggregated per-object view container:
 *
 *     export const leadViews = defineView({
 *       list:      { … },
 *       listViews: { all: { … }, pipeline: { … } },
 *       formViews: { default: { … } },
 *     })
 *
 * …to independent view entities authored with `defineViewItem`:
 *
 *     export const leadAll      = defineViewItem({ name: 'crm_lead.all',      object: 'crm_lead', viewKind: 'list', config: { … } })
 *     export const leadPipeline = defineViewItem({ name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'list', config: { … } })
 *     export const leadForm     = defineViewItem({ name: 'crm_lead.default',  object: 'crm_lead', viewKind: 'form', config: { … } })
 *
 * WHY THIS IS A REPORTER, NOT AN AUTO-REWRITER
 * --------------------------------------------
 * The backend loader already performs an equivalent expansion at load time
 * (the "dual-read" path — see ADR-0017 §3.2 and
 * `packages/metadata/src/plugin.ts` → `expandViewContainer`). Existing
 * `defineView` sources therefore keep working unchanged; this migration is
 * OPTIONAL. Because it is optional, the tool deliberately does NOT mutate
 * source code — a regex/AST rewrite of arbitrary user code (spread configs,
 * computed keys, imported fragments, comments) is unsafe for marginal value.
 *
 * Instead it SCANS `*.view.ts` files and REPORTS, per `defineView` call site,
 * the exact `ViewItem` names the loader will generate — so a team can choose
 * to author them explicitly with `defineViewItem` and copy the config across.
 *
 * Usage:
 *   node scripts/codemod/view-to-viewitem.mjs [dir ...]      # human report
 *   node scripts/codemod/view-to-viewitem.mjs --json [dir …] # machine output
 *
 * Default scan roots: examples/ and packages/ . Zero third-party deps.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const roots = argv.filter((a) => !a.startsWith('--'));
const scanRoots = (roots.length ? roots : ['examples', 'packages']).map((r) =>
  resolve(repoRoot, r),
);

/** Recursively collect `*.view.ts` files, skipping node_modules/dist/.cache. */
function collectViewFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.cache' || entry.startsWith('.git')) {
      continue;
    }
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) collectViewFiles(full, out);
    else if (entry.endsWith('.view.ts') || entry.endsWith('.view.tsx')) out.push(full);
  }
  return out;
}

/**
 * Heuristic, comment/string-tolerant scan of a single source file. We are NOT
 * building a full TS AST (zero-dep constraint); we only need to (a) detect
 * `defineView(` call sites and (b) recover the literal *keys* of the `list` /
 * `listViews` / `formViews` blocks to predict generated ViewItem names. Files
 * whose keys are computed/spread are reported as "needs manual review".
 */
function scanFile(file) {
  const src = readFileSync(file, 'utf8');
  const result = {
    file: relative(repoRoot, file),
    usesDefineView: /\bdefineView\s*\(/.test(src),
    usesDefineViewItem: /\bdefineViewItem\s*\(/.test(src),
    object: undefined,
    listKeys: [],
    formKeys: [],
    needsManualReview: false,
  };
  if (!result.usesDefineView) return result;

  // Bound the object name from `data: { object: '…' }` / `object: '…'`.
  const objMatch = src.match(/object\s*:\s*['"]([a-z][a-z0-9_]*)['"]/);
  if (objMatch) result.object = objMatch[1];

  // Recover top-level keys of a named block (`listViews: { all: …, pipeline: … }`).
  const blockKeys = (blockName) => {
    const re = new RegExp(`${blockName}\\s*:\\s*\\{`);
    const m = re.exec(src);
    if (!m) return null;
    // Walk braces from the opening `{` to find the block body.
    let depth = 0, i = m.index + m[0].length - 1, start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(start + 1, i);
    // Only direct children: keys at brace-depth 1 of `body`.
    const keys = [];
    let d = 0, k = '';
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      if (c === '{' || c === '[' || c === '(') d++;
      else if (c === '}' || c === ']' || c === ')') d--;
      else if (d === 0 && c === ':' ) {
        const key = k.trim().replace(/['"]/g, '');
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) keys.push(key);
        else result.needsManualReview = true; // computed / spread key
        k = '';
      } else if (d === 0 && (c === ',' || c === '\n')) {
        k = '';
      } else if (d === 0) {
        k += c;
      }
    }
    return keys;
  };

  const lv = blockKeys('listViews');
  const fv = blockKeys('formViews');
  if (lv === null && fv === null && !/\blist\s*:/.test(src)) result.needsManualReview = true;
  if (lv) result.listKeys = lv;
  if (fv) result.formKeys = fv;
  if (/\blist\s*:/.test(src) && !result.listKeys.includes('list')) {
    // The primary `list` becomes its own item unless it duplicates listViews
    // (the loader collapses a whole-body restatement — reported, not decided here).
    result.listKeys = ['list (primary — may dedup against listViews)', ...result.listKeys];
  }
  return result;
}

const files = scanRoots.flatMap((r) => collectViewFiles(r));
const scanned = files.map(scanFile);
const candidates = scanned.filter((s) => s.usesDefineView);
const already = scanned.filter((s) => s.usesDefineViewItem && !s.usesDefineView);
const review = candidates.filter((s) => s.needsManualReview || !s.object);

if (jsonMode) {
  process.stdout.write(JSON.stringify({ candidates, already, review }, null, 2) + '\n');
  process.exit(0);
}

const qualify = (obj, key) => (obj ? `${obj}.${key.replace(/ .*$/, '')}` : `<object>.${key}`);

console.log('\nADR-0017 — defineView → defineViewItem migration report');
console.log('='.repeat(60));
console.log(`Scanned ${scanned.length} view file(s) under: ${scanRoots.map((r) => relative(repoRoot, r)).join(', ')}\n`);

if (candidates.length === 0) {
  console.log('✓ No aggregated defineView() call sites found — nothing to migrate.');
} else {
  console.log(`Found ${candidates.length} file(s) still using defineView():\n`);
  for (const c of candidates) {
    console.log(`  ${c.file}${c.object ? `  (object: ${c.object})` : '  (object: UNKNOWN)'}`);
    const items = [
      ...c.listKeys.map((k) => `${qualify(c.object, k)}  [list]`),
      ...c.formKeys.map((k) => `${qualify(c.object, k)}  [form]`),
    ];
    for (const it of items) console.log(`      → ${it}`);
    if (c.needsManualReview) console.log('      ⚠ computed/spread keys — review by hand');
    console.log('');
  }
}

if (already.length) {
  console.log(`Already on defineViewItem (${already.length}): ${already.map((s) => s.file).join(', ')}\n`);
}

console.log('Note: migration is OPTIONAL. The loader auto-expands defineView() at');
console.log('load time (ADR-0017 §3.2), so unmigrated sources keep working.\n');
