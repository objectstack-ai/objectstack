#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-refd-timer-probe -- the PROCESS-GLOBAL ref'd-timer probe is reachable
 * from ONE module, and every leak pin that needs it goes through that module.
 *
 *   node scripts/check-refd-timer-probe.mjs              # the sweep (the gate)
 *   node scripts/check-refd-timer-probe.mjs --list       # every site the sweep sees
 *   node scripts/check-refd-timer-probe.mjs --self-test  # the detector's own rules
 *
 * ## The class this closes (#10785)
 *
 * `process.getActiveResourcesInfo()` reports the WHOLE process, so a `'Timeout'`
 * count derived from it is AMBIENT: it belongs to every co-tenant test file in
 * the worker and to the runner itself, not to the test reading it. Scoring a
 * subject against it --
 *
 *     const before = refdTimers();
 *     await subject();                       // anything can happen in here
 *     expect(refdTimers()).toBe(before);
 *
 * -- is sound only while the window between the two samples crosses no
 * event-loop turn, because timer callbacks run in the timers phase and a
 * microtask drain never reaches it. That is a property of code the test does
 * not own, and it is written down nowhere.
 *
 * The shape was found FIVE times over four cards before this gate existed
 * (#10785's table, reproduced because it is the measurement that justifies the
 * cost of a gate rather than a fifth site fix):
 *
 *   kernel.test.ts (#4813)                latent
 *   health-monitor.test.ts (#6329)        RED IN THE MERGE QUEUE -- the window
 *                                         stretched past @vitest/runner's own
 *                                         non-unref'd 100ms throttle timer,
 *                                         measured at 105ms
 *   timeout-guard.test.ts (#10604/#10661) RED IN CI -- `expected 2 to be 4`,
 *                                         two FOREIGN timers expiring mid-test
 *   kernel.test.ts x2, hot-reload.test.ts latent, fixed in #10685's PR
 *   service-automation/engine.test.ts     latent (#10783), fixed with this gate
 *
 * Each was repaired at the site. Nothing prevented the next one, and the
 * failure it produces is a shard-only intermittent red whose message points at
 * a timer count rather than at the change that caused it -- which blocks every
 * lane's merge queue at once. Two of five were found that way, not by review.
 *
 * ## Why THIS rule, and not the one that sounds more precise
 *
 * The rule the class suggests is "two readings may only be compared across a
 * window that contains no `await`". That is an AST question, and #10785 turned
 * it down for the reason AGENTS.md already records about source-scanning
 * gates: a text scan that gets it approximately right sees only the spellings
 * it knows, and an unrecognised one produces no flag, SILENTLY. A gate whose
 * default is a silent pass is the failure mode, not a weaker version of the
 * fix.
 *
 * So the rule here is the cheap, robust one: BAN THE RAW PROBE OUTSIDE ONE
 * APPROVED MODULE. It is a grep-level question with a one-entry allowlist, its
 * default is a RED gate naming the file and the line, and the invariant it
 * buys is structural rather than textual -- `stillPinningTheLoop()` is a
 * SYNCHRONOUS function, so its two samples are adjacent synchronous statements
 * and no `await` can be inserted between them without turning it into a
 * different, visibly `async`, function. The approved module argues that at
 * length; this gate is only what makes the argument reachable.
 *
 * ## What is matched, and the boundary that is stated rather than discovered
 *
 * The IDENTIFIER, anywhere in code -- not the `process.`-prefixed spelling.
 * A member access is one route to the function and there are others (`const {
 * getActiveResourcesInfo } = process`, a named import from `node:process`,
 * `process['getActiveResourcesInfo']`), so matching the receiver would leave a
 * silent hole per route. The identifier has to appear whichever route is
 * taken.
 *
 * The one spelling that evades it is a name assembled at runtime from pieces
 * ('getActive' + 'ResourcesInfo'). It is stated here rather than left to be
 * found later: nobody reaches for it by accident, and a gate that pretended to
 * cover it would be making the claim this file exists to refuse.
 *
 * Comments are masked (`js-comment-mask.mjs`) because the rule is about CODE.
 * That is load-bearing rather than tidy: the approved module's docblock, the
 * fake-timer comments in four core suites and this header all have to NAME the
 * banned probe to explain the rule, and a gate that forces authors to reword
 * prose to dodge a scanner teaches them the scanner is noise. String literals
 * are NOT masked -- over-collection can only cost a conversation, while a
 * masked literal would be a hole.
 *
 * ## The vacuous green this cannot have
 *
 * "No file outside the approved module reads the probe" is also true of a tree
 * where the approved module was deleted, renamed, or quietly emptied -- and
 * every pin in the family would then be reading the raw probe under another
 * name with this gate green. So the sweep asserts the approved module is
 * present AND still holds the probe. Zero findings mean the rule held; they
 * never stand for "there was nothing to find".
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** This file, repo-relative. Excluded mechanically -- see EXCLUDED_SELF. */
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join('/');

/**
 * The one module allowed to read the probe -- the allowlist, in full.
 *
 * It is a path rather than a pattern on purpose: "one approved module" is the
 * whole rule, and a pattern would let the population grow without anyone
 * deciding that it should.
 */
const APPROVED_HELPER = 'packages/qa/refd-timer-testkit/src/index.ts';

/**
 * EXCLUDED_SELF, not a second allowlist entry. This file has to spell the
 * identifier to look for it, so it is skipped by IDENTITY (derived from
 * `import.meta.url`, so a rename cannot strand it) rather than by a listed
 * exemption anyone could copy.
 */
const EXCLUDED_SELF = SELF;

/** The banned identifier, whatever receiver it is reached through. */
const PROBE = 'getActiveResourcesInfo';

/** Sources the rule applies to. A `.md` page discussing the probe is prose. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];

/** Directories `git ls-files` can still name that hold no authored source. */
const EXCLUDED_DIRS = ['node_modules/', 'dist/', 'coverage/', '.turbo/'];

// ---------------------------------------------------------------------------

/** Whether the sweep reads this repo-relative path at all. */
export function isScannable(file) {
  if (file === EXCLUDED_SELF) return false;
  if (EXCLUDED_DIRS.some((d) => file === d.slice(0, -1) || file.includes(`/${d}`) || file.startsWith(d))) {
    return false;
  }
  return SCANNED_EXTENSIONS.some((ext) => file.endsWith(ext));
}

/**
 * Every CODE occurrence of the probe identifier in `source`, with 1-based line
 * numbers. `maskComments` blanks comment spans and keeps every offset and
 * newline, so a line number computed on the masked text indexes the original.
 */
export function probeSitesIn(source) {
  const code = maskComments(source);
  const sites = [];
  const rx = new RegExp(`\\b${PROBE}\\b`, 'g');
  const lines = source.split('\n');

  let match;
  while ((match = rx.exec(code)) !== null) {
    const line = code.slice(0, match.index).split('\n').length;
    sites.push({ line, text: (lines[line - 1] ?? '').trim() });
  }
  return sites;
}

/**
 * The gate's verdict over a map of repo-relative path -> source text.
 *
 * Takes the tree as DATA so the self-test drives the same code the sweep does;
 * a detector whose rules are only reachable through the filesystem is a
 * detector whose negative controls have to be believed rather than run.
 */
export function judge(tree) {
  const problems = [];
  const sites = [];

  for (const [file, source] of Object.entries(tree)) {
    if (!isScannable(file)) continue;
    const found = probeSitesIn(source);
    if (found.length === 0) continue;
    sites.push(...found.map((s) => ({ file, ...s })));
    if (file === APPROVED_HELPER) continue;

    for (const s of found) {
      problems.push(
        `RAW PROBE: ${file}:${s.line} reads the process-global timer probe directly.\n`
        + `    ${s.text}\n`
        + '    That reading is AMBIENT -- it counts every co-tenant test file\'s timers and the\n'
        + '    runner\'s own, so comparing two of them across an `await` scores the subject against\n'
        + '    a number the test does not own. It has gone red in CI and in the merge queue.\n'
        + `    Fix: measure the subject's OWN handles, through ${APPROVED_HELPER} --\n`
        + '      const guards = await recordGuards(<the delay the subject arms>, () => subject());\n'
        + '      expect(guards).toHaveLength(<n>);              // the guards were really armed\n'
        + '      expect(stillPinningTheLoop(guards)).toBe(0);   // and none outlived its race\n'
        + '    A genuinely synchronous window (no `await` between the two samples) may use that\n'
        + '    module\'s `refdTimeouts()` instead. It is the private, test-only workspace package\n'
        + '    `@objectstack/refd-timer-testkit`: take it as a devDependency and import it by name.\n'
        + '    ⛔ There is no exemption entry to add here, and this gate offers none: the approved\n'
        + '       module IS the list, and a second copy of the probe is the class this exists to end.',
      );
    }
  }

  const helper = tree[APPROVED_HELPER];
  if (helper === undefined) {
    problems.push(
      `NO APPROVED MODULE: ${APPROVED_HELPER} is not in the scan set.\n`
      + '    Every finding above is measured against it, so its absence makes a clean run\n'
      + '    meaningless rather than good: a tree with no probe anywhere reads exactly like a\n'
      + '    tree where the rule held. If the module moved, move this gate\'s constant with it.',
    );
  } else if (probeSitesIn(helper).length === 0) {
    problems.push(
      `APPROVED MODULE NO LONGER READS THE PROBE: ${APPROVED_HELPER} is present but its code\n`
      + '    does not mention the probe any more. Either the instrument was gutted -- in which\n'
      + '    case every pin in the family is measuring nothing -- or it was rewritten onto a\n'
      + '    different primitive, in which case this gate is now watching the wrong identifier.',
    );
  }

  return { problems, sites };
}

// ---------------------------------------------------------------------------

/** One `git ls-files` invocation, NUL-split. */
function gitFiles(cwd, args) {
  return execFileSync('git', ['ls-files', '-z', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

/**
 * The tree the sweep reads: tracked files PLUS untracked-but-not-ignored ones.
 *
 * The second half matters for the same reason it does in `check-nul-bytes.mjs`
 * -- a new pin written this minute is untracked, and a gate that judged only
 * the index would greenlight exactly the file the author is asking about.
 */
export function readTree(root = REPO_ROOT) {
  const files = new Set([...gitFiles(root, []), ...gitFiles(root, ['--others', '--exclude-standard'])]);
  const tree = {};
  for (const file of files) {
    if (!isScannable(file)) continue;
    try {
      tree[file] = readFileSync(join(root, file), 'utf8');
    } catch {
      // A path in the index with no readable file (a broken symlink, a
      // deletion staged elsewhere) is not this gate's business.
    }
  }
  return tree;
}

// ── Self-test ───────────────────────────────────────────────────────────────

const HELPER_STUB = `
export const refdTimeouts = () =>
    process.${PROBE}().filter((r) => r === 'Timeout').length;
`;

function selfTest() {
  const cases = [
    {
      label: 'the approved module may read the probe → GREEN',
      tree: { [APPROVED_HELPER]: HELPER_STUB },
      expect: 'green',
    },
    {
      // THE NEGATIVE CONTROL. This is the exact fifth site (#10783), and it is
      // what makes a clean run mean something: without a case that reds, a
      // self-test proves only that the detector can be run.
      label: 'a raw probe in another package → RED, naming file and line',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'packages/services/service-automation/src/engine.test.ts':
          `const refdTimers = () =>\n    process.${PROBE}().filter(r => r === 'Timeout').length;\n`,
      },
      expect: 'red',
      wants: [/engine\.test\.ts:2 /, /recordGuards/, /stillPinningTheLoop/],
    },
    {
      label: 'a COMMENT naming the probe → GREEN (prose explains the rule; it does not break it)',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'packages/core/src/kernel.test.ts':
          `// Unlike \`process.${PROBE}()\`, the fake-timer count still sees\n// an unref'd timer.\nconst before = vi.getTimerCount();\n`,
      },
      expect: 'green',
    },
    {
      label: 'a BLOCK comment is masked, and a real hit AFTER it keeps its line number → RED at :5',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'packages/core/src/hot-reload.test.ts':
          `/*\n * ${PROBE} is process-wide.\n * Two lines of prose.\n */\nconst n = process.${PROBE}().length;\n`,
      },
      expect: 'red',
      wants: [/hot-reload\.test\.ts:5 /],
    },
    {
      // Spelling-independence, limb 1. Matching `process.` would miss this.
      label: 'a DESTRUCTURED probe → RED',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'packages/runtime/src/leak.test.ts': `const { ${PROBE} } = process;\n`,
      },
      expect: 'red',
      wants: [/leak\.test\.ts:1 /],
    },
    {
      // Spelling-independence, limb 2: the resolver route, no `process` in sight.
      label: 'a NAMED IMPORT from node:process → RED',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'packages/rest/src/leak.test.ts': `import { ${PROBE} } from 'node:process';\n`,
      },
      expect: 'red',
      wants: [/rest\/src\/leak\.test\.ts:1 /],
    },
    {
      // Spelling-independence, limb 3: computed member access.
      label: 'a BRACKETED member access → RED',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'packages/objectql/src/leak.test.ts': `const n = process['${PROBE}']().length;\n`,
      },
      expect: 'red',
      wants: [/objectql\/src\/leak\.test\.ts:1 /],
    },
    {
      label: 'a .md page discussing the probe is not scanned → GREEN',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'content/docs/testing/timers.md': `Call \`process.${PROBE}()\` to see the loop.\n`,
      },
      expect: 'green',
    },
    {
      // The vacuous green, limb 1.
      label: 'the approved module missing → RED even though no file breaks the rule',
      tree: { 'packages/core/src/kernel.test.ts': 'const before = vi.getTimerCount();\n' },
      expect: 'red',
      wants: [/NO APPROVED MODULE/],
    },
    {
      // The vacuous green, limb 2.
      label: 'the approved module present but no longer reading the probe → RED',
      tree: { [APPROVED_HELPER]: 'export const refdTimeouts = () => 0;\n' },
      expect: 'red',
      wants: [/NO LONGER READS THE PROBE/],
    },
    {
      label: 'two raw sites → two problems, each named',
      tree: {
        [APPROVED_HELPER]: HELPER_STUB,
        'packages/core/src/a.test.ts': `process.${PROBE}();\n`,
        'packages/core/src/b.test.ts': `\n\nprocess.${PROBE}();\n`,
      },
      expect: 'red',
      wants: [/a\.test\.ts:1 /, /b\.test\.ts:3 /],
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const { problems } = judge(c.tree);
    const isRed = problems.length > 0;
    if (isRed !== (c.expect === 'red')) {
      failed += 1;
      console.error(
        `  ✗ ${c.label}\n      expected ${c.expect}, got ${isRed ? 'red' : 'green'}`
        + (isRed ? `\n      ${problems.join('\n      ')}` : ''),
      );
      continue;
    }
    const blob = problems.join('\n');
    const missing = (c.wants ?? []).filter((rx) => !rx.test(blob));
    if (missing.length > 0) {
      failed += 1;
      console.error(
        `  ✗ ${c.label}\n      red as expected, but the message does not name `
        + `${missing.map((m) => `/${m.source}/`).join(', ')}\n      ${blob}`,
      );
      continue;
    }
    console.log(`  ✓ ${c.label}`);
  }

  // Discovery-level assertions, against the REAL tree. The cases above pin the
  // rules; these pin that the sweep still reaches anything at all -- a walk
  // that silently found nothing would satisfy every case above.
  const tree = readTree();
  const count = Object.keys(tree).length;
  if (count < 100) {
    failed += 1;
    console.error(`  ✗ real-tree discovery reached only ${count} source file(s) — the sweep is not walking the repo`);
  } else {
    console.log(`  ✓ real-tree discovery: ${count} source file(s) in the scan set`);
  }
  if (tree[APPROVED_HELPER] === undefined) {
    failed += 1;
    console.error(`  ✗ real-tree discovery did not reach ${APPROVED_HELPER}`);
  } else {
    console.log(`  ✓ real-tree discovery reaches the approved module itself`);
  }
  if (isScannable(EXCLUDED_SELF)) {
    failed += 1;
    console.error('  ✗ this gate does not exclude itself — it would report its own pattern as a violation');
  } else {
    console.log('  ✓ the gate excludes itself by identity, not by a listed exemption');
  }

  if (failed > 0) {
    console.error(`\n✗ check-refd-timer-probe self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`\n✓ check-refd-timer-probe self-test: ${cases.length} cases pass, negative controls included.`);
}

// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const tree = readTree();
  const { problems, sites } = judge(tree);

  if (process.argv.includes('--list')) {
    for (const s of sites) console.log(`${s.file}:${s.line}  ${s.text}`);
    console.log(`\n${sites.length} code site(s) across ${new Set(sites.map((s) => s.file)).size} file(s).`);
    process.exit(0);
  }

  if (problems.length > 0) {
    console.error(`\n✗ check-refd-timer-probe: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `OK  check-refd-timer-probe: ${Object.keys(tree).length} source file(s) swept; the process-global `
    + `timer probe is read in ${APPROVED_HELPER} and nowhere else.\n`
    + `    ${sites.length} code site(s), all inside the approved module, which is present and still reads it.`,
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
