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
 *
 * ## Two families of self-test, and why one was invisible (#11801)
 *
 * The population above was keyed on ONE spelling -- a `scripts/`|`packages/`
 * path carrying a `--self-test` flag. That is a rule about WHERE a self-test
 * lives, not about what it is, and a second family exists: `*.selftest.sh`
 * standalone matrices (`.claude/hooks/*.selftest.sh`,
 * `scripts/bump-objectui.selftest.sh`), invoked as bare executables with no
 * flag. lint.yml's `Claude hook guard self-tests` step is a real
 * tolerate-and-collect block over that family, and this gate scored it ZERO
 * targets -- so its collector shape was held by a review comment, which is
 * precisely the state this gate exists to end.
 *
 * A step is therefore judged on SELF-DECLARING markers, neither of which names
 * a directory:
 *
 *   M1  a repo script path followed by `--self-test` on the same command
 *   M2  a path whose BASENAME ends `.selftest.sh` -- self-testing is in the name
 *
 * NOT a `.claude/` exception. A hard-coded directory would be this defect one
 * level up: the next self-test outside the listed directories is invisible
 * again.
 *
 * ## Named sets and DISCOVERED sets
 *
 * Widening the markers alone would still not have seen that step, and this is
 * the half the filing did not have: the block names no self-test AT ALL. It
 * runs `find .claude/hooks -name '*.selftest.sh'` and loops over the result, so
 * its only literals are a directory and a glob, and its plurality is a run-time
 * fact. Measured: with the markers widened and nothing else, that step still
 * reports 0 targets.
 *
 * A discovered set is therefore treated as PLURAL BY CONSTRUCTION. That is not
 * a convenience. An enumeration is chosen precisely because the set is open and
 * expected to grow, so a bare loop over one is the #10814 defect with a WIDER
 * blast radius than the named case: the set can gain a member with no edit to
 * the workflow at all, and nothing goes red.
 *
 * The enumeration spellings recognised are PUBLISHED -- here and in the failure
 * text -- and every one is pinned by `--self-test`, on the precedent AGENTS.md
 * sets for `check:cross-package-test-inputs`: a source-text detector sees only
 * the spellings it knows, and an unrecognised one produces no flag SILENTLY.
 * Reaching for a spelling that is not here? Extend the list and pin it in the
 * same edit -- never route around it.
 *
 *   mapfile -t VAR < <(find ROOT ... -name '*.selftest.sh' ...)
 *   readarray -t VAR < <(find ROOT ... -name '*.selftest.sh' ...)
 *   VAR=( ROOT/*.selftest.sh )
 *   for VAR in ROOT/*.selftest.sh; do
 *
 * Routing follows the binding ONE HOP: an array bound by a discovery and then
 * consumed by `for X in "${VAR[@]}"` counts as routed when `run_self_test`
 * receives `$X`. Without that hop the real block reads as unrouted, because the
 * collector never sees the array's own name.
 *
 * ## Population movement, measured before and after (#11801)
 *
 * Generalising M1's path from `scripts|packages` to any repo-relative directory
 * moved NOTHING on this tree: 31 steps carry >=1 target and 2 carry >=2, before
 * and after, both on `main` and on the tree that adds the hook step. The
 * generalisation drops a location rule at measured zero cost; it fabricates no
 * pair and re-attributes no file.
 *
 * M2's LITERAL form currently matches zero live steps -- no workflow invokes a
 * `*.selftest.sh` by name today. It is carried because the family exists and it
 * is pinned by FIXTURES rather than by the tree, so a first literal use is
 * judged on arrival instead of arriving unjudged. Its positive control is the
 * fixture, never the population -- a rule with an empty population cannot be
 * shown to work by the population.
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

/** Extensions a repo script can carry. */
const SCRIPT_EXT = String.raw`(?:mjs|mts|cjs|js|sh|ts)`;
/** A repo-relative path with at least one directory segment -- ANY directory. */
const REPO_PATH = String.raw`(?:\./)?[\w.][\w./-]*\/[\w./-]+`;

/** MARKER 1 -- a repo script path carrying `--self-test` after it on the same command. */
const SELF_TEST_FLAG_TARGET = new RegExp(
  String.raw`(?:^|\s)(${REPO_PATH}\.${SCRIPT_EXT})(?=\s)[^\n]*?\s--self-test\b`,
);
/** MARKER 2 -- a path whose BASENAME declares it a self-test; no flag required. */
const SELF_TEST_NAMED_TARGET = new RegExp(String.raw`(?:^|\s)(${REPO_PATH}\.selftest\.sh)(?=\s|$)`);
/** The first repo-relative script path in a command -- the file a stub stands in for. */
const SCRIPT_TOKEN = new RegExp(String.raw`(?:^|\s)(${REPO_PATH}\.${SCRIPT_EXT})(?=\s|$)`);

/** A `*.selftest.sh` pattern as it appears in a `find -name` argument or a shell glob. */
const SELFTEST_PATTERN = String.raw`[\w.*?/-]*\*?\.selftest\.sh`;

/** Split a glob into the directory it searches and the pattern it matches. */
function splitGlob(glob) {
  const at = glob.lastIndexOf('/');
  return at === -1 ? { root: '.', pattern: glob } : { root: glob.slice(0, at), pattern: glob.slice(at + 1) };
}

/**
 * The enumeration spellings that bind a DISCOVERED set of self-tests to a
 * variable. Published deliberately (see the header): a source-text detector
 * sees only what it knows, and an unrecognised spelling produces no flag
 * silently. Every entry is pinned by `--self-test`.
 */
export const DISCOVERY_SPELLINGS = [
  {
    id: 'mapfile-find',
    example: "mapfile -t VAR < <(find ROOT ... -name '*.selftest.sh' ...)",
    re: new RegExp(
      String.raw`(?:^|\s)(?:mapfile|readarray)\s+(?:-\S+\s+)*(\w+)\s*<\s*<\(\s*find\s+(\S+)[^)]*?-name\s+['"]?(${SELFTEST_PATTERN})['"]?`,
    ),
    read: (m) => ({ variable: m[1], root: m[2], pattern: m[3] }),
  },
  {
    id: 'array-glob',
    example: 'VAR=( ROOT/*.selftest.sh )',
    re: new RegExp(String.raw`(?:^|\s)(\w+)=\(\s*['"]?(${SELFTEST_PATTERN})['"]?\s*\)`),
    read: (m) => ({ variable: m[1], ...splitGlob(m[2]) }),
  },
  {
    id: 'for-glob',
    example: 'for VAR in ROOT/*.selftest.sh; do',
    re: new RegExp(String.raw`(?:^|\s)for\s+(\w+)\s+in\s+['"]?(${SELFTEST_PATTERN})['"]?\s*;?`),
    read: (m) => ({ variable: m[1], ...splitGlob(m[2]) }),
  },
];

/** The published spellings, for failure text -- the list is not a private detail. */
function discoverySpellingHelp() {
  return DISCOVERY_SPELLINGS.map((s) => `      ${s.example}`).join('\n');
}

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
 * The DISTINCT scripts a `run:` block NAMES as self-tests, by either marker.
 *
 * @param {string} runText
 * @returns {string[]}
 */
export function selfTestTargets(runText) {
  const seen = new Set();
  for (const command of topLevelCommands(runText)) {
    for (const re of [SELF_TEST_FLAG_TARGET, SELF_TEST_NAMED_TARGET]) {
      const m = re.exec(command);
      if (m) seen.add(m[1].replace(/^\.\//, ''));
    }
  }
  return [...seen];
}

/**
 * The DISCOVERED sets of self-tests a `run:` block enumerates rather than
 * names. A discovery is PLURAL BY CONSTRUCTION -- see the header.
 *
 * @param {string} runText
 * @returns {Array<{ spelling: string, variable: string, root: string, pattern: string }>}
 */
export function selfTestDiscoveries(runText) {
  const out = [];
  const seen = new Set();
  for (const command of topLevelCommands(runText)) {
    for (const spelling of DISCOVERY_SPELLINGS) {
      const m = spelling.re.exec(command);
      if (!m) continue;
      const read = spelling.read(m);
      const discovery = {
        spelling: spelling.id,
        variable: read.variable,
        root: String(read.root).replace(/^\.\//, '').replace(/\/+$/, '') || '.',
        pattern: read.pattern,
      };
      const key = `${discovery.root}|${discovery.pattern}|${discovery.variable}`;
      if (seen.has(key)) break;
      seen.add(key);
      out.push(discovery);
      break;
    }
  }
  return out;
}

/**
 * The variable names that carry a discovery's items, following the binding ONE
 * HOP through `for X in "${VAR[@]}"`. Without this the real block reads as
 * unrouted: the collector receives the LOOP variable, never the array's name.
 *
 * @param {string} runText
 * @param {string} variable
 * @returns {Set<string>}
 */
export function routedVariables(runText, variable) {
  const names = new Set([variable]);
  const mentions = (text, name) => new RegExp(String.raw`\$\{?${name}\b`).test(text);
  for (let pass = 0; pass < 8; pass++) {
    let grew = false;
    for (const m of String(runText).matchAll(/(?:^|\s)for\s+(\w+)\s+in\s+([^\n;]*)/g)) {
      if (names.has(m[1])) continue;
      if ([...names].some((n) => mentions(m[2], n))) {
        names.add(m[1]);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return names;
}

/** Is this discovery's set routed through the collector helper? */
function discoveryIsRouted(runText, discovery, collected) {
  const names = routedVariables(runText, discovery.variable);
  return collected.some((c) => [...names].some((n) => new RegExp(String.raw`\$\{?${n}\b`).test(c)));
}

/** How a discovery reads in a message. */
function describeDiscovery(d) {
  return `${d.root}/${d.pattern} (discovered at run time, bound to \`${d.variable}\`)`;
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
      const discoveries = selfTestDiscoveries(step.run);
      // A DISCOVERED set is plural by construction -- the enumeration is chosen
      // because the set is open, so a bare loop over it masks a member the
      // workflow never named. See the header.
      if (targets.length < 2 && discoveries.length === 0) continue;
      const subjects = [...targets, ...discoveries.map(describeDiscovery)];
      const name = typeof step.name === 'string' ? step.name : '(unnamed step)';
      if (!isCollector(step.run)) {
        // A discovered set has no static count -- saying "1" would be the very
        // defect this gate's header names: a number that stays right while its
        // subject grows.
        const how =
          discoveries.length > 0
            ? 'a DISCOVERED set of independent self-tests'
            : `${subjects.length} independent self-tests`;
        problems.push(
          `${file}: job \`${job}\`, step "${name}" runs ${how} ` +
            `(${subjects.join(', ')}) as a bare sequence in one \`run:\` block. Under \`bash -e\` the first ` +
            `non-zero exit aborts the step, so the ones after it are never run -- neither green nor red ` +
            `(#10814). Route them through a \`run_self_test\` collector that runs each unconditionally and ` +
            `exits non-zero at the end naming every failure.` +
            (discoveries.length > 0
              ? ` The set is enumerated at run time, so it can gain a member with no edit to this workflow ` +
                `at all -- which is why an enumeration is judged plural on sight.`
              : ''),
        );
        continue;
      }
      const collected = collectedCommands(step.run);
      const uncollected = targets.filter((t) => !collected.some((c) => c.includes(t)));
      const unrouted = discoveries.filter((d) => !discoveryIsRouted(step.run, d, collected));
      const missed = [...uncollected, ...unrouted.map(describeDiscovery)];
      if (missed.length > 0) {
        problems.push(
          `${file}: job \`${job}\`, step "${name}" defines a collector but does not route ` +
            `${missed.join(', ')} through it -- a self-test outside the collector is masked exactly ` +
            `as before (#10814).`,
        );
        continue;
      }
      collectors.push({ file, job, name, run: step.run, discoveries });
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
      `scanned ${steps} \`run:\` steps and found no collector at all. Several live in lint.yml's \`lint\` ` +
        `job (#10814); zero means this scan stopped reading them, not that the tree stopped needing them ` +
        `(#4690). Recognised enumeration spellings for a discovered set:\n${discoverySpellingHelp()}`,
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

/**
 * Run a DISCOVERED-set block the way Actions runs it, against planted stubs.
 *
 * The block enumerates its own self-tests, so the stubs are planted where its
 * OWN `find`/glob will reach them and the block is left to discover them --
 * nothing is substituted into the text. Whether a stub ran is read from its
 * side effect, never inferred from the block's output.
 *
 * @param {string} runText   the block, verbatim
 * @param {{ root: string, pattern: string }} discovery where its enumeration looks
 * @param {string[]} stubNames basenames to plant, in `find | sort` order
 * @param {Set<number>} failing indices of the stubs that exit 1
 * @returns {{ status: number, output: string, executed: string[] }}
 */
export function driveDiscoveryBlock(runText, discovery, stubNames, failing) {
  const dir = mkdtempSync(join(tmpdir(), 'os-step-collector-disc-'));
  try {
    const log = join(dir, 'executed.log');
    const root = discovery.root && discovery.root !== '.' ? discovery.root : '.';
    mkdirSync(join(dir, root), { recursive: true });
    stubNames.forEach((base, i) => {
      const rel = root === '.' ? `./${base}` : `${root}/${base}`;
      const code = failing.has(i) ? 1 : 0;
      writeFileSync(join(dir, root, base), `#!/usr/bin/env bash\nprintf '%s\\n' "${rel}" >> "$OS_STUB_LOG"\nexit ${code}\n`, {
        mode: 0o755,
      });
    });
    writeFileSync(log, '');
    const script = join(dir, 'block.sh');
    writeFileSync(script, runText);
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

/**
 * The pre-fix shape for a discovered set: the same enumeration, looped bare.
 * This is the "simplification" the gate exists to reject, written the way
 * someone reaching for one would write it.
 */
export function bareDiscoveryLoop(discovery) {
  const root = discovery.root && discovery.root !== '.' ? discovery.root : '.';
  return [
    `mapfile -t os_ablation < <(find ${root} -type f -name '${discovery.pattern}' | sort)`,
    'for os_t in "${os_ablation[@]}"; do "$os_t"; done',
    '',
  ].join('\n');
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

  // ---- DISCOVERED sets: recognition, both reds, and the driven block -------
  //
  // Pinned by FIXTURES as well as by the tree. The live tree may hold no
  // discovery collector at a given moment, and coverage that silently drops to
  // zero when a workflow is edited elsewhere is the #4690 shape this family
  // exists to distrust.
  const asWorkflow = (title, body) =>
    [
      'jobs:',
      '  lint:',
      '    steps:',
      `      - name: ${title}`,
      '        run: |',
      ...body.map((l) => (l ? `          ${l}` : '')),
      '',
    ].join('\n');

  const DISCOVER = "mapfile -t selftests < <(find .claude/hooks -type f -name '*.selftest.sh' | sort)";

  // GREEN: enumerate, then route every discovered item through the collector.
  const discoveryCollectorBody = [
    DISCOVER,
    'if [ "${#selftests[@]}" -eq 0 ]; then',
    '  echo "DISCOVERED NOTHING -- verified nothing, which is a failure and not a pass (#4690)"',
    '  exit 1',
    'fi',
    'echo "discovered ${#selftests[@]} hook self-test(s)"',
    'failed=""',
    'run_self_test() {',
    '  echo "-- $*"',
    '  if "$@"; then',
    '    echo "PASS  $*"',
    '  else',
    '    echo "FAIL  $*"',
    '    failed="${failed} $*"',
    '  fi',
    '  return 0',
    '}',
    'for selftest in "${selftests[@]}"; do',
    '  run_self_test "$selftest"',
    'done',
    'if [ -n "$failed" ]; then',
    '  echo "FAILED:$failed"',
    '  exit 1',
    'fi',
  ];

  // RED 1: the same discovery "simplified" into a bare loop -- no collector.
  const discoveryBareBody = [DISCOVER, 'for selftest in "${selftests[@]}"; do', '  "$selftest"', 'done'];

  // RED 2: a collector exists, but the discovered set walks past it.
  const discoveryUnroutedBody = [
    DISCOVER,
    'run_self_test() { "$@"; }',
    'run_self_test node scripts/alpha.mjs --self-test',
    'for selftest in "${selftests[@]}"; do',
    '  "$selftest"',
    'done',
  ];

  const discGreen = scanWorkflowText(asWorkflow('Discovered self-tests, collected', discoveryCollectorBody), 'fixture.yml', parseYaml);
  assert(discGreen.problems.length === 0, `a DISCOVERED-set collector is accepted (${discGreen.problems[0] ?? ''})`);
  assert(discGreen.collectors.length === 1, `a DISCOVERED-set collector is JUDGED, not skipped (found ${discGreen.collectors.length})`);
  assert(
    discGreen.collectors[0]?.discoveries?.length === 1 &&
      discGreen.collectors[0].discoveries[0].root === '.claude/hooks' &&
      discGreen.collectors[0].discoveries[0].pattern === '*.selftest.sh' &&
      discGreen.collectors[0].discoveries[0].variable === 'selftests',
    'the discovery descriptor reads back its root, pattern and bound variable',
  );

  const discBare = scanWorkflowText(asWorkflow('Discovered self-tests, bare loop', discoveryBareBody), 'fixture.yml', parseYaml);
  assert(discBare.problems.length === 1, `a bare loop over a DISCOVERED set is one problem (got ${discBare.problems.length})`);
  assert(
    discBare.problems[0]?.includes('.claude/hooks/*.selftest.sh') && discBare.problems[0]?.includes('discovered at run time'),
    'the problem NAMES the discovered set rather than reporting an anonymous count',
  );

  const discUnrouted = scanWorkflowText(asWorkflow('Discovered self-tests, not routed', discoveryUnroutedBody), 'fixture.yml', parseYaml);
  assert(
    discUnrouted.problems.length === 1 && discUnrouted.problems[0].includes('does not route'),
    'a DISCOVERED set left outside an existing collector is still flagged',
  );

  // A named `*.selftest.sh` with no `--self-test` flag: MARKER 2's literal form.
  // Its live population is zero (no workflow invokes one by name), so this
  // fixture IS its positive control -- a rule with an empty population cannot be
  // shown to work by the population.
  const namedSelftestBody = ['.claude/hooks/guard-a.selftest.sh', 'scripts/bump-objectui.selftest.sh'];
  const namedBare = scanWorkflowText(asWorkflow('Two named .selftest.sh, sequenced', namedSelftestBody), 'fixture.yml', parseYaml);
  assert(
    namedBare.problems.length === 1 &&
      namedBare.problems[0].includes('.claude/hooks/guard-a.selftest.sh') &&
      namedBare.problems[0].includes('scripts/bump-objectui.selftest.sh'),
    'MARKER 2: two bare `*.selftest.sh` invocations are flagged, in ANY directory and with no flag',
  );
  assert(
    selfTestTargets('bash tools/local/thing.sh --self-test\nbash ops/other.sh --self-test').length === 2,
    'MARKER 1: the `--self-test` flag is recognised outside `scripts/`|`packages/` too',
  );
  assert(
    scanWorkflowText(asWorkflow('One named .selftest.sh', ['.claude/hooks/guard-a.selftest.sh']), 'fixture.yml', parseYaml).problems.length === 0,
    'a SINGLE named self-test is not a masking pair -- the threshold still bites',
  );

  // Every published discovery spelling is pinned. An unrecognised spelling
  // produces no flag SILENTLY, so the list is only as good as its pins.
  for (const spelling of DISCOVERY_SPELLINGS) {
    const sample = {
      'mapfile-find': DISCOVER,
      'array-glob': 'selftests=( .claude/hooks/*.selftest.sh )',
      'for-glob': 'for selftest in .claude/hooks/*.selftest.sh; do',
    }[spelling.id];
    assert(typeof sample === 'string', `discovery spelling \`${spelling.id}\` has a pinned sample`);
    if (typeof sample !== 'string') continue;
    const found = selfTestDiscoveries(sample);
    assert(
      found.length === 1 && found[0].root === '.claude/hooks' && found[0].pattern === '*.selftest.sh',
      `discovery spelling \`${spelling.id}\` is recognised and reads back its root and pattern (got ${JSON.stringify(found)})`,
    );
  }
  assert(
    selfTestDiscoveries('for selftest in "${selftests[@]}"; do').length === 0,
    'expanding an already-bound array is NOT a second discovery -- the pattern marker is required',
  );
  assert(
    routedVariables('for selftest in "${selftests[@]}"; do', 'selftests').has('selftest'),
    'routing follows the binding one hop, so the collector may receive the LOOP variable',
  );

  /**
   * Drive one DISCOVERED-set block: plant stubs where the block's own
   * enumeration will find them, then read what ran from the stubs' side effect.
   */
  const checkDiscoveryCollector = (label, runText, discovery) => {
    const names = ['zz-os-a.selftest.sh', 'zz-os-b.selftest.sh', 'zz-os-c.selftest.sh'];
    const n = names.length;

    const allPass = driveDiscoveryBlock(runText, discovery, names, new Set());
    assert(allPass.status === 0, `${label}: all green => the step exits 0 (got ${allPass.status})`);
    assert(
      allPass.executed.length === n,
      `${label}: all green => every DISCOVERED self-test runs (${allPass.executed.length}/${n})`,
    );
    assert((allPass.output.match(/^PASS /gm) ?? []).length === n, `${label}: all green => a PASS verdict per discovered self-test`);

    for (let i = 0; i < n; i++) {
      const one = driveDiscoveryBlock(runText, discovery, names, new Set([i]));
      assert(
        one.executed.length === n,
        `${label}: discovered #${i + 1} red => every one still RUNS (${one.executed.length}/${n}) -- a failure ` +
          `must not hide the others' verdicts`,
      );
      assert(
        (one.output.match(/^(PASS|FAIL) /gm) ?? []).length === n,
        `${label}: discovered #${i + 1} red => a verdict is printed for every discovered self-test`,
      );
      assert(
        one.status !== 0,
        `${label}: discovered #${i + 1} red => the step still FAILS (got ${one.status}) -- a collector that ` +
          `swallows the exit code is worse than the masking it replaces`,
      );
      assert(one.output.includes(names[i]), `${label}: discovered #${i + 1} red => the summary NAMES it`);
    }

    const allFail = driveDiscoveryBlock(runText, discovery, names, new Set(names.map((_, i) => i)));
    assert(allFail.status !== 0, `${label}: all red => the step fails`);
    assert(allFail.executed.length === n, `${label}: all red => every discovered self-test still runs`);

    // #4690 positive control, and the proof that the harness drives the block's
    // OWN enumeration: were it reading the repo instead of the fixture, it would
    // find the real matrices here and pass.
    const empty = driveDiscoveryBlock(runText, discovery, [], new Set());
    assert(empty.status !== 0, `${label}: EMPTY discovery => red, never a green pass over nothing (#4690) (got ${empty.status})`);
    assert(empty.executed.length === 0, `${label}: EMPTY discovery => nothing ran, so the fixture really is this block's input`);

    // ABLATION: the pre-fix shape over the SAME discovery must mask.
    const masked = driveDiscoveryBlock(bareDiscoveryLoop(discovery), discovery, names, new Set([0]));
    assert(
      masked.executed.length === 1,
      `${label}: ABLATION -- the pre-fix bare loop with the first red must run exactly 1 of ${n} (ran ` +
        `${masked.executed.length}); a harness that cannot reproduce the defect cannot certify the fix`,
    );
    assert(masked.status !== 0, `${label}: ABLATION -- the pre-fix shape does fail, it just fails silently`);
    const unmasked = driveDiscoveryBlock(bareDiscoveryLoop(discovery), discovery, names, new Set());
    assert(
      unmasked.executed.length === n && unmasked.status === 0,
      `${label}: ABLATION control -- with nothing red the pre-fix loop runs all ${n}, so the mask above is ` +
        `caused by the FAILURE and not by the harness`,
    );
  };

  // Guarded: if the recognition above regressed, the assertions have already
  // recorded it by name. Reaching in anyway would replace that list with a
  // stack trace -- red either way, but a red that says nothing specific.
  if (discGreen.collectors[0]?.discoveries?.length === 1) {
    checkDiscoveryCollector(
      'fixture.yml "Discovered self-tests, collected"',
      discGreen.collectors[0].run,
      discGreen.collectors[0].discoveries[0],
    );
  }

  // ---- The dynamic half: the LIVE blocks, under a real `bash -e` ------------
  const live = scanWorkflows(REPO_ROOT, parseYaml);
  assert(live.problems.length === 0, `the checked-in workflows pass the static half (${live.problems[0] ?? ''})`);
  assert(live.collectors.length >= 2, `at least the two known collectors are found (found ${live.collectors.length})`);

  for (const collector of live.collectors) {
    const label = `${collector.file} "${collector.name}"`;
    // A DISCOVERED-set collector names no command, so it is driven by planting
    // stubs where its own enumeration reaches -- not by substituting text.
    if ((collector.discoveries ?? []).length > 0) {
      for (const discovery of collector.discoveries) checkDiscoveryCollector(label, collector.run, discovery);
      continue;
    }
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
