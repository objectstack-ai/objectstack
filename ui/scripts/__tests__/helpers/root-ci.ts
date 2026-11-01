/**
 * The workflow that runs objectui's gates, read where it lives (objectstack#25712).
 *
 * Under the objectstack monorepo this tree is `ui/`, and GitHub runs only the
 * repository root's `.github/workflows/`. objectui's own `ci.yml` jobs were
 * ported there by objectstack#25697 (`Type Check` → `type-check-ui`, `Test` →
 * `test-ui`, `Build & E2E` → `build-e2e-ui`, and `lint.yml`'s `Lint` →
 * `lint-ui`), and every objectui command in them is spelled
 * `pnpm --dir ui run <alias>`. A pin in this directory that asks "does CI run
 * this gate, and in the right place" asks it of that file, by path, through
 * this module, and a pin that asks whether ANY workflow runs something asks
 * the root `.github/workflows/` directory through `rootWorkflowFiles()`. It
 * never reads a copy under `ui/.github/`: nothing runs one.
 *
 * What the port did not carry (the docs job, the shard aggregate, the
 * type-check-scope selector, the timings upload) has no job here, and the pins
 * on those retired with a disposition beside them rather than being pointed at
 * a job that does something else. The affected-test selector was wired into
 * `test-ui` later (objectstack#25868), and its pins read that job. The
 * coverage lane came back as a nightly workflow of its own
 * (objectstack#25924), named by `UI_COVERAGE` below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { nestedPrefix, workspaceRoot } from '../../workspace-root.mjs';

/** The four root jobs objectui's CI became (objectstack#25697). */
export const UI_JOBS = {
  typeCheck: 'type-check-ui',
  test: 'test-ui',
  lint: 'lint-ui',
  buildE2e: 'build-e2e-ui',
} as const;

/**
 * objectui's live-e2e lane, `live-e2e.yml`, ported to the root as its own job
 * on the workspace backend (objectstack#27154). Not one of `UI_JOBS`: it runs
 * none of the lint, type-check or vitest gates those pins hold the four to.
 */
export const UI_LIVE_E2E_JOB = 'live-e2e-ui';

/**
 * objectui's coverage lane, ported to the root as a nightly workflow
 * (objectstack#25924): the file, the sharded job and the merge job that
 * enforces the thresholds.
 */
export const UI_COVERAGE = {
  file: 'ui-coverage-nightly.yml',
  shards: 'ui-coverage',
  report: 'ui-coverage-report',
} as const;

/** The directory GitHub runs: `.github/workflows/` at the workspace root. */
export const rootWorkflowsDir = path.join(workspaceRoot(), '.github/workflows');

/** The workflow GitHub runs: `.github/workflows/ci.yml` at the workspace root. */
export const rootCiPath = path.join(rootWorkflowsDir, 'ci.yml');

/** That workflow's text. */
export function rootCi(): string {
  return fs.readFileSync(rootCiPath, 'utf8');
}

/**
 * Every workflow file in that directory, by name. Throws on a scan that reads
 * implausibly few, the reading that would make every "no workflow names this"
 * pin vacuous.
 */
export function rootWorkflowFiles(): string[] {
  const files = fs
    .readdirSync(rootWorkflowsDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
  if (files.length < 10) throw new Error(`${rootWorkflowsDir}: the scan read ${files.length} workflow file(s)`);
  return files;
}

/** One root workflow's text, by file name. */
export function rootWorkflow(file: string): string {
  return fs.readFileSync(path.join(rootWorkflowsDir, file), 'utf8');
}

/** How the root workflow spells one of objectui's root scripts. */
export function uiRun(alias: string): string {
  return `pnpm --dir ui run ${alias}`;
}

/** The text with whole-line YAML comments removed, so prose cannot satisfy a pin. */
export function withoutComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * One job's text, from its `  <key>:` line up to the next job key at the same
 * indent. Throws when the workflow defines no such job, so a renamed job is a
 * red pin, never an empty block that contains nothing and asserts nothing.
 */
export function jobBlock(ci: string, key: string): string {
  const jobsAt = ci.search(/^jobs:[ \t]*$/m);
  if (jobsAt === -1) throw new Error(`${rootCiPath} has no top-level \`jobs:\` key`);
  const jobs = ci.slice(jobsAt);
  const start = jobs.search(new RegExp(`^ {2}${key.replace(/[-.]/g, '\\$&')}:[ \\t]*$`, 'm'));
  if (start === -1) throw new Error(`${rootCiPath} defines no \`${key}\` job`);
  const rest = jobs.slice(start + 1);
  const next = rest.search(/^ {2}[a-z0-9][a-z0-9_-]*:[ \t]*$/m);
  return next === -1 ? jobs.slice(start) : jobs.slice(start, start + 1 + next);
}

/** Everything above `jobs:`: the triggers, the concurrency group, the defaults. */
export function triggerBlock(ci: string): string {
  const jobsAt = ci.search(/^jobs:[ \t]*$/m);
  if (jobsAt === -1) throw new Error(`${rootCiPath} has no top-level \`jobs:\` key`);
  return ci.slice(0, jobsAt);
}

/**
 * The `ui:` globs of the `filter` job's paths filter: a change matching one of
 * them sets `needs.filter.outputs.ui`, which every `* UI` job's `if:` reads.
 * Read as text, the way the filter itself is a YAML string. Throws on an empty
 * list, the reading that would make every "is not hidden" pin vacuous.
 */
export function uiFilterGlobs(ci: string): string[] {
  return filterGlobs(ci, 'ui');
}

/**
 * The globs of one named list of the `filter` job's paths filter (`ui`,
 * `ui_consumers`, `core`, ...), read the way `uiFilterGlobs` reads `ui:`.
 * Throws when the filter declares no such list or it lists no globs.
 */
export function filterGlobs(ci: string, name: string): string[] {
  const filter = jobBlock(ci, 'filter');
  const lines = filter.split('\n');
  const at = lines.findIndex((line) => new RegExp(`^ +${name}:[ \\t]*$`).test(line));
  if (at === -1) throw new Error(`${rootCiPath}: the \`filter\` job declares no \`${name}:\` paths filter`);
  const indent = lines[at].search(/\S/);
  const globs: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (line.search(/\S/) <= indent) break;
    const m = line.match(/^\s+-\s+'([^']+)'\s*$/);
    if (!m) throw new Error(`${rootCiPath}: cannot read the \`${name}:\` filter entry ${JSON.stringify(line)}`);
    globs.push(m[1]);
  }
  if (globs.length === 0) throw new Error(`${rootCiPath}: the \`${name}:\` paths filter lists no globs`);
  return globs;
}

/**
 * The `filter` outputs a job's `if:` starts it on: every
 * `needs.filter.outputs.<o> != 'false'` it spells, in order. Throws when the
 * job carries no `if:` line or the line reads no filter output.
 */
export function jobFilterOutputs(ci: string, key: string): string[] {
  const line = jobBlock(ci, key).match(/^ {4}if: (.+)$/m);
  if (!line) throw new Error(`${rootCiPath}: the \`${key}\` job carries no one-line \`if:\``);
  const outputs = [...line[1].matchAll(/needs\.filter\.outputs\.([A-Za-z_][\w-]*) != 'false'/g)].map((m) => m[1]);
  if (outputs.length === 0) throw new Error(`${rootCiPath}: the \`${key}\` job's \`if:\` reads no filter output`);
  return outputs;
}

/** A path relative to this tree, as the root workflow's filters see it (`ui/<path>`). */
export function repoPath(uiRelative: string): string {
  return `${nestedPrefix()}${uiRelative}`;
}

/** A paths-filter glob against a repository path: `**` crosses separators, `*` does not. */
export function globMatches(glob: string, file: string): boolean {
  return new RegExp(
    `^${glob
      .split('**')
      .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('.*')}$`,
  ).test(file);
}

/** One step of a root workflow job, as parsed. */
export interface CiStep {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly if?: string;
}

/** One root workflow job, as parsed: its condition and its steps. */
export interface CiJob {
  readonly if?: string;
  readonly steps: CiStep[];
}

/**
 * One job of the root `ci.yml`, parsed. Throws when the workflow defines no
 * such job or it parses to implausibly few steps, so a renamed job or a parse
 * that collapsed the list is a red pin, never a scan over nothing.
 */
export function rootCiJob(key: string): CiJob {
  const workflow = parseYaml(rootCi()) as { jobs?: Record<string, CiJob> };
  const job = workflow.jobs?.[key];
  if (!job) throw new Error(`${rootCiPath} defines no \`${key}\` job`);
  if (!Array.isArray(job.steps) || job.steps.length < 5) {
    throw new Error(`${rootCiPath}: the \`${key}\` job parsed to implausibly few steps`);
  }
  return job;
}

/**
 * The steps of a root `ci.yml` job whose whole `run:` is the given command, e.g.
 * `uiRun('lint:root')`. Exact, so a step that merely mentions the alias inside
 * a longer script (or a comment) does not count as running it.
 */
export function stepsRunning(job: CiJob, command: string): CiStep[] {
  return job.steps.filter((step) => typeof step.run === 'string' && step.run.trim() === command);
}
