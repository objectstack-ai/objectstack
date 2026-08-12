// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { QA as CoreQA } from '@objectstack/core';
import * as QA from '@objectstack/spec/qa';
import type { ZodError } from 'zod';

/**
 * Directory names a wildcard never descends into (#7363).
 *
 * `node_modules` is the one that made the command unusable, but all four are
 * the same claim: a wildcard is a search of *your* sources, and none of these
 * holds one. `node_modules` and `.git` are foreign trees; `dist` and `build`
 * are generated, so a suite found there is a stale copy of one that also lives
 * in source — discovering both runs it twice, and reports the build output's
 * version of a file the author is editing.
 *
 * The prune applies only to directories a *wildcard* reached. A pattern that
 * spells the name out still walks it — whether the name sits in the static
 * base (`node_modules/pkg/qa/…`, never offered to the prune at all) or in a
 * literal segment the walk itself matched (`packages/<any>/dist/…`). Naming a
 * directory is asking for it, and a list of defaults must not overrule the
 * argument you typed.
 */
const PRUNED_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

/** `**` — matches zero or more path segments. */
const GLOBSTAR = Symbol('globstar');

type SegmentMatcher = typeof GLOBSTAR | { readonly literal: string } | { readonly re: RegExp };

/**
 * Compile one pattern segment.
 *
 * Only `*` and `**` are wildcards — the two the command documents. Every other
 * regex metacharacter is escaped, including `?`, which the previous
 * escape-the-dots-only translation leaked through as a quantifier: `a?.json`
 * used to mean "optional `a`" and matched `.json`.
 */
function compileSegment(segment: string): SegmentMatcher {
  if (segment === '**') return GLOBSTAR;
  if (!segment.includes('*')) return { literal: segment };
  const source = segment
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return { re: new RegExp(`^${source}$`) };
}

function segmentMatches(matcher: SegmentMatcher, name: string): boolean {
  if (matcher === GLOBSTAR) return true;
  return 'literal' in matcher ? matcher.literal === name : matcher.re.test(name);
}

/**
 * Is this entry a file? `Dirent` already answers for the common cases, so the
 * only entries that still cost a syscall are symlinks — which `Dirent` reports
 * as neither file nor directory, and which the old `statSync` pass did count as
 * matches. That behaviour is preserved; what is gone is stat'ing every survivor
 * a second time.
 */
function isFileEntry(entry: fs.Dirent, fullPath: string): boolean {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(fullPath).isFile();
  } catch {
    return false; // dangling link — not a suite anyone can load
  }
}

/**
 * Resolve a glob-like pattern to matching file paths.
 * Supports `*` (single segment wildcard) and `**` (recursive wildcard).
 * Falls back to direct file path if no glob characters are present.
 *
 * The walk is lazy and segment-directed: it descends only into directories that
 * can still satisfy the rest of the pattern, and never builds a list of
 * candidates to filter afterwards. The previous implementation materialised
 * `readdirSync(baseDir, { recursive: true })` — every path under the base, as
 * one array, before any filtering ran — which for a leading `**` (base dir `.`)
 * meant the whole repository. Measured on this monorepo, `os test` with a
 * `**` pattern died at exit 134 after ~7 minutes of GC thrash, before a single
 * suite loaded (#7363).
 *
 * The walk also never descends into a symlinked directory. That is not only
 * cycle safety, it is the other half of why the old array was unsurvivable:
 * `readdirSync(…, { recursive: true })` DOES follow them, and a pnpm
 * `node_modules` is a symlink graph in which every package links to its
 * dependencies' real directories — so the set of walkable paths is not merely
 * large, it is combinatorial in dependency depth. That is where the "millions
 * of entries" came from, and how a tree `find` reports as ~97k real entries
 * exhausted an 8 GB heap.
 */
export function resolveGlob(pattern: string): string[] {
  // Direct file path — no wildcards
  if (!pattern.includes('*')) {
    return fs.existsSync(pattern) ? [pattern] : [];
  }

  const segments = pattern.replace(/\\/g, '/').split('/');

  // Peel off the leading static segments: they are a plain directory path, and
  // walking them is a lookup rather than a search.
  let globStart = 0;
  while (globStart < segments.length && !segments[globStart].includes('*')) globStart++;
  const baseParts = segments.slice(0, globStart);
  const baseDir = baseParts.length === 0
    ? '.'
    : baseParts[0] === ''
      // A leading '' means an absolute pattern. Folding it through `path.join`
      // as an ordinary segment turned `/tmp/x/*.json` into a cwd-relative
      // `tmp/x`, which then silently matched nothing.
      ? path.join('/', ...baseParts)
      : path.join(...baseParts);

  // No `existsSync(baseDir)` guard: the walk's own `readdirSync` is the thing
  // that has to survive a base that is missing, unreadable, or a plain file,
  // and it does. A pre-check would only be a second answer to the same
  // question — and the one that goes stale between the check and the read.

  // Adjacent `**` segments are one `**`; collapsing them keeps the walk from
  // reaching the same directory down two different pattern paths.
  const matchers: SegmentMatcher[] = [];
  for (const segment of segments.slice(globStart)) {
    const matcher = compileSegment(segment);
    if (matcher === GLOBSTAR && matchers[matchers.length - 1] === GLOBSTAR) continue;
    matchers.push(matcher);
  }

  const results: string[] = [];

  const walk = (dir: string, index: number): void => {
    const matcher = matchers[index];
    const isLast = index === matchers.length - 1;

    // `**` also matches *zero* segments, so the rest of the pattern gets a turn
    // at this same directory before we descend.
    if (matcher === GLOBSTAR && !isLast) walk(dir, index + 1);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — nothing in it can be a match
    }

    for (const entry of entries) {
      const isDir = entry.isDirectory();
      const fullPath = path.join(dir, entry.name);

      if (matcher === GLOBSTAR) {
        // A trailing `**` matches every file below this point.
        if (isLast && isFileEntry(entry, fullPath)) results.push(fullPath);
        // `**` is a wildcard, so the prune list applies to it unconditionally.
        if (isDir && !PRUNED_DIRS.has(entry.name)) walk(fullPath, index);
        continue;
      }

      if (!segmentMatches(matcher, entry.name)) continue;
      // Pruned only when a wildcard segment is what reached it.
      if (isDir && PRUNED_DIRS.has(entry.name) && !('literal' in matcher)) continue;

      if (isLast) {
        if (isFileEntry(entry, fullPath)) results.push(fullPath);
      } else if (isDir) {
        walk(fullPath, index + 1);
      }
    }
  };

  walk(baseDir, 0);

  // `readdir` order is filesystem-dependent; suites should run in the same
  // order on every machine.
  return [...new Set(results)].sort();
}

/** The suite shape, quoted back at an author whose file did not match it. */
const SUITE_SHAPE =
  '{ "name": string, "scenarios": [ { "id", "name", "steps": [ { "name", "action": { "type", "target" } } ] } ] }';

/**
 * Load and VALIDATE one Quality Protocol suite file.
 *
 * This used to be `JSON.parse(content) as QA.TestSuite`, carrying the schema
 * author's own `// Should validate with Zod`. The cast is the declared≠enforced
 * gap ADR-0049 names (#6247): `TestSuiteSchema` was declared, shipped and
 * documented, and had no `parse` site anywhere in the platform — the TYPE was
 * the contract the runner read, and a type assertion checks nothing at runtime.
 * What a bad file did instead of being refused: a missing `scenarios` TypeError'd
 * inside `TestRunner.runSuite` with no idea which file it came from; a misspelled
 * `steps` reported the scenario PASSED having executed nothing; a bad
 * `action.type` reached the HTTP adapter's `default:` branch mid-run, after the
 * earlier steps had already written records.
 *
 * So the parse happens HERE, at the boundary where the file name is still in
 * hand, and the error names the file, lists the issues and prescribes the shape.
 * Throws rather than exiting, so the caller keeps ownership of the run tally —
 * one broken suite is a failed suite, not a dead command.
 */
export function loadTestSuite(file: string): QA.TestSuite {
  const content = fs.readFileSync(file, 'utf-8');

  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch (e) {
    // A bare `Unexpected end of JSON input` names nothing; with a glob expanding
    // to a dozen files that is a message you have to bisect by hand.
    throw new Error(
      `${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}\n` +
        `  A Quality Protocol suite is a JSON document shaped ${SUITE_SHAPE}`,
    );
  }

  const result = QA.TestSuiteSchema.safeParse(doc);
  if (!result.success) {
    const issues = (result.error as ZodError).issues
      .map((issue) => `  ✗ ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `${file} is not a valid Quality Protocol suite (TestSuiteSchema):\n${issues}\n` +
        `  Expected shape: ${SUITE_SHAPE}\n` +
        `  Reference: content/docs/references/qa/testing.mdx`,
    );
  }

  return result.data as QA.TestSuite;
}

/**
 * The suite-count line, in the ONE spelling a caller may match on (#7848).
 *
 * `Found N test suites.` was already printed — but only when N was positive, so
 * the single number a CI step needs in order to tell "every suite passed" from
 * "there were no suites" was missing from exactly the run where it mattered.
 * It is emitted on every run now, `Found 0 test suites.` included, and the
 * wording lives here rather than inline so an edit to the prose has to notice
 * it is editing a machine-readable surface.
 */
export function foundSuitesLine(count: number): string {
  return `Found ${count} test suites.`;
}

export default class Test extends Command {
  /**
   * The empty-match posture is stated in the help text on purpose (#7848).
   *
   * `os test 'qa/nothing-matches-*.test.json'` exits 0 — a green exit from a run
   * that executed nothing, which is the #7347 `coverage.json` shape (a check that
   * checked nothing, reporting success). The exit status is nevertheless kept as
   * it is: a repository that legitimately ships no suites must not start failing
   * CI because we changed our minds about a number nobody documented. So the
   * posture becomes DECLARED, and `--fail-on-empty` makes the strict reading
   * available to the callers that want it.
   */
  static override description =
    'Run Quality Protocol test scenarios against a running server.\n' +
    'A pattern that matches no suite is NOT a failure by default: the run prints ' +
    '"Found 0 test suites." and exits 0, so a repository that legitimately ships no ' +
    'suites does not fail CI. Pass --fail-on-empty for the strict reading, where a ' +
    'pattern that has stopped matching (a renamed directory, a moved suite) fails the ' +
    'step instead of reporting success forever.';

  static override args = {
    files: Args.string({ description: 'Glob pattern for test files (e.g. "qa/*.test.json")', required: false, default: 'qa/*.test.json' }),
  };

  static override flags = {
    url: Flags.string({ description: 'Target base URL', default: 'http://localhost:3000' }),
    token: Flags.string({ description: 'Authentication token' }),
    'fail-on-empty': Flags.boolean({
      description: 'Exit non-zero when the pattern matches no test suite (default: matching nothing exits 0)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Test);
    const filesPattern = args.files;

    console.log(chalk.bold(`\n🧪 ObjectStack Quality Protocol Runner`));
    console.log(chalk.dim(`-------------------------------------`));
    console.log(`Target: ${chalk.blue(flags.url)}`);
    
    // 1. Setup Runner
    const adapter = new CoreQA.HttpTestAdapter(flags.url, flags.token);
    const runner = new CoreQA.TestRunner(adapter);

    // 2. Find test files using glob-style pattern matching
    const testFiles: string[] = resolveGlob(filesPattern);

    if (testFiles.length === 0) {
        // The count line comes FIRST and unconditionally: a caller parsing stdout
        // gets the same statement on an empty run as on a full one.
        console.log(foundSuitesLine(0));
        console.warn(chalk.yellow(`No test files found matching: ${filesPattern}`));
        if (flags['fail-on-empty']) {
            console.error(chalk.red(`--fail-on-empty: a run that loaded no suite is a failed run.`));
            process.exit(1);
        }
        console.log(chalk.dim(`Exiting 0 — an empty match is not a failure. Pass --fail-on-empty to make it one.`));
        return;
    }

    console.log(foundSuitesLine(testFiles.length));

    // 3. Run Tests
    let totalPassed = 0;
    let totalFailed = 0;

    for (const file of testFiles) {
        console.log(`\n📄 Running suite: ${chalk.bold(path.basename(file))}`);

        // Load and validate FIRST, and report a refusal on its own terms: a file
        // the schema rejects never had a chance to run, so folding it into the
        // run-failure branch below would report it as if the server had said no.
        let suite: QA.TestSuite;
        try {
            suite = loadTestSuite(file);
        } catch (e) {
            console.error(chalk.red(e instanceof Error ? e.message : String(e)));
            totalFailed++; // Count suite failure
            continue;
        }

        try {
            const results = await runner.runSuite(suite);

            for (const result of results) {
                const icon = result.passed ? '✅' : '❌';
                console.log(`  ${icon} Scenario: ${result.scenarioId} (${result.duration}ms)`);
                if (!result.passed) {
                   console.error(chalk.red(`     Error: ${result.error}`));
                   result.steps.forEach(step => {
                       if (!step.passed) {
                           console.error(chalk.red(`     Step Failed: ${step.stepName}`));
                           if (step.output) console.error(`     Output:`, step.output);
                           if (step.error) console.error(`     Error:`, step.error);
                       }
                   });
                   totalFailed++;
                } else {
                    totalPassed++;
                }
            }
        } catch (e) {
            console.error(chalk.red(`Failed to run suite ${file}: ${e}`));
            totalFailed++; // Count suite failure
        }
    }

    // 4. Summary
    console.log(chalk.dim(`\n-------------------------------------`));
    if (totalFailed > 0) {
        console.log(chalk.red(`FAILED: ${totalFailed} scenarios failed. ${totalPassed} passed.`));
        process.exit(1);
    } else {
        console.log(chalk.green(`SUCCESS: All ${totalPassed} scenarios passed.`));
        process.exit(0);
    }
  }
}
