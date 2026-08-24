#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-pnpm-acquisition -- every job that RUNS pnpm must acquire it first, and
// this gate prints the whole acquisition census every time it passes.
//
//   node scripts/check-pnpm-acquisition.mjs
//   node scripts/check-pnpm-acquisition.mjs --list
//   node scripts/check-pnpm-acquisition.mjs --self-test
//
// ## The defect this closes: a census that reaches zero while its subject lives
//
// The repo moved its `corepack enable` sites onto `.github/actions/setup-pnpm`,
// and that conversion was scoped -- correctly, and by its own measurement -- to
// the population `corepack enable` names. When it finishes, a grep for
// `corepack enable` across `.github/workflows/` returns 0.
//
// Zero is the dangerous number here. It is a TRUE answer about Corepack that
// reads as a complete answer about pnpm acquisition, and those are not the same
// question: `showcase-smoke.yml` acquires pnpm through `pnpm/action-setup@v6`,
// which contains no Corepack string and is therefore invisible to that key.
// Anyone greping the key in six months gets 0 and concludes the class is
// closed, while a job still downloads pnpm from the registry on every run.
//
// A metric that reaches zero while the thing it measures survives is worse than
// no metric, because it actively retires the attention. That is the whole
// reason this file exists, and it is the same asymmetry one level up from the
// one the conversion card itself named: a signature keyed on the step name
// `Verify pnpm version` under-reported the sites, because the unpaired ones
// downloaded inside a differently-named step.
//
// ## Why keying on the NEED rather than the MECHANISM is the fix
//
// Any gate keyed on a mechanism spelling inherits the defect above: it goes
// blind the day someone reaches for a spelling it does not know, and it goes
// blind SILENTLY, as a zero. So the population here is not "steps that say
// corepack" -- it is **every job that invokes `pnpm` in a `run:` step**. That
// population is defined by what the job needs, not by how it gets it.
//
// The inversion is what makes the census self-repairing. A mechanism this gate
// has never heard of does not vanish into a zero; it surfaces as a job that
// runs pnpm with no recognised acquisition, which is a hard, loud failure
// naming both of its readings ("a fifth path, or a broken job"). The unknown
// becomes the alarm rather than the blind spot.
//
// For the same reason every mechanism keeps a row in the printed census even at
// count 0. A zero next to its siblings is a measurement; a zero alone is what
// this gate exists to stop being mistaken for an all-clear.
//
// ## The ordering invariant, and the two jobs that paid for it
//
// `actions/setup-node`'s pnpm store cache (`cache: pnpm`, or a setup-node major
// whose `package-manager-cache` default is on) reads `packageManager` out of
// package.json and SHELLS OUT to pnpm to locate the store. So it requires pnpm
// on PATH *before* the setup-node step -- the opposite ordering from every
// `setup-pnpm` caller in this repo, which puts setup-node first.
//
// Getting that backwards does not degrade, it kills the job in the setup step:
//
//   ##[error]Unable to locate executable file: pnpm.
//
// and nothing in the failing step mentions pnpm, so the misleading first read
// is that some `run:` line invoked a package manager. `partof-closing-keyword-
// guard.yml` and `single-claim-path-guard.yml` both carry that receipt in their
// headers. It is statically decidable, so it is checked here: a job whose
// setup-node asks for the pnpm store cache must acquire pnpm strictly earlier.
//
// That invariant is what makes `showcase-smoke.yml` safe to LEAVE on
// `pnpm/action-setup` (see the census note below) and what would catch the
// naive conversion of it -- moving the acquisition after setup-node to match
// the house pattern, while leaving `cache: pnpm` behind.
//
// ## Recognised spellings -- published, because an unrecognised one is silent
//
// Same discipline as `check-cross-package-test-inputs`: the list a source scan
// can see is part of the contract, so it is published rather than left inside
// the implementation.
//
//   uses: ./.github/actions/setup-pnpm     composite       cache-backed
//   uses: pnpm/action-setup@<ref>          action-setup    downloads per job
//   run:  ... corepack enable ...          corepack-inline downloads per job
//   run:  ... npm i -g pnpm ...            npm-global      downloads per job
//   run:  ... get.pnpm.io/install.sh ...   standalone      downloads per job
//
// Reaching for a spelling that is not here? Add it here AND add a `--self-test`
// case in the same edit -- never route around it by adding an exemption. An
// unrecognised mechanism is the defect at the top of this file, not a style
// question.
//
// ## Boundaries, stated so they are not mistaken for coverage
//
// - Only `.github/workflows/*.yml|yaml` is scanned. Acquisition performed
//   INSIDE a `run:` script (`bash scripts/foo.sh` that enables Corepack itself)
//   is not statically visible; today no script in `scripts/` does this -- they
//   consume the pnpm their workflow already acquired.
// - Jobs that delegate to a reusable workflow (job-level `uses:`) have no steps
//   to read and are reported as unscannable rather than counted as clean.
// - `run:` steps are read from the PARSED document, so pnpm named only in a
//   YAML comment is correctly not an invocation. Seven workflows here are
//   deliberately dependency-free and mention pnpm only to explain why they
//   install none; a grep-based population would sweep all seven in.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { isEntrypoint } from './invoked-as.mjs';

const WORKFLOW_DIR = '.github/workflows';

/**
 * The recognised acquisition mechanisms, in report order. `cached` records
 * whether the happy path makes a registry call -- the census prints it so the
 * remaining exposure is legible without opening any workflow.
 */
export const MECHANISMS = [
  { id: 'composite', label: 'uses: ./.github/actions/setup-pnpm', cached: true },
  { id: 'action-setup', label: 'uses: pnpm/action-setup@<ref>', cached: false },
  { id: 'corepack-inline', label: 'run: corepack enable', cached: false },
  { id: 'npm-global', label: 'run: npm i -g pnpm', cached: false },
  { id: 'standalone', label: 'run: get.pnpm.io/install.sh', cached: false },
];

// `pnpm` as a COMMAND: preceded by start/whitespace/shell punctuation and
// followed by whitespace or end. The trailing guard is what keeps
// `pnpm-lock.yaml` and `pnpm-workspace.yaml` out of the population -- both
// appear in `run:` bodies, and matching them would put every job in scope.
const RE_PNPM_INVOKE = /(?:^|[\s;&|(`$])pnpm(?=[\s;&|)`]|$)/m;

const RE_COREPACK = /(?:^|[\s;&|(`$])corepack\s+enable\b/m;
const RE_STANDALONE = /get\.pnpm\.io\/install/;

// npm's global flag and `pnpm` on the same line, in either order.
const RE_NPM_GLOBAL_LINE = /\bnpm\s+(?:i|install|add)\b/;

const RE_COMPOSITE_USES = /^\.\/\.github\/actions\/setup-pnpm\/?$/;
const RE_ACTION_SETUP_USES = /^pnpm\/action-setup(?:@|$)/;
const RE_SETUP_NODE_USES = /^actions\/setup-node(?:@|$)/;

/** Does this `run:` body install pnpm globally through npm? */
function isNpmGlobalPnpm(run) {
  return run.split('\n').some((line) => {
    if (!RE_NPM_GLOBAL_LINE.test(line)) return false;
    if (!/\bpnpm\b/.test(line)) return false;
    return /(?:^|\s)(?:-g|--global)(?:\s|$)/.test(line);
  });
}

/** The mechanism a step uses to acquire pnpm, or null. */
function classifyStep({ uses, run }) {
  if (uses) {
    if (RE_COMPOSITE_USES.test(uses)) return 'composite';
    if (RE_ACTION_SETUP_USES.test(uses)) return 'action-setup';
  }
  if (run) {
    if (RE_COREPACK.test(run)) return 'corepack-inline';
    if (isNpmGlobalPnpm(run)) return 'npm-global';
    if (RE_STANDALONE.test(run)) return 'standalone';
  }
  return null;
}

/** Does this setup-node step ask for the pnpm store cache? */
function wantsPnpmStoreCache(step) {
  const withNode = step.get('with', true);
  if (!isMap(withNode)) return false;
  const cache = withNode.get('cache');
  if (cache != null && String(cache).trim() === 'pnpm') return true;
  const pmc = withNode.get('package-manager-cache');
  return pmc === true || String(pmc).trim() === 'true';
}

/**
 * Scan a checkout's workflows.
 *
 * @param {string} root  Repo root.
 * @returns {{files: string[], sites: object[], pnpmJobs: object[], problems: object[], unscannable: object[]}}
 */
export function scan(root) {
  const dir = join(root, WORKFLOW_DIR);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  const sites = [];
  const pnpmJobs = [];
  const problems = [];
  const unscannable = [];

  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter });
    const where = `${WORKFLOW_DIR}/${file}`;
    const lineOf = (node) => (node?.range ? lineCounter.linePos(node.range[0]).line : 0);

    const jobsNode = doc.get('jobs', true);
    if (!isMap(jobsNode)) continue;

    for (const pair of jobsNode.items) {
      const jobId = String(pair.key?.value ?? pair.key);
      const job = pair.value;
      if (!isMap(job)) continue;

      const stepsNode = job.get('steps', true);
      if (!isSeq(stepsNode)) {
        if (job.get('uses', true)) {
          unscannable.push({ where, jobId, line: lineOf(pair.key), why: 'delegates to a reusable workflow (no steps to read)' });
        }
        continue;
      }

      const acquisitions = [];
      let firstInvoke = null;
      let storeCache = null;

      stepsNode.items.forEach((step, index) => {
        if (!isMap(step)) return;
        const usesNode = step.get('uses', true);
        const runNode = step.get('run', true);
        const uses = isScalar(usesNode) ? String(usesNode.value ?? '').trim() : null;
        const run = isScalar(runNode) ? String(runNode.value ?? '') : null;
        const line = lineOf(usesNode ?? runNode ?? step);

        const mech = classifyStep({ uses, run });
        if (mech) acquisitions.push({ index, mech, line });

        if (uses && RE_SETUP_NODE_USES.test(uses) && wantsPnpmStoreCache(step) && storeCache === null) {
          storeCache = { index, line };
        }

        if (run && firstInvoke === null && RE_PNPM_INVOKE.test(run)) {
          firstInvoke = { index, line };
        }
      });

      for (const a of acquisitions) {
        sites.push({ where, jobId, line: a.line, mech: a.mech });
      }

      if (firstInvoke === null && storeCache === null) continue;

      pnpmJobs.push({ where, jobId, acquisitions, firstInvoke, storeCache });

      if (firstInvoke !== null) {
        const before = acquisitions.filter((a) => a.index <= firstInvoke.index);
        if (acquisitions.length === 0) {
          problems.push({
            kind: 'no-acquisition',
            where: `${where}:${firstInvoke.line}`,
            jobId,
            problem: 'runs pnpm but no step in the job acquires it by any recognised mechanism',
            fix: 'add `uses: ./.github/actions/setup-pnpm` -- or, if this job DOES acquire pnpm by a mechanism this gate has never seen, teach the gate: that unseen path is the defect in this script\'s header',
          });
        } else if (before.length === 0) {
          problems.push({
            kind: 'acquired-late',
            where: `${where}:${firstInvoke.line}`,
            jobId,
            problem: `runs pnpm before acquiring it (acquisition is at line ${acquisitions[0].line})`,
            fix: 'move the acquisition step above the first pnpm invocation',
          });
        }
      }

      if (storeCache !== null) {
        const strictlyBefore = acquisitions.filter((a) => a.index < storeCache.index);
        if (strictlyBefore.length === 0) {
          problems.push({
            kind: 'store-cache-before-acquisition',
            where: `${where}:${storeCache.line}`,
            jobId,
            problem:
              'actions/setup-node asks for the pnpm store cache, but pnpm is not acquired before this step -- setup-node shells out to pnpm to locate the store and the job dies here with "Unable to locate executable file: pnpm"',
            fix: 'acquire pnpm in an earlier step, or drop the pnpm store cache from setup-node and use the repo\'s explicit `pnpm store path` + actions/cache pair',
          });
        }
      }
    }
  }

  return { files, sites, pnpmJobs, problems, unscannable };
}

/** Render the census. Printed on success too -- that is the point of this gate. */
function renderCensus({ files, sites, pnpmJobs, unscannable }) {
  const lines = [];
  const uncachedTotal = sites.filter((s) => !MECHANISMS.find((m) => m.id === s.mech)?.cached).length;

  lines.push(
    `  pnpm acquisition census -- population is JOBS THAT RUN pnpm, not one spelling.`,
    `  ${files.length} workflow(s) scanned - ${pnpmJobs.length} job(s) need pnpm - ${sites.length} acquisition site(s), ${uncachedTotal} of them uncached.`,
    '',
  );

  for (const m of MECHANISMS) {
    const mine = sites.filter((s) => s.mech === m.id);
    const tag = m.cached ? 'cached  ' : 'UNCACHED';
    lines.push(`  ${tag}  ${String(mine.length).padStart(3)}  ${m.id.padEnd(16)} ${m.label}`);
    for (const s of mine) lines.push(`                       ${s.where}:${s.line}  (job: ${s.jobId})`);
  }

  if (unscannable.length) {
    lines.push('', `  ${unscannable.length} job(s) this gate cannot read:`);
    for (const u of unscannable) lines.push(`      ${u.where}:${u.line}  (job: ${u.jobId}) -- ${u.why}`);
  }

  lines.push(
    '',
    '  Every mechanism keeps a row above, including the ones at 0. A zero beside',
    '  its siblings is a measurement; a zero on its own is what this gate exists',
    '  to stop being read as "the class is closed". A mechanism nobody has taught',
    '  this gate does not appear as a zero at all -- it surfaces as a job that',
    '  runs pnpm with no recognised acquisition, which fails loudly.',
  );

  return lines.join('\n');
}

export function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const result = scan(root);

  if (result.problems.length === 0) {
    console.log('check-pnpm-acquisition: OK -- every job that runs pnpm acquires it first.\n');
    console.log(renderCensus(result));
    return 0;
  }

  const n = result.problems.length;
  console.error(`check-pnpm-acquisition: ${n} job(s) fail the acquisition contract\n`);
  for (const p of result.problems) {
    console.error(`  - ${p.where} (job: ${p.jobId}) -- ${p.problem}`);
    console.error(`    ${p.fix}\n`);
  }
  console.error(renderCensus(result));
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test -- real fixture roots through the real scan()
// ---------------------------------------------------------------------------

const FIXTURE_HEAD = ['name: F', 'on: push', 'jobs:'];

function wf(...body) {
  return [...FIXTURE_HEAD, ...body].join('\n') + '\n';
}

function withFixture(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pnpm-acq-'));
  try {
    const wfDir = join(dir, WORKFLOW_DIR);
    mkdirSync(wfDir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(wfDir, name), text);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const kinds = (r) => r.problems.map((p) => p.kind).sort();
  const mechs = (r) => r.sites.map((s) => s.mech).sort();

  // The house shape: setup-node, then the composite, then pnpm.
  withFixture(
    {
      'a.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v7',
        "      - uses: actions/setup-node@v7",
        '        with:',
        "          node-version: '22'",
        '      - uses: ./.github/actions/setup-pnpm',
        '      - run: pnpm install --frozen-lockfile',
      ),
    },
    (root) => {
      const r = scan(root);
      t('the house shape passes', r.problems.length === 0, JSON.stringify(kinds(r)));
      t('the composite is recognised', mechs(r).join() === 'composite', JSON.stringify(mechs(r)));
      t('the job is counted as needing pnpm', r.pnpmJobs.length === 1, String(r.pnpmJobs.length));
    },
  );

  // THE case this gate exists for: a job that runs pnpm with no acquisition at
  // all. This is how an unrecognised sixth mechanism surfaces -- loudly, rather
  // than as a silent zero in some mechanism-keyed count.
  withFixture(
    { 'a.yml': wf('  j:', '    runs-on: ubuntu-latest', '    steps:', '      - run: pnpm install') },
    (root) => {
      const r = scan(root);
      t('a job running pnpm with no acquisition FAILS', kinds(r).join() === 'no-acquisition', JSON.stringify(kinds(r)));
    },
  );

  // Ordering: acquisition after the first use.
  withFixture(
    {
      'a.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm install',
        '      - uses: ./.github/actions/setup-pnpm',
      ),
    },
    (root) => {
      const r = scan(root);
      t('acquisition AFTER the first pnpm call FAILS', kinds(r).join() === 'acquired-late', JSON.stringify(kinds(r)));
    },
  );

  // The measured killer: setup-node asking for the pnpm store cache with no
  // pnpm on PATH yet. Both spellings of the request.
  withFixture(
    {
      'a.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/setup-node@v7',
        '        with:',
        '          cache: pnpm',
        '      - uses: ./.github/actions/setup-pnpm',
        '      - run: pnpm install',
      ),
      'b.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/setup-node@v7',
        '        with:',
        '          package-manager-cache: true',
        '      - uses: ./.github/actions/setup-pnpm',
        '      - run: pnpm install',
      ),
    },
    (root) => {
      const r = scan(root);
      t(
        'setup-node wanting the pnpm store cache before acquisition FAILS, both spellings',
        kinds(r).join() === 'store-cache-before-acquisition,store-cache-before-acquisition',
        JSON.stringify(kinds(r)),
      );
    },
  );

  // ...and the same job with pnpm acquired FIRST is exactly showcase-smoke.yml's
  // shape. It must pass: this gate protects that ordering, it does not ban it.
  withFixture(
    {
      'a.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v7',
        '      - uses: pnpm/action-setup@v6',
        '      - uses: actions/setup-node@v7',
        '        with:',
        "          node-version: '22'",
        '          cache: pnpm',
        '      - run: pnpm install --frozen-lockfile',
      ),
    },
    (root) => {
      const r = scan(root);
      t("showcase-smoke's shape (acquire, THEN cache: pnpm) passes", r.problems.length === 0, JSON.stringify(kinds(r)));
      t('pnpm/action-setup is recognised', mechs(r).join() === 'action-setup', JSON.stringify(mechs(r)));
    },
  );

  // The remaining recognised spellings.
  withFixture(
    {
      'a.yml': wf('  j:', '    runs-on: ubuntu-latest', '    steps:', '      - run: corepack enable', '      - run: pnpm i'),
      'b.yml': wf('  j:', '    runs-on: ubuntu-latest', '    steps:', '      - run: npm i -g pnpm', '      - run: pnpm i'),
      'c.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: curl -fsSL https://get.pnpm.io/install.sh | sh -',
        '      - run: pnpm i',
      ),
    },
    (root) => {
      const r = scan(root);
      t(
        'corepack / npm-global / standalone are all recognised',
        mechs(r).join() === 'corepack-inline,npm-global,standalone',
        JSON.stringify(mechs(r)),
      );
      t('...and none of them is a failure', r.problems.length === 0, JSON.stringify(kinds(r)));
    },
  );

  // Population traps. Both of these would put a clean job in scope under a
  // grep-shaped population, and the second is load-bearing: seven workflows in
  // this repo are deliberately dependency-free and mention pnpm ONLY in
  // comments explaining why they install none.
  withFixture(
    {
      'a.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        "      - run: node scripts/x.mjs --lock pnpm-lock.yaml --ws pnpm-workspace.yaml",
      ),
      'b.yml': wf(
        '  j:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      # This job installs no package manager: pnpm is not on PATH here.',
        '      - run: node scripts/y.mjs',
      ),
    },
    (root) => {
      const r = scan(root);
      t(
        'pnpm-lock.yaml / pnpm-workspace.yaml are not pnpm INVOCATIONS',
        r.pnpmJobs.length === 0 && r.problems.length === 0,
        JSON.stringify({ jobs: r.pnpmJobs.length, kinds: kinds(r) }),
      );
    },
  );

  // A reusable-workflow job has no steps: reported, never silently clean.
  withFixture(
    { 'a.yml': wf('  j:', '    uses: ./.github/workflows/other.yml') },
    (root) => {
      const r = scan(root);
      t('a reusable-workflow job is reported as unscannable', r.unscannable.length === 1, JSON.stringify(r.unscannable));
    },
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`check-pnpm-acquisition --self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`check-pnpm-acquisition --self-test: ${cases.length} cases pass (real fixture roots through the real scan()).`);
  return 0;
}

function list() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const r = scan(root);
  for (const s of r.sites) console.log(`${s.mech}\t${s.where}:${s.line}\t${s.jobId}`);
  return 0;
}

// Exports bindings, so an import for those exports alone must run nothing.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  else if (process.argv.includes('--list')) process.exit(list());
  else process.exit(main());
}
