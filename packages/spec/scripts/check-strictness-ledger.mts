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
//   1. Site counts. Every object-constructing CALL in the file, read from the AST.
//      A count that no longer matches means someone added or removed a schema without
//      reclassifying it, and the row's `Class` verdict now covers sites nobody
//      triaged. This is the ratchet: touching a file forces you back through the
//      ledger.
//      The counting used to be a regex over the source text, and the #4001
//      re-measurement found it wrong in BOTH directions on seven files: it counted
//      `z.object({…})` written inside JSDoc prose, and it missed the prettier-wrapped
//      `z\n  .object({` form and `z.looseObject(` entirely. The worst case was
//      `automation/time-relative-trigger.zod.ts`, which read as ZERO sites — and a
//      zero-site file is deliberately SKIPPED by check 2, so an authorable schema sat
//      outside the map while this gate printed "no undeclared schema files". Same
//      shape as the non-recursive walk below, one layer further in: not the walk
//      blind, but the counter feeding it. See `lib/strictness-ledger.ts`.
//   5. The remaining-strip map. The triage tables say how much surface exists; that
//      never answered how much is still OPEN, which is the number batches are planned
//      against. Gated in both directions: a file with strip sites must have a row with
//      matching counts, AND a row whose file has reached zero strip sites FAILS, so a
//      closed file drops out. The reverse pin matters more than the forward one — this
//      ledger has already had to record that it once listed a shipped feature as a
//      TODO, and a worklist that can outlive its work will.
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
//      actually contains `.strict()` or `strictObject(`. This is deliberately weak — it proves the claim
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

import { analyzeSites, countSites, countStripSites, listSchemaFiles } from './lib/strictness-ledger';

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
      if (!fs.existsSync(abs)) return false;
      // `strictObject(` counts as strictness, same as a literal `.strict()` —
      // the helper applies it. Matching only `.strict()` made a converted file
      // read as NOT strict, so this check called a true claim a lie. Same blind
      // spot as the site count had: the measuring tool has to learn the idiom
      // whenever the idiom changes.
      return /\.strict\(\)|(?<![A-Za-z0-9_])strictObject\(/.test(fs.readFileSync(abs, 'utf-8'));
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

// ── The remaining-strip-site map (#4001 re-measurement) ─────────────────────
//
// The triage tables above say how much surface exists; they never said how much
// of it is still OPEN. That number is what every batch plan is scheduled
// against, and until it was measured the campaign was planning off counts of
// `strictObject(` occurrences — which miss every schema closed with the older
// `z.object(…).strict()` idiom, reading `automation/` as 0 strict when it has 8.
//
// So it is a table now, and gated in BOTH directions:
//   forward — a file with strip sites must have a row with the right counts;
//   reverse — a row whose file has reached zero strip sites FAILS.
//
// The reverse pin is the important half. A worklist that can outlive its work
// will: this ledger has already had to record that it once listed a shipped
// feature as a TODO, and the ADR-0010 debt list needed the same pin for the same
// reason. A row that cannot survive its own completion cannot rot.
interface StripRow { dir: string; file: string; strip: number; total: number; line: number }
const stripRows: StripRow[] = [];
const stripTotals = new Map<string, { strip: number; total: number; line: number }>();
let sdir: string | null = null;

for (let i = 0; i < md.length; i++) {
  const line = md[i];
  const header = line.match(/^#### `([a-z-]+)\/` — (\d+) strip of (\d+)/);
  if (header) {
    sdir = header[1];
    stripTotals.set(sdir, { strip: Number(header[2]), total: Number(header[3]), line: i + 1 });
    continue;
  }
  if (/^#{2,4} /.test(line) && !header) sdir = null;
  if (!sdir || !line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 4) continue;
  const file = cells[0].match(/^`([^`]+\.zod\.ts)`$/)?.[1];
  if (!file || !/^\d+$/.test(cells[1]) || !/^\d+$/.test(cells[2])) continue;
  stripRows.push({ dir: sdir, file, strip: Number(cells[1]), total: Number(cells[2]), line: i + 1 });
}

const stripDeclared = new Map<string, Map<string, StripRow>>();
for (const row of stripRows) {
  const perDir = stripDeclared.get(row.dir) ?? new Map<string, StripRow>();
  stripDeclared.set(row.dir, perDir);
  perDir.set(row.file, row);

  const abs = path.join(SRC, row.dir, row.file);
  if (!fs.existsSync(abs)) {
    errors.push(
      `ledger:${row.line} — remaining-strip map lists \`${row.dir}/${row.file}\`, which does not exist.\n` +
      `    → the file moved or was deleted; drop the row.`,
    );
    continue;
  }
  const sites = analyzeSites(abs);
  const strip = sites.filter((s) => s.posture === 'strip').length;
  if (strip === 0) {
    errors.push(
      `ledger:${row.line} — \`${row.dir}/${row.file}\` has NO strip sites left, but still has a row in the\n` +
      `    remaining-strip map.\n` +
      `    → the file is CLOSED: delete the row and decrement the "${row.dir}/ — N strip of M" header.\n` +
      `      This table is a worklist; a row that outlives its work is how this ledger rotted before.`,
    );
  } else if (strip !== row.strip || sites.length !== row.total) {
    errors.push(
      `ledger:${row.line} — \`${row.dir}/${row.file}\` declares ${row.strip} strip of ${row.total}, found ${strip} of ${sites.length}.\n` +
      `    → ${strip < row.strip ? 'sites were closed' : 'sites were opened or added'}. Update the row (and the section header),\n` +
      `    and confirm the Class verdict still covers what is left.`,
    );
  }
}

for (const [d, perDir] of stripDeclared) {
  const dirPath = path.join(SRC, d);
  if (!fs.existsSync(dirPath)) continue;
  const missing = listSchemaFiles(dirPath)
    .filter((f) => !perDir.has(f) && countStripSites(path.join(dirPath, f)) > 0);
  if (missing.length) {
    errors.push(
      `\`${d}/\` has ${missing.length} file(s) with strip sites missing from the remaining-strip map: ` +
      `${missing.map((f) => `${f} (${countStripSites(path.join(dirPath, f))})`).join(', ')}\n` +
      `    → add a row under \`#### \\\`${d}/\\\`\` with its strip/total counts and a per-schema Class verdict.`,
    );
  }
}

for (const [d, { strip, total, line }] of stripTotals) {
  const rows = stripRows.filter((r) => r.dir === d);
  const sumStrip = rows.reduce((a, r) => a + r.strip, 0);
  const dirPath = path.join(SRC, d);
  const actualTotal = fs.existsSync(dirPath)
    ? listSchemaFiles(dirPath).reduce((a, f) => a + countSites(path.join(dirPath, f)), 0)
    : 0;
  if (sumStrip !== strip) {
    errors.push(
      `ledger:${line} — \`${d}/\` remaining-strip header says ${strip} strip, rows sum to ${sumStrip}.\n` +
      `    → update the header to match the rows.`,
    );
  }
  if (total !== actualTotal) {
    errors.push(
      `ledger:${line} — \`${d}/\` remaining-strip header says "of ${total}", the directory has ${actualTotal} sites.\n` +
      `    → update the header; it must match the triage section total for the same directory.`,
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
const openStrip = stripRows.reduce((a, r) => a + r.strip, 0);
console.log(
  `✓ strictness ledger: ${fileCount} file(s) across ${sectionTotals.size} triaged director(ies) — ` +
  `site counts match, no undeclared schema files, section totals balance.`,
);
console.log(
  `✓ remaining-strip map: ${stripRows.length} open file(s) / ${openStrip} strip site(s) across ` +
  `${stripTotals.size} director(ies) — counts match, no file with strip sites is missing a row, ` +
  `no closed file still carries one.`,
);
