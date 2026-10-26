import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { declaredEntries } from '../check-changeset-overwrite.mjs';

/**
 * objectui#6336 — a hand-picked changeset filename can silently overwrite
 * another pull request's changeset.
 *
 * The hazard is not that an agent makes a mistake; it is WHO pays and WHEN.
 * The cost lands on a third party (whoever's release declaration disappears)
 * and is invisible at the time it happens: `git status` shows ` M`, not `??`,
 * so an agent checking "did my new file appear" reads the overwrite as its own
 * write landing, and the loss is a deleted release declaration that nothing
 * downstream flags.
 *
 * What this file pins, in the order the gate can fail:
 *
 *  1. **The workflow can start on the pull request that needs it.** A path
 *     filter is normally a false-negative surface; here it cannot be, because a
 *     change that modifies a `.changeset/*.md` touches `.changeset/**` by
 *     definition. The filter must still carry the gate's OWN closure — its YAML
 *     and the script it runs (objectui#6321) — or the pull request that changes
 *     the gate is not the one that runs it.
 *  2. **The verdicts**, against throwaway repositories rather than this one's
 *     history, so they stay decidable when the history moves. Both directions:
 *     a modification of a pre-existing changeset is REPORTED, and a change that
 *     only ADDS one stays green with the addition actually SEEN — a green that
 *     comes from the gate looking at nothing is the failure this whole card is
 *     about.
 *  3. **Report-only is the shipped default, and it is a choice, not an
 *     accident.** Measured over all 5281 first-parent commits on `main`, all 19
 *     modifications of a pre-existing changeset in this repository's history
 *     were legitimate (bump-level corrections, prose corrections, authors
 *     amending their own unreleased changeset). A blocking gate would have
 *     failed every one. `OS_CHANGESET_OVERWRITE_ENFORCE=1` is pinned here so the
 *     flip stays a decision someone makes with a new measurement.
 *  4. **Every missing input fails LOUD.** Report-only means the gate declines to
 *     fail on its FINDINGS — never that it passes without looking
 *     (objectstack#4928, objectui#4690).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-changeset-overwrite.mjs';
const WORKFLOW = '.github/workflows/changeset-guard.yml';

/**
 * The peer release declaration every fixture repository starts with — the file
 * the objectui#6336 overwrite lands on.
 *
 * ⛔ Never a filename this repository's own changeset directory carries, and
 * that is correctness, not tidiness (objectui#9472). The scanner in
 * `scripts/markdown-test-inputs.mjs` resolves markdown path literals out of
 * every test's source and offers only the ones that EXIST in the tree, so a
 * literal naming a PENDING declaration becomes a ledger entry — and
 * `pnpm changeset:version` deletes exactly those files, which turned that entry
 * into a `stale-not-read` finding and reddened `Validate the post-version tree`
 * on every scheduled release run. The fixture writes its own file instead, and
 * the `fixture-` prefix belongs to neither namespace a committed name can come
 * from: `pnpm changeset` generates `adjective-animal-verb`, and this repository
 * commits an issue-number-and-slug name (the convention `.changeset/README.md`
 * states). The tail is kept so the fixture still shows the generated shape the
 * hazard wears.
 */
const PEER_CHANGESET = '.changeset/fixture-olive-donkeys-smile.md';

/**
 * A workflow's YAML with whole-line comments removed.
 *
 * Required, not cosmetic: this workflow's header discusses `paths` and its own
 * self-coverage at length, so a scan that counted the prose would report filter
 * entries the file does not have. Same helper, same reason, as in
 * `check-changeset-presence.test.ts` and `merge-queue-reporting.test.ts`.
 */
function withoutComments(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const workflowYaml = withoutComments(fs.readFileSync(path.join(repoRoot, WORKFLOW), 'utf8'));

// ── fixture repositories ─────────────────────────────────────────────────────

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  git: (...args: string[]) => string;
  write: (rel: string, body: string) => void;
  remove: (rel: string) => void;
  commit: (message: string) => string;
}

/**
 * A throwaway repository carrying two pre-existing changesets and a package
 * with a CHANGELOG, which is all this gate reads.
 *
 * The changesets are named `@fixture/*` on purpose: if the gate ever stopped
 * reading declarations out of the files and fell back to a hard-coded
 * `@object-ui/*` surface, every "declared at base" assertion below would flip.
 */
function fixtureRepo(label: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `changeset-overwrite-${label}-`));
  fixtures.push(root);

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  const write = (rel: string, body: string): void => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };

  const remove = (rel: string): void => fs.rmSync(path.join(root, rel));

  const commit = (message: string): string => {
    execFileSync('git', ['add', '-A', '-f'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: root });
    return git('rev-parse', 'HEAD');
  };

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.com');
  git('config', 'user.name', 'Fixture');

  write('.changeset/config.json', JSON.stringify({ fixed: [['@fixture/alpha']], ignore: [] }, null, 2));
  // Documentation, not a declaration — it matches the `.changeset/*.md` glob and
  // must still never be reported.
  write('.changeset/README.md', '# Changesets\n\nDocumentation, not a declaration.\n');
  // The shape of the near-miss: somebody else's pending release declaration,
  // sitting under a name wearing the `pnpm changeset` adjective-animal-verb
  // shape. The file is the fixture's own — see `PEER_CHANGESET`.
  write(
    PEER_CHANGESET,
    '---\n"@fixture/charts": minor\n---\n\nChart widgets render at their resolved height.\n',
  );
  write('.changeset/plum-pandas-wave.md', '---\n"@fixture/alpha": patch\n---\n\nAn unrelated pending fix.\n');
  write('packages/alpha/package.json', JSON.stringify({ name: '@fixture/alpha', version: '1.0.0' }));
  write('packages/alpha/CHANGELOG.md', '# @fixture/alpha\n\n## 1.0.0\n');
  commit('base');

  return { root, git, write, remove, commit };
}

interface Run {
  status: number;
  output: string;
}

/** Runs the real gate against a fixture, capturing status and both streams. */
function runGate(root: string, args: string[] = [], env: Record<string, string> = {}): Run {
  try {
    const stdout = execFileSync('node', [path.join(repoRoot, GATE), '--root', root, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

/** base..head for a fixture's last commit. */
function lastCommitRange(fixture: Fixture): string[] {
  return ['--base', fixture.git('rev-parse', 'HEAD~1'), '--head', fixture.git('rev-parse', 'HEAD')];
}

// ── 1. the workflow is reachable, and covers itself ──────────────────────────

describe('changeset-guard.yml — the gate can start on the pull request that needs it', () => {
  it('exists, and runs the gate script', () => {
    expect(fs.existsSync(path.join(repoRoot, GATE)), `${GATE} must exist for the workflow to run it`).toBe(true);
    expect(workflowYaml).toMatch(new RegExp(`run:\\s*node\\s+${GATE.replace(/[.]/g, '\\.')}`));
  });

  it('gives the job the history its diff needs', () => {
    // The gate compares this change against its MERGE BASE with the target
    // branch. checkout's default is a depth-1 clone where `git merge-base` has
    // nothing to find, and an unresolvable base is a hard failure in the script
    // — so getting this wrong is a red build rather than a silent pass. Pinned
    // so it stays that way.
    expect(workflowYaml).toMatch(/fetch-depth:\s*0/);
  });

  it("carries the gate's own closure in the paths filter (objectui#6321)", () => {
    // Without this, the pull request that edits the gate is not the pull request
    // that runs it, and the first real execution lands on somebody else's
    // unrelated `.changeset/**` change. `paths:` appears twice — `pull_request`
    // and `push` — and both must carry it.
    const occurrences = workflowYaml.split(GATE).length - 1;
    expect(occurrences, `${GATE} must appear in BOTH paths: filters and the run: step`).toBeGreaterThanOrEqual(3);
    expect(workflowYaml.split(WORKFLOW).length - 1, 'the workflow must list its own YAML').toBeGreaterThanOrEqual(2);
  });

  it('still triggers on .changeset/** — the filter this gate depends on', () => {
    // A path filter is normally a false-negative surface. It is not here, and
    // only because of this entry: a change that modifies or deletes a
    // `.changeset/*.md` touches `.changeset/**` BY DEFINITION, so the filter
    // cannot skip the case the gate exists for.
    expect(workflowYaml).toMatch(/- '\.changeset\/\*\*'/);
  });
});

// ── 2. the verdicts ──────────────────────────────────────────────────────────

describe('a change that only ADDS a changeset', () => {
  const fixture = fixtureRepo('add-only');
  fixture.write('.changeset/6336-new-work.md', '---\n"@fixture/alpha": minor\n---\n\nBrand new work.\n');
  fixture.write('packages/alpha/src/index.ts', 'export const alpha = 2;\n');
  fixture.commit('feat: new work with its own changeset');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('is green', () => {
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('No pre-existing changeset was modified or deleted');
  });

  it('is green because the gate SAW the addition, not because it saw nothing', () => {
    // The half of the negative case that is easy to fake. A gate that reports
    // "0 changesets added" and exits 0 is green for the wrong reason, and would
    // stay green through the overwrite this card is about.
    expect(run.output).toContain('1 changeset(s) added, 0 modified, 0 deleted');
  });

  it('stays green even with enforcement switched on', () => {
    const enforced = runGate(fixture.root, lastCommitRange(fixture), { OS_CHANGESET_OVERWRITE_ENFORCE: '1' });
    expect(enforced.status, enforced.output).toBe(0);
  });
});

describe("a change that OVERWRITES a pre-existing changeset — the objectui#6336 shape", () => {
  const fixture = fixtureRepo('overwrite');
  // Exactly the near-miss: a heredoc onto a name that already existed, carrying
  // an unrelated declaration.
  fixture.write(
    PEER_CHANGESET,
    '---\n"@fixture/alpha": patch\n---\n\nMy own unrelated fix, written over somebody else.\n',
  );
  fixture.commit('fix: something else entirely');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('reports the file', () => {
    expect(run.output).toContain(PEER_CHANGESET);
    expect(run.output).toContain('1 changeset(s) it did not add');
  });

  it('names the declaration that was there, which is the thing at risk', () => {
    expect(run.output).toContain('declared at base: @fixture/charts: minor');
  });

  it('says which declaration is GONE — the part nothing downstream would flag', () => {
    expect(run.output).toContain('GONE from the declaration: @fixture/charts');
  });

  it('does not fail the build: report-only is the shipped default', () => {
    // Measured: all 19 modifications of a pre-existing changeset in this
    // repository's history were legitimate. Blocking would have failed every
    // one of those pull requests.
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('Report-only');
  });

  it('DOES fail under OS_CHANGESET_OVERWRITE_ENFORCE=1', () => {
    const enforced = runGate(fixture.root, lastCommitRange(fixture), { OS_CHANGESET_OVERWRITE_ENFORCE: '1' });
    expect(enforced.status, enforced.output).toBe(1);
    expect(enforced.output).toContain('GONE from the declaration: @fixture/charts');
  });
});

describe('a change that DELETES a pre-existing changeset', () => {
  const fixture = fixtureRepo('delete');
  fixture.remove('.changeset/plum-pandas-wave.md');
  fixture.commit('chore: drop a changeset');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('reports it, with what it declared', () => {
    expect(run.output).toContain('D  .changeset/plum-pandas-wave.md');
    expect(run.output).toContain('declared at base: @fixture/alpha: patch');
    expect(run.status, run.output).toBe(0);
  });
});

describe('the release emptying the queue', () => {
  const fixture = fixtureRepo('release');
  fixture.remove(PEER_CHANGESET);
  fixture.remove('.changeset/plum-pandas-wave.md');
  fixture.write('packages/alpha/CHANGELOG.md', '# @fixture/alpha\n\n## 1.1.0\n\n- An unrelated pending fix.\n');
  fixture.write('packages/alpha/package.json', JSON.stringify({ name: '@fixture/alpha', version: '1.1.0' }));
  fixture.commit('chore: release packages');
  const run = runGate(fixture.root, lastCommitRange(fixture), { OS_CHANGESET_OVERWRITE_ENFORCE: '1' });

  it('is not a finding — that is how changesets are consumed', () => {
    // Measured: 82 of the 88 commits on `main` that delete a pre-existing
    // changeset also modify a package CHANGELOG.md, and every one of those is a
    // release. Pinned under ENFORCEMENT, because this is the exemption that has
    // to survive the day somebody flips the switch.
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('Release consumption');
    expect(run.output).toContain('2 changeset(s) deleted');
  });
});

describe('.changeset/README.md', () => {
  const fixture = fixtureRepo('readme');
  fixture.write('.changeset/README.md', '# Changesets\n\nDocumentation, edited.\n');
  fixture.commit('docs: edit the changeset README');
  const run = runGate(fixture.root, lastCommitRange(fixture), { OS_CHANGESET_OVERWRITE_ENFORCE: '1' });

  it('is documentation, not a declaration, and is never reported', () => {
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain('No pre-existing changeset was modified or deleted');
  });
});

// ── 3. missing inputs fail loud ──────────────────────────────────────────────

describe('a base that cannot be resolved', () => {
  const fixture = fixtureRepo('no-base');

  it('is a hard failure, never a quiet pass', () => {
    // Report-only means the gate declines to fail on its FINDINGS. It must
    // still fail when it cannot look — a diff gate that cannot compute its diff
    // and exits 0 has reported "clean" while reading nothing (objectstack#4928,
    // objectui#4690).
    const run = runGate(fixture.root, ['--base', '0000000000000000000000000000000000000000']);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain('Cannot resolve the commit to compare against');
  });

  it('does not fall through to guessing another base', () => {
    // The defect the sibling gate's first draft had: with a fallthrough,
    // `--base <sha not in this clone>` silently judged the change against
    // `main`'s tip instead and printed a confident green.
    const run = runGate(fixture.root, ['--base', '0000000000000000000000000000000000000000']);
    expect(run.output).toContain('named EXPLICITLY');
  });
});

// ── 4. the frontmatter reader ────────────────────────────────────────────────

describe('declaredEntries', () => {
  it('reads every quoting dialect changesets writes', () => {
    expect(
      declaredEntries('---\n"@a/one": minor\n\'@a/two\': patch\n@a/three: major\n---\n\nbody\n'),
    ).toEqual([
      { name: '@a/one', bump: 'minor' },
      { name: '@a/two', bump: 'patch' },
      { name: '@a/three', bump: 'major' },
    ]);
  });

  it('reads an EMPTY frontmatter as declaring nothing, not as undeclared', () => {
    // The repository's explicit "this releases nothing" exemption. It is a real
    // declaration with zero entries, and overwriting one still loses a file
    // somebody wrote on purpose.
    expect(declaredEntries('---\n---\n\nTest-only change.\n')).toEqual([]);
  });

  it('declares nothing when there is no closed frontmatter block at all', () => {
    expect(declaredEntries('no frontmatter here\n')).toEqual([]);
    expect(declaredEntries('---\n"@a/one": minor\n\nnever closed\n')).toEqual([]);
  });

  it('ignores body lines that merely look like entries', () => {
    expect(declaredEntries('---\n"@a/one": minor\n---\n\n"@a/two": patch\n')).toEqual([
      { name: '@a/one', bump: 'minor' },
    ]);
  });
});
