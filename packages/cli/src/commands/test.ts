// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { QA as CoreQA } from '@objectstack/core';
import * as QA from '@objectstack/spec/qa';
import type { ZodError } from 'zod';

/**
 * Resolve a glob-like pattern to matching file paths.
 * Supports `*` (single segment wildcard) and `**` (recursive wildcard).
 * Falls back to direct file path if no glob characters are present.
 */
function resolveGlob(pattern: string): string[] {
  // Direct file path — no wildcards
  if (!pattern.includes('*')) {
    return fs.existsSync(pattern) ? [pattern] : [];
  }

  // Split pattern into the static base directory and the glob portion
  const parts = pattern.split(path.sep.replace('\\', '/'));
  // Also handle forward-slash on Windows
  const segments = pattern.includes('/') ? pattern.split('/') : parts;

  let baseDir = '.';
  let globStart = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].includes('*')) {
      globStart = i;
      break;
    }
    baseDir = i === 0 ? segments[i] : path.join(baseDir, segments[i]);
  }

  if (!fs.existsSync(baseDir)) return [];

  // Convert the glob portion into a RegExp
  const globPortion = segments.slice(globStart).join('/');
  const regexStr = globPortion
    .replace(/\./g, '\\.')           // escape dots
    .replace(/\*\*\//g, '(.+/)?')   // ** matches any directory depth
    .replace(/\*\*/g, '.*')         // trailing ** without slash
    .replace(/\*/g, '[^/]*');       // * matches within a single segment
  const regex = new RegExp(`^${regexStr}$`);

  // Recursively read all files under baseDir
  const entries = fs.readdirSync(baseDir, { recursive: true, encoding: 'utf-8' }) as string[];
  return entries
    .filter(entry => regex.test(entry.replace(/\\/g, '/')))
    .map(entry => path.join(baseDir, entry))
    .filter(fullPath => fs.statSync(fullPath).isFile());
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

export default class Test extends Command {
  static override description = 'Run Quality Protocol test scenarios against a running server';

  static override args = {
    files: Args.string({ description: 'Glob pattern for test files (e.g. "qa/*.test.json")', required: false, default: 'qa/*.test.json' }),
  };

  static override flags = {
    url: Flags.string({ description: 'Target base URL', default: 'http://localhost:3000' }),
    token: Flags.string({ description: 'Authentication token' }),
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
        console.warn(chalk.yellow(`No test files found matching: ${filesPattern}`));
        // Create a demo test file if none exist?
        return;
    }

    console.log(`Found ${testFiles.length} test suites.`);

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
