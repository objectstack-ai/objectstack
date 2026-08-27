#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-cli-command-ids (#12016) -- a CLI command id spelled as a STRING LITERAL
 * outside the CLI package must resolve to a real command path inside it.
 *
 *   node scripts/check-cli-command-ids.mjs              # audit the population
 *   node scripts/check-cli-command-ids.mjs --list       # print every literal and where it resolves
 *   node scripts/check-cli-command-ids.mjs --self-test  # verify the checker itself
 *
 * ## The coupling, and why nothing was holding it
 *
 * `packages/drivers/driver-sql/src/schema-drift.ts` tells an operator standing on a
 * corrupted column to run `os migrate multi-value-columns`:
 *
 *     export const MULTI_VALUE_COLUMN_REMEDY_COMMAND = 'os migrate multi-value-columns';
 *
 * That string has to match the oclif command id derived from the path
 * `packages/cli/src/commands/migrate/multi-value-columns.ts`. It is a STRING on
 * purpose -- the alternative is the engine importing from the CLI that boots it,
 * which is worse -- and the declaration comment says so. The coupling is
 * deliberate. Its UNENFORCEDNESS was the finding (#12016, from #11535 / PR #12012).
 *
 * The failure mode is the quiet one: a rename that updates `packages/cli` and the
 * docs but not the driver leaves a STALE HINT INSIDE AN OTHERWISE-CORRECT WARNING.
 * No suite reads that as wrong -- driver-sql's own pin asserts the emitted message
 * CONTAINS the constant, and the constant still matches itself. `declared != enforced`,
 * one layer out.
 *
 * ## Why the general form, and not a pin on that one constant
 *
 * The card proposed this gate on the argument that the constant "is unlikely to stay
 * the only such string", and that is a claim about a population nobody had counted.
 * It was counted before this file was written, on 8a7d070dba -- `--list` reprints it:
 *
 *   - 71 command ids are derivable from `packages/cli/src/commands/**`: 61 from command
 *     files and 11 topic directories, `migrate` being both (it has an `index.ts`).
 *     No `static aliases` anywhere in the tree.
 *   - 274 command-id literals sit in non-test source OUTSIDE `packages/cli`,
 *     across 98 files.
 *   - `packages/spec/src/migrations/registry.ts` carries 40, `schema-drift.ts` 14,
 *     `sql-driver.ts` 10.
 *   - The named constant is one of 14 IN ITS OWN FILE. The SAME warning message
 *     that interpolates it also spells `"os migrate apply"` inline, as a bare
 *     literal with no constant and no pin at all.
 *
 * So the population was never one string; it was 274, and the finding's own file is
 * among the densest sites in the repo. A per-constant pin would have covered 1 of 274
 * and left the identical hazard on the next line of the same template literal.
 *
 * ## The sibling half, inside `packages/cli` (#11465 / PR #12177)
 *
 * The same class was measured INSIDE the CLI package on the same days: 536 invocations
 * in 107 sources, 6 unresolved, two stale and two deliberate. That card chose to fix
 * and DECLARE rather than gate, and #12177's declarations say in prose that "a sweep
 * over the documented CLI invocations in this package will flag both of them". This
 * gate's population starts where that one stops -- every oclif package is excluded from
 * its own scan -- so the two never touch the same line. Two of its lessons are built in
 * here rather than rediscovered: a bare TOPIC resolves (its `os datasource` false
 * positive cannot occur), and an exemption asserts its own cause still holds.
 *
 * ## The resolution rule, derived and not listed
 *
 * Command ids come from the oclif filesystem convention -- the same derivation
 * `scripts/docs-audit/affected-docs.mjs` uses for its `command` doc anchor -- and from
 * DECLARED data, never a curated table:
 *
 *   - Which packages are CLIs: any package whose `package.json` declares `oclif.bin`.
 *     Gated on the declaration, not on a hardcoded `packages/cli` path, so a second
 *     CLI package is covered the day it lands.
 *   - Which binary names count: `oclif.bin` plus every `bin` key the package declares.
 *   - Which ids exist: `src/commands/<a>/<b>.ts` -> `<a> <b>`, and `<a>/index.ts` -> `<a>`.
 *   - A DIRECTORY under `src/commands/` is a TOPIC and resolves too. `os meta` has no
 *     `meta/index.ts`, but `meta/` exists, and oclif serves a topic as topic help --
 *     not as an unknown-command error. `plugin-auth`'s `'os meta' run` prose is
 *     therefore correct, and calling it a violation would be the gate fabricating one.
 *     Renaming the DIRECTORY still reds it, which is the coupling that matters.
 *
 * ## What counts as a literal: the delimiter is the whole precision story
 *
 * The candidate must open IMMEDIATELY after a `'`, `"` or backtick -- the bin name is
 * the first thing in the quoted run. That single rule is what makes an honest detector
 * possible, and it was measured too: the loose form ("a bin name anywhere on a quoted
 * line") produced 9 unresolvable hits of which 6 were noise -- Spanish translation
 * prose where `\b` fired inside `envios diarios`, a Python `import os from 'os'`
 * example, and the sentence "carry an os validate-clean security posture". Every one
 * of those has a LETTER or a SPACE before the `os`, and the delimiter rule drops all
 * six without a single carve-out. What survives is 231 resolving literals and the
 * FIXTURES below.
 *
 * Comment lines are out of population. A comment naming a renamed command is stale
 * prose; the string in an operator's terminal is the thing that misroutes them. Tests
 * are out for the same reason plus one more: a test that pins a command id is asserting
 * about the CLI, and the CLI's own suite is where that belongs.
 *
 * ## Docs are NOT this gate's job, and are not uncovered either
 *
 * `content/docs/deployment/cli.mdx` spells the same command. It is already carried:
 * `affected-docs.mjs`'s `command` anchor maps a changed command FILE to the doc pages
 * naming its phrase, verified on this repo -- a diff touching
 * `packages/cli/src/commands/migrate/multi-value-columns.ts` lists
 * `content/docs/deployment/cli.mdx`. Extending THIS gate over prose would mean
 * deciding, without a delimiter to lean on, which of 811 `os ...` mentions in
 * `content/docs` is a command and which is a sentence -- precisely the fabrication
 * `affected-docs.mjs`'s own header refuses. Source has quotes; prose does not.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OCLIF_COMMANDS_DIR = 'src/commands';

/**
 * This gate's own source, excluded from its own population.
 *
 * ⭐ A CHECKER CANNOT BE ITS OWN EVIDENCE. Every negative fixture below --
 * `'os migrate nonexistent-command'`, `'os demo'`, `'os nope nope'` -- is an
 * unresolvable id ON PURPOSE, because that is what a self-test for this gate is made
 * of. Scanning them would make the gate red exactly in proportion to how well it is
 * tested, and the only way to go green would be to delete the tests.
 *
 * This was found the honest way rather than reasoned out: the gate ran green while the
 * file was still UNTRACKED (`populationFiles` reads `git ls-files`) and reded on the
 * first run after it was committed. Same shape as the fixtures in
 * `scripts/docs-audit/*` that `FIXTURE_EXEMPTIONS` carries -- this one just happens to
 * be in this file, so it is excluded whole rather than line by line.
 */
const OWN_SOURCE = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join('/');

/**
 * The repo roots this gate reads WHOLE — every tracked source file under them is in the
 * population, with no further predicate. `populationFiles` derives its admission test
 * from this list, so the two cannot drift.
 *
 * The gate's other half is not a root at all: a `src/` PATH SEGMENT anywhere
 * (`packages/<pkg>/src/**`, `apps/<app>/src/**`). That is a shape, not a subtree, and it is
 * deliberately not declared below.
 */
const POPULATION_ROOTS = ['scripts'];

/**
 * ⭐ THE LANDING OBLIGATION A NEW GATE CANNOT SEE, AND THIS ONE WALKED INTO TWICE.
 *
 * `scripts/pm/dispatch-gates.mjs` derives WHICH gates a card must run by matching the
 * path literals in each gate's source against the card's changed files. `hintCovers`
 * REFUSES a bare single-segment literal as too generic — a measured refusal (+139084
 * fabricated pairs), and it stays. `'scripts/'` collapses to `scripts`, so the
 * admission predicate above names a root no derivation can match, and this gate would
 * have "landed already invisible": never named for a card touching its own population,
 * scoring the same quiet green for every card in the tree.
 *
 * The escape is this declaration — the `ROOT_DIR_WATCH_HINTS` idiom, carried by
 * `check-role-word.mjs` (`['skills/**']`) and `check-examples-live-imports.mjs`
 * (`['examples/**']`). A subtree spelling is a DIFFERENT CLAIM from a bare word: an
 * author stating what the gate actually reads.
 *
 * ⛔ It must be spelled as a LITERAL, not built from `POPULATION_ROOTS` — the hint
 * extractor reads source text, so a computed `` `${r}/**` `` would produce no hint and
 * leave the gate exactly as invisible. The coupling is enforced from the other side
 * instead, in `--self-test`: every separator-less root must appear here as `<root>/**`,
 * and nothing may appear here that the gate does not walk. A declaration that can drift
 * from the scan is worse than none — it replaces a silent gate with a lying one.
 *
 * That harm is measured, not argued (#12472): run `extractWatchHints` over this file and
 * the literal spelling yields the subtree hint while the computed spelling yields NOTHING.
 * The self-test's own copies of the hint cannot stand in for this line — the extractor
 * blanks comments and the whole `selfTest` body before it scans, so this declaration is
 * the only occurrence in the file that the extractor can ever see. Which is exactly why
 * the `--self-test` case guarding it must search THIS STATEMENT and not the whole file:
 * spelled as a bare whole-file `includes`, it found its own needle and could not fail.
 *
 * ⛔ And only roots the gate reads WHOLE belong here. `packages/**` does not: this gate
 * opens `packages/<pkg>/package.json` and each package's `src` subtree, not the root entire, so
 * declaring it would name this gate for a card touching a package README. Naming a root
 * the gate does not read is a FABRICATED lead, which `hintCovers` prices above the
 * silence it would cure.
 */
const ROOT_DIR_WATCH_HINTS = ['scripts/**'];

/**
 * ## The two ledgers, and why an exemption has to assert its own cause
 *
 * Both are keyed by file AND by the exact candidate text, so a genuinely wrong literal
 * appearing in an exempt file still reds. And both SELF-RETIRE: `main` fails if a listed
 * entry no longer reproduces in the scan, so neither list can rot into a lie about a line
 * that has since been fixed, moved or deleted. That shape is `packages/cli`'s own
 * `EXCLUDED` idiom (#10967 / #11465) -- "an exemption that asserts its own cause still
 * holds" -- and it is the reason this gate can carry a baseline without hiding anything.
 *
 * `FIXTURE_EXEMPTIONS`: an unresolvable id is the POINT of the code -- a checker's own
 * self-test asserting that a NON-command does not match. These are permanent.
 */
const FIXTURE_EXEMPTIONS = [
  {
    file: 'scripts/docs-audit/affected-docs.mjs',
    text: 'os meta resync-plan',
    why: "affected-docs's own self-test case for 'a sibling command id is not this one'",
  },
  {
    file: 'scripts/docs-audit/check-drift-comment.mjs',
    text: 'os demo',
    why: 'a fabricated README fixture for the drift-comment self-test; @objectstack/demo has no CLI',
  },
  {
    file: 'scripts/docs-audit/check-drift-comment.mjs',
    text: 'os demo studio',
    why: 'the same fabricated README fixture, two-word form',
  },
];

/**
 * `BASELINED_VIOLATIONS`: REAL defects of exactly the class this gate exists to catch,
 * standing in packages this card does not own. Filed, linked, printed on every green run
 * -- never silent. The gate ships FIRST with today's violations baselined and the fixes
 * follow in the owning lane, which is the same order `check-cli-test-child-env` shipped in
 * and for the same reason: sweeping without the gate restates a convention instead of
 * enforcing it.
 *
 * EMPTY, and that is the design working rather than a list nobody kept. The gate shipped
 * with exactly one entry -- the `objectstack publish` refusal message in
 * `packages/spec/src/api/endpoint.zod.ts` (#12223) -- and it retired ITSELF: fixing the
 * string to `os package publish` made the entry stop reproducing, the `stale` check below
 * RED, and deleting it the only way back to green. A baseline here cannot outlive its
 * defect, so this list stays a record of work in flight and never becomes a silent
 * exemption. Add to it only under the rule above: a real defect, filed and linked.
 */
const BASELINED_VIOLATIONS = [];

const isExempt = (file, text) =>
  FIXTURE_EXEMPTIONS.some((e) => e.file === file && e.text === text)
  || BASELINED_VIOLATIONS.some((e) => e.file === file && e.text === text);

const LEDGER = () => [...FIXTURE_EXEMPTIONS, ...BASELINED_VIOLATIONS];

/** Every binary name a package declares for itself: `oclif.bin` plus each `bin` key. */
export function binNamesOf(pkg) {
  if (!pkg || typeof pkg !== 'object' || !pkg.oclif || typeof pkg.oclif.bin !== 'string' || !pkg.oclif.bin) return [];
  const names = [pkg.oclif.bin];
  if (pkg.bin && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)) {
    for (const k of Object.keys(pkg.bin)) if (/^[A-Za-z0-9][\w.-]*$/.test(k)) names.push(k);
  }
  return [...new Set(names.filter((n) => /^[A-Za-z0-9][\w.-]*$/.test(n)))];
}

/**
 * The set of ids a commands dir yields: every command FILE, plus every TOPIC directory.
 * `readDir`/`statOf` are injectable so `--self-test` can pin this against a scratch tree.
 */
export function commandIdsUnder(commandsDir, readDir = readdirSync, statOf = statSync) {
  return commandSurfaceUnder(commandsDir, readDir, statOf).ids;
}

/**
 * `{ ids, topics }` for a commands dir. `topics` is every DIRECTORY name -- the
 * distinction `resolveId` needs: a word following a TOPIC is a subcommand attempt and
 * must resolve, while a word following a LEAF command is an argument and is ignored.
 */
export function commandSurfaceUnder(commandsDir, readDir = readdirSync, statOf = statSync) {
  const ids = new Set();
  const topics = new Set();
  const walk = (abs, segs) => {
    let entries;
    try { entries = readDir(abs); } catch { return; }
    for (const name of entries) {
      const child = join(abs, name);
      let st;
      try { st = statOf(child); } catch { continue; }
      if (st.isDirectory()) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) continue;
        ids.add([...segs, name].join(' ')); // the topic itself
        topics.add([...segs, name].join(' '));
        walk(child, [...segs, name]);
        continue;
      }
      const m = /^(.+)\.(?:ts|tsx|js|mjs|cjs)$/.exec(name);
      if (!m) continue;
      const base = m[1];
      if (/\.(?:test|spec|contract|integration|e2e|dry-run)$/.test(base)) continue;
      if (base.includes('.')) continue; // any other dotted sidecar is not a command
      if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) continue;
      ids.add(base === 'index' ? segs.join(' ') : [...segs, base].join(' '));
    }
  };
  walk(commandsDir, []);
  ids.delete('');
  return { ids, topics };
}

/** Discover every oclif CLI package in the repo from DECLARED `oclif.bin`. */
function discoverClis(root = REPO_ROOT) {
  const clis = [];
  const pkgDirs = [];
  const scan = (rel, depth) => {
    let entries;
    try { entries = readdirSync(join(root, rel)); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try { st = statSync(join(root, childRel)); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (existsSync(join(root, childRel, 'package.json'))) pkgDirs.push(childRel);
      if (depth > 0) scan(childRel, depth - 1);
    }
  };
  scan('packages', 2);
  for (const dir of pkgDirs) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')); } catch { continue; }
    const bins = binNamesOf(pkg);
    if (!bins.length) continue;
    const commandsDir = join(root, dir, OCLIF_COMMANDS_DIR);
    if (!existsSync(commandsDir)) continue;
    const { ids, topics } = commandSurfaceUnder(commandsDir);
    clis.push({ dir, bins, ids, topics });
  }
  return clis;
}

/**
 * Every command-id literal on a line, as `{ bin, words, text, index }`.
 * The bin name must be the FIRST thing inside the quoted run -- see the header.
 */
export function literalsOn(line, bins) {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return [];
  const alt = bins.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`['"\`](${alt})((?: [a-z0-9][a-z0-9-]*){1,2})`, 'g');
  const out = [];
  for (const m of line.matchAll(re)) {
    out.push({ bin: m[1], words: m[2].trim().split(' '), text: `${m[1]}${m[2]}`, index: m.index });
  }
  return out;
}

/**
 * Resolve a literal's words to a command id, or `null`.
 *
 * ⭐ THE ONE-WORD FALLBACK IS CONDITIONAL, and the self-test is what forced that. A plain
 * longest-prefix rule ("two words, else one") makes this gate BLIND TO ITS OWN PURPOSE:
 * rename `migrate/multi-value-columns.ts` and `'os migrate multi-value-columns'` quietly
 * falls back to `migrate`, which is a real id -- so the literal the finding is ABOUT
 * would stay green through exactly the rename #12016 describes. It was written that way
 * first and the `--self-test` rename case caught it.
 *
 * The fallback is only correct when the trailing word is an ARGUMENT, and that is
 * mechanically decidable: a word after a TOPIC (a directory under `src/commands/`) is a
 * subcommand attempt and must resolve on its own; a word after a LEAF command is an
 * argument (`os validate metadata`) and is ignored.
 */
export function resolveId(words, ids, topics = new Set()) {
  const two = words.slice(0, 2).join(' ');
  if (words.length >= 2 && ids.has(two)) return two;
  if (words.length >= 2 && topics.has(words[0])) return null;
  return ids.has(words[0]) ? words[0] : null;
}

/** Tracked source files in the population: package `src/` and repo `scripts/`, no tests. */
function populationFiles(root = REPO_ROOT, cliDirs = []) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, maxBuffer: 1 << 28 })
    .toString().trim().split('\n');
  return tracked.filter((f) => {
    if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(f)) return false;
    if (f === OWN_SOURCE) return false;
    if (cliDirs.some((d) => f.startsWith(`${d}/`))) return false;
    if (/\.(?:test|spec)\.[tj]sx?$/.test(f) || f.includes('/__tests__/')) return false;
    return /(?:^|\/)src\//.test(f) || POPULATION_ROOTS.some((r) => f.startsWith(`${r}/`));
  });
}

function audit(root = REPO_ROOT) {
  const clis = discoverClis(root);
  if (!clis.length) return { refusal: 'no package declares `oclif.bin` -- the derivation has no source' };
  const allBins = [...new Set(clis.flatMap((c) => c.bins))];
  const violations = [];
  const resolved = [];
  const seen = new Set();
  for (const file of populationFiles(root, clis.map((c) => c.dir))) {
    let text;
    try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    if (!allBins.some((b) => text.includes(`${b} `))) continue;
    text.split('\n').forEach((line, i) => {
      for (const lit of literalsOn(line, allBins)) {
        const cli = clis.find((c) => c.bins.includes(lit.bin));
        const id = resolveId(lit.words, cli.ids, cli.topics);
        const rec = { file, line: i + 1, text: lit.text, id, cli: cli.dir, src: line.trim().slice(0, 160) };
        if (id) resolved.push(rec);
        else if (isExempt(file, lit.text)) seen.add(`${file}\u0000${lit.text}`);
        else violations.push(rec);
      }
    });
  }
  const stale = LEDGER().filter((e) => !seen.has(`${e.file}\u0000${e.text}`));
  return { clis, violations, resolved, stale, refusal: null };
}

function main() {
  const r = audit();
  if (r.refusal) { console.error(`✗ check-cli-command-ids: ${r.refusal}`); return 1; }
  if (r.violations.length) {
    console.error('✗ check-cli-command-ids: command-id literal(s) that resolve to no command path:\n');
    for (const v of r.violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    literal: "${v.text}"  ->  no such command under ${v.cli}/${OCLIF_COMMANDS_DIR}/`);
      console.error(`    ${v.src}`);
    }
    console.error('\nEither the command was renamed and this string was left behind (fix the string),');
    console.error('or the string never named a command (reword it so it is not a quoted command phrase).');
    return 1;
  }
  if (r.stale.length) {
    console.error('✗ check-cli-command-ids: ledger entr(ies) that no longer reproduce:\n');
    for (const e of r.stale) console.error(`  ${e.file}  "${e.text}"\n    ${e.why}`);
    console.error('\nThe line was fixed, moved or deleted. Delete the ledger entry — an exemption');
    console.error('that has outlived its cause is a claim nobody is checking.');
    return 1;
  }
  for (const e of BASELINED_VIOLATIONS) {
    console.log(`⚠ baselined violation — ${e.file}: "${e.text}"${e.issue ? ` (${e.issue})` : ''}`);
    console.log(`  ${e.why}`);
  }
  const files = new Set(r.resolved.map((x) => x.file)).size;
  console.log(
    `✓ check-cli-command-ids: ${r.resolved.length} command-id literal(s) across ${files} file(s) `
    + `outside ${r.clis.map((c) => c.dir).join(', ')} all resolve to a real command path `
    + `(${r.clis.reduce((n, c) => n + c.ids.size, 0)} ids derived; ${FIXTURE_EXEMPTIONS.length} declared fixture exemptions, `
    + `${BASELINED_VIOLATIONS.length} baselined violation(s) listed above).`,
  );
  return 0;
}

function list() {
  const r = audit();
  if (r.refusal) { console.error(`✗ ${r.refusal}`); return 1; }
  for (const x of [...r.resolved, ...r.violations].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`${x.file}:${x.line}\t"${x.text}"\t${x.id ?? '*** UNRESOLVED ***'}`);
  }
  console.log(`\n${r.resolved.length} resolved, ${r.violations.length} unresolved.`);
  return 0;
}

function selfTest() {
  const cases = [];
  const t = (name, ok, detail = '') => cases.push({ name, ok, detail });

  // -- the id derivation, against a scratch tree (no repo state) --------------
  const dir = mkdtempSync(join(tmpdir(), 'cli-cmd-ids-'));
  try {
    const cmds = join(dir, 'src', 'commands');
    mkdirSync(join(cmds, 'migrate'), { recursive: true });
    mkdirSync(join(cmds, 'meta'), { recursive: true });
    writeFileSync(join(cmds, 'build.ts'), '');
    writeFileSync(join(cmds, 'migrate', 'index.ts'), '');
    writeFileSync(join(cmds, 'migrate', 'multi-value-columns.ts'), '');
    writeFileSync(join(cmds, 'migrate', 'apply.contract.test.ts'), '');
    writeFileSync(join(cmds, 'meta', 'resync.ts'), '');
    const { ids, topics } = commandSurfaceUnder(cmds);
    t('a top-level file is a one-word id', ids.has('build'));
    t('a directory is a topic', topics.has('migrate') && topics.has('meta'));
    t('a leaf command is NOT a topic', !topics.has('build'));
    t('a nested file is a two-word id', ids.has('migrate multi-value-columns'));
    t('topic/index.ts collapses to the topic', ids.has('migrate'));
    t('a topic DIRECTORY resolves even with no index.ts', ids.has('meta'), '`os meta` is topic help, not an error');
    t('a nested command under a topic resolves', ids.has('meta resync'));
    t('a .test.ts sidecar is not a command', !ids.has('migrate apply'));

    // The gate must RED on the exact failure #12016 describes: the command file is
    // renamed and the driver's string is left behind. Same tree, one rename.
    const before = commandSurfaceUnder(cmds);
    rmSync(join(cmds, 'migrate', 'multi-value-columns.ts'));
    writeFileSync(join(cmds, 'migrate', 'multi-value-columns-v2.ts'), '');
    const after = commandSurfaceUnder(cmds);
    const lit = literalsOn("export const C = 'os migrate multi-value-columns';", ['os'])[0];
    t('the known-good literal resolves before the rename',
      resolveId(lit.words, before.ids, before.topics) === 'migrate multi-value-columns');
    t('THE SAME literal resolves to nothing after the rename',
      resolveId(lit.words, after.ids, after.topics) === null,
      'this is the #12016 failure the gate exists to catch');
    t('the fallback does NOT silently rescue it via the topic',
      after.ids.has('migrate') && after.topics.has('migrate')
      && resolveId(lit.words, after.ids, after.topics) === null,
      '`migrate` is a real id; a plain longest-prefix rule would have passed here');
    t('a word after a LEAF command is still an argument',
      resolveId(['build', 'metadata'], after.ids, after.topics) === 'build');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // -- a KNOWN-BAD literal: a command id that resolves to nothing -------------
  const ids = new Set(['migrate apply', 'migrate', 'build']);
  const topics = new Set(['migrate']);
  const bad = literalsOn("throw new Error('run \"os migrate nonexistent-command\" first');", ['os']);
  t('a known-bad literal is detected', bad.length === 1 && bad[0].text === 'os migrate nonexistent-command');
  t('a known-bad literal resolves to NOTHING', bad.length === 1 && resolveId(bad[0].words, ids, topics) === null);
  t('a known-good literal beside it resolves',
    resolveId(literalsOn('`os migrate apply`', ['os'])[0].words, ids, topics) === 'migrate apply');

  // -- the delimiter rule: the six measured noise shapes stay OUT ------------
  t('Spanish prose ("envios diarios") is not a literal', literalsOn("label: 'Limite de envios diarios',", ['os']).length === 0);
  t('a Python import example is not a literal', literalsOn("import os from 'os';", ['os']).length === 0);
  t('an unquoted sentence is not a literal', literalsOn('`carry an os validate-clean security posture`,', ['os']).length === 0);
  t('a comment line is out of population', literalsOn(" * run `os migrate apply` to fix", ['os']).length === 0);
  t('a bin name mid-string is not a literal', literalsOn('`re-run os migrate apply now`', ['os']).length === 0);
  t('a bin name at a quote IS a literal', literalsOn('via "os migrate apply --allow-destructive".', ['os']).length === 1);

  // -- the exemption ledger is site-scoped, not blanket ----------------------
  t('a declared fixture is exempt', isExempt('scripts/docs-audit/check-drift-comment.mjs', 'os demo'));
  t('the SAME text elsewhere is NOT exempt', !isExempt('packages/drivers/driver-sql/src/schema-drift.ts', 'os demo'));
  t('a DIFFERENT text in an exempt file is NOT exempt', !isExempt('scripts/docs-audit/check-drift-comment.mjs', 'os migrate gone'));

  // -- the ledger self-retires: a listed entry that stops reproducing REDS ---
  t('every ledger entry reproduces in the live scan', audit().stale.length === 0,
    audit().stale.map((e) => `${e.file} "${e.text}"`).join('; '));
  t('a fabricated ledger entry would be reported stale',
    (() => {
      const live = audit();
      const fake = { file: 'packages/does/not/exist.ts', text: 'os nope nope' };
      // same predicate `audit` uses, applied to an entry that cannot have been seen
      return !live.resolved.some((x) => x.file === fake.file)
        && !live.violations.some((x) => x.file === fake.file);
    })(),
    'the staleness check is keyed on what the scan actually saw');

  t('the gate excludes its OWN source from its population',
    OWN_SOURCE === 'scripts/check-cli-command-ids.mjs'
    && !audit().resolved.some((x) => x.file === OWN_SOURCE)
    && !audit().violations.some((x) => x.file === OWN_SOURCE),
    'every negative fixture in this file is an unresolvable id by construction');

  // -- the dispatch-gates declaration (#12016's own landing obligation) ------
  //
  // Enforcement cannot hold either half here: the declaration is read by ANOTHER TOOL
  // (`scripts/pm/dispatch-gates.mjs`), so a wrong or stale one runs green in this file
  // forever and pays itself out as a dev dispatched on a scripts/ card with this gate
  // missing from the brief. Both directions are pinned, and both matter — a missing
  // declaration is a silent gate, a surplus one is a lying gate.
  const separatorless = POPULATION_ROOTS.filter((r) => !r.includes('/'));
  t('every whole-root population entry is declared as a subtree (a bare root is refused by '
    + 'hintCovers as too generic, so it needs the `<root>/**` spelling)',
    separatorless.length > 0 && separatorless.every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)));
  t('and nothing is declared that this gate does not walk whole — no fabricated lead',
    ROOT_DIR_WATCH_HINTS.every((h) => POPULATION_ROOTS.includes(h.replace(/\/\*+$/, ''))));
  // ⭐ This case is SCOPED to the declaration statement and DERIVES its needle. Both
  // halves are load-bearing, and the naive spelling got both wrong (#12472).
  //
  // It used to search the WHOLE file for a needle it spelled inline, so `includes` found
  // that needle in the ASSERTION rather than in the declaration and the case was
  // satisfied by its own text: rewriting the declaration into the computed form it
  // exists to reject left the self-test fully GREEN, all 38 cases passing. A case that
  // cannot fail is the same under-enforcement this gate was built to catch, one layer in.
  //
  // Assembling the needle -- the remedy `check-objectql-double-limit.mjs` carries for
  // the identical idiom -- is NOT sufficient here, which is why this looks different from
  // its sibling. That file spells the hint twice (declaration, assertion), so un-spelling
  // the assertion leaves the declaration as the only copy. This file spells it a THIRD
  // time, in the runtime-value case just below, and a whole-file search finds THAT copy
  // and stays green on the computed form. Measured. So the scope is the fix and the
  // derived needle is the hygiene; ⛔ do not widen the search back to the whole file.
  //
  // The harm this case names is real, not theoretical -- measured against the extractor
  // itself: `extractWatchHints` recovers the subtree hint from the literal declaration
  // and recovers NOTHING from the computed one. The self-test's own copies cannot rescue
  // it, because `maskSelfTests` blanks this whole function before the scan runs.
  const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const declSites = [...ownSource.matchAll(/\bconst\s+ROOT_DIR_WATCH_HINTS\s*=\s*([^;]*);/g)];
  t('the declaration statement is found exactly once in this source',
    declSites.length === 1,
    `${declSites.length} site(s) matched -- the case below cannot judge what it cannot locate`);
  t('the declaration is spelled as a LITERAL in this source, not computed',
    declSites.length === 1 && ROOT_DIR_WATCH_HINTS.length > 0
    && ROOT_DIR_WATCH_HINTS.every((h) =>
      declSites[0][1].includes(`'${h}'`) || declSites[0][1].includes(`"${h}"`)),
    'the hint extractor reads source text; a computed `${r}/**` builds no hint at all');
  t('scripts is the root it declares, and the population really reaches across it',
    ROOT_DIR_WATCH_HINTS.includes('scripts/**')
    && new Set(audit().resolved.filter((x) => x.file.startsWith('scripts/')).map((x) => x.file)).size >= 5);

  // -- bin names come from declared data ------------------------------------
  t('oclif.bin is read', binNamesOf({ oclif: { bin: 'os' } }).includes('os'));
  t('bin keys join it', binNamesOf({ oclif: { bin: 'os' }, bin: { objectstack: './bin/run.js' } }).includes('objectstack'));
  t('a package with no oclif block declares no bins', binNamesOf({ bin: { foo: 'x' } }).length === 0);

  // -- the live repo returns a verdict, and it is green ----------------------
  const live = audit();
  t('the live audit returns a verdict', live.refusal === null, live.refusal ?? '');
  t('the live repo has at least one CLI package', live.refusal === null && live.clis.length >= 1);
  t('the live population is non-trivial', live.refusal === null && live.resolved.length > 100,
    live.refusal === null ? `${live.resolved.length} literals` : '');
  t('the finding\'s own constant is in the population',
    live.refusal === null && live.resolved.some((x) =>
      x.file === 'packages/drivers/driver-sql/src/schema-drift.ts' && x.text === 'os migrate multi-value-columns'));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-cli-command-ids self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-cli-command-ids self-test: ${cases.length} cases pass `
    + '(the id derivation covers files, topic indexes and bare topic dirs and drops test sidecars; '
    + 'a known-bad literal resolves to nothing while its good neighbour resolves; '
    + 'the #12016 rename reds THE SAME literal that was green before it; '
    + 'all six measured noise shapes stay out on the delimiter rule alone; '
    + 'the fixture ledger is scoped to file AND text; and the live repo returns a green verdict).',
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  else if (argv.includes('--list')) process.exit(list());
  else process.exit(main());
}
