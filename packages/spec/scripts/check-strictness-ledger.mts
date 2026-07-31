#!/usr/bin/env tsx
// Strictness-ledger gate — makes docs/audits/2026-07-unknown-key-strictness-ledger.md
// enforceable instead of merely descriptive.
//
// WHY THIS EXISTS. The ledger is the #4001 campaign's map: which `z.object` sites
// are authorable (the `.strict()` ratchet target), which are wire, which are
// deliberately open. Every step reads it to decide what to do next. Nothing kept it
// honest, and it went stale twice in one week:
//
//   - `hook.zod.ts` carried a blanket `authorable (p)` that verification disproved —
//     HookContextSchema in the same file is a runtime shape (#4207).
//   - It listed "build the unknown-key WARNING layer" as the next step months after
//     that layer shipped, sending the next reader off to rebuild it (#4218).
//
// A map that drifts is worse than no map: it is followed. This gate holds the two
// claims in it that are mechanically checkable.
//
// WHAT IT CHECKS
//   1. Site counts. The ledger states its own method — "site counts are `z.object(`
//      occurrences per file" — so every count is verifiable. A count that no longer
//      matches means someone added or removed a schema without reclassifying it, and
//      the row's `Class` verdict now covers sites nobody triaged. This is the ratchet:
//      touching a file forces you back through the ledger.
//   2. Coverage. Every `*.zod.ts` under a triaged directory that HAS `z.object(` sites
//      must appear in that directory's table. A new one is undeclared surface —
//      exactly what the ledger exists to prevent. The walk is RECURSIVE; nested files
//      are declared by their path relative to the section directory
//      (`driver/postgres.zod.ts`). It was not recursive at first, and `data/driver/`
//      sat undeclared behind that — see the ledger's note on it. Files with zero sites
//      (pure enum / token modules like `data/date-macros.zod.ts`) are skipped: the
//      ledger classifies sites, and they have none to classify. This is not a hole —
//      the day such a file grows its first `z.object(` it becomes undeclared and this
//      gate says so.
//   3. Section totals. `### \`ui/\` — 192 sites` must equal the sum of its rows.
//      Cheap, and it catches a row edited without updating the header.
//   4. Strictness claims. A row whose note says "strict as of" must name a file that
//      actually contains `.strict()`. This is deliberately weak — it proves the claim
//      is not fiction, not that every site in the file is strict. Rows say things like
//      "partially strict"; encoding which sites those are would need a second ledger,
//      and the per-schema truth already lives in the code the note points at.
//
// WHAT IT DOES NOT CHECK. The `Class` column itself — authorable vs wire vs open is a
// human judgement about who writes the input, and the campaign's own rule is
// verify-before-tightening. This gate protects the ledger's ARITHMETIC and its
// COVERAGE so that judgement is made against current code.
//
// Usage:
//   tsx check-strictness-ledger.mts          # fail on drift
//   tsx check-strictness-ledger.mts --list   # print the parsed ledger

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { countSites, listSchemaFiles } from './lib/strictness-ledger';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const REPO = path.resolve(SPEC, '../..');
const LEDGER = path.join(REPO, 'docs/audits/2026-07-unknown-key-strictness-ledger.md');
const SRC = path.join(SPEC, 'src');
const LIST = process.argv.includes('--list');

interface Row {
  dir: string;
  files: string[];
  /** Declared `z.object(` count per file, index-aligned with `files`. */
  counts: number[];
  note: string;
  line: number;
}

/**
 * Parse `8`, `6+2`, `10+9+2` or `4 ea` against a file list.
 * `N ea` means every file in the row declares N — the ledger's shorthand for a
 * run of same-sized files.
 */
function parseCounts(cell: string, fileCount: number): number[] | null {
  const ea = cell.match(/^(\d+)\s*ea$/);
  if (ea) return Array(fileCount).fill(Number(ea[1]));
  const parts = cell.split('+').map((p) => p.trim());
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length === 1 && fileCount > 1) return null;
  return nums.length === fileCount ? nums : null;
}

const md = fs.readFileSync(LEDGER, 'utf-8').split('\n');
const rows: Row[] = [];
const sectionTotals = new Map<string, { declared: number; line: number }>();
let dir: string | null = null;

for (let i = 0; i < md.length; i++) {
  const line = md[i];

  const header = line.match(/^### `([a-z-]+)\/` — (\d+) sites/);
  if (header) {
    dir = header[1];
    sectionTotals.set(dir, { declared: Number(header[2]), line: i + 1 });
    continue;
  }
  // Any other h2/h3 closes the current section, so prose tables below the
  // triage cannot be mistaken for rows.
  if (/^##/.test(line) && !header) dir = null;
  if (!dir || !line.startsWith('|')) continue;

  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 3) continue;
  const files = [...cells[0].matchAll(/`([^`]+\.zod\.ts)`/g)].map((m) => m[1]);
  if (files.length === 0) continue;

  const counts = parseCounts(cells[1], files.length);
  if (counts === null) {
    console.error(`✗ ${LEDGER}:${i + 1} — cannot parse site count "${cells[1]}" for ${files.length} file(s)`);
    process.exit(1);
  }
  rows.push({ dir, files, counts, note: cells.slice(2).join(' '), line: i + 1 });
}

if (LIST) {
  for (const r of rows) {
    console.log(`${r.dir}/ ${r.files.map((f, i) => `${f}=${r.counts[i]}`).join(' ')}`);
  }
  process.exit(0);
}

const errors: string[] = [];
const declaredByDir = new Map<string, Set<string>>();

for (const row of rows) {
  const declared = declaredByDir.get(row.dir) ?? new Set<string>();
  declaredByDir.set(row.dir, declared);

  row.files.forEach((file, idx) => {
    declared.add(file);
    const abs = path.join(SRC, row.dir, file);
    if (!fs.existsSync(abs)) {
      errors.push(
        `ledger:${row.line} — lists \`${row.dir}/${file}\`, which does not exist.\n` +
        `    → the file moved or was deleted; update or drop the row.`,
      );
      return;
    }
    const actual = countSites(abs);
    if (actual !== row.counts[idx]) {
      errors.push(
        `ledger:${row.line} — \`${row.dir}/${file}\` declares ${row.counts[idx]} site(s), found ${actual}.\n` +
        `    → ${actual > row.counts[idx] ? 'new' : 'removed'} \`z.object(\` site(s) since the row was written. ` +
        `Re-read the file, confirm the Class verdict still covers it, and update the count.`,
      );
    }
  });

  if (/strict as of/i.test(row.note)) {
    const anyStrict = row.files.some((f) => {
      const abs = path.join(SRC, row.dir, f);
      return fs.existsSync(abs) && /\.strict\(\)/.test(fs.readFileSync(abs, 'utf-8'));
    });
    if (!anyStrict) {
      errors.push(
        `ledger:${row.line} — row claims "strict as of" but no listed file contains \`.strict()\`:\n` +
        `    ${row.files.map((f) => `${row.dir}/${f}`).join(', ')}\n` +
        `    → the claim is stale; the ratchet was reverted or the schema moved.`,
      );
    }
  }
}

// Coverage ratchet — a new .zod.ts in a triaged directory is undeclared surface.
for (const [d, declared] of declaredByDir) {
  const dirPath = path.join(SRC, d);
  if (!fs.existsSync(dirPath)) continue;
  // Recursive — see lib/strictness-ledger.ts for why that is load-bearing.
  // Nested files are declared by their path relative to the section directory
  // (`driver/postgres.zod.ts`), which the row parser already accepts.
  const onDisk = listSchemaFiles(dirPath);
  // Zero-site files carry nothing to classify (see the header note). They become
  // reportable the moment they grow a `z.object(`.
  const missing = onDisk.filter((f) => !declared.has(f) && countSites(path.join(dirPath, f)) > 0);
  if (missing.length) {
    errors.push(
      `\`${d}/\` has ${missing.length} undeclared schema file(s) with sites: ` +
      `${missing.map((f) => `${f} (${countSites(path.join(dirPath, f))})`).join(', ')}\n` +
      `    → add a row to the ${d}/ table with its site count and a Class verdict ` +
      `(authorable / wire / open — see the classification rule at the top of the ledger).`,
    );
  }
}

// Section arithmetic.
for (const [d, { declared, line }] of sectionTotals) {
  const sum = rows.filter((r) => r.dir === d).reduce((a, r) => a + r.counts.reduce((x, y) => x + y, 0), 0);
  if (sum !== declared) {
    errors.push(
      `ledger:${line} — \`${d}/\` header says ${declared} sites, rows sum to ${sum}.\n` +
      `    → update the header to match the rows.`,
    );
  }
}

if (errors.length) {
  console.error(`\n✗ strictness ledger: ${errors.length} drift(s)\n`);
  for (const e of errors) console.error(`  ${e}\n`);
  console.error(`  The ledger is ${path.relative(REPO, LEDGER)}.\n`);
  process.exit(1);
}

const fileCount = rows.reduce((a, r) => a + r.files.length, 0);
console.log(
  `✓ strictness ledger: ${fileCount} file(s) across ${sectionTotals.size} triaged director(ies) — ` +
  `site counts match, no undeclared schema files, section totals balance.`,
);
