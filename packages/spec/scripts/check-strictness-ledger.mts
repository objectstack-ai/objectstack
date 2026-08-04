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
// A map that drifts is worse than no map: it is followed.
//
// ── WHAT CHANGED AT #5107, AND WHY THE GATE'S JOB INVERTED ───────────────────
//
// The ledger's numbers used to be hand-written and this gate compared them against
// the AST. That worked — it is why every count in the file is trustworthy — but it
// left the numbers in the merge path, and the numbers were the ledger's entire
// conflict surface: two batches each decrement a header by their own correct
// delta, git merges the ROWS cleanly (they do not overlap), and the subtotal, which
// conflicts with nothing, merges CLEAN AND WRONG. Seven cases in one day.
//
// So the numbers moved into a generated artifact carrying `merge=os-regen`, and
// this gate proves two things instead of one:
//
//   A. the generated artifact is FRESH — it equals what the AST says right now;
//   B. the hand-written prose is CONSISTENT with it — every row names a real file
//      with real sites, and every file with sites has a row.
//
// Both directions still fail loudly, which is the property that matters:
//   - a stale artifact (someone changed a schema and did not regenerate) → red;
//   - a hand row naming a file that is gone, or that has no sites left → red;
//   - a file with sites and no row → red (undeclared surface);
//   - a strip row whose file has reached ZERO strip sites → red (the reverse pin:
//     a worklist that can outlive its work will).
//
// What the count check bought and this must not lose: touching a schema forced you
// back through the ledger to confirm the `Class` verdict still covered it. It still
// does — the artifact goes stale, this gate goes red, and the failure below says so
// in those words. The fix is now `gen:` plus a read of the diff rather than a
// hand-edited number, which is the point: the arithmetic was never the part a human
// was good at, and it is where all seven of the day's bad merges landed.
//
// WHAT IT STILL DOES NOT CHECK. The `Class` column's correctness — authorable vs
// wire vs open is a human judgement about who writes the input, and the campaign's
// rule is verify-before-tightening. The gate protects the ARITHMETIC and the
// COVERAGE so that judgement is always made against current code. It does now check
// the `Class` cell's FORM (that it is a declared verdict, and that a resolved
// `mixed`/`split` states its split), because the generated subtotal is arithmetic
// over that cell — an unparseable verdict would otherwise be published as a
// confident number, which is this file's own subject matter.
//
// Usage:
//   tsx check-strictness-ledger.mts          # fail on drift
//   tsx check-strictness-ledger.mts --list   # print the parsed rows and their buckets

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { analyzeSites, countSites, countStripSites, listSchemaFiles } from './lib/strictness-ledger';
import {
  BUCKETS,
  COUNTS_PATH,
  GEN_COMMAND,
  LEDGER_PATH,
  VERDICTS,
  bucketize,
  loadLedger,
  parseClassCell,
} from './lib/strictness-ledger-doc';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const REPO = path.resolve(SPEC, '../..');
const SRC = path.join(SPEC, 'src');
const LIST = process.argv.includes('--list');

const { parsed, model, problems, rendered, countsPath, ledgerText } = loadLedger(REPO, SRC);

if (LIST) {
  for (const t of model.triaged) {
    console.log(`${t.dir}/ — ${t.sites} sites, ${t.strip} strip`);
    for (const f of t.files) console.log(`  ${f.file}  sites=${f.sites} strip=${f.strip}`);
    for (const b of BUCKETS) if (t.buckets[b]) console.log(`  bucket ${b} = ${t.buckets[b]}`);
  }
  process.exit(0);
}

const errors: string[] = [...problems];

/* ── A. the generated artifact is fresh ────────────────────────────────────── */
//
// Byte comparison against a re-render, not a re-parse of the artifact. A parser
// reading it back would be a second implementation of the same truth, and when two
// implementations disagree the one that wins is whichever the gate happens to
// call — which is how a green check ends up standing over a wrong file. This
// campaign has that scar in four separate instruments already.

/** The first few differing lines, as `- on disk` / `+ expected`. */
function firstDifferences(actual: string, expected: string, limit = 6): string {
  const a = actual.split('\n');
  const b = expected.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit * 2; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`      - ${a[i]}`);
    if (b[i] !== undefined) out.push(`      + ${b[i]}`);
  }
  return out.length ? `    first difference(s) (- on disk, + expected):\n${out.join('\n')}\n` : '';
}

if (!fs.existsSync(countsPath)) {
  errors.push(`${COUNTS_PATH} is MISSING.\n    → ${GEN_COMMAND}`);
} else {
  const onDisk = fs.readFileSync(countsPath, 'utf-8');
  if (onDisk !== rendered) {
    errors.push(
      `${COUNTS_PATH} is STALE — it does not match what the AST says right now.\n` +
        `    → ${GEN_COMMAND}\n` +
        `    Then READ the diff: a count that moved means a schema was added, removed or\n` +
        `    re-postured under a \`Class\` verdict nobody re-examined. Confirm the verdict in\n` +
        `    ${LEDGER_PATH} still covers it — that re-read is what\n` +
        `    the old hand-written counts bought, and it is the half of them worth keeping.\n` +
        `    ⛔ Never hand-patch a number in the artifact. Regeneration is wholesale.\n` +
        firstDifferences(onDisk, rendered),
    );
  }
}

/* ── B. the hand-written prose is consistent with the code ─────────────────── */

// B1. Triage rows — every declared file must exist AND still have sites.
//
// The second half is the reverse pin the per-file count used to provide for free:
// a row over a file with nothing left to classify is a verdict about nothing, and
// it reads to the next batch as surface that was triaged.
const ledgerLines = ledgerText.split('\n');
const declaredByDir = new Map<string, Set<string>>();
for (const row of parsed.triage) {
  const declared = declaredByDir.get(row.dir) ?? new Set<string>();
  declaredByDir.set(row.dir, declared);

  for (const file of row.files) {
    declared.add(file);
    const abs = path.join(SRC, row.dir, file);
    if (!fs.existsSync(abs)) {
      errors.push(
        `ledger:${row.line} — lists \`${row.dir}/${file}\`, which does not exist.\n` +
          `    → the file moved or was deleted; update or drop the row.`,
      );
      continue;
    }
    if (countSites(abs) === 0) {
      errors.push(
        `ledger:${row.line} — \`${row.dir}/${file}\` has NO object sites, but still has a triage row.\n` +
          `    → this ledger classifies SITES and this file has none left to classify (a pure\n` +
          `      enum/token module is deliberately never declared). Drop the row — and check\n` +
          `      whether the sites moved to a file that now needs one.`,
      );
    }
  }

  // B2. The "strict as of" claim, read from the row's own line. Deliberately weak:
  // it proves the claim is not fiction, not that every site in the file is strict.
  if (!/strict as of/i.test(ledgerLines[row.line - 1] ?? '')) continue;
  const anyStrict = row.files.some((f) => {
    const abs = path.join(SRC, row.dir, f);
    if (!fs.existsSync(abs)) return false;
    // `strictObject(` counts as strictness, same as a literal `.strict()` — the
    // helper applies it. Matching only `.strict()` made a converted file read as
    // NOT strict, so this check once called a true claim a lie.
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

// B3. Triage coverage ratchet — a new .zod.ts in a triaged directory is undeclared
// surface. The walk is RECURSIVE; see lib/strictness-ledger.ts for why that is
// load-bearing (`data/driver/` sat outside the map behind a one-level walk while
// this gate printed "no undeclared schema files").
for (const [d, declared] of declaredByDir) {
  const dirPath = path.join(SRC, d);
  if (!fs.existsSync(dirPath)) continue;
  // Zero-site files carry nothing to classify. They become reportable the moment
  // they grow a `z.object(`.
  const missing = listSchemaFiles(dirPath).filter((f) => !declared.has(f) && countSites(path.join(dirPath, f)) > 0);
  if (missing.length) {
    errors.push(
      `\`${d}/\` has ${missing.length} undeclared schema file(s) with sites: ` +
        `${missing.map((f) => `${f} (${countSites(path.join(dirPath, f))})`).join(', ')}\n` +
        `    → add a row to the ${d}/ triage table with a Class verdict (authorable / wire /\n` +
        `      open / no door / no gate — see the classification rule at the top of the ledger).\n` +
        `      The site COUNT is generated; do not write one into the row.`,
    );
  }
}

// B4. The remaining-strip map, gated in BOTH directions.
//
//   forward — a file with strip sites must have a row;
//   reverse — a row whose file has reached zero strip sites FAILS.
//
// The reverse pin is the important half. A worklist that can outlive its work
// will: this ledger has already had to record that it once listed a shipped
// feature as a TODO, and the ADR-0010 debt list needed the same pin for the same
// reason. A row that cannot survive its own completion cannot rot.
const stripDeclared = new Map<string, Set<string>>();
for (const row of parsed.strip) {
  const perDir = stripDeclared.get(row.dir) ?? new Set<string>();
  stripDeclared.set(row.dir, perDir);
  perDir.add(row.file);

  const abs = path.join(SRC, row.dir, row.file);
  if (!fs.existsSync(abs)) {
    errors.push(
      `ledger:${row.line} — remaining-strip map lists \`${row.dir}/${row.file}\`, which does not exist.\n` +
        `    → the file moved or was deleted; drop the row.`,
    );
    continue;
  }
  const strip = analyzeSites(abs).filter((s) => s.posture === 'strip').length;
  if (strip === 0) {
    errors.push(
      `ledger:${row.line} — \`${row.dir}/${row.file}\` has NO strip sites left, but still has a row in the\n` +
        `    remaining-strip map.\n` +
        `    → the file is CLOSED: delete the row. The header and the subtotal are generated and\n` +
        `      will follow — do not adjust a number by hand.\n` +
        `      This table is a worklist; a row that outlives its work is how this ledger rotted before.`,
    );
    continue;
  }

  // The Class cell is a machine-readable input to the generated subtotal, so its
  // FORM is gated here (never its verdict).
  const parsedClass = parseClassCell(row.classCell);
  if (!parsedClass) {
    errors.push(
      `ledger:${row.line} — \`${row.dir}/${row.file}\`'s Class cell "${row.classCell}" is not a verdict.\n` +
        `    → one of: ${VERDICTS.join(', ')}; optionally \` (p)\`; optionally a split\n` +
        `      (\`mixed · 6 authorable, 2 wire\`). The subtotal is generated from this cell.`,
    );
  } else {
    const res = bucketize(parsedClass, strip);
    if ('error' in res) errors.push(`ledger:${row.line} — \`${row.dir}/${row.file}\` ${res.error}`);
  }
}

for (const [d, perDir] of stripDeclared) {
  const dirPath = path.join(SRC, d);
  if (!fs.existsSync(dirPath)) continue;
  const missing = listSchemaFiles(dirPath).filter(
    (f) => !perDir.has(f) && countStripSites(path.join(dirPath, f)) > 0,
  );
  if (missing.length) {
    errors.push(
      `\`${d}/\` has ${missing.length} file(s) with strip sites missing from the remaining-strip map: ` +
        `${missing.map((f) => `${f} (${countStripSites(path.join(dirPath, f))})`).join(', ')}\n` +
        `    → add a row under \`#### \\\`${d}/\\\` — remaining strip sites\` with a per-schema Class\n` +
        `      verdict. The strip/site COUNTS are generated; do not write them into the row.`,
    );
  }
}

// B5. A triaged directory with open files must carry a remaining-strip section.
// Without this the whole section could vanish and the forward pin above would
// never run for it — "0 strip" and "nobody looked" must not read the same.
for (const dir of parsed.triagedDirs) {
  const t = model.triaged.find((x) => x.dir === dir);
  if (t && t.openFiles.length > 0 && !parsed.stripDirs.includes(dir)) {
    errors.push(
      `\`${dir}/\` has ${t.openFiles.length} file(s) with strip sites but no remaining-strip section.\n` +
        `    → add \`#### \\\`${dir}/\\\` — remaining strip sites\` with a row per open file.`,
    );
  }
}

/* ── report ───────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`\n✗ strictness ledger: ${errors.length} drift(s)\n`);
  for (const e of errors) console.error(`  ${e}\n`);
  console.error(`  The ledger is ${LEDGER_PATH} (prose — hand-written).`);
  console.error(`  The counts are ${COUNTS_PATH} (generated — ${GEN_COMMAND}).\n`);
  process.exit(1);
}

const triageFiles = parsed.triage.reduce((a, r) => a + r.files.length, 0);
console.log(
  `✓ strictness ledger: ${triageFiles} file(s) across ${parsed.triagedDirs.length} triaged director(ies) — ` +
    `every row names a live sited file, no undeclared schema files.`,
);
console.log(
  `✓ remaining-strip map: ${parsed.strip.length} open file(s) / ${model.global.strip} strip site(s) across ` +
    `${parsed.stripDirs.length} director(ies) — no file with strip sites is missing a row, ` +
    `no closed file still carries one, every Class cell resolves.`,
);
console.log(
  `✓ ${COUNTS_PATH} is current — ${model.global.sites} site(s) measured, ` +
    `${model.global.buckets.authorable} authorable strip site(s) left.`,
);
