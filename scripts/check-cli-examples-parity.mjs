#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-cli-examples-parity (#15393) -- a command whose EXAMPLE SET is written
 * out twice, once in the CLI's `examples` array and once in a documentation
 * page, must carry the same invocations in both places.
 *
 *   node scripts/check-cli-examples-parity.mjs              # judge the table
 *   node scripts/check-cli-examples-parity.mjs --list       # both sides of every row
 *   node scripts/check-cli-examples-parity.mjs --self-test  # prove the battery can go red
 *
 * ## The pair, and the drift that was measured
 *
 * `os package publish` ships its examples twice. `packages/cli/src/commands/
 * package/publish.ts` carries `static override examples`, printed verbatim by
 * oclif under `EXAMPLES`; `content/docs/deployment/cli.mdx` carries the same
 * five invocations in a fenced block under `#### \`os package publish\``. Two
 * hand-maintained copies of one set, and nothing compared them.
 *
 * They came apart. The CLI line carried `# local dev (apps/cloud)` -- a
 * directory deleted from this repo -- while the docs line for the same example
 * said `# against a local control plane` and named no directory. The docs copy
 * was correct for the whole time the shipped `--help` output was wrong, and
 * nothing noticed. PR #15390 made them agree again; this file is the mechanism
 * half, so the next divergence is a red line instead of a customer reading one
 * thing and running another.
 *
 * ## ⛔ This is NOT `check-cli-command-ids`, and does not reopen its refusal
 *
 * `scripts/check-cli-command-ids.mjs` considered covering this same docs page
 * and REFUSED, on the record in its own header: extending it over prose would
 * mean deciding, with no delimiter to lean on, which of 811 `os ...` mentions
 * in `content/docs` is a command and which is a sentence. That refusal is
 * correct and it stands untouched -- that gate asks a different question ("does
 * this literal name a real command?") of a different population (every quoted
 * command-id literal outside the CLI package).
 *
 * The population HERE is a TABLE: one fenced code block under one exact heading
 * on one page, against one named `examples` array in one named source file.
 * There is no prose in it, no guessing which line is a command, and no line
 * enters it that a table row did not point at. A second pair is one more row.
 *
 * A third mechanism touches this pair and is also not this one:
 * `scripts/docs-audit/affected-docs.mjs`'s `command` anchor surfaces `cli.mdx`
 * to a REVIEWER on a diff touching `publish.ts`. That is a prompt, not an
 * assertion, which is exactly why it did not catch the drift above.
 *
 * ## What "the same" means, and the one thing the comparison deliberately drops
 *
 * The two voices legitimately differ. Help text is terse; docs prose annotates.
 * The CLI writes `$ ` prompts; the docs block does not. The two orders differ
 * today (`--install` is third in the CLI and fourth in the docs) and neither is
 * wrong. So what is compared is the SET of invocations, each normalised by:
 *
 *   - stripping a leading `$ ` prompt;
 *   - stripping a trailing `#` comment (only where the `#` opens a shell
 *     comment: at line start or after whitespace, and outside quotes, so a `#`
 *     inside `--note "a # b"` is part of the invocation);
 *   - trimming, and collapsing internal runs of spaces and tabs to one space,
 *     which is what makes the docs block's column alignment invisible here.
 *
 * ORDER IS IGNORED. Commentary is ignored. The invocations may not differ.
 *
 * ## Why a docs fence line that does not invoke the command is CONTEXT
 *
 * Measured before it was decided, on `54e23693b`: the docs block carries SIX
 * lines and the `examples` array carries FIVE. The extra docs line is
 * `os compile` -- the step a reader runs BEFORE publishing, in a block written
 * to be pasted whole. It is not a sixth way to invoke `os package publish` and
 * the CLI's `examples` array could not carry it (an oclif `examples` entry is
 * an example OF the command it is declared on).
 *
 * So the row's command phrase -- derived from the command file's path and the
 * owning package's declared `oclif.bin`, never typed twice -- selects the lines
 * that are compared. A fence line that does not invoke that phrase is a context
 * line: counted, named in the verdict, and not compared. The alternative
 * (compare every fence line) would assert something false about docs blocks --
 * that a teaching transcript may contain nothing but invocations of one command
 * -- and would red today over a line nobody thinks is wrong.
 *
 * The asymmetry is deliberate and runs the other way on the CLI side: an
 * `examples` entry that does NOT invoke the row's command is a FINDING, not a
 * skipped line. Dropping it silently would let an example leave the comparison
 * without anyone deciding that it should.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * Each of these exits 1 naming the row, because each one is a tree this gate
 * could not have judged: an empty table; a command file, docs page or package
 * manifest that cannot be read; an `examples` symbol that is absent or is not a
 * plain array of string literals (a computed array is refused rather than
 * guessed at); a heading that is absent or appears more than once; a heading
 * with no fenced block before the next heading; and ZERO invocations on either
 * side after normalisation -- the anti-vacuity case, where an empty set would
 * otherwise equal an empty set and print a confident green.
 *
 * ## Scope boundary
 *
 * The table, and nothing else. This gate does not scan `content/docs` for pairs
 * it might add, and it does not sweep bare tokens anywhere: a token sweep over
 * this corpus breaks working code (`objectos.ai`, `cloud.objectos.ai`,
 * `DEFAULT_CLOUD_URL` and several literal plugin ids are all correct), which is
 * the trap #14806 records.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
// The CommonMark fence scanner is IMPORTED rather than re-derived. Fence
// parsing has exactly one correct answer per input and this repo already paid
// for it once, with the rules written down and pinned by that gate's own
// self-test. Importing it also records the coupling where the dispatch
// derivation can see it: a change to that parser names this gate.
import { fencedBlocks } from './docs-audit/check-docs-transcript-drift.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');

/** Exit codes. There is no "nothing was measured" pass: see the refusals above. */
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;

/**
 * The population: one row per example set that is written out twice.
 *
 * The four fields are the whole population. `commandFile` and `docsPage` are
 * spelled as repo-relative path LITERALS on purpose -- `scripts/pm/
 * dispatch-gates.mjs` derives a dispatch's gate list from the path literals a
 * gate's module body carries, so this row is what makes a card touching EITHER
 * side of the pair name this gate.
 *
 * `heading` is the exact ATX heading line the docs block sits under. It is a
 * literal because a heading is prose the author chose; the command PHRASE
 * inside it is not typed here at all -- it is derived (see `commandPhrase`) and
 * the heading is required to contain it, so a row pointing at the wrong section
 * is a refusal rather than a comparison of two unrelated blocks.
 */
const PAIRS = Object.freeze([
  Object.freeze({
    id: 'os-package-publish',
    commandFile: 'packages/cli/src/commands/package/publish.ts',
    examplesSymbol: 'examples',
    docsPage: 'content/docs/deployment/cli.mdx',
    heading: '#### `os package publish`',
  }),
]);

/* --------------------------------------------------------- the command phrase */

/**
 * The oclif command phrase a row is about -- `os package publish` -- derived
 * from DECLARED data rather than typed a third time.
 *
 * The id comes from the filesystem convention (`src/commands/<a>/<b>.ts` ->
 * `<a> <b>`, `<a>/index.ts` -> `<a>`), the same derivation
 * `check-cli-command-ids` and `affected-docs.mjs` use. The bin name comes from
 * the owning package's `oclif.bin`, found by walking up from the command file,
 * so a CLI that renames its binary moves this gate with it.
 */
export function commandPhrase(row, root = REPO_ROOT) {
  const marker = '/src/commands/';
  const at = row.commandFile.indexOf(marker);
  if (at < 0) {
    return { problem: `\`commandFile\` ${row.commandFile} is not under a \`src/commands/\` directory, so no oclif command id can be derived from it.` };
  }
  const packageDir = row.commandFile.slice(0, at);
  const manifestRel = `${packageDir}/package.json`;
  const manifestAbs = join(root, manifestRel);
  if (!existsSync(manifestAbs)) {
    return { problem: `the owning package manifest ${manifestRel} does not exist, so the \`oclif.bin\` this row's command phrase is built from cannot be read.` };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestAbs, 'utf8'));
  } catch (err) {
    return { problem: `${manifestRel} did not parse as JSON -- ${err.message}` };
  }
  const bin = manifest?.oclif?.bin;
  if (typeof bin !== 'string' || bin.trim() === '') {
    return { problem: `${manifestRel} declares no \`oclif.bin\`, so this row's command phrase has no binary name. Is ${packageDir} still the CLI package?` };
  }
  const tail = row.commandFile.slice(at + marker.length).replace(/\.[cm]?tsx?$/, '');
  const segments = tail.split('/').filter((s) => s !== '');
  if (segments[segments.length - 1] === 'index') segments.pop();
  if (segments.length === 0) {
    return { problem: `${row.commandFile} derives no command id -- it resolves to the bare topic root.` };
  }
  return { phrase: [bin, ...segments].join(' ') };
}

/* ------------------------------------------------------------ normalisation */

/**
 * One invocation, normalised for comparison. Returns `''` for a line that
 * carries no invocation at all (blank, or comment-only).
 *
 * ⚠️ The trailing-comment strip is the load-bearing half: without it the two
 * sides differ on every annotated line and the gate reds on a tree where
 * nothing is wrong. The self-test's `X1` mutation removes exactly this step and
 * requires the equal-sets case to go red.
 */
export function normaliseInvocation(raw) {
  let text = String(raw ?? '').trim();
  if (text.startsWith('$')) text = text.slice(1).replace(/^[ \t]+/, '');
  text = stripTrailingComment(text);
  return text.trim().replace(/[ \t]+/g, ' ');
}

/**
 * `text` up to the `#` that opens a shell comment, if any.
 *
 * A `#` counts only where a shell would take it: at the start of the line or
 * after whitespace, and outside a quoted run. `--note "first cut"` is why the
 * quote state is tracked at all, and `--note "a # b"` is why it has to be.
 */
export function stripTrailingComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote !== "'") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) return text.slice(0, i);
  }
  return text;
}

/** Does a normalised line invoke `phrase`, as a whole run of words? */
export function invokesCommand(normalised, phrase) {
  let from = 0;
  for (;;) {
    const at = normalised.indexOf(phrase, from);
    if (at < 0) return false;
    const before = at === 0 ? ' ' : normalised[at - 1];
    const afterIndex = at + phrase.length;
    const after = afterIndex >= normalised.length ? ' ' : normalised[afterIndex];
    if (before === ' ' && after === ' ') return true;
    from = at + 1;
  }
}

/* ---------------------------------------------------------------- the CLI side */

/**
 * The string literals of `static [override] <symbol> = [ ... ]`, or a problem.
 *
 * ⛔ Anything that is not a plain array of string literals is REFUSED rather
 * than interpreted: an array built by `.map()`, spread from a constant, or
 * carrying an interpolated template is one this reader would have to guess at,
 * and a guess here is a comparison nobody can check.
 */
export function readExamples(source, symbol) {
  const decl = new RegExp(`static\\s+(?:override\\s+)?${symbol}\\b\\s*(?::[^=]*)?=\\s*`).exec(source);
  if (!decl) {
    return { problem: `no \`static ${symbol} = [ ... ]\` declaration -- the symbol was renamed or moved.` };
  }
  let i = decl.index + decl[0].length;
  if (source[i] !== '[') {
    const preview = source.slice(i, i + 40).split('\n')[0];
    return { problem: `\`${symbol}\` is not an array literal -- it is assigned \`${preview}\`. This gate refuses to guess at a computed example set.` };
  }
  i++;
  const values = [];
  for (;;) {
    while (i < source.length && /[\s,]/.test(source[i])) i++;
    if (i >= source.length) return { problem: `the \`${symbol}\` array is never closed -- the file ends inside it.` };
    if (source[i] === ']') return { values };
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== '`') {
      const preview = source.slice(i, i + 40).split('\n')[0];
      return { problem: `\`${symbol}\` is not a plain array of string literals -- it carries \`${preview}\`. This gate refuses to guess at a computed example set.` };
    }
    i++;
    let out = '';
    for (;;) {
      if (i >= source.length) return { problem: `an unterminated string literal inside \`${symbol}\`.` };
      const ch = source[i];
      if (ch === '\\') {
        out += decodeEscape(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        break;
      }
      if (quote === '`' && ch === '$' && source[i + 1] === '{') {
        return { problem: `a template literal inside \`${symbol}\` interpolates a value. An example whose text is computed cannot be compared against a page.` };
      }
      out += ch;
      i++;
    }
    values.push(out);
  }
}

/** The one-character escapes a JS string literal can carry, for this purpose. */
function decodeEscape(ch) {
  if (ch === 'n') return '\n';
  if (ch === 't') return '\t';
  if (ch === 'r') return '\r';
  if (ch === undefined) return '';
  return ch;
}

/* --------------------------------------------------------------- the docs side */

/** Is `line` (1-based) inside one of `blocks`? */
function insideAnyFence(blocks, line) {
  return blocks.some((b) => line > b.line && (b.closeLine === null || line < b.closeLine));
}

/**
 * The first fenced code block under `heading`, or a problem.
 *
 * "Under" is bounded by the next ATX heading that is NOT inside a fence -- a
 * `# comment` line inside a bash block is not a heading, and treating it as one
 * would end the section early and hide the block this row points at.
 */
export function blockUnderHeading(source, heading) {
  const lines = source.split('\n');
  const wanted = heading.trim();
  const headingLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === wanted) headingLines.push(i + 1);
  }
  const blocks = fencedBlocks(source);
  const real = headingLines.filter((line) => !insideAnyFence(blocks, line));
  if (real.length === 0) {
    return { problem: `the heading \`${wanted}\` is not on the page. The pair moved -- re-point the row, or drop it.` };
  }
  if (real.length > 1) {
    return { problem: `the heading \`${wanted}\` appears ${real.length} times (lines ${real.join(', ')}). A row must name one section, not a choice of sections.` };
  }
  const headingLine = real[0];
  let sectionEnd = lines.length + 1;
  for (let i = headingLine; i < lines.length; i++) {
    const line = i + 1;
    if (!/^ {0,3}#{1,6}(\s|$)/.test(lines[i])) continue;
    if (insideAnyFence(blocks, line)) continue;
    sectionEnd = line;
    break;
  }
  const block = blocks.find((b) => b.line > headingLine && b.line < sectionEnd);
  if (!block) {
    return { problem: `the section under \`${wanted}\` (lines ${headingLine}-${sectionEnd - 1}) carries no fenced code block. There is nothing on the page to compare the examples against.` };
  }
  return { block };
}

/* ------------------------------------------------------------------ judgement */

/**
 * Judge one row against a checkout at `root`. Returns `{ findings, reading }`;
 * `reading` is what `--list` and the verdict print, and is `null` when the row
 * could not be read at all.
 */
export function judgePair(row, root = REPO_ROOT) {
  const findings = [];
  const fail = (kind, detail) => findings.push({ row: row.id, kind, detail });

  const derived = commandPhrase(row, root);
  if (derived.problem) {
    fail('row-unreadable', derived.problem);
    return { findings, reading: null };
  }
  const phrase = derived.phrase;

  const commandAbs = join(root, row.commandFile);
  if (!existsSync(commandAbs)) {
    fail('row-unreadable', `${row.commandFile} does not exist. The command moved; re-point the row.`);
    return { findings, reading: null };
  }
  const docsAbs = join(root, row.docsPage);
  if (!existsSync(docsAbs)) {
    fail('row-unreadable', `${row.docsPage} does not exist. The page moved; re-point the row.`);
    return { findings, reading: null };
  }

  if (!row.heading.includes(phrase)) {
    fail(
      'row-mismatch',
      `the row's heading \`${row.heading}\` does not name the command \`${phrase}\` derived from ${row.commandFile}. `
        + 'A row whose two halves are about different commands would compare two unrelated sets.',
    );
    return { findings, reading: null };
  }

  const examples = readExamples(readFileSync(commandAbs, 'utf8'), row.examplesSymbol);
  if (examples.problem) {
    fail('examples-unreadable', `${row.commandFile}: ${examples.problem}`);
    return { findings, reading: null };
  }

  const found = blockUnderHeading(readFileSync(docsAbs, 'utf8'), row.heading);
  if (found.problem) {
    fail('docs-unreadable', `${row.docsPage}: ${found.problem}`);
    return { findings, reading: null };
  }

  // ── The CLI side. An example that does not invoke the row's command is a
  //    finding: it leaves the comparison, and that must be somebody's decision.
  const cli = [];
  for (const entry of examples.values) {
    const normalised = normaliseInvocation(entry);
    if (normalised === '') {
      fail('cli-example-empty', `${row.commandFile}: the \`${row.examplesSymbol}\` entry ${JSON.stringify(entry)} normalises to nothing.`);
      continue;
    }
    if (!invokesCommand(normalised, phrase)) {
      fail(
        'cli-example-off-command',
        `${row.commandFile}: the \`${row.examplesSymbol}\` entry \`${normalised}\` does not invoke \`${phrase}\`. `
          + 'An example of this command that does not run it cannot be compared against the page.',
      );
      continue;
    }
    cli.push(normalised);
  }

  // ── The docs side. A fence line that does not invoke the command is CONTEXT
  //    (`os compile` before a publish, say): counted, printed, not compared.
  const docs = [];
  const context = [];
  for (const entry of found.block.body) {
    const normalised = normaliseInvocation(entry.text);
    if (normalised === '') continue;
    if (invokesCommand(normalised, phrase)) docs.push(normalised);
    else context.push({ line: entry.line, text: normalised });
  }

  const reading = {
    row: row.id,
    phrase,
    commandFile: row.commandFile,
    docsPage: row.docsPage,
    heading: row.heading,
    fenceLine: found.block.line,
    cli: [...cli].sort(),
    docs: [...docs].sort(),
    context,
  };

  // ── Anti-vacuity, before the comparison. Two empty sets are equal, and that
  //    equality is the one thing this gate must never print as a pass.
  if (cli.length === 0) {
    fail(
      'no-cli-invocations',
      `${row.commandFile}: \`${row.examplesSymbol}\` yielded ZERO invocations of \`${phrase}\`. Nothing was compared.`,
    );
  }
  if (docs.length === 0) {
    fail(
      'no-docs-invocations',
      `${row.docsPage}: the fenced block at line ${found.block.line} under \`${row.heading}\` carries ZERO invocations of \`${phrase}\`. Nothing was compared.`,
    );
  }
  if (findings.length) return { findings, reading };

  const cliSet = new Set(cli);
  const docsSet = new Set(docs);
  for (const one of reading.cli) {
    if (docsSet.has(one)) continue;
    fail(
      'missing-in-docs',
      `\`${one}\`\n      is in ${row.commandFile} (\`${row.examplesSymbol}\`) and in no line of the block at `
        + `${row.docsPage}:${found.block.line}.`,
    );
  }
  for (const one of reading.docs) {
    if (cliSet.has(one)) continue;
    fail(
      'missing-in-cli',
      `\`${one}\`\n      is in the block at ${row.docsPage}:${found.block.line} and in no entry of `
        + `\`${row.examplesSymbol}\` in ${row.commandFile}.`,
    );
  }

  return { findings, reading };
}

/** Every row. */
export function judge(rows, root = REPO_ROOT) {
  const findings = [];
  const readings = [];
  if (!rows || rows.length === 0) {
    return {
      findings: [{
        row: '(table)',
        kind: 'empty-table',
        detail: 'the pair table is EMPTY. A gate with no population measured nothing, and its exit code says nothing about the tree.',
      }],
      readings,
    };
  }
  for (const row of rows) {
    const judged = judgePair(row, root);
    findings.push(...judged.findings);
    if (judged.reading) readings.push(judged.reading);
  }
  return { findings, readings };
}

/* ------------------------------------------------------------------------ CLI */

function list(readings) {
  for (const r of readings) {
    console.log(`${r.row}  \`${r.phrase}\``);
    console.log(`  ${r.commandFile} (examples)`);
    for (const one of r.cli) console.log(`    cli   ${one}`);
    console.log(`  ${r.docsPage}:${r.fenceLine} under ${r.heading}`);
    for (const one of r.docs) console.log(`    docs  ${one}`);
    for (const c of r.context) console.log(`    ctx   ${r.docsPage}:${c.line}  ${c.text}  (does not invoke \`${r.phrase}\`)`);
  }
  console.log(`\n${readings.length} row(s) read.`);
}

function main(argv, root = REPO_ROOT) {
  const { findings, readings } = judge(PAIRS, root);

  if (argv.includes('--list')) {
    list(readings);
    for (const f of findings) console.log(`FINDING  [${f.kind}] ${f.row}: ${f.detail}`);
    return findings.length ? EXIT_FINDINGS : EXIT_OK;
  }

  if (findings.length) {
    console.error(`✗ check-cli-examples-parity: ${findings.length} finding(s) across ${PAIRS.length} declared pair(s):\n`);
    for (const f of findings) {
      console.error(`  [${f.kind}] ${f.row}`);
      console.error(`    ${f.detail}\n`);
    }
    console.error(
      'The CLI `examples` array and the documented block are two copies of one example set. Make the\n'
      + 'INVOCATIONS agree; the wording, the order and the trailing comments are yours to differ on.\n'
      + 'Both sides: node scripts/check-cli-examples-parity.mjs --list\n',
    );
    return EXIT_FINDINGS;
  }

  for (const r of readings) {
    console.log(
      `✓ ${r.row}: ${r.cli.length} \`${r.phrase}\` invocation(s) in ${r.commandFile} (\`examples\`) `
      + `== ${r.docs.length} in the block at ${r.docsPage}:${r.fenceLine} under ${r.heading}`
      + `${r.context.length ? ` (${r.context.length} context line(s) skipped)` : ''}`,
    );
  }
  console.log(
    `✓ check-cli-examples-parity: ${readings.length} declared pair(s) agree as SETS `
    + '(order, prompts and trailing comments normalised away).',
  );
  return EXIT_OK;
}

/* ----------------------------------------------------------------- self-test */

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 -- a self-test that never finished, reported as one that
// passed.
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor ───────────────────────────
//
// `cases.filter((c) => !c.ok)` alone makes "every case held" and "the cases
// never ran" print the same line. The floor requires the OPENED set to equal
// the DECLARED set with each battery at or above its own count. A pinned TOTAL
// is not the repair: one battery dropping to zero keeps a total "right" the
// moment a sibling grows. The counts are FLOORS -- adding cases is ordinary work.
const SELF_TEST_BATTERIES = Object.freeze({
  'The normaliser, the examples reader and the fence locator': 22,
  'The judgement over real scratch trees, two rows at a time': 16,
  'At the PROGRAM level (real exit codes, real trees)': 8,
});
// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 3;

function selfTest() {
  const cases = [];
  const batterySeen = new Map();
  let openBattery = '(no battery open)';
  const battery = (name) => {
    openBattery = name;
    if (!batterySeen.has(name)) batterySeen.set(name, 0);
  };
  const t = (name, ok, detail) => {
    batterySeen.set(openBattery, (batterySeen.get(openBattery) ?? 0) + 1);
    cases.push({ name: `${openBattery} · ${name}`, ok: Boolean(ok), detail });
  };

  // ── 1. The readers ──────────────────────────────────────────────────────
  battery('The normaliser, the examples reader and the fence locator');

  t('a `$ ` prompt is stripped', normaliseInvocation('$ os package publish') === 'os package publish');
  t('a bare line is unchanged', normaliseInvocation('os package publish') === 'os package publish');
  t('a trailing comment is stripped', normaliseInvocation('os package publish   # local dev') === 'os package publish');
  t('column alignment collapses', normaliseInvocation('os package publish     --install') === 'os package publish --install');
  t('a tab collapses like a space', normaliseInvocation('os\tpackage\tpublish') === 'os package publish');
  t('a `#` inside double quotes survives',
    normaliseInvocation('os package publish --note "first # cut"') === 'os package publish --note "first # cut"',
    normaliseInvocation('os package publish --note "first # cut"'));
  t('a `#` inside single quotes survives',
    normaliseInvocation("os package publish --note 'a # b'") === "os package publish --note 'a # b'");
  t('a `#` glued to a word is not a comment', normaliseInvocation('os package publish --tag v1#2') === 'os package publish --tag v1#2');
  t('a comment-only line normalises to nothing', normaliseInvocation('  # just a note') === '');
  t('a blank line normalises to nothing', normaliseInvocation('   ') === '');

  t('an env prefix still invokes the command',
    invokesCommand('OS_CLOUD_URL=http://localhost:4000 os package publish', 'os package publish'));
  t('a flag suffix still invokes the command', invokesCommand('os package publish --install', 'os package publish'));
  t('a different command does not', !invokesCommand('os compile', 'os package publish'));
  t('a longer command name is not a match on its prefix',
    !invokesCommand('os package publish-draft --now', 'os package publish'));

  const source = [
    'export default class X extends Command {',
    '  static override examples = [',
    "    '$ os package publish',",
    '    "$ os package publish --note \\"first cut\\"",',
    '  ];',
    '}',
  ].join('\n');
  const read = readExamples(source, 'examples');
  t('both literal spellings are read', read.values?.length === 2, JSON.stringify(read));
  t('an escaped quote survives decoding',
    read.values?.[1] === '$ os package publish --note "first cut"', read.values?.[1]);
  t('a missing symbol is a problem, not an empty array',
    Boolean(readExamples(source, 'nope').problem));
  t('a computed array is REFUSED rather than guessed at',
    Boolean(readExamples('static override examples = BASE.map((x) => x);', 'examples').problem));
  t('an interpolating template literal is refused',
    Boolean(readExamples('static examples = [`$ os package publish ${flag}`];', 'examples').problem),
    JSON.stringify(readExamples('static examples = [`$ os package publish ${flag}`];', 'examples')));

  const page = [
    '#### `os package publish`',
    '',
    '```bash',
    'os compile',
    '# a comment inside the fence, which is not a heading',
    'os package publish',
    '```',
    '',
    '#### `os package install`',
    '',
    '```bash',
    'os package install',
    '```',
  ].join('\n');
  const located = blockUnderHeading(page, '#### `os package publish`');
  t('the block under the heading is found', located.block?.line === 3, JSON.stringify(located.problem ?? located.block?.line));
  t('a `#` line inside the fence did not end the section', located.block?.body?.length === 3, String(located.block?.body?.length));
  t('an absent heading is a problem', Boolean(blockUnderHeading(page, '#### `os nope`').problem));
  t('a heading with no fence before the next heading is a problem',
    Boolean(blockUnderHeading('#### `os package publish`\n\ntext\n\n## Next\n', '#### `os package publish`').problem));

  // ── 2. The judgement, over real files on disk ───────────────────────────
  battery('The judgement over real scratch trees, two rows at a time');

  const tree = mkdtempSync(join(tmpdir(), 'check-cli-examples-parity-'));
  try {
    const write = (rel, body) => {
      const abs = join(tree, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    };
    write('packages/cli/package.json', JSON.stringify({ name: '@objectstack/cli', oclif: { bin: 'os' } }));

    const commandFile = (entries) =>
      `export default class C extends Command {\n  static override examples = [\n${
        entries.map((e) => `    ${JSON.stringify(e)},`).join('\n')}\n  ];\n}\n`;
    const section = (heading, lines) => `${heading}\n\nprose\n\n\`\`\`bash\n${lines.join('\n')}\n\`\`\`\n`;
    const docsPage = (heading, lines) => `---\ntitle: t\n---\n\n${section(heading, lines)}\n## After\n`;

    const rowA = {
      id: 'row-a',
      commandFile: 'packages/cli/src/commands/package/publish.ts',
      examplesSymbol: 'examples',
      docsPage: 'content/docs/deployment/cli.mdx',
      heading: '#### `os package publish`',
    };
    const rowB = {
      id: 'row-b',
      commandFile: 'packages/cli/src/commands/package/install.ts',
      examplesSymbol: 'examples',
      docsPage: 'content/docs/deployment/cli.mdx',
      heading: '#### `os package install`',
    };

    // The equal case, written the way the two voices really differ: a different
    // ORDER, different trailing comments, `$ ` on one side only, and a context
    // line in the docs block that the CLI array cannot carry.
    write(rowA.commandFile, commandFile([
      '$ os package publish',
      '$ os package publish --env env_abc123 --install',
      '$ OS_CLOUD_URL=http://localhost:4000 os package publish    # local dev',
    ]));
    write(rowA.docsPage, docsPage(rowA.heading, [
      'os compile',
      'os package publish                                    # dist/objectstack.json',
      'OS_CLOUD_URL=http://localhost:4000 os package publish  # against a local control plane',
      'os package publish --env env_abc123 --install         # publish, then install',
    ]));

    const green = judgePair(rowA, tree);
    t('equal sets in a different order with different comments are GREEN',
      green.findings.length === 0, JSON.stringify(green.findings));
    t('and the reading counts three invocations a side',
      green.reading?.cli.length === 3 && green.reading?.docs.length === 3,
      `${green.reading?.cli.length}/${green.reading?.docs.length}`);
    t('and the `os compile` line is reported as CONTEXT, not compared',
      green.reading?.context.length === 1 && green.reading?.context[0].text === 'os compile',
      JSON.stringify(green.reading?.context));
    t('and the derived phrase comes from the path and the declared bin',
      green.reading?.phrase === 'os package publish', green.reading?.phrase);

    // An invocation missing on the DOCS side.
    write(rowA.docsPage, docsPage(rowA.heading, [
      'os compile',
      'os package publish',
      'OS_CLOUD_URL=http://localhost:4000 os package publish',
    ]));
    const missingDocs = judgePair(rowA, tree);
    t('an invocation missing in the docs block REDS',
      missingDocs.findings.some((f) => f.kind === 'missing-in-docs'), JSON.stringify(missingDocs.findings));
    t('and the finding quotes the exact normalised line',
      missingDocs.findings.some((f) => f.detail.includes('os package publish --env env_abc123 --install')),
      JSON.stringify(missingDocs.findings.map((f) => f.detail)));

    // An invocation missing on the CLI side.
    write(rowA.docsPage, docsPage(rowA.heading, [
      'os package publish',
      'os package publish --env env_abc123 --install',
      'OS_CLOUD_URL=http://localhost:4000 os package publish',
      'os package publish --visibility org',
    ]));
    const missingCli = judgePair(rowA, tree);
    t('an invocation missing in the CLI array REDS',
      missingCli.findings.some((f) => f.kind === 'missing-in-cli'), JSON.stringify(missingCli.findings));
    t('and that finding quotes the exact normalised line',
      missingCli.findings.some((f) => f.detail.includes('os package publish --visibility org')),
      JSON.stringify(missingCli.findings.map((f) => f.detail)));

    // Anti-vacuity, both directions.
    write(rowA.docsPage, docsPage(rowA.heading, ['os compile', '# nothing else here']));
    const emptyDocs = judgePair(rowA, tree);
    t('a docs block with ZERO invocations is REFUSED, not passed',
      emptyDocs.findings.some((f) => f.kind === 'no-docs-invocations'), JSON.stringify(emptyDocs.findings));
    t('and the refusal does not also print set differences (nothing was compared)',
      !emptyDocs.findings.some((f) => f.kind === 'missing-in-docs' || f.kind === 'missing-in-cli'),
      JSON.stringify(emptyDocs.findings.map((f) => f.kind)));

    write(rowA.commandFile, commandFile(['$ os compile']));
    const offCommand = judgePair(rowA, tree);
    t('a CLI example that does not invoke the command REDS (it is never skipped)',
      offCommand.findings.some((f) => f.kind === 'cli-example-off-command'), JSON.stringify(offCommand.findings));
    t('and with every example off-command the CLI side is refused as empty',
      offCommand.findings.some((f) => f.kind === 'no-cli-invocations'), JSON.stringify(offCommand.findings.map((f) => f.kind)));

    // The pair moved: heading gone, symbol gone.
    write(rowA.commandFile, commandFile(['$ os package publish']));
    write(rowA.docsPage, docsPage('#### `os package publish (renamed)`', ['os package publish']));
    t('a heading that is no longer on the page is REFUSED',
      judgePair(rowA, tree).findings.some((f) => f.kind === 'docs-unreadable'));
    write(rowA.docsPage, docsPage(rowA.heading, ['os package publish']));
    write(rowA.commandFile, 'export default class C extends Command {}\n');
    t('an `examples` symbol that is no longer there is REFUSED',
      judgePair(rowA, tree).findings.some((f) => f.kind === 'examples-unreadable'));

    // A SECOND row, judged in the same run as the first: one green, one red.
    write(rowA.commandFile, commandFile(['$ os package publish']));
    write(rowB.commandFile, commandFile(['$ os package install --env env_abc123']));
    write(rowB.docsPage, `---\ntitle: t\n---\n\n${section(rowA.heading, ['os package publish'])}\n${
      section(rowB.heading, ['os package install'])}`);
    const two = judge([rowA, rowB], tree);
    t('two rows produce two readings', two.readings.length === 2, String(two.readings.length));
    t('the second row is judged against ITS OWN heading and command file',
      two.readings[1]?.phrase === 'os package install', two.readings[1]?.phrase);
    t('and its drift is reported against the second row, not the first',
      two.findings.length > 0 && two.findings.every((f) => f.row === 'row-b'),
      JSON.stringify(two.findings.map((f) => `${f.row}:${f.kind}`)));
    t('an EMPTY table is refused rather than passing vacuously',
      judge([], tree).findings.some((f) => f.kind === 'empty-table'));
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }

  // ── 3. Program level ────────────────────────────────────────────────────
  //
  // Everything above drives exported predicates. A predicate the PROGRAM never
  // consults would satisfy all of it, so this battery builds real trees, runs
  // the real file in them as a child process against the REAL table, and reads
  // a real exit status -- never a pipe's. The script copy is written INTO the
  // scratch tree's own `scripts/` so its `REPO_ROOT` resolves there and nothing
  // reaches back into this checkout.
  battery('At the PROGRAM level (real exit codes, real trees)');

  const sandbox = mkdtempSync(join(tmpdir(), 'check-cli-examples-parity-prog-'));
  try {
    const copy = (rel) => {
      const abs = join(sandbox, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, readFileSync(join(REPO_ROOT, rel), 'utf8'));
    };
    copy('scripts/check-cli-examples-parity.mjs');
    copy('scripts/invoked-as.mjs');
    copy('scripts/docs-audit/check-docs-transcript-drift.mjs');

    const row = PAIRS[0];
    const write = (rel, body) => {
      const abs = join(sandbox, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    };
    const packageDir = row.commandFile.slice(0, row.commandFile.indexOf('/src/commands/'));
    write(`${packageDir}/package.json`, JSON.stringify({ name: '@objectstack/cli', oclif: { bin: 'os' } }));
    const writeCommand = (entries) =>
      write(row.commandFile, `export default class C extends Command {\n  static override examples = [\n${
        entries.map((e) => `    ${JSON.stringify(e)},`).join('\n')}\n  ];\n}\n`);
    const writeDocs = (heading, lines) =>
      write(row.docsPage, `---\ntitle: t\n---\n\n${heading}\n\n\`\`\`bash\n${lines.join('\n')}\n\`\`\`\n`);

    writeCommand(['$ os package publish', '$ os package publish --install    # then install']);
    writeDocs(row.heading, [
      'os compile',
      'os package publish --install   # publish, then install',
      'os package publish             # the default artifact',
    ]);

    const run = (args = []) => {
      const r = spawnSync(process.execPath, [join(sandbox, 'scripts', 'check-cli-examples-parity.mjs'), ...args], { encoding: 'utf8' });
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };

    const ok = run();
    t('equal sets in a different order with different comments exit 0', ok.status === EXIT_OK, ok.out.slice(0, 400));
    t('and the verdict names the row', ok.out.includes(row.id), ok.out.slice(0, 300));
    t('and it names the context line it skipped', ok.out.includes('context line(s) skipped'), ok.out.slice(0, 300));

    writeDocs(row.heading, ['os compile', 'os package publish']);
    const drifted = run();
    t('an invocation missing on one side exits 1', drifted.status === EXIT_FINDINGS, String(drifted.status));
    t('and the failure names the missing invocation',
      drifted.out.includes('os package publish --install'), drifted.out.slice(0, 600));

    writeDocs(row.heading, ['os compile']);
    const vacuous = run();
    t('a docs block with no invocation of the command exits 1, never 0',
      vacuous.status === EXIT_FINDINGS && vacuous.out.includes('ZERO invocations'), vacuous.out.slice(0, 400));

    writeDocs('#### `os package publish` (moved)', ['os package publish']);
    const moved = run();
    t('a heading that moved exits 1 naming the heading',
      moved.status === EXIT_FINDINGS && moved.out.includes('is not on the page'), moved.out.slice(0, 400));

    writeDocs(row.heading, ['os package publish', 'os package publish --install']);
    write(row.commandFile, 'export default class C extends Command {}\n');
    const noSymbol = run();
    t('an absent `examples` symbol exits 1 rather than comparing nothing',
      noSymbol.status === EXIT_FINDINGS && noSymbol.out.includes('examples-unreadable'), noSymbol.out.slice(0, 400));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases ─────────────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared.
  const floorFailure = (message) => { cases.push({ name: message, ok: false }); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
      + `${SELF_TEST_BATTERY_FLOOR} -- a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES `
      + '-- an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN -- 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} -- cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure('A battery at or below its floor means cases STOPPED RUNNING -- the battery is the bug, not the number.');
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-cli-examples-parity self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return EXIT_FINDINGS;
  }
  console.log(
    `✓ check-cli-examples-parity self-test: ${cases.length} cases pass (normalisation of prompts, `
    + 'comments and alignment; the string-literal examples reader and its refusals; the heading/fence '
    + 'locator; set equality over real scratch trees with two rows; and the real exit codes 0 / 1 from a '
    + 'child process).',
  );
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const selfTestCode = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-cli-examples-parity self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
      );
      process.exit(EXIT_FINDINGS);
    }
    process.exit(selfTestCode);
  }
  process.exit(main(process.argv.slice(2)));
}
