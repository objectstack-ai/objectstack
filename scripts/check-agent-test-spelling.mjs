#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-agent-test-spelling (#10166) -- no committed command may forward
 * arguments to vitest through a bare `--`.
 *
 *   node scripts/check-agent-test-spelling.mjs              # the gate
 *   node scripts/check-agent-test-spelling.mjs --list       # the census it judged
 *   node scripts/check-agent-test-spelling.mjs --self-test  # prove it can go red
 *
 * ## The defect
 *
 * `pnpm --filter @objectstack/spec test -- --maxWorkers=2 gen-sdui-manifest`
 * runs the WHOLE package suite. Two layers, neither of them ours, each
 * re-measured on this tree rather than recalled:
 *
 *   LAYER 1  pnpm forwards the separator VERBATIM into the child's argv.
 *            pnpm 10.33.0  `run test -- --maxWorkers=2 pat` -> ["--","--maxWorkers=2","pat"]
 *            npm  11       same form                        -> ["--maxWorkers=2","pat"]   (strips)
 *            npx           `echo-argv -- --maxWorkers=2 pat`-> ["--","--maxWorkers=2","pat"] (forwards)
 *            turbo 2.10.10 `run test --filter=probe-a -- --maxWorkers=2 pat`
 *                                                           -> ["--maxWorkers=2","pat"]   (strips)
 *            control, no separator: pnpm -> ["--maxWorkers=2","pat"], turbo -> [].
 *
 *   LAYER 2  vitest 4.1.10 (cac 6.7.14) DISCARDS everything after a bare `--`,
 *            options and positionals alike, in silence. The control pair is the
 *            whole defect in two lines -- same binary, same root, same flag:
 *
 *              vitest list --root EMPTY --this-flag-does-not-exist
 *                -> CACError: Unknown option `--thisFlagDoesNotExist`   exit 1
 *              vitest list --root EMPTY -- --this-flag-does-not-exist
 *                -> no error, no output                                 exit 0
 *
 * So the separator converts a LOUD rejection into a silent exit 0. Applied to a
 * real run: the file pattern and `--maxWorkers` are lost together, the entire
 * package suite executes, and it passes. Nothing in the output says the
 * narrowing was ignored -- the green is real and merely LARGER than the one
 * asked for. Measured on the card: 415 files / 11045 tests / 358s under the
 * shared verify lock, where the intended run was one file in 655ms.
 *
 * That the concurrency flag dies in the same breath is the sharp half: every
 * seat that believed it was capping workers was not.
 *
 * ## Why a gate, when the corrected spelling already landed
 *
 * #11425 landed the documented spelling (`pnpm --filter <pkg> exec vitest run
 * --maxWorkers=2 <file>`) and a refusal of the separator in `AGENTS.md` and
 * `.claude/agents/os-dev.md`. That is documentation read by agents -- i.e.
 * discipline. Nothing detects the bad spelling if someone writes it anyway, and
 * its failure mode is a green over-broad run that reads as a targeted pass.
 * This gate is the mechanical half.
 *
 * ## ⛔ This gate is GREEN OVER AN EMPTY POPULATION, and says so out loud
 *
 * Measured when it landed: 0 violations. A guard that has only ever printed
 * "0 violations" is indistinguishable from a guard with a broken selector --
 * which is the EXACT defect class this card is about, so a silent zero here
 * would be this gate committing the sin it exists to catch.
 *
 * Three things are done about that, and none of them is a promise:
 *
 *   1. The verdict line prints the POPULATION, not just the verdict: files
 *      scanned, bare separators seen, launcher-rooted command runs seen. A zero
 *      that is a measurement reads differently from a zero that is a silence.
 *   2. `run()` REFUSES -- exit EXIT_REFUSED, not 0 -- when a declared root is
 *      missing, when no file was scanned, when the corpus contains no bare `--`
 *      at all, when no launcher-rooted run was found, or when the vitest-script
 *      derivation came back empty. Each of those is a broken selector wearing a
 *      pass. Same shape as `check-i18n-coverage.mjs` and
 *      `check-pnpm-filter-targets.mjs` (#4690, #9932).
 *   3. `--self-test` drives the REAL sweep over a REAL temp tree on disk, so
 *      what is proven red is the file walk plus the extractor plus the verdict,
 *      not a predicate called with a string.
 *
 * Measured on the tree this landed against (base a5110f523): 351 files, 3315
 * bare `--` tokens, 1012 launcher-rooted runs, 6 separators JUDGED, 0 violations.
 *
 * ⭐ That `6` is the number that matters, and it is why the zero is worth
 * printing. FIVE of the six are forms a naive bare-`--` selector would have RED,
 * and every one of them is correct as written:
 *
 *   .github/workflows/ci.yml:1122   pnpm turbo run test --filter=@objectstack/dogfood -- --shard=N/3
 *   .github/workflows/lint.yml:2443 pnpm dev -- --fresh   (quoted in this gate's own wiring comment)
 *   AGENTS.md:126                   pnpm dev -- --fresh -p <random>
 *   AGENTS.md:133                   pnpm dev:crm -- --fresh -p 38421
 *   AGENTS.md:388                   pnpm dev -- --fresh -p <random>
 *
 * The sixth is prose inside `scripts/check-examples-live-imports.mjs`, cleared
 * because its command word is a `check:` script.
 *
 * `--list` prints each with the named reason it was cleared. So the gate's zero
 * is not "it found nothing" — it is "it read five and cleared five on the rule",
 * and a selector broken in the obvious direction fails that visibly.
 *
 * ⛔ `judged === 0` is REPORTED LOUDLY but is NOT a refusal, and the asymmetry is
 * deliberate. The refusals above are structural — a correct tree cannot drive
 * them to zero. `judged` can legitimately reach zero (someone rewrites those
 * four lines), and refusing on it would red an unrelated PR on a correct tree
 * and send its author to weaken a gate they do not own. This header's own
 * standard — a false red on correct work is worse than no gate — applies to the
 * gate's self-check as much as to its rule.
 *
 * ## The boundary is the hard part, not the detection
 *
 * `AGENTS.md` teaches `pnpm dev -- --fresh -p <random>` and `pnpm dev:crm --
 * --fresh -p 38421`, and those are CORRECT: pnpm forwards the separator and
 * those CLIs tolerate a leading `--`. `.github/workflows/ci.yml` shards dogfood
 * with `pnpm turbo run test --filter=@objectstack/dogfood -- --shard=N/3`, and
 * that is correct too, because turbo strips the separator (measured above).
 * A gate that reds on either is a FALSE RED ON CORRECT INSTRUCTIONS, which is
 * worse than no gate: it teaches seats to route around the guard.
 *
 * So the rule is vitest-BOUND, not separator-bound, and the boundary falls out
 * of derivation rather than a hand-carved exception list:
 *
 *   - the vitest-backed script names are READ FROM THE WORKSPACE (every tracked
 *     `package.json` whose script body invokes vitest), not guessed. Today that
 *     derives {demo, test, test:coverage, test:integration, test:watch} across
 *     80 manifests. `dev` and `dev:crm` are not in it and cannot be, because no
 *     `dev` script runs vitest -- so the documented dev-server spelling is safe
 *     by MEASUREMENT, not by an exception someone has to remember to keep.
 *   - `npm` and `turbo` in the run are EXEMPT because both were measured to
 *     strip the separator before anything downstream sees it.
 *
 * ## What is judged, and the direction it fails in
 *
 * A `--` is judged only inside a LAUNCHER-ROOTED RUN: a `pnpm` / `pnpx` / `npx`
 * token, up to the next shell/markdown boundary. That single rule is what keeps
 * prose out of the verdict without a comment stripper:
 *
 *     // A vitest worker can die at the process level -- native module segfault
 *
 * is a real line in `scripts/check-test-completeness.mjs` and it mentions
 * vitest next to a bare `--`. It has no launcher, so it is never judged.
 * `git checkout -- <paths>`, `git log --oneline -20 origin/main -- <paths>`,
 * `-- PostgreSQL: Find unused indexes` and `node run-with-stall-guard.mjs
 * --stall-minutes 10 -- pnpm ...` are all cleared the same way.
 *
 * Inside a run, the COMMAND WORD is the first token that is not a flag, not a
 * value consumed by a known value-taking pnpm flag, and not `run`/`exec`/`dlx`.
 * `pnpm --filter <pkg> test` has command word `test`; `pnpm dev:crm` has
 * `dev:crm`. An unknown value-taking flag shifts the command word by one and
 * the run is then NOT judged -- a MISS, never a false red. That direction is
 * deliberate: a gate over correct instructions must fail toward silence.
 *
 * ## The counter-example problem -- why this gate does not forbid its own fix
 *
 * A corpus gate over instruction files was proposed once before and REJECTED,
 * on a reason worth keeping in front of whoever edits this file:
 *
 *   "it would fire on the counter-example the corrected instruction MUST
 *    contain (the bad spelling itself, quoted as a warning), i.e. the gate
 *    would forbid the fix."
 *
 * That objection is correct and is answered here structurally, not waived.
 * `COUNTER_EXAMPLE_FILES` is a declared list of instruction files permitted to
 * spell the bad form as a warning, each entry carrying a REASON. It is EMPTY
 * today, because #11425's refusal is prose ("everything after a bare `--` is
 * discarded") rather than a quoted bad command -- so the escape hatch is not
 * yet needed, and an empty list is the honest state to record. Adding an entry
 * is a visible, reviewed edit to this file, not an inline mute marker scattered
 * through the corpus; `--self-test` rejects an entry without a reason and pins
 * the list small, so it cannot grow into a mute button.
 *
 * ⛔ If this gate ever reds on an instruction file that is correctly TEACHING
 * the refusal, the fix is an entry here with a reason -- never a weakening of
 * the rule, and never a deletion of the counter-example.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

export const EXIT_CLEAN = 0;
export const EXIT_VIOLATIONS = 1;
export const EXIT_REFUSED = 2;

/**
 * Launchers that were MEASURED to forward the separator verbatim.
 *
 * `npm` is deliberately absent: it strips, so `npm run test -- <file>` narrows
 * correctly and flagging it would be a false red. It appears in STRIPPERS
 * instead, for the case where it shows up inside a pnpm-rooted run.
 */
export const LAUNCHERS = new Set(['pnpm', 'pnpx', 'npx']);

/** Measured to strip the separator before anything downstream sees it. */
export const STRIPPERS = new Set(['npm', 'turbo']);

/** pnpm sub-commands that are not the script name. */
const RUN_KEYWORDS = new Set(['run', 'exec', 'dlx']);

/**
 * pnpm flags that consume the NEXT token as their value.
 *
 * Incomplete by design and safe in the incomplete direction: an unlisted
 * value-taking flag makes its value look like the command word, the command
 * word is then not a vitest script name, and the run goes UNJUDGED. A miss,
 * not a false red.
 */
const VALUE_FLAGS = new Set([
  '--filter',
  '--filter-prod',
  '-F',
  '--dir',
  '-C',
  '--workspace-concurrency',
  '--reporter',
  '--config',
  '-c',
  '--use-node-version',
]);

/**
 * The files that OWN this rule and are therefore not judged by it.
 *
 * This file spells every broken form in its `--self-test` fixtures. Judging it
 * would make the gate fail on its own positive controls, and deleting the
 * fixtures to appease it would delete the only proof the gate can fail at all.
 *
 * Pinned in `--self-test` at exactly one entry, so it cannot quietly become a
 * second mute list.
 */
export const RULE_OWNING_FILES = ['scripts/check-agent-test-spelling.mjs'];

/**
 * Instruction files permitted to quote the broken spelling as a WARNING.
 *
 * See the header. EMPTY today and that is a measurement, not an oversight:
 * #11425's refusal is prose, so nothing in the corpus needs the hatch yet.
 *
 * Shape: `{ path, reason }`. The reason is required -- `--self-test` refuses an
 * entry without one -- because "why is this file allowed to spell it" is the
 * whole content of the exemption.
 *
 * @type {{ path: string, reason: string }[]}
 */
export const COUNTER_EXAMPLE_FILES = [];

/** Roots read as the agent-facing instruction corpus. */
export const INSTRUCTION_ROOTS = ['.claude', 'skills'];

/** Roots read as the EXECUTED half -- where a broken spelling would run. */
export const EXECUTED_ROOTS = ['.github/workflows', 'scripts'];

/**
 * Loose files in the corpus: every tracked AGENTS.md / CLAUDE.md, wherever it
 * sits. Enumerated by name rather than by path so a new nested one is covered
 * on arrival.
 */
export const LOOSE_FILE_NAMES = new Set(['AGENTS.md', 'CLAUDE.md']);

const SCANNED_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.cjs',
  '.js',
  '.ts',
  '.sh',
  '.bash',
  '.yml',
  '.yaml',
  '.json',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo']);

/* ────────────────────────────── the classifier ────────────────────────────── */

/**
 * Join shell/YAML line continuations into logical lines.
 *
 * A trailing backslash means the command continues, and the multi-line spelling
 * is one the naive line-at-a-time reader misses:
 *
 *     pnpm --filter <pkg> test \
 *       -- --maxWorkers=2 <file>
 *
 * The reported line number stays the FIRST line of the logical line, so a
 * finding still points at the line a reader opens.
 *
 * @param {string} text
 * @returns {{ line: number, text: string }[]}
 */
export function logicalLines(text) {
  const out = [];
  const raw = text.split('\n');
  let buffer = null;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const continues = /\\\s*$/.test(line);
    const body = continues ? line.replace(/\\\s*$/, ' ') : line;
    if (buffer === null) {
      start = i + 1;
      buffer = body;
    } else {
      buffer += ' ' + body.trim();
    }
    if (!continues) {
      out.push({ line: start, text: buffer });
      buffer = null;
    }
  }
  if (buffer !== null) out.push({ line: start, text: buffer });
  return out;
}

/**
 * Shell and markdown boundaries that end a command run.
 *
 * ⚠️ `<` and `>` are NOT boundaries. They read like redirections, but the
 * corpus writes placeholders as `<pkg>` / `<file>`, and splitting there would
 * cut `pnpm --filter <pkg> test -- <file>` in half and lose the launcher --
 * silently missing the single most likely instruction spelling.
 */
const BOUNDARY = /[|;&`()]+/;

/** @param {string} token */
function stripDecoration(token) {
  return token.replace(/^[`'"*_,.:]+/, '').replace(/[`'"*_,.:]+$/, '');
}

/** @param {string} token */
function isVitestToken(token) {
  return /(^|\/)vitest(\.[cm]?js)?$/.test(stripDecoration(token));
}

/**
 * The command word of a launcher-rooted run: the first token that is not a
 * flag, not a value consumed by a known value-taking flag, and not a pnpm run
 * keyword.
 *
 * @param {string[]} window tokens from the launcher (inclusive) to the separator (exclusive)
 * @returns {string | null}
 */
export function commandWord(window) {
  for (let i = 1; i < window.length; i++) {
    const token = window[i];
    if (token.startsWith('-')) continue;
    const previous = window[i - 1];
    if (VALUE_FLAGS.has(previous)) continue;
    if (RUN_KEYWORDS.has(stripDecoration(token))) continue;
    return stripDecoration(token);
  }
  return null;
}

/**
 * Judge one launcher-rooted run that contains a bare separator.
 *
 * @param {string[]} window tokens from the launcher to the separator (exclusive)
 * @param {Set<string>} vitestScripts derived vitest-backed script names
 * @returns {{ bound: false, why: string } | { bound: true, why: string }}
 */
export function judgeRun(window, vitestScripts) {
  const stripper = window.map(stripDecoration).find((t) => STRIPPERS.has(t));
  if (stripper) return { bound: false, why: `\`${stripper}\` strips the separator (measured)` };
  if (window.some(isVitestToken)) return { bound: true, why: 'invokes vitest directly' };
  const word = commandWord(window);
  if (word && vitestScripts.has(word)) return { bound: true, why: `runs the vitest-backed script \`${word}\`` };
  if (!word) return { bound: false, why: 'no command word before the separator' };
  return { bound: false, why: `\`${word}\` is not a vitest-backed script` };
}

/**
 * Scan one logical line.
 *
 * @param {string} text
 * @param {Set<string>} vitestScripts
 * @returns {{ findings: { excerpt: string, why: string }[], separators: number, runs: number }}
 */
export function scanLine(text, vitestScripts) {
  const findings = [];
  let separators = 0;
  let runs = 0;
  let judged = 0;
  for (const segment of text.split(BOUNDARY)) {
    const tokens = segment.split(/\s+/).filter(Boolean);
    let runStart = -1;
    for (let i = 0; i < tokens.length; i++) {
      const bare = stripDecoration(tokens[i]) === '--' || tokens[i] === '--';
      if (bare) separators++;
      if (runStart === -1) {
        if (LAUNCHERS.has(stripDecoration(tokens[i]))) {
          runStart = i;
          runs++;
        }
        continue;
      }
      if (!bare) continue;
      const window = tokens.slice(runStart, i);
      judged++;
      const verdict = judgeRun(window, vitestScripts);
      if (verdict.bound) {
        findings.push({ excerpt: tokens.slice(runStart, Math.min(i + 4, tokens.length)).join(' '), why: verdict.why });
      }
      runStart = -1;
    }
  }
  return { findings, separators, runs, judged };
}

/* ─────────────────────────── the workspace derivation ─────────────────────── */

/**
 * Every script name in the workspace whose body invokes vitest.
 *
 * Derived, never guessed: the boundary between "flagged" and "correct as
 * written" rests on this set, and a hand-typed list would drift the moment a
 * package renames a script. An EMPTY result is a broken derivation, and `run()`
 * refuses on it rather than reporting a clean tree it never judged.
 *
 * @param {string} root
 * @returns {{ names: Set<string>, manifests: number }}
 */
export function deriveVitestScripts(root) {
  const names = new Set();
  let manifests = 0;
  /** @param {string} dir */
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.name === 'package.json') {
        let parsed;
        try {
          parsed = JSON.parse(readFileSync(join(dir, entry.name), 'utf8'));
        } catch {
          continue;
        }
        manifests++;
        const scripts = parsed && typeof parsed === 'object' ? parsed.scripts : null;
        if (!scripts || typeof scripts !== 'object') continue;
        for (const [name, body] of Object.entries(scripts)) {
          if (typeof body === 'string' && /(^|[^\w-])vitest([^\w-]|$)/.test(body)) names.add(name);
        }
      }
    }
  };
  walk(root);
  return { names, manifests };
}

/* ──────────────────────────────── the sweep ───────────────────────────────── */

/**
 * @param {string} root
 * @returns {string[]} repo-relative paths
 */
export function scannedFiles(root) {
  const files = [];
  /** @param {string} dir */
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      if (!SCANNED_EXTENSIONS.has(extension)) continue;
      files.push(relative(root, full));
    }
  };
  for (const dirName of [...INSTRUCTION_ROOTS, ...EXECUTED_ROOTS]) {
    const full = join(root, dirName);
    if (existsSync(full) && statSync(full).isDirectory()) walk(full);
  }
  // Loose AGENTS.md / CLAUDE.md, wherever they sit.
  /** @param {string} dir */
  const looseWalk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        looseWalk(full);
      } else if (LOOSE_FILE_NAMES.has(entry.name)) {
        files.push(relative(root, full));
      }
    }
  };
  looseWalk(root);
  return [...new Set(files)].sort();
}

/**
 * @param {string} root
 * @param {{ counterExamples?: {path: string, reason: string}[], ruleOwners?: string[] }} [options]
 */
export function sweep(root, options = {}) {
  const counterExamples = new Set((options.counterExamples ?? COUNTER_EXAMPLE_FILES).map((e) => e.path));
  const ruleOwners = new Set(options.ruleOwners ?? RULE_OWNING_FILES);
  const { names: vitestScripts, manifests } = deriveVitestScripts(root);
  const files = scannedFiles(root);
  const findings = [];
  let separators = 0;
  let runs = 0;
  let judged = 0;
  let exempted = 0;
  for (const file of files) {
    if (ruleOwners.has(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const { line, text: logical } of logicalLines(text)) {
      const result = scanLine(logical, vitestScripts);
      separators += result.separators;
      runs += result.runs;
      judged += result.judged;
      for (const finding of result.findings) {
        if (counterExamples.has(file)) {
          exempted++;
          continue;
        }
        findings.push({ file, line, ...finding });
      }
    }
  }
  return { files, findings, separators, runs, judged, exempted, vitestScripts, manifests };
}

const FIX = 'delete the separator: `pnpm --filter <pkg> exec vitest run --maxWorkers=2 <file>`';

/**
 * @param {string} root
 * @param {(s: string) => void} log
 * @returns {number} exit code
 */
export function run(root = REPO_ROOT, log = console.error) {
  for (const dirName of [...INSTRUCTION_ROOTS, ...EXECUTED_ROOTS]) {
    if (!existsSync(join(root, dirName))) {
      log(`✗ check-agent-test-spelling: declared root \`${dirName}\` is absent — REFUSING to report a verdict`);
      log('  A verdict over the roots that DID resolve is a verdict about a population nobody configured.');
      return EXIT_REFUSED;
    }
  }
  const result = sweep(root);
  const census =
    `${result.files.length} file(s) · ${result.separators} bare \`--\` token(s) · ` +
    `${result.runs} launcher-rooted run(s) · ${result.judged} separator(s) JUDGED · ` +
    `${result.vitestScripts.size} vitest-backed script name(s) derived from ${result.manifests} manifest(s)`;

  if (result.vitestScripts.size === 0) {
    log(`✗ check-agent-test-spelling: derived ZERO vitest-backed script names — REFUSING (${census})`);
    log('  The boundary between "broken" and "correct as written" rests on that set. Empty means the derivation broke.');
    return EXIT_REFUSED;
  }
  if (result.files.length === 0) {
    log(`✗ check-agent-test-spelling: scanned ZERO files — REFUSING (${census})`);
    return EXIT_REFUSED;
  }
  if (result.separators === 0) {
    log(`✗ check-agent-test-spelling: found ZERO bare \`--\` in the corpus — REFUSING (${census})`);
    log('  This tree has dozens (git pathspecs alone). Zero means the extractor stopped reaching the population.');
    return EXIT_REFUSED;
  }
  if (result.runs === 0) {
    log(`✗ check-agent-test-spelling: found ZERO pnpm/npx command runs — REFUSING (${census})`);
    log('  A corpus with no launcher in it is not this repo; the tokenizer is broken.');
    return EXIT_REFUSED;
  }

  if (result.findings.length > 0) {
    log(`✗ check-agent-test-spelling: ${result.findings.length} command(s) forward arguments to vitest through a bare \`--\``);
    log('');
    for (const finding of result.findings) {
      log(`  ${finding.file}:${finding.line}`);
      log(`    ${finding.excerpt}`);
      log(`    ${finding.why} — pnpm forwards the \`--\` verbatim and vitest DISCARDS everything after it.`);
      log('    The file pattern AND --maxWorkers are lost, the whole package suite runs, and it exits 0.');
      log(`    fix: ${FIX}`);
      log('');
    }
    log('  Teaching the broken form on purpose? Declare the file in COUNTER_EXAMPLE_FILES');
    log('  in scripts/check-agent-test-spelling.mjs, with a reason. ⛔ Never weaken the rule.');
    return EXIT_VIOLATIONS;
  }

  log(`✓ check-agent-test-spelling: 0 violations — ${census}${result.exempted ? ` · ${result.exempted} declared counter-example(s)` : ''}`);
  if (result.judged === 0) {
    log('  ⚠️⚠️ JUDGED NOTHING. This run ruled on zero separators, so its green says nothing about');
    log('     the rule — only that the corpus contains no pnpm/npx command with a bare `--` at all.');
    log('     Non-vacuity for this run rests ENTIRELY on --self-test. Treat a persistent zero here as');
    log('     a reason to re-derive the population, not as a clean bill of health.');
  } else {
    log(`  ⚠️ The VIOLATING population is empty, but ${result.judged} separator(s) were judged and cleared`);
    log('     ON THE RULE — run --list to see each one and the named reason it was cleared. A naive');
    log('     bare-`--` selector reds on the documented `pnpm dev -- --fresh` spelling and on CI\'s own');
    log('     turbo dogfood shard; those are the cleared ones. Non-vacuity is carried by --self-test,');
    log('     which drives this same sweep RED over a temp tree on disk.');
  }
  return EXIT_CLEAN;
}

/* ──────────────────────────────── --list ──────────────────────────────────── */

function list(root = REPO_ROOT, log = console.log) {
  const result = sweep(root);
  log(`files scanned            : ${result.files.length}`);
  log(`bare \`--\` tokens seen    : ${result.separators}   (mostly prose; the reachability probe)`);
  log(`launcher-rooted runs     : ${result.runs}`);
  log(`separators JUDGED        : ${result.judged}   (inside a launcher-rooted run — the population the rule rules on)`);
  log(`vitest-backed script set : ${[...result.vitestScripts].sort().join(', ')} (from ${result.manifests} manifests)`);
  log(`violations               : ${result.findings.length}`);
  log(`declared counter-examples: ${COUNTER_EXAMPLE_FILES.length}`);
  log('');
  log('every bare separator inside a launcher-rooted run, and how it was cleared:');
  for (const file of result.files) {
    if (RULE_OWNING_FILES.includes(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const { line, text: logical } of logicalLines(text)) {
      for (const segment of logical.split(BOUNDARY)) {
        const tokens = segment.split(/\s+/).filter(Boolean);
        let runStart = -1;
        for (let i = 0; i < tokens.length; i++) {
          if (runStart === -1) {
            if (LAUNCHERS.has(stripDecoration(tokens[i]))) runStart = i;
            continue;
          }
          if (tokens[i] !== '--') continue;
          const window = tokens.slice(runStart, i);
          const verdict = judgeRun(window, result.vitestScripts);
          log(`  ${verdict.bound ? 'RED  ' : 'clear'} ${file}:${line}  ${window.join(' ')} --   (${verdict.why})`);
          runStart = -1;
        }
      }
    }
  }
}

/* ─────────────────────────────── --self-test ──────────────────────────────── */
// Fixture trees on disk, not a model of one: what has to be proven is that the
// SWEEP goes red, which means the walk, the extension filter, the tokenizer and
// the verdict, together. A predicate called with a string proves none of that.

const VITEST_SCRIPTS = new Set(['demo', 'test', 'test:coverage', 'test:integration', 'test:watch']);

/** The forms that MUST be refused. Every one is a spelling seen in the wild or named on the card. */
export const RED_CASES = [
  'pnpm --filter @objectstack/spec test -- --maxWorkers=2 gen-sdui-manifest',
  'pnpm --filter @objectstack/runtime test -- --maxWorkers=2 --run src/a.test.ts src/b.test.ts',
  'pnpm --filter <pkg> test -- <file>',
  'pnpm --filter @objectstack/cli exec vitest run -- src/commands/serve.test.ts',
  'pnpm test -- src/normalize.test.ts',
  'pnpm run test -- --maxWorkers=2 pat',
  'pnpm --filter @objectstack/metadata test:coverage -- src/x.test.ts',
  'npx vitest run -- src/x.test.ts',
  'pnpm --filter @objectstack/spec test --',
  'pnpm exec vitest run --maxWorkers=2 -- src/x.test.ts',
];

/** The forms that MUST be allowed. The dev-script and turbo entries are the ones that matter. */
export const GREEN_CASES = [
  'pnpm dev -- --fresh -p <random>',
  'pnpm dev:crm -- --fresh -p 38421',
  'pnpm dev:showcase -- --fresh -p 38999',
  'pnpm turbo run test --filter=@objectstack/dogfood -- --shard=1/3',
  'pnpm turbo run test $FILTERS --concurrency=4 --summarize',
  'npm run test -- --maxWorkers=2 pat',
  'pnpm --filter <pkg> exec vitest run --maxWorkers=2 <file>',
  'pnpm --filter @objectstack/spec test --maxWorkers=2 src/x.test.ts',
  'git checkout -- <paths>',
  'git log --oneline -20 origin/main -- <paths named in the issue>',
  'git stash push -- packages/spec/src/kernel/metadata-plugin.zod.ts',
  'git diff > /tmp/wip.patch && git checkout -- packages/spec',
  '-- PostgreSQL: Find unused indexes',
  '// A vitest worker can die at the process level -- native module segfault, OOM,',
  'node scripts/run-with-stall-guard.mjs --log "$T/x.log" --stall-minutes 10 -- pnpm --filter @objectstack/driver-sql test',
  'node scripts/run-with-stall-guard.mjs --stall-minutes 10 -- pnpm turbo run test --filter=@objectstack/dogfood -- --shard=1/3',
  '| **Backend-only debug** | `pnpm dev -- --fresh -p <random>` | Random high port |',
  'bash scripts/pm/os-verify-lock.sh -c "pnpm --filter @objectstack/spec test --maxWorkers=2 x"',
];

function makeFixtureTree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-test-spelling-'));
  for (const [relPath, body] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return dir;
}

/** A tree that satisfies every anti-vacuity precondition, so refusals are not what is being measured. */
function baseFixtureFiles(extra = {}) {
  return {
    'package.json': JSON.stringify({ name: 'fixture', scripts: { test: 'vitest run', 'test:watch': 'vitest' } }),
    '.claude/agents/os-dev.md': 'Use `pnpm --filter <pkg> exec vitest run --maxWorkers=2 <file>`.\nRestore with `git checkout -- <path>`.\n',
    'skills/x/SKILL.md': 'Start the app with `pnpm dev -- --fresh -p 38421`.\n',
    '.github/workflows/lint.yml': '    run: pnpm turbo run test --filter=@objectstack/dogfood -- --shard=1/3\n',
    'scripts/keep.sh': '# nothing to see\npnpm --filter @objectstack/spec test --maxWorkers=2 x\n',
    'AGENTS.md': 'Rules: always use a `pnpm dev`/`dev:crm` script.\n',
    ...extra,
  };
}

function selfTest() {
  const failures = [];
  const t = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  };

  console.log('classifier — forms that MUST be refused');
  for (const line of RED_CASES) {
    t(line, scanLine(line, VITEST_SCRIPTS).findings.length > 0, true);
  }

  console.log('classifier — forms that MUST be allowed (a false red here is worse than no gate)');
  for (const line of GREEN_CASES) {
    t(line, scanLine(line, VITEST_SCRIPTS).findings.length, 0);
  }

  console.log('the multi-line spelling a line-at-a-time reader misses');
  t(
    'continuation join',
    scanLine(logicalLines('pnpm --filter <pkg> test \\\n  -- --maxWorkers=2 <file>\n')[0].text, VITEST_SCRIPTS).findings.length,
    1,
  );
  // 1 = the joined `a \` + `b`, 3 = `c`, 4 = the empty tail a trailing newline leaves.
  t('continuation keeps the FIRST line number', logicalLines('a \\\nb\nc\n').map((l) => l.line), [1, 3, 4]);

  console.log('the command word is what pnpm would resolve');
  t('--filter consumes its value', commandWord(['pnpm', '--filter', 'test', 'build']), 'build');
  t('run keyword is skipped', commandWord(['pnpm', 'run', 'test']), 'test');
  t('bare script', commandWord(['pnpm', 'test']), 'test');
  t('dev script', commandWord(['pnpm', 'dev:crm']), 'dev:crm');
  t('no command word', commandWord(['pnpm']), null);

  console.log('measured stripper carve-outs, both named');
  t('turbo', judgeRun(['pnpm', 'turbo', 'run', 'test'], VITEST_SCRIPTS).bound, false);
  t('npm', judgeRun(['pnpm', 'npm', 'run', 'test'], VITEST_SCRIPTS).bound, false);

  console.log('the SWEEP over a real temp tree — the walk, not the predicate');
  const redTree = makeFixtureTree(
    baseFixtureFiles({ '.claude/agents/bad.md': 'Run `pnpm --filter @objectstack/spec test -- --maxWorkers=2 <file>`.\n' }),
  );
  try {
    const lines = [];
    t('sweep goes RED on a planted instruction file', run(redTree, (s) => lines.push(s)), EXIT_VIOLATIONS);
    const joined = lines.join('\n');
    t('the message names the file', joined.includes('.claude/agents/bad.md'), true);
    t('the message names the line', joined.includes('.claude/agents/bad.md:1'), true);
    t('the message carries the fix', joined.includes('exec vitest run'), true);
    t('the message names the escape hatch', joined.includes('COUNTER_EXAMPLE_FILES'), true);

    console.log('the escape hatch works — a declared counter-example is not a violation');
    const exempted = sweep(redTree, {
      counterExamples: [{ path: '.claude/agents/bad.md', reason: 'quotes the broken form as a warning' }],
    });
    t('declared file is exempt', exempted.findings.length, 0);
    t('and the exemption is COUNTED, not silent', exempted.exempted, 1);
  } finally {
    rmSync(redTree, { recursive: true, force: true });
  }

  console.log('the same tree WITHOUT the plant is green — the red above is the plant, not the fixture');
  const greenTree = makeFixtureTree(baseFixtureFiles());
  try {
    const lines = [];
    t('sweep is clean', run(greenTree, (s) => lines.push(s)), EXIT_CLEAN);
    // ⭐ The load-bearing half. A green that judged NOTHING is the defect this gate
    // exists to catch, so the green fixture must be green ON THE RULE: it carries the
    // documented `pnpm dev -- --fresh` spelling and the turbo shard form, and both must
    // be reached, judged and cleared — not skipped.
    const greenSweep = sweep(greenTree);
    t('the green tree JUDGED its separators rather than skipping them', greenSweep.judged, 2);
    t('and it prints that number', lines.join('\n').includes('separator(s) JUDGED'), true);
  } finally {
    rmSync(greenTree, { recursive: true, force: true });
  }

  console.log('anti-vacuity — every way a broken selector could wear a pass is a REFUSAL');
  const noRoot = makeFixtureTree({ 'AGENTS.md': 'x\n' });
  try {
    t('a missing declared root refuses', run(noRoot, () => {}), EXIT_REFUSED);
  } finally {
    rmSync(noRoot, { recursive: true, force: true });
  }

  const noVitest = makeFixtureTree({
    'package.json': JSON.stringify({ name: 'f', scripts: { test: 'jest' } }),
    // ⚠️ A REAL package name, not a placeholder: `check-pnpm-filter-targets` judges
    // string literals in `scripts/**` and reds on `--filter x`. Measured, not guessed —
    // the first draft of this fixture spelled `x` and turned that gate red.
    '.claude/keep.md': 'pnpm --filter @objectstack/spec test -- y\n',
    'skills/keep.md': 'x\n',
    '.github/workflows/keep.yml': 'x\n',
    'scripts/keep.sh': 'x\n',
  });
  try {
    t('an empty vitest-script derivation refuses', run(noVitest, () => {}), EXIT_REFUSED);
  } finally {
    rmSync(noVitest, { recursive: true, force: true });
  }

  const noSeparators = makeFixtureTree({
    'package.json': JSON.stringify({ name: 'f', scripts: { test: 'vitest run' } }),
    '.claude/keep.md': 'pnpm --filter @objectstack/spec test\n',
    'skills/keep.md': 'x\n',
    '.github/workflows/keep.yml': 'x\n',
    'scripts/keep.sh': 'x\n',
  });
  try {
    t('a corpus with no bare separator refuses', run(noSeparators, () => {}), EXIT_REFUSED);
  } finally {
    rmSync(noSeparators, { recursive: true, force: true });
  }

  const noLaunchers = makeFixtureTree({
    'package.json': JSON.stringify({ name: 'f', scripts: { test: 'vitest run' } }),
    '.claude/keep.md': 'git checkout -- <path>\n',
    'skills/keep.md': 'x\n',
    '.github/workflows/keep.yml': 'x\n',
    'scripts/keep.sh': 'x\n',
  });
  try {
    t('a corpus with no launcher refuses', run(noLaunchers, () => {}), EXIT_REFUSED);
  } finally {
    rmSync(noLaunchers, { recursive: true, force: true });
  }

  console.log('the declared lists cannot quietly become mute buttons');
  t('exactly one rule-owning file', RULE_OWNING_FILES.length, 1);
  t('and it is this file', RULE_OWNING_FILES[0], 'scripts/check-agent-test-spelling.mjs');
  t('every counter-example carries a reason', COUNTER_EXAMPLE_FILES.every((e) => typeof e.reason === 'string' && e.reason.trim().length > 0), true);
  t('the counter-example list stays tiny', COUNTER_EXAMPLE_FILES.length <= 3, true);

  console.log('the derivation reads THIS workspace, and reads it non-empty');
  const derived = deriveVitestScripts(REPO_ROOT);
  t('derives a non-empty script set', derived.names.size > 0, true);
  t('derives `test`', derived.names.has('test'), true);
  t('does NOT derive `dev` — the documented dev-server spelling is safe by measurement', derived.names.has('dev'), false);
  t('does NOT derive `dev:crm`', derived.names.has('dev:crm'), false);

  if (failures.length > 0) {
    console.error(`\n✗ check-agent-test-spelling --self-test -- ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    return 1;
  }
  console.log('\n✓ check-agent-test-spelling --self-test: all cases pass');
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  else if (argv.includes('--list')) list();
  else process.exit(run());
}
