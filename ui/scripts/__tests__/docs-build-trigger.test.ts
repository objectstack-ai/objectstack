import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * objectui#8647 — `Build Docs` must not report green having built nothing.
 *
 * ## The defect
 *
 * `ci.yml`'s `docs` job decides in one step whether to build the site, and until
 * this pin the decision read a diff against `apps/site/` and `content/` only.
 * Those are the site's OUTPUT surface. Its INPUT surface is far larger:
 * `turbo run build --filter='@object-ui/site'` builds every workspace package
 * the site depends on before `next build` runs at all. So a pull request that
 * touched only `packages/**` skipped the build and still reported `success` —
 * measured at 13 seconds against a 3m16s uncached build. A skipped build and a
 * passed build are the same green to every reader downstream, and two cards had
 * already leaned on that green as their Turbopack evidence.
 *
 * ## ⭐ What this file pins, and why it executes the real shell
 *
 * The thing that must never regress is a DECISION, not a string. A test that
 * only grepped the pathspec out of the YAML would pass while the decision was
 * broken by anything else in the step — a reordered early return, a quoting
 * slip, a `--` in the wrong place. So the assertions below extract the step's
 * `run:` script verbatim, substitute the three `${…}` expressions GitHub would
 * substitute, and execute it with `bash -e` (GitHub's own default shell for
 * `run:` on Linux) against throwaway git repositories. What is asserted is the
 * `should_run` value the step actually writes to `GITHUB_OUTPUT`.
 *
 * ⭐ That is also what makes this pin able to tell "built and passed" from
 * "skipped", which the check itself cannot: `should_run` is the switch every
 * later step in the job is gated on, so `should_run=true` is exactly the
 * condition under which the site is compiled.
 *
 * ## The two drift guards, and why the list in the YAML is derived
 *
 * A hand-curated include list decays silently in the one direction this whole
 * card is about: add a dependency to the site, forget the workflow, and the gate
 * quietly narrows again with nothing red anywhere. So the list is derived, and
 * these tests re-derive it from the two sources of truth on every pull request:
 *
 *   1. the package-manifest graph reached from `@object-ui/site` over
 *      `workspace:` dependencies, devDependencies and peerDependencies — the
 *      graph turbo walks for `^build`. Validated against turbo itself while this
 *      landed: `turbo run build --filter='@object-ui/site' --dry=json` reported
 *      31 tasks, being these 30 packages plus the site.
 *   2. the root-level inputs `turbo.json` declares for the `build` task
 *      (`$TURBO_ROOT$/…`), which are by turbo's own definition files a build's
 *      output depends on.
 *
 * Each is checked BEHAVIOURALLY — a fixture file under the package or at the
 * declared path must make the real step answer `true` — so a covering entry that
 * is misspelled, wrongly quoted or shadowed fails here rather than in production.
 *
 * ## The negative set is derived too
 *
 * Widening a gate to "every pull request" is the other way to get this wrong,
 * and it was ruled out on cost: the job is a Turbopack build. The packages
 * OUTSIDE the closure must still skip, and that set is computed as
 * `all workspace packages − closure` rather than listed, so a package that later
 * joins the closure moves between the two sets on its own instead of leaving a
 * stale expectation behind.
 *
 * ⛔ `Build Docs` is a required status check on this repository's merge queue.
 * Renaming the job, or letting it stop reporting a conclusion, does not make the
 * gate stricter — it makes the repository unmergeable. The job name is pinned
 * below for that reason, and every remedy here keeps the job reporting on every
 * pull request exactly as it does today.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ciWorkflowPath = path.join(repoRoot, '.github/workflows/ci.yml');
const SITE_PACKAGE = '@object-ui/site';
const SITE_DIR = 'apps/site';
const JOB_ID = 'docs';
const JOB_NAME = 'Build Docs';
const STEP_ID = 'docs-changes';
const WORKSPACE_ROOTS = ['packages', 'apps', 'examples'];

// ── Reading the workflow ────────────────────────────────────────────────────

type WorkflowStep = { id?: string; name?: string; run?: string; if?: string; uses?: string };

const ciWorkflow = parseYaml(fs.readFileSync(ciWorkflowPath, 'utf8')) as {
  jobs: Record<string, { name?: string; steps: WorkflowStep[] }>;
};

const docsJob = ciWorkflow.jobs?.[JOB_ID];
const docsSteps: WorkflowStep[] = docsJob?.steps ?? [];
const filterStep = docsSteps.find((s) => s.id === STEP_ID);

/**
 * The expressions the harness substitutes. Pinned as an exact set: a new `${…}`
 * in this step would be left unsubstituted by the harness, and bash would read
 * whatever the literal text happens to mean — a silently unfaithful test.
 */
const SUBSTITUTED_EXPRESSIONS = [
  'github.event_name',
  'github.event.pull_request.base.sha',
  'github.event.pull_request.head.sha',
] as const;

function expressionsIn(script: string): string[] {
  return [...script.matchAll(/\$\{\{\s*(.+?)\s*\}\}/g)].map((m) => m[1]);
}

// ── Executing the real step ─────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'pin',
      GIT_AUTHOR_EMAIL: 'pin@example.invalid',
      GIT_COMMITTER_NAME: 'pin',
      GIT_COMMITTER_EMAIL: 'pin@example.invalid',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  }).trim();
}

function writeFixtureFiles(dir: string, files: string[]): void {
  for (const rel of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `// fixture for the docs-build trigger pin\n`);
  }
}

/**
 * A throwaway repository whose first commit is the base and whose every later
 * commit sits directly on that base, touching one fixture's files and nothing
 * else. `A...B` therefore has `A` as its merge base, exactly as it does for a
 * pull request.
 */
function buildFixtureRepo(fixtures: Record<string, string[]>): {
  dir: string;
  base: string;
  heads: Record<string, string>;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-build-trigger-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  writeFixtureFiles(dir, ['seed.txt']);
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');

  const heads: Record<string, string> = {};
  for (const [name, files] of Object.entries(fixtures)) {
    git(dir, 'checkout', '--quiet', '--detach', base);
    git(dir, 'clean', '-qfd');
    writeFixtureFiles(dir, files);
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', `fixture: ${name}`);
    heads[name] = git(dir, 'rev-parse', 'HEAD');
  }
  git(dir, 'checkout', '--quiet', '--detach', base);
  return { dir, base, heads };
}

function runFilterStep(options: {
  cwd: string;
  eventName?: string;
  baseSha: string;
  headSha: string;
}): { shouldRun: string | null; log: string } {
  const script = filterStep?.run;
  if (!script) throw new Error(`step \`${STEP_ID}\` has no run: script`);
  const rendered = script
    .replaceAll(/\$\{\{\s*github\.event_name\s*\}\}/g, options.eventName ?? 'pull_request')
    .replaceAll(/\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/g, options.baseSha)
    .replaceAll(/\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/g, options.headSha);

  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-build-out-')), 'out');
  fs.writeFileSync(outFile, '');
  const scriptFile = path.join(path.dirname(outFile), 'step.sh');
  fs.writeFileSync(scriptFile, rendered);

  // `bash -e {0}` is GitHub's default shell for `run:` on a Linux runner.
  const log = execFileSync('bash', ['-e', scriptFile], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: outFile },
  });

  const written = fs.readFileSync(outFile, 'utf8');
  const match = [...written.matchAll(/^should_run=(\S+)$/gm)];
  return { shouldRun: match.length ? match[match.length - 1][1] : null, log };
}

// ── Deriving what the site build consumes ───────────────────────────────────

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function readWorkspaceManifests(): Map<string, { dir: string; manifest: Manifest }> {
  const byName = new Map<string, { dir: string; manifest: Manifest }>();
  for (const root of WORKSPACE_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      const manifestPath = path.join(abs, entry, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
      if (manifest.name) byName.set(manifest.name, { dir: `${root}/${entry}`, manifest });
    }
  }
  return byName;
}

const workspaceManifests = readWorkspaceManifests();

/**
 * The workspace packages turbo builds on the way to the site. `^build` follows
 * the internal package graph, so every `workspace:` dependency edge counts —
 * dev and peer edges included, because they are edges in that same graph.
 */
function siteBuildClosure(): string[] {
  const seen = new Set<string>();
  const stack = [SITE_PACKAGE];
  while (stack.length) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = workspaceManifests.get(name);
    if (!entry) continue;
    const { dependencies, devDependencies, peerDependencies, optionalDependencies } = entry.manifest;
    for (const group of [dependencies, devDependencies, peerDependencies, optionalDependencies]) {
      for (const [dep, range] of Object.entries(group ?? {})) {
        if (String(range).startsWith('workspace:') && !seen.has(dep)) stack.push(dep);
      }
    }
  }
  seen.delete(SITE_PACKAGE);
  return [...seen]
    .map((name) => workspaceManifests.get(name)?.dir)
    .filter((dir): dir is string => Boolean(dir))
    .sort();
}

const closureDirs = siteBuildClosure();
const allWorkspaceDirs = [...workspaceManifests.values()].map((v) => v.dir).sort();
const outsideClosureDirs = allWorkspaceDirs.filter(
  (dir) => dir !== SITE_DIR && !closureDirs.includes(dir),
);

/** Root-level build inputs `turbo.json` declares for the `build` task. */
function turboRootBuildInputs(): string[] {
  const turbo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8')) as {
    tasks?: Record<string, { inputs?: string[] }>;
  };
  const inputs = turbo.tasks?.build?.inputs ?? [];
  return inputs
    .filter((i) => i.startsWith('$TURBO_ROOT$/'))
    .map((i) => i.slice('$TURBO_ROOT$/'.length))
    .sort();
}

/** Expand a declared input to a file that exists today, so the fixture is real. */
function resolveDeclaredInput(declared: string): string {
  if (!declared.includes('*')) return declared;
  const dir = path.dirname(declared);
  const pattern = new RegExp(`^${path.basename(declared).replaceAll('.', '\\.').replaceAll('*', '.*')}$`);
  const matches = fs
    .readdirSync(path.join(repoRoot, dir))
    .filter((f) => pattern.test(f))
    .sort();
  if (!matches.length) throw new Error(`turbo declares \`${declared}\` but nothing matches it`);
  return `${dir}/${matches[0]}`;
}

const MANIFEST_INPUTS = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json'];

// ── The fixtures, built once ────────────────────────────────────────────────

const fixtures: Record<string, string[]> = {
  // The shape the card was filed on: a pull request that changed only
  // `packages/types/**` and reported `success` in 13 seconds having built
  // nothing. This is the firing control — it must now build.
  'packages/types only': ['packages/types/src/index.ts'],
  'content only': ['content/docs/guide/example.mdx'],
  'site only': [`${SITE_DIR}/app/page.tsx`],
  'root readme only': ['README.md'],
  'changeset only': ['.changeset/lovely-pandas-clap.md'],
  'internal docs only': ['docs/adr/ADR-9999-example.md'],
  'unrelated workflow only': ['.github/workflows/nothing-to-do-with-the-site.yml'],
  'ci.yml only': ['.github/workflows/ci.yml'],
};
for (const dir of closureDirs) fixtures[`closure:${dir}`] = [`${dir}/src/pin-fixture.ts`];
for (const dir of outsideClosureDirs) fixtures[`outside:${dir}`] = [`${dir}/src/pin-fixture.ts`];
for (const declared of turboRootBuildInputs()) {
  fixtures[`turbo-input:${declared}`] = [resolveDeclaredInput(declared)];
}
for (const manifest of MANIFEST_INPUTS) fixtures[`manifest:${manifest}`] = [manifest];

const repo = buildFixtureRepo(fixtures);

function decide(fixtureName: string): string | null {
  return runFilterStep({
    cwd: repo.dir,
    baseSha: repo.base,
    headSha: repo.heads[fixtureName],
  }).shouldRun;
}

// ── Assertions ──────────────────────────────────────────────────────────────

describe('Build Docs — the job keeps reporting, under the name the queue requires', () => {
  it('is still called `Build Docs`', () => {
    expect(
      docsJob?.name,
      '`Build Docs` is a required status check on the merge-queue ruleset; a required context that stops reporting under its own name makes the repository unmergeable, which is not a stricter gate',
    ).toBe(JOB_NAME);
  });

  it('has no path filter on the job or the workflow triggers that could keep it from reporting', () => {
    const triggers = (ciWorkflow as unknown as { on?: Record<string, unknown> }).on ?? {};
    const pullRequest = (triggers as { pull_request?: Record<string, unknown> }).pull_request ?? {};
    expect(
      Object.keys(pullRequest),
      'the filter belongs in the job, not on the trigger: a `paths`/`paths-ignore` here would make the required context absent rather than green',
    ).not.toContain('paths');
    expect(Object.keys(pullRequest)).not.toContain('paths-ignore');
  });

  it('gates every later step of the job on the one decision this file pins', () => {
    const guarded = docsSteps.filter((s) => s.if?.includes(`steps.${STEP_ID}.outputs.should_run`));
    expect(guarded.length).toBeGreaterThanOrEqual(8);
    expect(
      guarded.map((s) => s.name),
      'the site build must be one of the guarded steps, or `should_run` no longer means "the site was built"',
    ).toContain('Build Site');
  });
});

describe('the decision step is executed as written, not paraphrased', () => {
  it('exists and substitutes exactly the expressions the harness knows about', () => {
    expect(filterStep, `\`ci.yml\` must still have a step with id \`${STEP_ID}\``).toBeTruthy();
    expect([...new Set(expressionsIn(filterStep!.run ?? ''))].sort()).toEqual(
      [...SUBSTITUTED_EXPRESSIONS].sort(),
    );
  });
});

describe('the firing control — the shape that used to report green without building', () => {
  it('builds on a pull request that touches only `packages/types`', () => {
    expect(
      decide('packages/types only'),
      'this is the whole card: `packages/types`-only pull requests reported success having built nothing',
    ).toBe('true');
  });

  it('still builds for the two surfaces the old filter knew about', () => {
    expect(decide('content only')).toBe('true');
    expect(decide('site only')).toBe('true');
  });

  it('builds for a change to the workflow that defines the build', () => {
    // The gate validates its own edits. Without this a pull request rewriting
    // this very job would take the 13-second green as its evidence — which is
    // the failure this card is about, applied to the fix for it.
    expect(decide('ci.yml only')).toBe('true');
    expect(
      decide('unrelated workflow only'),
      'only this workflow, not `.github/` wholesale',
    ).toBe('false');
  });
});

describe('drift guard 1 — every package turbo builds for the site triggers the build', () => {
  it('derives a non-trivial closure', () => {
    expect(closureDirs.length).toBeGreaterThan(20);
    expect(closureDirs).toContain('packages/types');
    expect(closureDirs).toContain('packages/react');
  });

  it.each(closureDirs)('%s', (dir) => {
    expect(
      decide(`closure:${dir}`),
      `\`${dir}\` is in the site's build closure, so a change to it changes what this job compiles — add it to the pathspec in the \`${STEP_ID}\` step`,
    ).toBe('true');
  });
});

describe('drift guard 2 — every root build input turbo declares triggers the build', () => {
  const declared = turboRootBuildInputs();

  it('reads a non-empty declaration out of turbo.json', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared)('%s', (input) => {
    expect(
      decide(`turbo-input:${input}`),
      `turbo.json declares \`${input}\` as an input to every \`build\` task — add it to the pathspec in the \`${STEP_ID}\` step`,
    ).toBe('true');
  });

  it.each(MANIFEST_INPUTS)('%s', (manifest) => {
    expect(
      decide(`manifest:${manifest}`),
      `\`${manifest}\` decides which versions the build resolves`,
    ).toBe('true');
  });
});

describe('the gate is still a filter — it did not become "every pull request"', () => {
  it('derives a non-empty set of packages outside the closure', () => {
    expect(outsideClosureDirs.length).toBeGreaterThan(0);
  });

  it.each(outsideClosureDirs)('skips for %s', (dir) => {
    expect(
      decide(`outside:${dir}`),
      `\`${dir}\` is not in the site's build closure, so building the site for it buys nothing; if it has just become a dependency, this file's closure derivation will have moved it to the other set`,
    ).toBe('false');
  });

  it.each(['root readme only', 'changeset only', 'internal docs only', 'unrelated workflow only'])(
    'skips for %s',
    (name) => {
      expect(decide(name)).toBe('false');
    },
  );
});

describe('the two silent-skip guards this card must not undo', () => {
  it('builds unconditionally when the event is not a pull request', () => {
    // objectui#3523: a merge_group build has no `github.event.pull_request`, so
    // the diff would run on a bare `...` range — which git reads as
    // `HEAD...HEAD`, exits 0 on, and prints nothing for. Without this early
    // return the LAST check before `main` is the one that skips.
    const bare = runFilterStep({
      cwd: repo.dir,
      eventName: 'merge_group',
      baseSha: '',
      headSha: '',
    });
    expect(bare.shouldRun).toBe('true');
  });

  it('builds when the diff cannot be computed at all', () => {
    // Fails OPEN (objectui#3723): an unreachable base sha must not read as
    // "nothing docs-related changed".
    const unreachable = runFilterStep({
      cwd: repo.dir,
      baseSha: '0000000000000000000000000000000000000000',
      headSha: repo.heads['packages/types only'],
    });
    expect(unreachable.shouldRun).toBe('true');
  });
});
