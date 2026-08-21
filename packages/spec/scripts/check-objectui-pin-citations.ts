#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui pin CITATION gate — spec prose that claims to name the pin this repo
 * builds against must actually name it (#10274).
 *
 *   pnpm --filter @objectstack/spec check:objectui-pin-citations
 *   pnpm --filter @objectstack/spec check:objectui-pin-citations --self-test
 *   pnpm --filter @objectstack/spec check:objectui-pin-citations --list
 *
 * ## WHY THIS EXISTS
 *
 * `packages/spec/src` carries READ-POINT RECORDS: docblocks and test-block
 * headers that say "this key is LIVE, and here is the objectui file:line that
 * reads it". They exist for exactly one reason — so a liveness sweep does not
 * have to re-derive a cross-repo read point before it can rule on a key. The
 * measured cost of the absence was a full dispatch cycle (#9397), which is what
 * bought #9881 and #9972.
 *
 * A read point is only re-checkable if the reader knows WHICH objectui tree the
 * line numbers were counted in, so each record anchors itself to the pin:
 * "the objectui pin this repo builds against (`.objectui-sha` = `<sha>`)".
 *
 * Nothing linked that sentence to the pin file. #10137 moved `.objectui-sha`
 * and four records went on asserting a pin the repo no longer builds against.
 * The records did not become WRONG — the anchors still held — they became
 * UNVERIFIABLE, which is the precise state they were written to end: an auditor
 * who checks the anchor finds a sha that is not the pin and is back to not
 * knowing whether the line numbers hold. And the class recurs on EVERY pin bump,
 * silently, because prose has no dependency edge.
 *
 * This gate is that edge. A citation in the asserting spelling must equal the
 * pin file, so the next bump fails loudly on the records it invalidates.
 *
 * ## THE TWO SPELLINGS, AND WHY THE DISTINCTION IS THE WHOLE DESIGN
 *
 * Two different things get said about a sha in this tree, and only one of them
 * can rot:
 *
 *   ASSERTING   `.objectui-sha` = `<sha>`        "this IS the pin we build against"
 *   HISTORICAL  `.objectui-sha` pin `<sha>`      "this is where the measurement was taken"
 *
 * The asserting form makes a claim about TODAY and is checked against the pin
 * file. The historical form is a dated record of a past measurement — #5010's
 * ruling being absorbed at pin `09987b68`, a renderer's branch semantics
 * measured at `665661ab0932` — and a later pin bump does not falsify it. Forcing
 * those to the current pin would demand re-measuring settled history on every
 * bump, and rewriting the sha without re-measuring would be a lie the gate had
 * manufactured.
 *
 * So the SPELLING is load-bearing: it is how an author declares which claim they
 * are making, and the gate enforces the one they chose.
 *
 * ## WHY AN UNRECOGNISED SPELLING IS A FAILURE, NOT A SKIP
 *
 * A source scan sees only the spellings it knows, and an unrecognised one
 * produces no flag — no declaration, SILENTLY (AGENTS.md states this for
 * `check:cross-package-test-inputs`, which learned it the hard way). So a
 * `.objectui-sha` mention that names a sha-shaped token in NEITHER form is a
 * hard failure asking the author to pick one. That is what keeps the population
 * honest: you cannot leave the gate's field of view by phrasing around it.
 *
 * Three of these existed when the gate landed and were normalised with it — two
 * citations that WRAPPED across comment lines, and one parenthetical that omitted
 * the keyword. (Wrapping is handled generally now, see below; the keyword is not.)
 *
 * ## WHAT IS DELIBERATELY OUT OF POPULATION
 *
 *   - **`.objectui-sha` mentions that name no sha** ("measured at the
 *     `.objectui-sha` pin", pointing at a FILE rather than a line). Nothing in
 *     them can rot: they make no falsifiable claim about a particular tree.
 *     They are skipped, not excused.
 *   - **Everything outside `packages/spec/src`.** CHANGELOGs, `.changeset/*.md`
 *     and `content/docs/releases/**` are HISTORICAL RECORDS by construction —
 *     a released note describing the pin at release time must never be rewritten
 *     to today's pin. `examples/**` dogfood records ("verified in a browser at
 *     pinned objectui `82a94170c405`") are dated observations, the historical
 *     form in different words. `scripts/objectui-changeset-digest.mjs` names
 *     `.changeset/console-82a94170c405.md` — a FILENAME in a worked example, not
 *     a citation at all. None of these is a claim about the current pin, so none
 *     joins the population. Widening to another package's sources is a later
 *     decision, and would want that package's records read first.
 *
 * ## WHY IT SCANS RAW TEXT AND NOT `scripts/js-comment-mask.mjs`
 *
 * That helper is the one answer to "is this span comment or code?", and every
 * gate that must DECIDE that question owes it the call. This gate does not have
 * the question: a pin citation is a pin citation wherever it is written, and a
 * `.objectui-sha` sha in a string literal would be just as much a claim as one
 * in a docblock. Nothing is stripped here, so there is no private
 * `stripComments` to drift.
 *
 * Wrapped prose IS handled, because a record that spans two comment lines is
 * ordinary and must not have to be reflowed for a matcher's convenience: each
 * line's comment decoration is peeled and the lines are joined before matching,
 * with a per-character map back to the original line so a failure reports the
 * line a reader can open.
 *
 * ## WHY THERE IS NO `gen:` THAT FIXES THIS
 *
 * The obvious automation — rewrite every cited sha to the pin — is the one thing
 * this gate must never do, and the reason is the failure it exists to catch. The
 * sha is not the record; the FILE:LINE ANCHORS are, and they are only true of the
 * tree they were counted in. A find-and-replace would make every record CLAIM the
 * current pin while its anchors still described the old one — converting a loud,
 * accurate "unverifiable" into a silent, confident lie, which is strictly worse
 * than the rot. Re-measuring is a human/agent act, and #10274 is why that is not
 * theoretical: re-measuring at the new pin found that two of the four anchors had
 * been WRONG SINCE THEY WERE WRITTEN (`662-665` and `851-853` truncated JSX
 * expressions that really span `662-668` and `851-857` — identical at both pins,
 * so a sha-only rewrite would have preserved both errors and hidden them behind a
 * fresh-looking sha).
 *
 * Hence NO_GENERATOR in the `check:generated` ledger, for
 * `check:browser-reachable-entries`' reason exactly: a `gen:` here would grant by
 * running a command the one thing that has to be earned by measurement.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const REPO = path.resolve(SPEC, '../..');
const SRC = path.join(SPEC, 'src');
const PIN_FILE = path.join(REPO, '.objectui-sha');

const LIST = process.argv.includes('--list');

/** How far past a `.objectui-sha` mention a citation may reach. */
const WINDOW = 160;

/**
 * A sha-shaped token: hex, at least git's 7-char abbreviation floor, and
 * carrying at least one DIGIT.
 *
 * The digit is what keeps the "unrecognised spelling" arm from firing on prose:
 * `[0-9a-f]{7,}` alone matches ordinary English words (`defaced`, `effaced`), and
 * this gate's unclassified arm is a hard failure, so a false positive there costs
 * a reader real time. Every abbreviated git sha in this tree carries a digit.
 */
const SHA_TOKEN = String.raw`(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}`;

const MENTION = /`?\.objectui-sha`?/g;
const ASSERTING = new RegExp(String.raw`^\`?\.objectui-sha\`?\s*=\s*\`(${SHA_TOKEN})\``, 'i');
const HISTORICAL = new RegExp(String.raw`^\`?\.objectui-sha\`?\s+pin\s*\(?\s*\`(${SHA_TOKEN})\``, 'i');
/** Same two, with the backticks around the sha missing — a near-miss, not a new form. */
const ASSERTING_BARE = new RegExp(String.raw`^\`?\.objectui-sha\`?\s*=\s*(${SHA_TOKEN})\b`, 'i');
const HISTORICAL_BARE = new RegExp(String.raw`^\`?\.objectui-sha\`?\s+pin\s*\(?\s*(${SHA_TOKEN})\b`, 'i');
const ANY_SHA = new RegExp(String.raw`\b${SHA_TOKEN}\b`, 'i');

type Citation = {
  file: string;
  line: number;
  kind: 'asserting' | 'historical';
  sha: string;
};

type Problem = { file: string; line: number; message: string[] };

// ---------------------------------------------------------------------------
// Flattening — a citation that wraps across comment lines is still one citation
// ---------------------------------------------------------------------------

type Flat = { text: string; lineOf: number[] };

/**
 * Peel each line's comment decoration and join, keeping a per-character map back
 * to the original 1-based line number.
 *
 * Blank-and-keep-offsets (the `js-comment-mask` discipline) is not available
 * here: the whole point is to CLOSE the gap a wrap opens, which necessarily
 * moves offsets. The line map is what preserves the property that matters — a
 * failure names a line a reader can open.
 */
export function flatten(source: string): Flat {
  const lines = source.split('\n');
  let text = '';
  const lineOf: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const content = raw.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?)\s?/, '');
    for (let k = 0; k < content.length; k++) {
      text += content[k];
      lineOf.push(i + 1);
    }
    text += ' ';
    lineOf.push(i + 1);
  }
  return { text, lineOf };
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

export function scanFile(rel: string, source: string): { citations: Citation[]; problems: Problem[] } {
  const citations: Citation[] = [];
  const problems: Problem[] = [];
  const { text, lineOf } = flatten(source);

  MENTION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION.exec(text)) !== null) {
    const at = m.index;
    const line = lineOf[at] ?? 0;
    const window = text.slice(at, at + WINDOW);

    const asserting = ASSERTING.exec(window);
    if (asserting) {
      citations.push({ file: rel, line, kind: 'asserting', sha: asserting[1]!.toLowerCase() });
      continue;
    }
    const historical = HISTORICAL.exec(window);
    if (historical) {
      citations.push({ file: rel, line, kind: 'historical', sha: historical[1]!.toLowerCase() });
      continue;
    }

    const bare = ASSERTING_BARE.exec(window) ?? HISTORICAL_BARE.exec(window);
    if (bare) {
      problems.push({
        file: rel,
        line,
        message: [
          `the cited sha \`${bare[1]}\` is not written in backticks.`,
          `Spell it \`` + '`' + `${bare[1]}` + '`' + `\` — the backticks are what make the citation`,
          `mechanically findable, and a citation this gate cannot find is a citation`,
          `nothing re-checks when the pin moves.`,
        ],
      });
      continue;
    }

    // Neither form. Only a failure if a sha is actually being named — a mention
    // that points at a FILE names nothing that can rot.
    if (ANY_SHA.test(window)) {
      problems.push({
        file: rel,
        line,
        message: [
          `names a sha in neither recognised citation spelling.`,
          `Pick the one that says what you mean:`,
          '',
          '  `.objectui-sha` = `<sha>`     this IS the pin we build against (checked here)',
          '  `.objectui-sha` pin `<sha>`   measured AT that pin (a dated record, not checked)',
          '',
          `An unrecognised spelling is not a pass: it leaves the citation outside every`,
          `check, which is the silent state this gate exists to remove.`,
        ],
      });
    }
  }
  return { citations, problems };
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|mts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc.sort();
}

export function readPin(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`pin file not found: ${file}`);
  }
  const raw = readFileSync(file, 'utf8').trim();
  if (!/^[0-9a-f]{40}$/i.test(raw)) {
    throw new Error(`pin file ${file} does not hold a 40-char sha: ${JSON.stringify(raw)}`);
  }
  return raw.toLowerCase();
}

// ---------------------------------------------------------------------------
// self-test — the shapes, not the corpus
// ---------------------------------------------------------------------------

function selfTest(): never {
  const failures: string[] = [];
  const PIN = '9a3daf8d37ad973a621e5edd276fe32467f90684';
  const check = (ok: boolean, what: string): void => { if (!ok) failures.push(what); };

  const scan = (src: string) => scanFile('fixture.ts', src);

  // ── the asserting form, both verdicts ───────────────────────────────────
  {
    const { citations, problems } = scan('// builds against — `.objectui-sha` = `9a3daf8d3`.\n');
    check(problems.length === 0, 'asserting/current: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'asserting', 'asserting/current: classified asserting');
    check(citations[0] !== undefined && PIN.startsWith(citations[0].sha), 'asserting/current: sha is a pin prefix');
  }
  {
    const { citations } = scan('// builds against — `.objectui-sha` = `82a94170c`.\n');
    check(citations.length === 1, 'asserting/stale: found');
    check(citations[0] !== undefined && !PIN.startsWith(citations[0].sha), 'asserting/stale: NOT a pin prefix — this is the founding failure');
  }

  // ── the historical form is NOT checked against the pin ──────────────────
  {
    const { citations, problems } = scan('// measured at the `.objectui-sha` pin `665661ab0932`: the renderer\n');
    check(problems.length === 0, 'historical: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'historical', 'historical: classified historical');
    check(citations[0] !== undefined && !PIN.startsWith(citations[0].sha), 'historical: an old sha here is legitimate, not rot');
  }
  {
    // The parenthesised variant this tree actually writes.
    const { citations, problems } = scan('// measured against objectui at the `.objectui-sha` pin (`09987b68`) rather\n');
    check(problems.length === 0, 'historical/parens: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'historical', 'historical/parens: classified historical');
  }

  // ── a citation that WRAPS is still one citation ─────────────────────────
  {
    const { citations, problems } = scan(
      '// Both re-measured at the pin this repo builds against —\n' +
      '// `.objectui-sha` = `9a3daf8d3`. These two were the first records\n',
    );
    check(problems.length === 0, 'wrapped: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'asserting', 'wrapped: found across the line break');
  }
  {
    // Wrapped BETWEEN the token and the sha — the shape that was unfindable
    // before this gate and is the reason flattening exists.
    const { citations, problems } = scan(
      ' * measured at the `.objectui-sha` pin\n' +
      ' * `82a9417` (re-verified identical at objectui `origin/main` `6c68b13`)\n',
    );
    check(problems.length === 0, 'wrapped-mid: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'historical', 'wrapped-mid: found across the line break');
    check(citations[0]?.line === 1, 'wrapped-mid: reports the line the mention opens on');
  }

  // ── unrecognised spellings FAIL rather than slipping through ────────────
  {
    const { citations, problems } = scan('// both read off the console build (`.objectui-sha` 6314e87f2, `plugin-grid`):\n');
    check(citations.length === 0, 'unclassified: not counted as a citation');
    check(problems.length === 1, 'unclassified: a sha in neither form must FAIL');
  }
  {
    const { problems } = scan('// builds against — `.objectui-sha` = 82a94170c.\n');
    check(problems.length === 1, 'bare sha after `=`: near-miss must FAIL');
    check(problems[0]?.message.join(' ').includes('backticks') === true, 'bare sha after `=`: message names the fix');
  }

  // ── a mention naming NO sha is skipped, and prose does not false-flag ───
  {
    const { citations, problems } = scan('// from the renderers\' read points at the `.objectui-sha` pin; see the\n');
    check(citations.length === 0 && problems.length === 0, 'sha-free mention: skipped, not excused');
  }
  {
    // The all-hex-letters English words the digit requirement exists to exclude.
    const { problems } = scan('// the `.objectui-sha` pin, whose earlier claim was defaced and effaced\n');
    check(problems.length === 0, 'hex-looking prose without a digit must not be read as a sha');
  }
  {
    // A mention inside a PATH, which is how the CLI writes it.
    const { citations, problems } = scan("const stamp = path.join(dir, 'dist', '.objectui-sha');\n");
    check(citations.length === 0 && problems.length === 0, 'a path mention names no sha and is skipped');
  }

  // ── pin-file validation ─────────────────────────────────────────────────
  {
    let threw = false;
    try { readPin(path.join(REPO, 'does-not-exist-.objectui-sha')); } catch { threw = true; }
    check(threw, 'readPin: a missing pin file must throw, never default');
  }

  // ── vacuous-green guard: the real tree must contain citations ───────────
  {
    const files = sourceFiles(SRC);
    check(files.length > 0, 'discovery: found no spec sources at all');
    let found = 0;
    for (const f of files) found += scanFile(f, readFileSync(f, 'utf8')).citations.length;
    check(found > 0, 'discovery: found zero citations in the real tree — the matcher or the scope has moved');
  }

  if (failures.length) {
    for (const f of failures) console.error(`✗ self-test: ${f}`);
    console.error(`\ncheck-objectui-pin-citations --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    '✅  self-test: asserting citations are checked against the pin and historical ones are not;\n' +
      '    a citation wrapped across comment lines is still found (both wrap positions); a sha in\n' +
      '    neither spelling and a sha missing its backticks both FAIL; a mention naming no sha is\n' +
      '    skipped; hex-looking prose without a digit is not a sha; a missing pin file throws.',
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------

function main(): void {
  if (process.argv.includes('--self-test')) selfTest();

  const pin = readPin(PIN_FILE);
  const files = sourceFiles(SRC);

  const citations: Citation[] = [];
  const problems: Problem[] = [];
  for (const f of files) {
    const rel = path.relative(REPO, f);
    const r = scanFile(rel, readFileSync(f, 'utf8'));
    citations.push(...r.citations);
    problems.push(...r.problems);
  }

  if (LIST) {
    for (const c of citations) {
      const verdict = c.kind === 'historical' ? 'historical' : pin.startsWith(c.sha) ? 'current' : 'STALE';
      console.log(`${c.kind.padEnd(10)} ${c.sha.padEnd(14)} ${verdict.padEnd(10)} ${c.file}:${c.line}`);
    }
    return;
  }

  // Vacuous-green guard. Zero citations is far likelier to mean the records
  // moved (or the matcher stopped seeing them) than that this tree stopped
  // citing the pin — and a gate that checked nothing must not report success.
  if (citations.length === 0) {
    console.error(
      `✗ No objectui pin citations found under ${path.relative(REPO, SRC)}.\n\n` +
        `  The read-point records that cite \`.objectui-sha\` are the population this gate\n` +
        `  exists for, so finding none means they moved or the spelling changed — not that\n` +
        `  there is nothing to check. Re-derive the scope; a gate that reads nothing must\n` +
        `  not report success.\n`,
    );
    process.exit(1);
  }

  const stale = citations.filter((c) => c.kind === 'asserting' && !pin.startsWith(c.sha));
  const asserting = citations.filter((c) => c.kind === 'asserting');

  for (const p of problems) {
    console.error(`✗ ${p.file}:${p.line} — ${p.message[0]}`);
    for (const l of p.message.slice(1)) console.error(l ? `    ${l}` : '');
    console.error('');
  }

  if (stale.length) {
    console.error(
      `✗ ${stale.length} spec source(s) assert an objectui pin this repo does NOT build against.\n\n` +
        `  .objectui-sha = ${pin}\n`,
    );
    for (const c of stale) console.error(`    ${c.file}:${c.line} cites \`${c.sha}\``);
    console.error(
      `\n  ⛔ Do NOT fix this by replacing the sha.\n\n` +
        `  The sha is not the record — the objectui file:line ANCHORS beside it are, and they\n` +
        `  are only true of the tree they were counted in. Rewriting the sha alone makes the\n` +
        `  record CLAIM the current pin while its anchors still describe the old one: a silent,\n` +
        `  confident lie in place of a loud, accurate "unverifiable". #10274 measured that risk\n` +
        `  as real — re-measuring found two anchors that had been wrong since they were written.\n\n` +
        `  RE-MEASURE each record at the current pin instead:\n\n` +
        `    git -C ../objectui show ${pin.slice(0, 9)}:<path> > /tmp/at-pin.tsx\n\n` +
        `  then re-derive every cited line number from THAT file, update the anchors and the\n` +
        `  sha together, and say in the PR body what you measured. If a read point has moved\n` +
        `  or died, the record needs more than a citation refresh — report it rather than\n` +
        `  re-pointing it.\n\n` +
        `  A citation that is a DATED RECORD of a past measurement rather than a claim about\n` +
        `  today belongs in the other spelling, which this gate does not check:\n\n` +
        `    \`.objectui-sha\` pin \`${stale[0]!.sha}\`\n`,
    );
    process.exit(1);
  }

  if (problems.length) {
    console.error(`✗ ${problems.length} unfindable pin citation spelling(s) in ${path.relative(REPO, SRC)}.\n`);
    process.exit(1);
  }

  console.log(
    `✅ ${asserting.length} asserting objectui pin citation(s) match .objectui-sha (${pin.slice(0, 9)}), ` +
      `${citations.length - asserting.length} historical citation(s) recorded and not checked, ` +
      `across ${files.length} spec source(s).`,
  );
}

main();
