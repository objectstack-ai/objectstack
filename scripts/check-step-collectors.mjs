#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-step-collectors (#10814) -- a workflow step that runs several
 * INDEPENDENT self-tests must report every one of their verdicts, and must
 * still fail when any of them does.
 *
 *   node scripts/check-step-collectors.mjs              # the gate
 *   node scripts/check-step-collectors.mjs --self-test  # verify the checker itself
 *
 * ## The defect
 *
 * GitHub executes a `run:` block as `bash -e <file>`, so the FIRST non-zero
 * exit aborts the step and every command after it is never reached. The step
 * then reports one failure and says nothing at all about the commands that were
 * never run -- they are neither green nor red, and no part of the log tells
 * those two apart.
 *
 * Measured, not hypothetical (#10814, from the #10807 incident): lint.yml's
 * `Shallow-history guard self-tests` step ran three independent self-tests as a
 * bare sequence, `git-history.mjs --self-test` was first, and it was red on
 * `main` from ~12:00Z for about ten hours. For that whole window
 * `check-engine-split-ratio.mjs --self-test` and `collect-release-notes.sh
 * --self-test` did not execute in CI once -- on the step that gates every PR.
 * Both happened to be green, so the mask cost nothing that day; the shape it
 * leaves behind is the expensive half: while the first guard is red a SECOND
 * regression in either of the others lands unnoticed, and surfaces only once
 * the first is fixed, at which point it reads as though the fix broke it.
 *
 * This is #4690 one level up. #4690 is a scan that read nothing reporting as a
 * scan that found nothing wrong; this is a step that ran one of three checks
 * reporting as a step that ran its checks.
 *
 * ## What is a defect here, and what is not
 *
 * Abort-on-first-failure is CORRECT for most multi-command blocks, and the
 * distinction is whether the earlier command is a PRECONDITION for reading the
 * later one. `node scripts/check-x.mjs --self-test` followed by `node
 * scripts/check-x.mjs` is the dominant shape in lint.yml, and there the abort
 * is the point: a checker whose own self-test failed has no verdict worth
 * printing. Likewise ci.yml's `mkdir -p "$RUNNER_TEMP/..."` before the run that
 * writes there, and its `psql ALTER SYSTEM` / `pg_reload_conf` sequences.
 *
 * The flagged shape is narrower and mechanically decidable: ONE step invoking
 * `--self-test` on TWO OR MORE DISTINCT scripts. Distinct scripts testing
 * themselves are independent by construction -- none of them is the other's
 * precondition -- so there is no reading under which the later ones should be
 * skipped. Swept over this tree when the gate was written: 343 `run:` steps
 * across every workflow, of which exactly two matched, both in lint.yml's
 * `lint` job, and both are now collectors.
 *
 * ## The remedy this gate requires, and the one it forbids
 *
 * Tolerate-and-collect inside the one block: run every self-test
 * unconditionally, print a verdict per self-test, and exit non-zero at the end
 * naming every one that failed.
 *
 * ⛔ NOT a split into one step per self-test. A plain split does not fix this
 * at all -- Actions skips a job's remaining steps once a step fails, so the
 * mask survives the split verbatim; restoring the property would take an `if:`
 * on each gate step, and a condition is a way for a PR to arrange that a gate
 * does not run on it. (Both gates that read step structure were checked and
 * would have tolerated a split: `check-shard-attestation` scans ci.yml only,
 * and `check-required-contexts` pins job-level properties plus the single
 * `check:required-contexts` step. The split was rejected on the merits above,
 * not because a gate refused it.)
 *
 * ## Why the self-test drives the REAL blocks, under a REAL `bash -e`
 *
 * A collector that swallows the exit code is a strictly worse defect than the
 * masking it replaces, and from the outside it is INDISTINGUISHABLE from
 * success: a green step over a red self-test. Nothing static can tell a
 * collector that propagates from one that does not, so `--self-test` extracts
 * each live block out of lint.yml, writes it to a file, and runs it as
 * `bash -e <file>` -- the same invocation Actions uses -- in a fixture
 * directory where each named script is replaced by a STUB with a controlled
 * exit code. Whether a command ran is read from the stub's own side effect (it
 * appends its path to a log), never inferred from the block's output, so the
 * block cannot vouch for itself.
 *
 * Both directions are pinned, and so is the harness: the same command list is
 * also driven through the PRE-FIX shape (a bare newline-joined sequence), which
 * must mask -- one of three stubs executing when the first fails, three of three
 * when none does. A harness that cannot reproduce the defect cannot certify the
 * fix.
 *
 * Invoked as `node scripts/...` rather than through a `pnpm check:*` alias, on
 * the precedent lint.yml already sets: several gate steps in that job are
 * invoked directly, and dispatch-gates.mjs derives gate families from either
 * spelling, so the direct form loses no discovery and adds no key to the root
 * manifest.
 *
 * NOT because root package.json is off limits: the #9465 changeset lane fences
 * that file's `@changesets/cli` range and its `version` script, not the file,
 * so a `check:step-collectors` key would have been allowed. Recorded because
 * the over-broad reading of that fence propagates as a constraint nobody has.
 */

import { requireDependency } from './import-prerequisite.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const WORKFLOW_DIR = join('.github', 'workflows');

/** The block this gate requires, recognised by the helper it must define. */
const COLLECTOR_ANCHOR = /^\s*run_self_test\s*\(\)\s*\{/m;
/** One invocation of a self-test through the collector helper. */
const COLLECTED_CALL = /^[ \t]*run_self_test[ \t]+(\S.*)$/gm;
/** A repo script path carrying `--self-test` somewhere after it on the same command. */
const SELF_TEST_TARGET = /(?:^|\s)((?:\.\/)?(?:scripts|packages)\/[\w./-]+\.(?:mjs|mts|cjs|js|sh|ts))(?=\s)[^\n]*?\s--self-test\b/;
/** The first repo-relative script path in a command -- the file a stub stands in for. */
const SCRIPT_TOKEN = /(?:^|\s)((?:scripts|packages)\/[\w./-]+\.(?:mjs|mts|cjs|js|sh|ts))(?=\s|$)/;

/**
 * The top-level commands of a `run:` block: whole-line `#` comments dropped and
 * backslash continuations folded, so a multi-LINE single command counts once.
 *
 * @param {string} runText
 * @returns {string[]}
 */
export function topLevelCommands(runText) {
  const out = [];
  let acc = '';
  for (const raw of String(runText).split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (acc) {
      acc += ' ' + line.trim();
    } else {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      acc = trimmed;
    }
    if (acc.endsWith('\\')) {
      acc = acc.slice(0, -1).trim();
      continue;
    }
    out.push(acc);
    acc = '';
  }
  if (acc) out.push(acc);
  return out;
}

/**
 * The DISTINCT scripts a `run:` block asks to self-test.
 *
 * @param {string} runText
 * @returns {string[]}
 */
export function selfTestTargets(runText) {
  const seen = new Set();
  for (const command of topLevelCommands(runText)) {
    const m = SELF_TEST_TARGET.exec(command);
    if (m) seen.add(m[1].replace(/^\.\//, ''));
  }
  return [...seen];
}

/** Does this block use the collector helper rather than a bare sequence? */
export function isCollector(runText) {
  return COLLECTOR_ANCHOR.test(String(runText));
}

/** The commands a collector block drives, in order. */
export function collectedCommands(runText) {
  return [...String(runText).matchAll(COLLECTED_CALL)].map((m) => m[1].trim());
}

/**
 * Judge one workflow's text. Pure over the text, so the self-test drives the
 * same predicate the gate does rather than a paraphrase of it.
 *
 * @param {string} text  workflow YAML source
 * @param {string} file  its file name, for messages
 * @param {(source: string) => unknown} parseYaml
 * @returns {{ problems: string[], steps: number, collectors: Array<{ file: string, job: string, name: string, run: string }> }}
 */
export function scanWorkflowText(text, file, parseYaml) {
  const problems = [];
  const collectors = [];
  let steps = 0;
  let doc;
  try {
    doc = parseYaml(text);
  } catch (error) {
    return { problems: [`${file} does not parse as YAML: ${error.message}`], steps: 0, collectors: [] };
  }
  const jobs = doc && typeof doc === 'object' ? doc.jobs : undefined;
  if (!jobs || typeof jobs !== 'object') return { problems, steps, collectors };

  for (const [job, body] of Object.entries(jobs)) {
    for (const step of Array.isArray(body?.steps) ? body.steps : []) {
      if (typeof step?.run !== 'string') continue;
      steps++;
      const targets = selfTestTargets(step.run);
      if (targets.length < 2) continue;
      const name = typeof step.name === 'string' ? step.name : '(unnamed step)';
      if (!isCollector(step.run)) {
        problems.push(
          `${file}: job \`${job}\`, step "${name}" sequences ${targets.length} independent self-tests ` +
            `(${targets.join(', ')}) in one \`run:\` block. Under \`bash -e\` the first non-zero exit aborts ` +
            `the step, so the ones after it are never run -- neither green nor red (#10814). Route them ` +
            `through a \`run_self_test\` collector that runs each unconditionally and exits non-zero at the ` +
            `end naming every failure.`,
        );
        continue;
      }
      const collected = collectedCommands(step.run);
      const uncollected = targets.filter((t) => !collected.some((c) => c.includes(t)));
      if (uncollected.length > 0) {
        problems.push(
          `${file}: job \`${job}\`, step "${name}" defines a collector but does not route ` +
            `${uncollected.join(', ')} through it -- a self-test outside the collector is masked exactly ` +
            `as before (#10814).`,
        );
        continue;
      }
      collectors.push({ file, job, name, run: step.run });
    }
  }
  return { problems, steps, collectors };
}

/**
 * Scan every checked-in workflow.
 *
 * Missing input is a failure, never a pass (#4690): no workflow directory, and
 * no collector found at all, are both problems -- a scan that reads nothing is
 * indistinguishable from a scan that found nothing wrong.
 *
 * @param {string} root
 * @param {(source: string) => unknown} parseYaml
 */
export function scanWorkflows(root, parseYaml) {
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) {
    return { problems: [`${WORKFLOW_DIR} does not exist -- nothing was verified (see #4690).`], steps: 0, collectors: [], files: 0 };
  }
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .sort();
  if (files.length === 0) {
    return { problems: [`${WORKFLOW_DIR} holds no workflow files -- nothing was verified (see #4690).`], steps: 0, collectors: [], files: 0 };
  }
  const problems = [];
  const collectors = [];
  let steps = 0;
  for (const file of files) {
    const out = scanWorkflowText(readFileSync(join(dir, file), 'utf8'), file, parseYaml);
    problems.push(...out.problems);
    collectors.push(...out.collectors);
    steps += out.steps;
  }
  if (collectors.length === 0 && problems.length === 0) {
    problems.push(
      `scanned ${steps} \`run:\` steps and found no collector at all. Two live in lint.yml's \`lint\` job ` +
        `(#10814); zero means this scan stopped reading them, not that the tree stopped needing them (#4690).`,
    );
  }
  return { problems, steps, collectors, files: files.length };
}

// -- The dynamic half: drive a real block under a real `bash -e` --------------

/**
 * Run one `run:` block the way Actions runs it, against stubs.
 *
 * @param {string} runText   the block, verbatim
 * @param {string[]} commands the commands it is expected to drive
 * @param {Set<number>} failing indices of the commands whose stub exits 1
 * @returns {{ status: number, output: string, executed: string[] }}
 */
export function driveBlock(runText, commands, failing) {
  const dir = mkdtempSync(join(tmpdir(), 'os-step-collector-'));
  try {
    const log = join(dir, 'executed.log');
    commands.forEach((command, i) => {
      const m = SCRIPT_TOKEN.exec(command);
      if (!m) throw new Error(`no repo script path in command: ${command}`);
      const target = join(dir, m[1]);
      mkdirSync(dirname(target), { recursive: true });
      const code = failing.has(i) ? 1 : 0;
      if (target.endsWith('.sh')) {
        writeFileSync(target, `#!/usr/bin/env bash\nprintf '%s\\n' "${m[1]}" >> "$OS_STUB_LOG"\nexit ${code}\n`);
      } else {
        writeFileSync(
          target,
          `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.OS_STUB_LOG, ${JSON.stringify(m[1])} + '\\n');\nprocess.exit(${code});\n`,
        );
      }
    });
    writeFileSync(log, '');
    const script = join(dir, 'block.sh');
    writeFileSync(script, runText);
    // `bash -e <file>` is the invocation GitHub uses for a `run:` block with no
    // `shell:` key. Reproducing it exactly is the whole point of this harness.
    const proc = spawnSync('bash', ['-e', script], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, OS_STUB_LOG: log },
    });
    return {
      status: proc.status ?? -1,
      output: `${proc.stdout ?? ''}${proc.stderr ?? ''}`,
      executed: readFileSync(log, 'utf8').split('\n').filter(Boolean),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The pre-fix shape: the same commands as a bare newline-joined sequence. */
export function bareSequence(commands) {
  return `${commands.join('\n')}\n`;
}

// -- Entry points -------------------------------------------------------------

async function loadYamlParser() {
  const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url);
  return parse;
}

async function run() {
  const parseYaml = await loadYamlParser();
  const { problems, steps, collectors, files } = scanWorkflows(REPO_ROOT, parseYaml);
  if (problems.length > 0) {
    console.error(`✗ check-step-collectors -- ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  • ${p}\n`);
    return 1;
  }
  console.log(
    `✓ check-step-collectors: ${steps} \`run:\` steps across ${files} workflow(s); ` +
      `${collectors.length} step(s) run 2+ independent self-tests, all of them through a collector.`,
  );
  return 0;
}

async function selfTest() {
  const parseYaml = await loadYamlParser();
  const failures = [];
  let checked = 0;
  const assert = (condition, description) => {
    checked++;
    if (!condition) failures.push(description);
  };

  // ---- The static half: the predicate can go red, and reds are specific -----
  const bareFixture = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: Two independent self-tests, sequenced',
    '        run: |',
    '          node scripts/alpha.mjs --self-test',
    '          node scripts/beta.mjs --self-test',
    '',
  ].join('\n');
  const bare = scanWorkflowText(bareFixture, 'fixture.yml', parseYaml);
  assert(bare.problems.length === 1, 'a bare sequence of two distinct self-tests is one problem');
  assert(
    bare.problems[0]?.includes('scripts/alpha.mjs') && bare.problems[0]?.includes('scripts/beta.mjs'),
    'the problem names both masked self-tests',
  );

  const preconditionFixture = bareFixture.replace(
    '          node scripts/alpha.mjs --self-test\n          node scripts/beta.mjs --self-test\n',
    '          node scripts/alpha.mjs --self-test\n          node scripts/alpha.mjs\n',
  );
  assert(
    scanWorkflowText(preconditionFixture, 'fixture.yml', parseYaml).problems.length === 0,
    'the `<gate> --self-test` + `<gate>` precondition shape is NOT flagged -- the abort is correct there',
  );

  const uncollectedFixture = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: A collector that misses one',
    '        run: |',
    '          run_self_test() { "$@"; }',
    '          run_self_test node scripts/alpha.mjs --self-test',
    '          node scripts/beta.mjs --self-test',
    '',
  ].join('\n');
  const uncollected = scanWorkflowText(uncollectedFixture, 'fixture.yml', parseYaml);
  assert(
    uncollected.problems.length === 1 && uncollected.problems[0].includes('does not route'),
    'a self-test left OUTSIDE an existing collector is still flagged -- it is masked exactly as before',
  );

  assert(
    scanWorkflows(join(tmpdir(), 'os-step-collectors-absent'), parseYaml).problems.some((p) => p.includes('does not exist')),
    '#4690: a missing workflow directory is a failure, never a pass',
  );

  // ---- The dynamic half: the LIVE blocks, under a real `bash -e` ------------
  const live = scanWorkflows(REPO_ROOT, parseYaml);
  assert(live.problems.length === 0, `the checked-in workflows pass the static half (${live.problems[0] ?? ''})`);
  assert(live.collectors.length >= 2, `at least the two known collectors are found (found ${live.collectors.length})`);

  for (const collector of live.collectors) {
    const label = `${collector.file} "${collector.name}"`;
    const commands = collectedCommands(collector.run);
    assert(commands.length >= 2, `${label}: the collector drives 2+ commands (found ${commands.length})`);
    if (commands.length < 2) continue;

    // Every self-test green: everything runs, nothing is reported failed, exit 0.
    const allPass = driveBlock(collector.run, commands, new Set());
    assert(allPass.status === 0, `${label}: all green => the step exits 0 (got ${allPass.status})`);
    assert(
      allPass.executed.length === commands.length,
      `${label}: all green => every command runs (${allPass.executed.length}/${commands.length})`,
    );
    assert(
      (allPass.output.match(/^PASS /gm) ?? []).length === commands.length,
      `${label}: all green => a PASS verdict per command`,
    );
    assert(!/FAILED:/.test(allPass.output), `${label}: all green => no failure summary`);

    // One self-test red, in EVERY position -- including first, the position the
    // #10807 incident actually occupied.
    for (let i = 0; i < commands.length; i++) {
      const one = driveBlock(collector.run, commands, new Set([i]));
      assert(
        one.executed.length === commands.length,
        `${label}: command ${i + 1} red => every command still RUNS (${one.executed.length}/${commands.length}) ` +
          `-- a failure must not hide the others' verdicts`,
      );
      assert(
        (one.output.match(/^(PASS|FAIL) /gm) ?? []).length === commands.length,
        `${label}: command ${i + 1} red => a verdict is printed for every command`,
      );
      assert(
        one.status !== 0,
        `${label}: command ${i + 1} red => the step still FAILS (got ${one.status}) -- a collector that ` +
          `swallows the exit code is worse than the masking it replaces and looks identical to success`,
      );
      assert(
        one.output.includes('FAILED:') && one.output.includes(commands[i]),
        `${label}: command ${i + 1} red => the summary NAMES it`,
      );
      const others = commands.filter((_, j) => j !== i);
      assert(
        others.every((c) => one.output.includes(`PASS  ${c}`)),
        `${label}: command ${i + 1} red => the others are reported PASS, not silence`,
      );
    }

    // Every self-test red: all of them run, all of them are named.
    const allFail = driveBlock(collector.run, commands, new Set(commands.map((_, i) => i)));
    assert(allFail.status !== 0, `${label}: all red => the step fails`);
    assert(allFail.executed.length === commands.length, `${label}: all red => every command still runs`);
    assert(
      commands.every((c) => allFail.output.includes(`FAIL  ${c}`)),
      `${label}: all red => every command is named in a FAIL verdict`,
    );

    // ---- The ablation: the PRE-FIX shape must MASK ------------------------
    // Same commands, same harness, bare sequence. If this does not mask, the
    // harness is not faithful and every assertion above is worthless.
    const masked = driveBlock(bareSequence(commands), commands, new Set([0]));
    assert(
      masked.executed.length === 1,
      `${label}: ABLATION -- the pre-fix bare sequence with the first command red must run exactly 1 ` +
        `of ${commands.length} (ran ${masked.executed.length}); a harness that cannot reproduce the ` +
        `defect cannot certify the fix`,
    );
    assert(masked.status !== 0, `${label}: ABLATION -- the pre-fix shape does fail, it just fails silently`);
    const unmasked = driveBlock(bareSequence(commands), commands, new Set());
    assert(
      unmasked.executed.length === commands.length && unmasked.status === 0,
      `${label}: ABLATION control -- with nothing red the pre-fix shape runs all ${commands.length}, so the ` +
        `mask above is caused by the FAILURE and not by the harness`,
    );
  }

  if (failures.length === 0) {
    console.log(`✓ check-step-collectors --self-test: ${checked} assertions, ${live.collectors.length} live block(s) driven under a real \`bash -e\`.`);
    return 0;
  }
  console.error(`✗ check-step-collectors --self-test -- ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  • ${f}`);
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--self-test') process.exit(await selfTest());
  else process.exit(await run());
}
