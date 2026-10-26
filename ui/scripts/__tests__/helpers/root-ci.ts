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
 * this module. It never reads a copy under `ui/.github/`: nothing runs one.
 *
 * What the port did not carry (the coverage lane, the docs job, the shard
 * aggregate, the type-check-scope selector, the timings upload) has no job
 * here, and the pins on those retired with a disposition beside them rather
 * than being pointed at a job that does something else. The affected-test
 * selector was wired into `test-ui` later (objectstack#25868), and its pins
 * read that job.
 */
import fs from 'node:fs';
import path from 'node:path';

import { nestedPrefix, workspaceRoot } from '../../workspace-root.mjs';

/** The four root jobs objectui's CI became (objectstack#25697). */
export const UI_JOBS = {
  typeCheck: 'type-check-ui',
  test: 'test-ui',
  lint: 'lint-ui',
  buildE2e: 'build-e2e-ui',
} as const;

/** The workflow GitHub runs: `.github/workflows/ci.yml` at the workspace root. */
export const rootCiPath = path.join(workspaceRoot(), '.github/workflows/ci.yml');

/** That workflow's text. */
export function rootCi(): string {
  return fs.readFileSync(rootCiPath, 'utf8');
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
  const filter = jobBlock(ci, 'filter');
  const lines = filter.split('\n');
  const at = lines.findIndex((line) => /^ +ui:[ \t]*$/.test(line));
  if (at === -1) throw new Error(`${rootCiPath}: the \`filter\` job declares no \`ui:\` paths filter`);
  const indent = lines[at].search(/\S/);
  const globs: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (line.search(/\S/) <= indent) break;
    const m = line.match(/^\s+-\s+'([^']+)'\s*$/);
    if (!m) throw new Error(`${rootCiPath}: cannot read the \`ui:\` filter entry ${JSON.stringify(line)}`);
    globs.push(m[1]);
  }
  if (globs.length === 0) throw new Error(`${rootCiPath}: the \`ui:\` paths filter lists no globs`);
  return globs;
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
