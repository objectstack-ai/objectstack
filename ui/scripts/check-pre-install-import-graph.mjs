#!/usr/bin/env node
/**
 * check-pre-install-import-graph -- every `scripts/` gate a workflow step runs
 * BEFORE `pnpm install` must load without `node_modules`.
 *
 *   node scripts/check-pre-install-import-graph.mjs
 *   node scripts/check-pre-install-import-graph.mjs --list
 *   node scripts/check-pre-install-import-graph.mjs --self-test
 *
 * ## The property, and why it is worth a gate (objectui#6148)
 *
 * A handful of this repository's gates deliberately run before any install:
 * they read the checkout and nothing else, which is what lets them run
 * UNFILTERED on every pull request shape for the price of a checkout plus one
 * `node` call. `repo-gates.yml`'s install-free steps (the Internal Docs Link
 * Check, Skill Guide Path Check and Control Byte Scan among them, objectui#12214)
 * and `changeset-presence.yml` exist in that shape on purpose -- their headers
 * say a gate a markdown-only PR cannot start "rebuilds the hole it exists to
 * close".
 *
 * The property that arrangement depends on is narrow and unwritten: each of
 * those scripts' WHOLE STATIC IMPORT GRAPH has to be node builtins plus
 * repo-relative modules, with nothing anywhere in it needing `node_modules`.
 *
 * A violation is invisible everywhere it could be caught cheaply:
 *
 *   - not a type error -- `tsc -p tsconfig.scripts.json` is happy with a
 *     package import;
 *   - not a lint error -- the package is a real dependency of the repo;
 *   - not a local failure -- locally `node_modules` exists, so it runs fine;
 *   - not a test failure -- until this gate, exactly ONE of the pre-install
 *     scripts had a test asserting it.
 *
 * It surfaces only as `ERR_MODULE_NOT_FOUND` in a CI job, on whichever pull
 * request happens to touch the file. And for the four gates above, whose whole
 * point is running on shapes that skip installs, that is a gate that STOPS
 * RUNNING rather than a gate that fails loudly -- the failure direction
 * AGENTS.md names as worse than no verifier at all.
 *
 * The class is live rather than theoretical: objectui#6092's PR 2 changed
 * `check-doc-component-types.mjs` -- the single pinned one -- and its test went
 * red immediately, on a change that was in fact still install-free. The same
 * change to any of the others would have produced nothing.
 *
 * ## Two design decisions, and the defect each one prevents
 *
 * **The population is DERIVED from `.github/workflows/`, never hard-coded.** A
 * hard-coded list of scripts rots the first time someone moves a step above
 * `pnpm install` -- which is exactly the edit that needs catching. So this gate
 * parses every workflow, and for every job compares each step's index against
 * the index of the first `pnpm install` step IN THE SAME JOB. Move a step
 * above an install and the population grows on the next run; move one below and
 * it shrinks. objectui#6135 landed the same lesson one layer over: the
 * enumeration is the thing that rots.
 *
 * **The check walks the whole graph, not the entry file's own import lines.**
 * The assertion this gate generalises read one file's imports and required each
 * to start with `node:`. That is too narrow in one direction -- a relative
 * import of a builtins-only local module is fine, and two gates here spell
 * their builtins bare (`from "fs"`), which is equally install-free -- and too
 * weak in the other, because it cannot see a package pulled in ONE HOP AWAY.
 * Measured: adding `import ts from 'typescript'` to `scripts/invoked-as.mjs`
 * reddens the graph walk and is invisible to any own-imports-only form. Since
 * objectui#6092 every one of these scripts imports `./invoked-as.mjs`, so one
 * hop away is where the next breach will come from.
 *
 * ## Why static, and not a resolver hook
 *
 * The runtime alternative -- load each script under a `module.register` hook
 * that throws on any specifier needing `node_modules` -- was the right ad-hoc
 * instrument for the one-off measurement in objectui#6092, and is the wrong one
 * for a gate that runs on every pull request: it EXECUTES module top level.
 * These files are CI gates; several of them spawn `git`, read the whole tree,
 * or `process.exit`. A gate that runs nine other gates to decide whether they
 * could run is a much larger blast radius than the question deserves.
 *
 * ## This gate satisfies its own rule, by construction
 *
 * `repo-gates.yml` runs this file before its install step, so this
 * file is IN its own derived population and walks itself. Its graph is
 * `node:fs`, `node:module`, `node:path`, `node:url`, plus `./invoked-as.mjs`
 * and `./js-comment-mask.mjs`, whose own graphs are builtins only. Nothing here
 * may grow a package import without the gate reporting itself -- which is the
 * intended arrangement, not a coincidence to be preserved by hand.
 *
 * ## What is deliberately NOT judged
 *
 * Non-`node` pre-install steps (a `bash scripts/*.sh`, a `uses:` action) have
 * no JavaScript import graph and are not in the population. And this gate never
 * REPAIRS anything: it installs the floor. A script that needs a package must
 * move below the install in its workflow, or lose the package.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { scanSource } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root -- this file lives at `scripts/` depth 0. */
export function repoRoot() {
  return resolve(HERE, '..');
}

const WORKFLOW_DIR = '.github/workflows';

// ---------------------------------------------------------------------------
// A workflow parser that needs no YAML package
// ---------------------------------------------------------------------------

/**
 * The one constraint that shapes everything below: this gate runs BEFORE
 * `pnpm install`, so it cannot `import { parse } from 'yaml'` the way
 * `scripts/__tests__/entry-guard-wiring.test.ts` legitimately does. What it
 * needs from YAML is small and structural -- jobs, their steps in order, and
 * each step's `run:` scalar -- so it reads the indentation directly.
 *
 * The one part that genuinely cannot be skipped is BLOCK SCALARS: `run: |`
 * bodies are shell, they contain `#` comment lines that are CONTENT rather than
 * YAML comments, and several of them are long. Reading them as ordinary lines
 * would both mis-nest the parse and let a `# pnpm install` in a shell comment
 * move the install boundary -- shrinking the population, which is the unsafe
 * direction.
 *
 * @typedef {{ indent: number, text: string, line: number, block: string | null }} Line
 * @param {string} text
 * @returns {Line[]}
 */
export function lexYaml(text) {
  const raw = text.split('\n');
  /** @type {Line[]} */
  const out = [];

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const text_ = line.trim();
    if (text_.startsWith('#')) continue;

    /** @type {Line} */
    const entry = { indent, text: text_, line: i + 1, block: null };
    out.push(entry);

    // `key: |`, `key: >-`, `key: |2` ... everything more-indented is content.
    if (!/:\s*[|>][+-]?\d*$/.test(text_)) continue;

    /** @type {string[]} */
    const body = [];
    let j = i + 1;
    for (; j < raw.length; j++) {
      const l = raw[j];
      if (l.trim() === '') {
        body.push('');
        continue;
      }
      if (l.length - l.trimStart().length <= indent) break;
      body.push(l);
    }
    const widths = body.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length);
    const dedent = widths.length > 0 ? Math.min(...widths) : 0;
    entry.block = body.map((l) => l.slice(dedent)).join('\n');
    i = j - 1;
  }

  return out;
}

/** `key: value` split for one mapping line, `value` empty for a block scalar. */
function keyValue(text) {
  const at = text.indexOf(':');
  if (at === -1) return null;
  const key = text.slice(0, at).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null;
  return { key, value: text.slice(at + 1).trim() };
}

/**
 * The jobs of one workflow, each with its steps IN ORDER.
 *
 * Step order is the whole point -- "before `pnpm install`" is a statement about
 * indices, and a parser that returned a set rather than a sequence could not
 * answer the question at all.
 *
 * @param {string} text  A workflow file's YAML.
 * @returns {Array<{ id: string, steps: Array<{ index: number, name: string, run: string, uses: string }> }>}
 */
export function parseWorkflowJobs(text) {
  const lines = lexYaml(text);
  const jobsAt = lines.findIndex((l) => l.indent === 0 && l.text === 'jobs:');
  if (jobsAt === -1) return [];

  const after = lines.slice(jobsAt + 1);
  const endsAt = after.findIndex((l) => l.indent === 0);
  const scoped = endsAt === -1 ? after : after.slice(0, endsAt);
  if (scoped.length === 0) return [];

  const jobIndent = scoped[0].indent;
  /** @type {number[]} */
  const starts = [];
  scoped.forEach((l, i) => {
    if (l.indent === jobIndent && /^[A-Za-z0-9_-]+:$/.test(l.text)) starts.push(i);
  });

  return starts.map((start, k) => {
    const block = scoped.slice(start, starts[k + 1] ?? scoped.length);
    return { id: block[0].text.slice(0, -1), steps: parseSteps(block) };
  });
}

/** The `steps:` sequence of one job block, in order. */
function parseSteps(block) {
  const at = block.findIndex((l) => l.text === 'steps:');
  if (at === -1) return [];
  const stepsIndent = block[at].indent;

  const steps = [];
  let itemIndent = -1;
  /** @type {{ index: number, name: string, run: string, uses: string } | null} */
  let current = null;

  const take = (line, text) => {
    const kv = keyValue(text);
    if (!current || !kv) return;
    const value = line.block ?? kv.value;
    if (kv.key === 'run') current.run = value;
    else if (kv.key === 'name') current.name = value;
    else if (kv.key === 'uses') current.uses = value;
  };

  for (const line of block.slice(at + 1)) {
    if (line.indent <= stepsIndent) break;

    if (line.text.startsWith('- ') || line.text === '-') {
      if (itemIndent === -1) itemIndent = line.indent;
      if (line.indent !== itemIndent) continue; // a nested sequence, not a step
      current = { index: steps.length, name: '', run: '', uses: '' };
      steps.push(current);
      if (line.text.length > 1) take(line, line.text.slice(2));
      continue;
    }

    if (itemIndent !== -1 && line.indent === itemIndent + 2) take(line, line.text);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// The derivation: which steps run a `scripts/` gate before an install
// ---------------------------------------------------------------------------

/** A `run:` scalar with its SHELL comment lines dropped. */
function shellCode(run) {
  return run
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
}

/**
 * Does this step install `node_modules`?
 *
 * Anchored at a COMMAND POSITION -- start of line, or just after a `;`, `&&`,
 * `||`, `|` or `(` -- rather than anywhere whitespace precedes the word. Both
 * halves of that are load-bearing, and this repository supplies a case for
 * each:
 *
 *   - `pnpm exec playwright install chromium` (`ci.yml`'s `e2e` job) installs a
 *     BROWSER, not the workspace. The package-manager anchor is what excludes
 *     it, since `playwright` is not `pnpm`.
 *   - `git config merge.pnpm-merge.driver "pnpm install --no-frozen-lockfile"`
 *     CONFIGURES a merge driver; it installs nothing. The command-position
 *     anchor is what excludes it -- the `pnpm` there is inside an argument.
 *
 *     ⚠️ Formerly `changeset-release.yml`, where that step sat ahead of the job's
 *     real install. It was removed with the dead CI half of the lockfile merge
 *     driver (objectui#6436, ruled 2026-08-27), so NO live in-repo instance of
 *     this shape remains. This is the SECOND re-pointing of the example -- PR
 *     objectui#6389 moved it here when `dependabot-auto-merge.yml` lost its copy
 *     -- and this time there is nowhere live to move it to. The shape survives
 *     as the synthetic fixture in the `does not read an install out of a shell
 *     comment or a quoted argument` case of
 *     `scripts/__tests__/check-pre-install-import-graph.test.ts`, cited by test
 *     NAME rather than line number on purpose (objectui#6998 records a
 *     cross-file citation in this repo that had rotted 86 and 107 lines off).
 *     ⛔ Do not drop the anchor because its example went away: it is the reason
 *     the boundary is drawn at a command position, and a quoted `pnpm install`
 *     can reappear in any workflow at any time.
 *
 * Getting that second one wrong would move the install boundary to step 4 and
 * silently drop `scripts/dependabot-merge-gate.mjs` out of the population --
 * the SHRINKING direction, which is the one that costs coverage rather than
 * producing a false red.
 */
const INSTALL_RE = /(?:^|[;&|(])\s*(?:pnpm|npm|yarn|bun)\s+(?:install|ci|i)(?:\s|$)/m;

/**
 * `node scripts/whatever.mjs`, allowing `node --flag script.mjs`.
 *
 * Deliberately looser than `INSTALL_RE`: any whitespace will do before `node`,
 * so a wrapped invocation (`xargs node scripts/x.mjs`, a `bash -c "..."`) is
 * still seen. Over-inclusion here costs a graph walk over a script that may not
 * really run pre-install; under-inclusion costs the coverage this gate exists
 * to install. Those are not symmetric, so the loose form is the right one.
 */
const NODE_SCRIPT_RE = /(?:^|[\s;&|(])node\s+(?:--[^\s]+\s+)*(scripts\/[A-Za-z0-9._/-]+\.(?:mjs|cjs|js))/g;

/**
 * Every step that runs a `scripts/` JavaScript file before the first
 * `pnpm install` in its own job.
 *
 * A job with NO install at all counts entirely: every `node` step in it is a
 * pre-install step. That is not an edge case -- several gate workflows were
 * built that way before objectui#12214 folded most of them into
 * `repo-gates.yml`, whose gates sit before its install step instead.
 *
 * @param {Array<{ file: string, text: string }>} workflows
 * @returns {Array<{ workflow: string, job: string, step: number, stepName: string, script: string }>}
 */
export function derivePreInstallSteps(workflows) {
  const found = [];

  for (const { file, text } of workflows) {
    for (const job of parseWorkflowJobs(text)) {
      const code = job.steps.map((s) => shellCode(s.run));
      const installAt = code.findIndex((run) => INSTALL_RE.test(run));
      const limit = installAt === -1 ? job.steps.length : installAt;

      for (let i = 0; i < limit; i++) {
        // One row per (step, script), not per invocation: `lint.yml`'s
        // entry-guard step runs `--self-test` and then the gate itself, and two
        // identical rows would read as two steps.
        const seen = new Set();
        for (const m of code[i].matchAll(NODE_SCRIPT_RE)) {
          if (seen.has(m[1])) continue;
          seen.add(m[1]);
          found.push({
            workflow: file,
            job: job.id,
            step: i,
            stepName: job.steps[i].name,
            script: m[1],
          });
        }
      }
    }
  }

  return found;
}

/** Read `.github/workflows/` from disk, sorted so output is stable. */
export function readWorkflows(root) {
  const dir = join(root, WORKFLOW_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
}

// ---------------------------------------------------------------------------
// The static import graph
// ---------------------------------------------------------------------------

/**
 * Every specifier this source statically imports.
 *
 * Comment- and literal-aware via `scripts/js-comment-mask.mjs`, and that is not
 * belt-and-braces: `check-entry-guard.mjs` really does carry
 * `'require("fs").writeFileSync(...)'` inside a string literal as one of its
 * corpus cases, and this file's own self-test below spells a `typescript`
 * import inside a fixture string. A scan that read either as code would report
 * a finding it invented out of prose.
 *
 * The KEYWORD's offset is what gets tested against the masks, and the specifier
 * is then read from the untouched source -- so the quotes and their contents
 * survive, which blanking literals outright would not allow.
 *
 * `import()` with a literal argument counts. A dynamic import of a package does
 * not break module load, it breaks whenever the branch is reached -- still a
 * pre-install script that cannot do its job, and still statically visible.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function staticSpecifiers(source) {
  const { comment, literal } = scanSource(source);
  const out = [];

  const patterns = [
    // `import x from 'a'` / `import 'a'` / `export { x } from 'a'`
    /\b(import|export)\b(?:[^'"();]*?\bfrom\s*)?\s*['"]([^'"]+)['"]/g,
    // `import('a')` and `require('a')`
    /\b(import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const at = m.index ?? 0;
      if (comment[at] || literal[at]) continue;
      if (!out.includes(m[2])) out.push(m[2]);
    }
  }

  return out;
}

/** Is this specifier satisfied by node itself, with or without the `node:` prefix? */
export function isBuiltinSpecifier(spec) {
  return isBuiltin(spec) || isBuiltin(spec.replace(/^node:/, ''));
}

/**
 * Walk one entry's static import graph.
 *
 * `read(relativePath)` returns the file's source, or `null` when it does not
 * exist. Injected rather than hard-wired to `readFileSync` so the self-test's
 * fixtures are in-memory graphs rather than temp directories -- the shapes are
 * the contract here, not this tree's current contents.
 *
 * @param {string} entry  Repo-relative path, e.g. `scripts/check-doc-links.mjs`.
 * @param {{ read: (path: string) => string | null }} io
 * @returns {{ modules: string[], violations: Array<{ chain: string[], specifier: string }>, unresolved: Array<{ chain: string[], specifier: string }> }}
 */
export function walkImportGraph(entry, { read }) {
  /** @type {Map<string, string | null>} module -> the module that first reached it */
  const parents = new Map([[entry, null]]);
  const queue = [entry];
  const modules = [];
  const violations = [];
  const unresolved = [];

  /** The path from the entry down to `module`, as it was first reached. */
  const chainTo = (module) => {
    const chain = [];
    for (let at = module; at != null; at = parents.get(at) ?? null) chain.unshift(at);
    return chain;
  };

  while (queue.length > 0) {
    const module = queue.shift();
    const source = read(module);
    if (source == null) {
      // Only reachable for the ENTRY itself: a relative import that resolves to
      // nothing is recorded as unresolved by its importer, below.
      unresolved.push({ chain: chainTo(module), specifier: module });
      continue;
    }
    modules.push(module);
    if (module.endsWith('.json')) continue;

    for (const spec of staticSpecifiers(source)) {
      if (spec.startsWith('.')) {
        const target = join(dirname(module), spec).split('\\').join('/');
        if (read(target) == null) {
          unresolved.push({ chain: [...chainTo(module), spec], specifier: spec });
          continue;
        }
        if (!parents.has(target)) {
          parents.set(target, module);
          queue.push(target);
        }
        continue;
      }
      if (isBuiltinSpecifier(spec)) continue;
      violations.push({ chain: [...chainTo(module), spec], specifier: spec });
    }
  }

  return { modules, violations, unresolved };
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/**
 * @param {string} root
 * @returns {{ steps: ReturnType<typeof derivePreInstallSteps>, scripts: string[], modules: string[], findings: Array<{ script: string, chain: string[], specifier: string, kind: 'package' | 'unresolved' }> }}
 */
export function scan(root) {
  const steps = derivePreInstallSteps(readWorkflows(root));
  const scripts = [...new Set(steps.map((s) => s.script))].sort();

  const read = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  const modules = new Set();
  const findings = [];
  for (const script of scripts) {
    const graph = walkImportGraph(script, { read });
    for (const m of graph.modules) modules.add(m);
    for (const v of graph.violations) findings.push({ script, ...v, kind: 'package' });
    for (const u of graph.unresolved) findings.push({ script, ...u, kind: 'unresolved' });
  }

  return { steps, scripts, modules: [...modules].sort(), findings };
}

const describe = (s) => `${s.workflow} : ${s.job} (step ${s.step}) -> ${s.script}`;

function main() {
  const result = scan(repoRoot());
  const jobs = new Set(result.steps.map((s) => `${s.workflow}:${s.job}`)).size;

  if (result.findings.length === 0) {
    console.log(
      `✅  check-pre-install-import-graph: OK — ${result.steps.length} pre-install step(s) in ` +
        `${jobs} job(s) run ${result.scripts.length} scripts/ gate(s); ${result.modules.length} ` +
        `module(s) walked, every non-relative leaf a node builtin.`,
    );
    return;
  }

  const packages = result.findings.filter((f) => f.kind === 'package');
  const missing = result.findings.filter((f) => f.kind === 'unresolved');

  console.error(
    `❌  check-pre-install-import-graph: ${result.findings.length} pre-install import-graph ` +
      `finding(s) across ${result.scripts.length} gate(s)\n`,
  );

  for (const f of packages) {
    console.error(`    • ${f.script} reaches the package \`${f.specifier}\`:`);
    console.error(`        ${f.chain.join(' -> ')}`);
  }
  for (const f of missing) {
    console.error(`    • ${f.script} imports \`${f.specifier}\`, which does not exist:`);
    console.error(`        ${f.chain.join(' -> ')}`);
  }

  console.error(`
These scripts run BEFORE \`pnpm install\` in their workflow job, so at the moment
they run there is no \`node_modules\` for a package specifier to resolve against.
This does not fail as a type error, a lint error, a local run or (until now) a
test — it fails as ERR_MODULE_NOT_FOUND inside one CI job, on whichever pull
request happens to touch the file.

For the gates that carry NO path filter precisely so they see every PR shape,
that is a gate which stops running rather than one that fails loudly.

Two ways out, and repairing the import is not this gate's job:

  • drop the package — most of these graphs need only node builtins and each
    other; or
  • move the step BELOW \`pnpm install\` in its workflow job, accepting the
    install cost and, for an unfiltered gate, deciding deliberately that it is
    worth paying.

\`node scripts/check-pre-install-import-graph.mjs --list\` prints the derived
population and every module walked. The population is DERIVED from
${WORKFLOW_DIR}/ on every run, so moving a step across an install
changes it — nothing here is a hard-coded list to keep in sync.`);

  process.exit(1);
}

function list() {
  const result = scan(repoRoot());
  console.log(`Derived from ${WORKFLOW_DIR}/ — steps running a scripts/ gate before any pnpm install:\n`);
  for (const s of result.steps) console.log(`    ${describe(s)}`);
  console.log(`\n${result.steps.length} step(s), ${result.scripts.length} distinct script(s).\n`);
  console.log('Modules reached by the walk:\n');
  for (const m of result.modules) console.log(`    ${m}`);
  console.log(`\n${result.modules.length} module(s).`);
  for (const f of result.findings) console.log(`\nFINDING  ${f.kind}  ${f.chain.join(' -> ')}`);
}

// ---------------------------------------------------------------------------
// Self-test — the shapes, not this tree's contents
// ---------------------------------------------------------------------------

/**
 * A green run over today's workflows proves only that today's workflows are
 * clean. These cases are the contract: each one is a shape that has to be read
 * correctly for the derivation to be a derivation and for the walk to see one
 * hop away.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  // -- the derivation ------------------------------------------------------
  const WF = `name: Probe
on:
  pull_request:
jobs:
  before:
    steps:
      - name: Checkout code
        uses: actions/checkout@v7
      - name: Gate
        run: node scripts/probe-before.mjs
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Late gate
        run: node scripts/probe-after.mjs
  never-installs:
    steps:
      - name: Checkout code
        uses: actions/checkout@v7
      - name: Gate
        run: node scripts/probe-no-install.mjs
`;
  const derived = derivePreInstallSteps([{ file: 'probe.yml', text: WF }]);
  const scripts = derived.map((s) => s.script);

  t(
    'a step above `pnpm install` is in the population',
    scripts.includes('scripts/probe-before.mjs'),
    scripts.join(', '),
  );
  t(
    'a step BELOW `pnpm install` is not — the boundary is per job, by index',
    !scripts.includes('scripts/probe-after.mjs'),
    scripts.join(', '),
  );
  t(
    'a job that never installs counts entirely (four of this repo`s nine are that shape)',
    scripts.includes('scripts/probe-no-install.mjs'),
    scripts.join(', '),
  );
  t(
    'the step INDEX is reported, so a moved step is visible in --list',
    derived[0]?.step === 1 && derived[0]?.job === 'before',
    JSON.stringify(derived[0] ?? null),
  );

  const BLOCK = `jobs:
  j:
    steps:
      - name: Multi-line
        run: |
          # pnpm install --frozen-lockfile   <- a SHELL comment, not an install
          echo "about to run the gate"
          node scripts/probe-block.mjs
      - name: Browsers are not node_modules
        run: pnpm exec playwright install chromium
      - name: Still pre-install
        run: node scripts/probe-after-playwright.mjs
      - name: Commented out
        run: |
          # node scripts/probe-commented.mjs
          echo done
`;
  const block = derivePreInstallSteps([{ file: 'block.yml', text: BLOCK }]).map((s) => s.script);
  t('reads a `run: |` block scalar', block.includes('scripts/probe-block.mjs'), block.join(', '));
  t(
    'a `#` line inside a block scalar cannot move the install boundary',
    block.includes('scripts/probe-after-playwright.mjs'),
    block.join(', '),
  );
  t(
    '`pnpm exec playwright install` is not an install of node_modules',
    block.includes('scripts/probe-after-playwright.mjs'),
    block.join(', '),
  );
  t(
    'a commented-out invocation is not a step that runs a gate',
    !block.includes('scripts/probe-commented.mjs'),
    block.join(', '),
  );

  // -- the walk ------------------------------------------------------------
  const graphOf = (files, entry) =>
    walkImportGraph(entry, { read: (p) => (Object.hasOwn(files, p) ? files[p] : null) });

  const clean = graphOf(
    {
      'scripts/a.mjs': "import { readFileSync } from 'node:fs';\nimport { helper } from './b.mjs';\n",
      'scripts/b.mjs': 'import { resolve } from "path";\nexport const helper = resolve;\n',
    },
    'scripts/a.mjs',
  );
  t('a builtins-only graph is clean', clean.violations.length === 0, JSON.stringify(clean.violations));
  t(
    'a bare builtin (`from "path"`) is install-free too — the old form called it a violation',
    clean.modules.length === 2 && clean.violations.length === 0,
    clean.modules.join(', '),
  );

  const oneHop = graphOf(
    {
      'scripts/a.mjs': "import { helper } from './b.mjs';\n",
      'scripts/b.mjs': "import ts from 'typescript';\nexport const helper = ts;\n",
    },
    'scripts/a.mjs',
  );
  t(
    'a package ONE HOP away is a violation — the whole reason this walks',
    oneHop.violations.length === 1 && oneHop.violations[0].specifier === 'typescript',
    JSON.stringify(oneHop.violations),
  );
  t(
    'and the finding names the PATH, not just a verdict',
    oneHop.violations[0]?.chain.join(' -> ') === 'scripts/a.mjs -> scripts/b.mjs -> typescript',
    oneHop.violations[0]?.chain.join(' -> '),
  );

  const quoted = graphOf(
    {
      // A gate carrying an import inside a fixture string, and one inside a
      // comment. Both are prose about code, not code.
      'scripts/a.mjs': [
        "import { readFileSync } from 'node:fs';",
        "// import ts from 'typescript';",
        "const FIXTURE = \"import ts from 'typescript';\";",
        'export const x = [readFileSync, FIXTURE];',
      ].join('\n'),
    },
    'scripts/a.mjs',
  );
  t(
    'an import inside a comment or a string literal is not an import',
    quoted.violations.length === 0,
    JSON.stringify(quoted.violations),
  );

  const dynamic = graphOf({ 'scripts/a.mjs': "await import('typescript');\n" }, 'scripts/a.mjs');
  t(
    'a literal `import()` of a package counts — it fails when reached, not at load',
    dynamic.violations.length === 1,
    JSON.stringify(dynamic.violations),
  );

  const broken = graphOf({ 'scripts/a.mjs': "import './nope.mjs';\n" }, 'scripts/a.mjs');
  t(
    'a relative import resolving to nothing is reported, never walked past',
    broken.unresolved.length === 1 && broken.violations.length === 0,
    JSON.stringify(broken.unresolved),
  );

  const cyclic = graphOf(
    {
      'scripts/a.mjs': "import './b.mjs';\n",
      'scripts/b.mjs': "import './a.mjs';\n",
    },
    'scripts/a.mjs',
  );
  t('a cycle terminates', cyclic.modules.length === 2, cyclic.modules.join(', '));

  return cases;
}

function runSelfTest() {
  const cases = selfTest();
  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}\n      got: ${c.detail}`);
  if (failed.length > 0) {
    console.error(`\n❌  check-pre-install-import-graph self-test: ${failed.length}/${cases.length} case(s) FAILED.`);
    process.exit(1);
  }
  console.log(
    `✓ check-pre-install-import-graph self-test: ${cases.length} cases pass ` +
      `(derivation boundary, block scalars, one-hop package, masked prose, cycles).`,
  );
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else if (process.argv.includes('--list')) list();
  else main();
}
