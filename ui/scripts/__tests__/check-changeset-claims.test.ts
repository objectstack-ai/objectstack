import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BORN_FALSE_VERDICTS,
  audit,
  declaredPackages,
  evaluateBornFalseControls,
  evaluateSelfContradictionControls,
  judgeAddress,
  lineAddresses,
  mapLine,
  namedFiles,
  packageDirectories,
  paragraphNaming,
  resolveNamed,
  selfContradictions,
  sentenceAround,
  treeIndex,
} from '../check-changeset-claims.mjs';

/**
 * objectui#9003 — a pending changeset's prose is judged by nothing.
 *
 * A `.changeset/*.md` body publishes VERBATIM into the CHANGELOG at the next
 * release, and between authoring and release nothing re-reads it when a later
 * merge falsifies it. This gate does not judge whether the prose is true — it
 * judges whether the body NAMES a file this change touches, and hands the
 * paragraph to the one seat that can answer the truth question cheaply.
 *
 * What this file pins, in the order the gate can fail:
 *
 *  1. **It can start on the pull request that needs it.** The falsifying change
 *     is an ordinary source change, so the gate lives in the workflow with NO
 *     path filter. That absence is the load-bearing property and is pinned here:
 *     adding a `paths:` filter to that workflow would blind this gate silently,
 *     which is the exact failure mode `changeset-guard.yml` can afford and this
 *     one cannot.
 *  2. **Both directions of the verdict**, against throwaway repositories rather
 *     than this one's history, so they stay decidable when the history moves. A
 *     report that fires, and a FIRING CONTROL — the same fixture with the named
 *     file left alone — so a green can never come from the gate looking at
 *     nothing.
 *  3. **The exclusions are deliberate, not accidents.** A changeset this change
 *     ADDS is never reported BY THE WENT-FALSE HALF. ⚠️ That is no longer the
 *     same sentence as "the gate is blind to BORN FALSE": objectui#9509 added a
 *     second reading with its own corpus and its own coordinate, and section 6
 *     below pins it. The exclusion itself is unchanged and still load-bearing. A
 *     changeset declaring no bump is never reported: its body never publishes.
 *     An ambiguously-named file is never reported: a span resolving to many
 *     files names none of them.
 *  4. **It can never block.** There is no enforcing switch, deliberately: a
 *     pending changeset naming a file you edited is usually still true.
 *  5. **Every missing input fails LOUD.** Report-only means the gate declines to
 *     fail on its FINDINGS — never that it passes without looking
 *     (objectstack#4928, objectui#4690).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-changeset-claims.mjs';
const WORKFLOW = '.github/workflows/changeset-presence.yml';

/**
 * A workflow's YAML with whole-line comments removed.
 *
 * Required, not cosmetic: this workflow's header discusses its own trigger set
 * at length, so a scan that counted the prose would report filter entries the
 * file does not have. Same helper, same reason, as in the sibling changeset
 * gate tests.
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
 * A throwaway repository carrying pending changesets and the files they name.
 *
 * The package is `@fixture/alpha` on purpose: if the gate ever stopped reading
 * the tree and fell back to a hard-coded `@object-ui/*` surface, every
 * expectation below would flip.
 */
function fixtureRepo(label: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `changeset-claims-${label}-`));
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
  // Documentation, not a declaration. It matches `.changeset/*.md` and names a
  // file on purpose — it must still never be reported.
  write('.changeset/README.md', '# Changesets\n\nSee `reconciliation.test.ts` for an example.\n');

  // The shape of objectui#8617: a pending declaration whose body makes a
  // present-tense claim, in a paragraph, about a named file.
  write(
    '.changeset/6794-declared-default.md',
    '---\n' +
      "'@fixture/alpha': patch\n" +
      '---\n\n' +
      'The inspector now declares the default.\n\n' +
      'A reconciliation assertion in `reconciliation.test.ts` keeps the two sides pinned.\n' +
      'It reads the expected value out of the installed contract rather than pinning a literal.\n\n' +
      'The sibling controller is a separate card whose default flips on a bump still ahead.\n',
  );
  // Declares nothing: an empty-frontmatter no-release declaration. Its body
  // never reaches a CHANGELOG, so there is no verbatim publication to protect.
  write('.changeset/6800-internal-only.md', '---\n---\n\nInternal only; see `reconciliation.test.ts`.\n');
  // Names a file whose basename is ambiguous in this tree.
  write(
    '.changeset/6900-ambiguous.md',
    '---\n' + "'@fixture/alpha': patch\n" + '---\n\n' + 'Both barrels changed; see `index.ts`.\n',
  );

  write('packages/alpha/package.json', JSON.stringify({ name: '@fixture/alpha', version: '1.0.0' }));
  write('packages/alpha/src/index.ts', 'export const alpha = 1;\n');
  write('packages/alpha/src/reconciliation.test.ts', 'export const pinned = true;\n');
  write('packages/alpha/src/untouched.ts', 'export const untouched = true;\n');
  // The second `index.ts`, which is what makes that basename ambiguous.
  write('packages/beta/src/index.ts', 'export const beta = 1;\n');
  commit('base');

  return { root, git, write, remove, commit };
}

interface Run {
  status: number;
  output: string;
}

/**
 * Runs the real gate against a fixture, capturing status and both streams.
 *
 * BOTH streams on the success path too, not just on failure: this gate warns on
 * stderr while still exiting 0 — losing the DELIVERY hand-off is a warning, not
 * a verdict — and a harness that reads only stdout on a green run cannot see
 * that half of the output. In the job log the two streams are interleaved
 * anyway, so this is what a reader actually gets.
 */
function runGate(root: string, args: string[] = [], env: Record<string, string> = {}): Run {
  // ⚠️ EVERY case decides its own corpus. `GITHUB_EVENT_PATH` is exported to every
  // process on a runner, and the gate reads it when `--pr-body` is absent — so an
  // inherited environment fed the gate under test the REAL pull request body of
  // whatever build was running, in a temp repository that has nothing to do with
  // it (objectui#9509, patch round 1: measured, off by exactly one body). The
  // cases that did not redden survived it by luck, not by hermeticity, so it is
  // stripped here for all of them rather than at the two that noticed. A case
  // that WANTS the variable sets it back through `env`.
  const { GITHUB_EVENT_PATH: _inherited, ...hermetic } = process.env;
  const run = spawnSync('node', [path.join(repoRoot, GATE), '--root', root, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...hermetic, ...env },
  });
  return { status: run.status ?? -1, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

/** base..head for a fixture's last commit. */
function lastCommitRange(fixture: Fixture): string[] {
  return ['--base', fixture.git('rev-parse', 'HEAD~1'), '--head', fixture.git('rev-parse', 'HEAD')];
}

// ── 1. the gate can start on the pull request that needs it ──────────────────

describe('changeset-presence.yml — where this gate has to live', () => {
  it('exists, and the workflow runs it', () => {
    expect(fs.existsSync(path.join(repoRoot, GATE)), `${GATE} must exist for the workflow to run it`).toBe(true);
    expect(workflowYaml).toMatch(new RegExp(`run:\\s*node\\s+${GATE.replace(/[.]/g, '\\.')}`));
  });

  it('gives the job the history its diff needs', () => {
    // The gate compares this change against its MERGE BASE. checkout's default
    // is a depth-1 clone where `git merge-base` has nothing to find, and an
    // unresolvable base is exit 1 in the script rather than a skip — so getting
    // this wrong is a red build, not a silent pass. Pinned so it stays that way.
    expect(workflowYaml).toMatch(/fetch-depth:\s*0/);
  });

  it('carries NO paths filter — the property this gate depends on', () => {
    // `changeset-guard.yml` can afford a `paths: ['.changeset/**']` filter
    // because a change that modifies a changeset touches `.changeset/**` BY
    // DEFINITION. This gate's subject is the opposite: an ordinary source change
    // that falsifies somebody else's pending claim, which is under no obligation
    // to touch `.changeset/**` at all. A path filter added here would blind the
    // gate with no red anywhere, so its ABSENCE is pinned.
    expect(workflowYaml).not.toMatch(/^\s*paths(-ignore)?:/m);
  });
});

// ── 1b. the finding is DELIVERED, not archived (objectui#9140) ───────────────

describe('delivery — the ruling that the finding reaches the pull request', () => {
  // objectui#9140 measured the "REQUEST TO READ" at zero answers out of four
  // live instances, because it was addressed to a job log nobody opens on a
  // green check. The director's ruling (maintainer 「同意」) moves WHERE the
  // finding is read and ⛔ nothing else: exit 0, not a required context,
  // nothing blocks.
  it('hands this run\'s finding set to the renderer instead of re-measuring it', () => {
    // One measurement, two consumers. A report that re-derives its own subject
    // can disagree with the log it claims to report, and the disagreement is
    // invisible to both sides.
    expect(workflowYaml).toMatch(/node\s+scripts\/check-changeset-claims\.mjs\s+--json\s+claims\.json/);
    expect(workflowYaml).toMatch(
      /node\s+scripts\/render-changeset-claims-comment\.mjs\s+--from\s+claims\.json/,
    );
  });

  it('posts through the channel the Console Performance Budget report uses', () => {
    expect(workflowYaml).toMatch(/uses:\s*actions\/github-script@/);
    const budget = withoutComments(
      fs.readFileSync(path.join(repoRoot, '.github/workflows/performance-budget.yml'), 'utf8'),
    );
    expect(budget).toMatch(/uses:\s*actions\/github-script@/);
  });

  it('holds `pull-requests: write` on the JOB, leaving the declaration gate with a read-only token', () => {
    // A job-level block REPLACES the workflow-level one, so `contents: read`
    // has to be named again or checkout loses it. The workflow-level block must
    // stay read-only: the declaration gate above needs nothing but a checkout,
    // and a grant it does not use is a grant nobody is auditing.
    expect(workflowYaml).toMatch(/permissions:\n\s+contents: read\n\s+pull-requests: write/);
    expect(workflowYaml).toMatch(/^permissions:\n\s+contents: read\n/m);
    expect(workflowYaml).not.toMatch(/^permissions:\n\s+contents: read\n\s+pull-requests/m);
  });

  it('⛔ never subscribes `pull_request_target`, which would run this on a fork\'s branch with a write token', () => {
    expect(workflowYaml).not.toMatch(/pull_request_target/);
  });

  it('comments only on a pull request', () => {
    // A `merge_group` build has no pull request to comment on, and the gate
    // still has to REPORT there — so the delivery steps are conditioned and the
    // measuring step is not.
    const conditions = workflowYaml.match(/if: \$\{\{ github\.event_name == 'pull_request' \}\}/g) ?? [];
    expect(conditions.length).toBe(2);
  });

  it('cannot paint this job red by failing to post', () => {
    // A fork's pull request gets a read-only token and the API call fails for a
    // reason that says nothing about changesets. Report-only means the gate
    // declines to fail on its FINDINGS; it must not start failing on its
    // PLUMBING either.
    expect(workflowYaml).toMatch(/continue-on-error: true/);
  });
});

// ── 2. both directions of the verdict ────────────────────────────────────────

describe('a change that edits a file a pending changeset NAMES', () => {
  const fixture = fixtureRepo('names-edited');
  fixture.write('packages/alpha/src/reconciliation.test.ts', 'export const pinned = false;\n');
  fixture.write('.changeset/7000-this-change.md', '---\n' + "'@fixture/alpha': patch\n" + '---\n\nThis change.\n');
  fixture.commit('fix(alpha): flip the reconciliation pin');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('reports the changeset that names it', () => {
    expect(run.output).toContain('.changeset/6794-declared-default.md');
    expect(run.output).toContain('names `reconciliation.test.ts`');
    expect(run.output).toContain('packages/alpha/src/reconciliation.test.ts');
    expect(run.output).toContain('edited by this change');
  });

  it('quotes the PARAGRAPH, not the line (objectui#8617)', () => {
    // Both false halves of that card's claim sat in ONE paragraph, and
    // correcting either alone would have left the paragraph asserting the same
    // wrong thing. A reader handed one line corrects one line.
    expect(run.output).toContain('A reconciliation assertion in `reconciliation.test.ts` keeps the two sides pinned.');
    expect(run.output).toContain('It reads the expected value out of the installed contract');
  });

  it('says out loud that it is NOT calling the paragraph false', () => {
    expect(run.output).toContain('NOT a claim that any of those paragraphs is false');
  });

  it('names the correction path and the gate that will report it', () => {
    // Triage fenced weakening the discouragement gate. The answer is an
    // EXPLICIT path, not a hole: the report says the correction is precedented,
    // that the overwrite gate reports it, and that the report is that gate's own
    // legitimate case.
    expect(run.output).toContain('CORRECT THE BODY');
    expect(run.output).toContain('check-changeset-overwrite.mjs');
    expect(run.output).toContain('legitimate');
  });

  it('does not block', () => {
    expect(run.status).toBe(0);
  });

  it('is not coupled to the overwrite gate\'s enforcement switch', () => {
    // That switch belongs to a different gate. If flipping it ever failed this
    // one, a maintainer revisiting the overwrite measurement would silently
    // acquire a blocking prose gate nobody decided on.
    const enforced = runGate(fixture.root, lastCommitRange(fixture), { OS_CHANGESET_OVERWRITE_ENFORCE: '1' });
    expect(enforced.status).toBe(0);
  });
});

describe('the firing control — the same fixture with the named file left alone', () => {
  const fixture = fixtureRepo('firing-control');
  fixture.write('packages/alpha/src/untouched.ts', 'export const untouched = false;\n');
  fixture.write('.changeset/7001-elsewhere.md', '---\n' + "'@fixture/alpha': patch\n" + '---\n\nElsewhere.\n');
  fixture.commit('fix(alpha): change a file nothing pending names');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('is green, and green because it LOOKED', () => {
    // The whole point of pairing this with the case above: a silent run must be
    // provably a silent run over a read population, not a run that read nothing.
    // The identical fixture reports when the named file is the one edited.
    expect(run.output).toContain('No pending changeset names a file this change touches');
    expect(run.status).toBe(0);
  });

  it('states the population it read', () => {
    expect(run.output).toMatch(/read against 2 pending declaration\(s\) that publish a body \(3 pending in total\)/);
  });
});

// ── 3. the exclusions, each one deliberate ───────────────────────────────────

describe('a changeset THIS change adds', () => {
  const fixture = fixtureRepo('own-changeset');
  fixture.write('packages/alpha/src/untouched.ts', 'export const untouched = false;\n');
  fixture.write(
    '.changeset/7002-mine.md',
    '---\n' + "'@fixture/alpha': patch\n" + '---\n\nRewrote `untouched.ts` entirely.\n',
  );
  fixture.commit('fix(alpha): rewrite untouched');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('is never reported by the WENT-FALSE half — the exclusion that keeps it readable', () => {
    // Excluding a change's own changesets is what makes that half readable at
    // all: they name their own files by construction, so it would fire on
    // nearly every change here. objectui#9509 ⛔ did not relax this — it took
    // those same bodies on a different coordinate (section 6).
    expect(run.output).toContain('No pending changeset names a file this change touches');
    expect(run.status).toBe(0);
  });

  it('⛔ reports a corpus it read but could not judge as neither clean nor a finding', () => {
    // This fixture's own changeset IS in the born-false corpus and spells no
    // line address. "Read, but nothing to judge" and "every address checked
    // out" are different answers, and one tick for both teaches the reader to
    // skim the tick.
    expect(run.output).toContain('Corpus: 1 body(ies)');
    expect(run.output).toContain('Read, but nothing to judge');
    expect(run.output).not.toContain('either names the tree it was read');
  });
});

describe('a changeset that declares no bump', () => {
  const fixture = fixtureRepo('no-release');
  fixture.write('packages/alpha/src/reconciliation.test.ts', 'export const pinned = false;\n');
  fixture.remove('.changeset/6794-declared-default.md');
  fixture.commit('chore(alpha): leave only the empty-frontmatter declaration');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('is never reported — its body never publishes', () => {
    // 427 of the 1,384 pending in this repository are these. They declare "no
    // release"; nothing in them reaches a CHANGELOG, so there is no verbatim
    // publication to protect.
    expect(run.output).not.toContain('6800-internal-only');
    expect(run.output).toContain('No pending changeset names a file this change touches');
  });
});

describe('a file named ambiguously', () => {
  const fixture = fixtureRepo('ambiguous');
  fixture.write('packages/alpha/src/index.ts', 'export const alpha = 2;\n');
  fixture.commit('fix(alpha): edit one of the two barrels');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('is never reported — a span resolving to many files names none of them', () => {
    // Picking one would invent a claim the author did not make. Dropping
    // ambiguity is also the filter that keeps the report readable: `package.json`
    // resolves to 47 files in this workspace and therefore names nothing.
    expect(run.output).not.toContain('6900-ambiguous');
    expect(run.output).toContain('No pending changeset names a file this change touches');
  });
});

describe('a file the change DELETES', () => {
  const fixture = fixtureRepo('deleted');
  fixture.remove('packages/alpha/src/reconciliation.test.ts');
  fixture.write('.changeset/7003-retire.md', '---\n' + "'@fixture/alpha': patch\n" + '---\n\nRetired.\n');
  fixture.commit('refactor(alpha): retire the reconciliation pin');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('is reported at the louder severity', () => {
    // The named path will not exist after this change, so the sentence names
    // something that is not there. Still report-only: a changeset that retired a
    // file names it correctly and the file is correctly gone.
    expect(run.output).toContain('.changeset/6794-declared-default.md');
    expect(run.output).toContain('THIS CHANGE LEAVES NO SUCH FILE');
    expect(run.status).toBe(0);
  });

  it('⛔ no longer prints that a born-false claim is outside the gate entirely', () => {
    // ⚠️ THE CARRIER INVERTED, so a bare count of the words "BORN false" across
    // this landing proves nothing — the phrase survives in both trees. What
    // changed is what the sentence SAYS. The footer used to name born-false as a
    // whole class the gate cannot see ("a changeset this change adds is excluded
    // by construction"); it now names the ONE born-false shape still out of
    // reach — an ordinal claim spelling no line address — and the section above
    // it reads the rest. This is asserted on a run that HAS went-false findings,
    // because that footer prints nowhere else.
    expect(run.output).not.toContain('A changeset this change adds is excluded by construction');
    expect(run.output).toContain('A born-false claim carrying no LINE ADDRESS');
    expect(run.output).toContain('Born false — claims this change publishes about a tree it replaced');
  });
});

describe('.changeset/README.md', () => {
  const fixture = fixtureRepo('readme');
  fixture.write('packages/alpha/src/reconciliation.test.ts', 'export const pinned = false;\n');
  fixture.commit('fix(alpha): flip the pin');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('is documentation, never a declaration', () => {
    expect(run.output).not.toContain('README.md');
  });
});

// ── 4. never silent ──────────────────────────────────────────────────────────

describe('an input the gate cannot read', () => {
  const fixture = fixtureRepo('unreadable');

  it('is exit 1, never a quiet pass', () => {
    // Report-only means this gate declines to fail on its FINDINGS. It never
    // means it passes without looking (objectstack#4928, objectui#4690).
    const run = runGate(fixture.root, ['--base', 'refs/heads/no-such-base-ref']);
    expect(run.status).toBe(1);
    expect(run.output).toContain('Cannot resolve the commit to compare against');
    expect(run.output).toContain('never that it passes without looking');
  });
});

// ── 5. the readers, in isolation ─────────────────────────────────────────────

describe('namedFiles', () => {
  it('reads backticked file names and nothing else', () => {
    const source = 'Touches `evaluator.ts` and `flow-node-config.spec-reconciliation.test.ts`.';
    expect(namedFiles(source)).toEqual(['evaluator.ts', 'flow-node-config.spec-reconciliation.test.ts']);
  });

  it('ignores an unbackticked mention', () => {
    // An unbackticked phrase has no boundary a parser can trust, and widening to
    // bare words is how this becomes a symbol matcher — the shape measured at
    // 191 paragraphs per commit and rejected.
    expect(namedFiles('Touches evaluator.ts in passing.')).toEqual([]);
  });

  it('ignores a symbol, a package name and a prose span', () => {
    expect(namedFiles('`evaluateCondition` in `@object-ui/permissions` returns `true`.')).toEqual([]);
  });
});

describe('paragraphNaming', () => {
  const body = 'First claim about `a.ts`.\n\nSecond paragraph, two sentences. It also mentions `b.ts` here.\n';

  it('returns the whole paragraph, not the sentence', () => {
    expect(paragraphNaming(body, 'b.ts')).toBe('Second paragraph, two sentences. It also mentions `b.ts` here.');
  });

  it('returns null when the span is not in the body', () => {
    expect(paragraphNaming(body, 'c.ts')).toBeNull();
  });
});

describe('resolveNamed', () => {
  const index = treeIndex(repoRoot, null);

  it('resolves an unambiguous basename in this repository', () => {
    expect(resolveNamed(index, 'check-changeset-claims.mjs')).toBe(GATE);
  });

  it('sees a file that is written but not committed yet', () => {
    // Without untracked files in the listing, this gate would resolve a name
    // to nothing locally and to something in CI — disagreeing with itself
    // depending on who ran it. The gate's own source is the case: it is
    // untracked in the worktree that writes it and tracked by the time CI
    // reads it, and it must resolve either way.
    expect(resolveNamed(index, 'check-changeset-overwrite.mjs')).toBe('scripts/check-changeset-overwrite.mjs');
  });

  it('refuses an ambiguous one, with no hand-maintained denylist', () => {
    // `package.json` resolves to dozens of tracked files here. Precision comes
    // from resolution against the tree, not from a list somebody has to keep.
    expect(resolveNamed(index, 'package.json')).toBeNull();
  });
});

// ── 6. the blind spot is COUNTED, not hand-counted per incident ──────────────

/**
 * objectui#9140 — the shape this gate cannot see, made measurable.
 *
 * objectui#9065 was five WENT-FALSE claims at once; the gate named four and was
 * blind to the fifth. The fifth's body names no file at all — it coordinates
 * itself by SYMBOL — so no diff can make the diff-mode check speak about it.
 * That was established by counting backticked spans BY HAND, once, on one card.
 *
 * `--audit` now counts the population instead, so the size of the blind spot is
 * re-derived on every run rather than written down (AGENTS.md rule #9). What is
 * pinned here is the COUNTER, in both directions:
 *
 *   - a symbol-coordinated body is counted as outside the reach (it fires), and
 *   - the FIRING NEGATIVE CONTROL: the same body with one resolvable file name
 *     added is NOT counted there. Without that leg, "the census sees it" cannot
 *     be told apart from "the census counts everything".
 *
 * The limit itself is pinned too: even when the change edits the very file the
 * symbol-only body is about, the diff-mode gate still reports nothing about it.
 * ⛔ That is the card's finding, pinned AS A LIMIT — not a bug to be fixed by
 * loosening the coordinate, which objectui#9140 measured and left open.
 */
describe('objectui#9140 — bodies this gate can never reach', () => {
  /** A fixture carrying one symbol-coordinated pending body. */
  function blindFixture(label: string, body: string): Fixture {
    const fixture = fixtureRepo(label);
    fixture.write('.changeset/9140-symbol-coordinated.md', body);
    fixture.commit('a pending declaration that coordinates itself by symbol');
    return fixture;
  }

  // The shape of `.changeset/7165-grid-dependent-values.md`: every coordinate it
  // offers is a symbol, and not one of them is spelled as a file name.
  const SYMBOL_ONLY =
    '---\n' +
    "'@fixture/alpha': patch\n" +
    '---\n\n' +
    'The inline editor now supplies `dependentValues`, so a `dependsOn` column is\n' +
    'no longer permanently uneditable. `renderCellEditor` passes the saved row.\n';

  it('counts a symbol-coordinated body as outside the reach', () => {
    const fixture = blindFixture('blind', SYMBOL_ONLY);
    const totals = audit(fixture.root, null);

    expect(totals.silent, 'a body naming no file is outside the diff-mode reach').toBeGreaterThanOrEqual(1);
    expect(totals.blind.join('\n')).toContain('.changeset/9140-symbol-coordinated.md');
  });

  it('FIRING NEGATIVE CONTROL — the same body naming one resolvable file is NOT counted there', () => {
    // Known direction, and it must move: the ONLY edit between the two fixtures
    // is one added backticked file name that resolves to exactly one tracked
    // file. If the census counted every body, this leg would read identically
    // to the one above and prove nothing.
    const blind = audit(blindFixture('blind-ctl-a', SYMBOL_ONLY).root, null);
    const seeing = audit(
      blindFixture('blind-ctl-b', SYMBOL_ONLY.replace('the saved row.', 'the saved row, in `reconciliation.test.ts`.'))
        .root,
      null,
    );

    const named = '.changeset/9140-symbol-coordinated.md';
    expect(blind.blind.join('\n'), 'the symbol-only body IS in the blind list').toContain(named);
    expect(seeing.blind.join('\n'), 'adding one resolvable file name takes it OUT').not.toContain(named);
    // Non-empty guard: both runs must have looked at the same publishing
    // population, so the difference above cannot come from one side reading
    // nothing at all.
    expect(seeing.publishing, 'both runs read the same publishing population').toBe(blind.publishing);
    expect(blind.publishing).toBeGreaterThan(0);
    expect(seeing.silent, 'the control body left the silent population').toBe(blind.silent - 1);
  });

  it('pins the LIMIT: the diff-mode gate stays silent even when the change edits the file that body is about', () => {
    const fixture = blindFixture('blind-limit', SYMBOL_ONLY);
    // `renderCellEditor` is a symbol this body names. Edit the file that
    // declares it — the exact shape of the falsifying merge on objectui#9065.
    fixture.write('packages/alpha/src/reconciliation.test.ts', 'export const renderCellEditor = () => null;\n');
    fixture.commit('edit the file the symbol-only body is about');

    const run = runGate(fixture.root, lastCommitRange(fixture));

    expect(run.status, 'report-only: still exit 0').toBe(0);
    expect(run.output, 'the symbol-coordinated body is never reported').not.toContain(
      '9140-symbol-coordinated.md',
    );
    // Control with a known direction that HITS in this same run: the gate did
    // look, and it can still speak about a body that names that same file.
    expect(run.output, 'the gate was not simply silent about everything').toContain(
      '.changeset/6794-declared-default.md',
    );
  });
});

// ── 6. the delivery hand-off is a real artefact of the real run ──────────────

describe('--json, the hand-off the pull request comment is rendered from', () => {
  const fixture = fixtureRepo('json-handoff');
  fixture.write('packages/alpha/src/reconciliation.test.ts', 'export const pinned = false;\n');
  fixture.commit('fix(alpha): flip the reconciliation pin');
  const handOff = path.join(fixture.root, 'claims.json');
  const run = runGate(fixture.root, [...lastCommitRange(fixture), '--json', handOff]);

  it('writes the finding set this run measured', () => {
    const written = JSON.parse(fs.readFileSync(handOff, 'utf8'));
    expect(written.findings).toHaveLength(1);
    expect(written.findings[0].changeset).toBe('.changeset/6794-declared-default.md');
    expect(written.findings[0].file).toBe('packages/alpha/src/reconciliation.test.ts');
    expect(written.findings[0].paragraph).toContain('keeps the two sides pinned');
  });

  it('carries the population the log reports, so the comment cannot contradict it', () => {
    const written = JSON.parse(fs.readFileSync(handOff, 'utf8'));
    expect(run.output).toContain(`read against ${written.considered} pending declaration(s)`);
    expect(run.output).toContain(`(${written.pending} pending in total)`);
  });

  it('still exits 0 — delivery moved where the finding is read, never what the gate does', () => {
    expect(run.status).toBe(0);
  });

  it('writes an EMPTY finding list rather than no file, so the renderer can resolve a stale request', () => {
    const quiet = fixtureRepo('json-handoff-quiet');
    quiet.write('packages/alpha/src/untouched.ts', 'export const untouched = false;\n');
    quiet.commit('fix(alpha): change a file nothing pending names');
    const quietHandOff = path.join(quiet.root, 'claims.json');
    const quietRun = runGate(quiet.root, [...lastCommitRange(quiet), '--json', quietHandOff]);
    expect(quietRun.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(quietHandOff, 'utf8')).findings).toEqual([]);
  });

  it('⛔ never fails the gate over its own plumbing', () => {
    // An unwritable hand-off loses the DELIVERY. The verdict is the log and it
    // is already printed, so exit 1 here would be this gate failing a build
    // over a broken pipe — the one thing report-only forbids.
    const broken = runGate(fixture.root, [
      ...lastCommitRange(fixture),
      '--json',
      path.join(fixture.root, 'no-such-directory', 'claims.json'),
    ]);
    expect(broken.status).toBe(0);
    expect(broken.output).toContain('Could not write');
  });
});

// ── 6. the BORN-FALSE reading (objectui#9509) ────────────────────────────────

/**
 * objectui#9509: a claim written against the MERGE BASE while describing the
 * HEAD, falsified by the diff's OWN insertion. It fails worse than went-false —
 * it is false at the moment of publication, and ⛔ no later event will ever turn
 * it red.
 *
 * The geometry every case below uses is objectui#9496's, because that pull
 * request published the arithmetic independently of this file: its body and the
 * docblock it landed both state `:246`@`b8a006883d` = `:274`@head. ⇒ 274 is
 * attested OUTSIDE this test and cannot be quietly re-derived to match a mapper
 * that drifts.
 */
describe('mapLine — where this change moves a base line', () => {
  // `@@ -220,0 +221,28 @@` then `@@ -223 +251 @@`, measured on 8700d6d93.
  const hunks = [
    { oldStart: 220, oldCount: 0, newCount: 28 },
    { oldStart: 223, oldCount: 1, newCount: 1 },
  ];

  it('reproduces the figure objectui#9496 published: :246 at the base is :274 at the head', () => {
    expect(mapLine(hunks, 246)).toBe(274);
  });

  it('reports a rewritten line as gone rather than as some other number', () => {
    // Base `:223` IS the line the repair rewrites. Returning 251 for it would be
    // the worst possible answer: a number that resolves, to the wrong thing.
    expect(mapLine(hunks, 223)).toBeNull();
  });

  it('leaves the insertion point itself alone — the off-by-one that would fake a finding', () => {
    // git spells a pure insertion as "after old line 220", so 220 is untouched
    // and 221 is not. An implementation that moved 220 would report stable
    // citations as displaced, which is the false positive this reading can
    // least afford on a report-only channel.
    expect(mapLine(hunks, 220)).toBe(220);
    expect(mapLine(hunks, 221)).toBe(249);
  });

  it('leaves a line above every hunk where it is', () => {
    expect(mapLine(hunks, 100)).toBe(100);
  });
});

describe('lineAddresses — what counts as an address, and what binds it', () => {
  const resolve = (span: string): string | null =>
    span.includes('imported-defaults.ts') ? 'packages/types/src/zod/imported-defaults.ts' : null;

  it('binds a bare `:246` to the file named earlier in ITS paragraph', () => {
    // Both carded instances were written this way. Reading `:246` without that
    // binding would turn every port number and every `key: 246` into a citation.
    // fixture-address: fixture prose handed to the reader under test, ⛔ not a pointer into this tree
    const rows = lineAddresses('The shape recurs in `imported-defaults.ts`: `:223` and `:246`.', resolve);
    expect(rows.map((r) => r.line)).toEqual([223, 246]);
    expect(rows.every((r) => r.file.endsWith('imported-defaults.ts'))).toBe(true);
  });

  it('⛔ never carries that binding across a blank line into somebody else\'s subject', () => {
    // fixture-address: fixture prose handed to the reader under test, ⛔ not a pointer into this tree
    const rows = lineAddresses('See `imported-defaults.ts` for the walker.\n\nThe frame is at `:246`.', resolve);
    expect(rows).toEqual([]);
  });

  it('reads the sha binding per SENTENCE, ⛔ not per paragraph', () => {
    // THE load-bearing choice. objectui#9496's §2 paragraph names a sha, and a
    // paragraph-wide window would have exempted the very claim the card is
    // about. A sha three sentences away binds nothing.
    // fixture-address: fixture prose handed to the reader under test, ⛔ not a pointer into this tree
    const bound = lineAddresses('At `b8a006883d` the shape recurs in `imported-defaults.ts`: `:246`.', resolve);
    expect(bound[0].bound).toBe(true);

    const adrift = lineAddresses(
      // fixture-address: fixture prose handed to the reader under test, ⛔ not a pointer into this tree
      'The repair landed at `b8a006883d`. The shape recurs in `imported-defaults.ts`: `:246`.',
      resolve,
    );
    expect(adrift[0].bound).toBe(false);
  });

  it('accepts `at this head` as a binding — it names a tree as definitely as a sha', () => {
    // fixture-address: fixture prose handed to the reader under test, ⛔ not a pointer into this tree
    const rows = lineAddresses('At this head `imported-defaults.ts:274` is the tuple arm.', resolve);
    expect(rows[0].bound).toBe(true);
  });

  it('⛔ does not read a bare decimal as a sha', () => {
    // `12345678` is a number. Accepting it would let any figure in a sentence
    // silence every address beside it.
    // fixture-address: fixture prose handed to the reader under test, ⛔ not a pointer into this tree
    const rows = lineAddresses('Run 12345678 read `imported-defaults.ts:246` as the tuple arm.', resolve);
    expect(rows[0].bound).toBe(false);
  });

  it('keeps a column and a range, because the FIRST number is the one that moves', () => {
    const rows = lineAddresses(
      // fixture-address: fixture prose handed to the reader under test, ⛔ not a pointer into this tree
      'The frame is `imported-defaults.ts:281:75` and the arm is `imported-defaults.ts:221-228`.',
      resolve,
    );
    expect(rows.map((r) => r.line)).toEqual([281, 221]);
  });

  it('drops a spelling that resolves to no tracked file — it names nothing definite', () => {
    expect(lineAddresses('The frame is at `…9088:189:7`.', resolve)).toEqual([]);
  });
});

describe('sentenceAround', () => {
  it('stops at the sentence boundary rather than running to the paragraph end', () => {
    const paragraph = 'First at `abc1234`. Second cites `:246`. Third.';
    expect(sentenceAround(paragraph, paragraph.indexOf('`:246`'))).not.toContain('abc1234');
  });
});

describe('judgeAddress — the arithmetic, never the meaning', () => {
  const hunks = [{ oldStart: 220, oldCount: 0, newCount: 28 }];
  const address = { file: 'a.ts', line: 246, bound: false };

  it('reports a moved line in a file this change MODIFIES', () => {
    const verdict = judgeAddress(address, () => 'modified', () => hunks);
    expect(verdict).toEqual({ verdict: 'moved', movedTo: 274 });
    expect(BORN_FALSE_VERDICTS.has(verdict.verdict)).toBe(true);
  });

  it('reports any address into a file this change ADDS as unanchored', () => {
    // Instance 1's shape: the frame moved TWICE, between revisions of one
    // branch. There is no tree outside the pull request in which that number can
    // be read, so binding it is the only thing that can make it durable.
    const verdict = judgeAddress(address, () => 'added', () => hunks);
    expect(verdict.verdict).toBe('unanchored');
  });

  it('⛔ says nothing about a file this change does not touch', () => {
    // That address may well be false, but nothing about THIS diff made it so.
    // It is the citation census's population (`check-new-cross-file-line-citations.mjs`)
    // and ⛔ not this one's — one reader per population.
    expect(judgeAddress(address, () => null, () => hunks).verdict).toBe('untouched');
  });

  it('⛔ says nothing about an address bound to the tree it was read from', () => {
    // The durable form. A gate that reported it would be teaching authors to
    // unbind, which is the opposite of what objectui#9509 asks for.
    const verdict = judgeAddress({ ...address, bound: true }, () => 'modified', () => hunks);
    expect(verdict.verdict).toBe('anchored');
  });

  it('distinguishes a stable line from a moved one — without this it is an absolute count', () => {
    expect(judgeAddress({ ...address, line: 100 }, () => 'modified', () => hunks).verdict).toBe('stable');
  });
});

describe('the born-false controls', () => {
  it('all pass against objectui#9496\'s own geometry', () => {
    const failures = evaluateBornFalseControls().filter((control) => !control.ok);
    expect(failures.map((f) => `${f.id}: ${f.detail}`)).toEqual([]);
  });

  it('CAN fail — a judge that lies is caught rather than passed', () => {
    // ⭐ The firing control on the controls. A suite that cannot be made to fail
    // is decoration, and a differential reader that reports zero because its
    // differ broke is indistinguishable from prose with nothing wrong in it.
    const lying = (): { verdict: string; movedTo: null } => ({ verdict: 'stable', movedTo: null });
    const failed = evaluateBornFalseControls(lying).filter((control) => !control.ok);
    expect(failed.map((f) => f.id)).toEqual([
      'unbound-address-into-a-line-this-diff-moves',
      'an-address-into-a-file-this-change-adds-is-unanchored',
    ]);
  });

  it('keeps BOTH directions — a control suite that only ever fires proves nothing', () => {
    const controls = evaluateBornFalseControls();
    expect(controls.filter((c) => c.detail === '(silent)').length).toBeGreaterThan(0);
    expect(controls.filter((c) => c.detail !== '(silent)').length).toBeGreaterThan(0);
  });
});

describe('end to end — a pull request body read against its own diff', () => {
  const fixture = fixtureRepo('born-false');
  // 20 lines, so a citation into the middle of it has somewhere to be moved to.
  fixture.write(
    'packages/alpha/src/walker.ts',
    Array.from({ length: 20 }, (_, i) => `export const step${i + 1} = ${i + 1};\n`).join(''),
  );
  fixture.commit('feat(alpha): the walker');
  // The change under test INSERTS above the cited line, exactly as objectui#9496
  // did, and adds a brand-new file.
  fixture.write(
    'packages/alpha/src/walker.ts',
    '// inserted\n// inserted\n// inserted\n' +
      Array.from({ length: 20 }, (_, i) => `export const step${i + 1} = ${i + 1};\n`).join(''),
  );
  fixture.write('packages/alpha/src/brand-new.ts', 'export const fresh = 1;\n');
  const head = fixture.commit('feat(alpha): insert above the cited line');
  const base = fixture.git('rev-parse', 'HEAD~1');

  const bodyFile = path.join(fixture.root, 'body.md');
  fs.writeFileSync(
    bodyFile,
    'The subject is `walker.ts:10`.\n\n' +
      `At \`${base}\` the subject is \`walker.ts:10\`.\n\n` +
      'The new pin is `brand-new.ts:1`.\n\n' +
      'Untouched: `reconciliation.test.ts:1`.\n',
  );
  const run = runGate(fixture.root, ['--base', base, '--head', head, '--pr-body', bodyFile]);

  it('reports the unbound address the diff moved, and says where it went', () => {
    expect(run.output).toContain('this change moves packages/alpha/src/walker.ts:10 to :13');
  });

  it('reports an address into a file this change ADDS as having no tree outside the pull request', () => {
    expect(run.output).toContain('exists in no tree outside this pull request');
  });

  it('⛔ stays silent on the same address bound to a sha — the discrimination', () => {
    // ⛔ A checker that flags everything is not a checker. Four addresses were
    // read; two were reported. Both halves of that split are the measurement.
    expect(run.output).toContain('Line addresses read in them: 4');
    expect(run.output).toContain('2 address(es) in the prose this change publishes');
  });

  it('⛔ stays silent on an address into a file this change does not touch', () => {
    expect(run.output).not.toContain('reconciliation.test.ts:1');
  });

  it('asks for the number to be BOUND, ⛔ never for it to be corrected', () => {
    // The card states this before anything else: correcting `:246` to `:274`
    // produces a claim that is true today and born false again on the next
    // insertion. ⇒ the instruction has to be the durable form, or the gate
    // manufactures the next instance.
    expect(run.output).toContain('BIND THE NUMBER TO THE TREE IT WAS READ FROM');
    expect(run.output).toContain('not an instruction to');
  });

  it('is REPORT-ONLY — findings do not fail the run', () => {
    expect(run.status).toBe(0);
  });
});

describe('the floor under the born-false census', () => {
  const fixture = fixtureRepo('born-false-floor');
  fixture.write('packages/alpha/src/untouched.ts', 'export const untouched = 2;\n');
  fixture.commit('chore(alpha): touch a file, publish no prose');
  const run = runGate(fixture.root, lastCommitRange(fixture));

  it('⛔ never reports an empty corpus as clean', () => {
    // A merge_group build has no pull request body, and a change may add no
    // changeset. Reading NOTHING and printing a tick would be reporting "this
    // change publishes no false claim" on a run that read no prose at all
    // (objectstack#4928).
    expect(run.output).toContain('Corpus: 0 body(ies)');
    expect(run.output).toContain('NOT a clean verdict');
    expect(run.output).toContain('measured NOTHING');
  });

  it('⛔ does not print the all-clear line it prints when it DID read prose', () => {
    expect(run.output).not.toContain('either names the tree it was read');
  });
});

describe('the corpus is the prose this change publishes about itself', () => {
  it('reads the pull request body from the event payload the job already receives', () => {
    // ⛔ No new workflow, no new required context, no new permission and no API
    // call: `GITHUB_EVENT_PATH` is a file on the runner, and
    // `check-governed-queue-guard.mjs` already reads it the same way.
    const gate = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(gate).toContain('GITHUB_EVENT_PATH');
    expect(gate).toContain('pull_request?.body');
  });

  it('⛔ does not take the tree at large — that population has a reader already', () => {
    // A citation written into an ordinary source file is
    // `check-new-cross-file-line-citations.mjs`'s differential population. Two
    // readers over one population is how two answers start disagreeing.
    expect(fs.existsSync(path.join(repoRoot, 'scripts/check-new-cross-file-line-citations.mjs'))).toBe(true);
    const gate = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(gate).toContain('check-new-cross-file-line-citations.mjs');
  });

  it('delivers a born-false-only finding instead of leaving it in the job log', () => {
    // objectui#9140 measured the job-log channel at zero answers out of four.
    // The comment step decides whether to post from the finding COUNT, so a run
    // whose only finding is born-false has to be counted there too.
    expect(workflowYaml).toContain('(measured.bornFalse ?? []).length');
  });

  it('⭐ delivers a self-contradiction-only finding too (objectui#9841)', () => {
    // ⚠️ ASSERTED AS ITS OWN TERM, ⛔ never as the whole sum. A pin that matched
    // the sum verbatim would redden on a harmless rewording and — worse — would
    // be repaired by pasting whatever the file now says, which is how a dropped
    // term gets blessed. This one goes red for exactly one reason: this reading
    // stopped being counted, and its findings stopped creating the comment.
    expect(workflowYaml).toContain('(measured.selfContradiction ?? []).length');
  });

  it('counts EVERY reading the gate carries — one term per reading, none left out', () => {
    // The standing obligation, stated where the next reading's author will read
    // it: a reading that is measured, rendered and then not counted here is
    // delivered to a job log nobody opens. That is objectui#9842's shape, and it
    // is the reason this surface was extended rather than left for later.
    for (const term of [
      'measured.findings.length',
      '(measured.bornFalse ?? []).length',
      '(measured.selfContradiction ?? []).length',
    ]) {
      expect(workflowYaml).toContain(term);
    }
  });
});

describe('the boundary control the first ablation of this change exposed', () => {
  it('catches the off-by-one that the other four controls all pass', () => {
    // ⚠️ MEASURED, not anticipated. The first ablation of this change mutated
    // `line <= hunk.oldStart` to `line <`, and the pin in section 6 went red
    // while ALL FOUR of the gate's own controls stayed green — so the gate
    // would have reported "instrument fine" while silently marking every stable
    // citation at an insertion point as moved. A control suite that cannot see
    // the mutation its own unit tests can see is not a self-check.
    const ids = evaluateBornFalseControls().map((control) => control.id);
    expect(ids).toContain('the-insertion-point-itself-does-not-move');
    expect(evaluateBornFalseControls().every((control) => control.ok)).toBe(true);
  });
});

// ── 7. the corpus may not be AMBIENT (objectui#9509, patch round 1) ──────────

/**
 * ⭐ Found by this file's own empty-corpus floor, in CI, ⛔ not by review.
 *
 * `GITHUB_EVENT_PATH` is exported to every process on a runner. The gate reads
 * it when `--pr-body` is absent, so a run against a throwaway fixture repository
 * picked up the REAL pull request body of the build that happened to be running
 * and counted it as "the prose this change publishes about itself" — off by
 * exactly one body. The floor whose whole job is "this run measured NOTHING"
 * slid up to the next floor instead. ⇒ the reading built to be unfakeable was
 * being fed by the environment.
 *
 * The repair is a predicate about the TREE rather than about how the process was
 * launched: the payload names `pull_request.head.sha`, and a tree that cannot
 * resolve that commit is not the tree the event is about.
 */
describe('an event payload from another tree', () => {
  const fixture = fixtureRepo('ambient-corpus');
  fixture.write('packages/alpha/src/untouched.ts', 'export const untouched = 3;\n');
  fixture.commit('chore(alpha): touch a file, publish no prose');

  // A payload shaped exactly like a real one, naming a head this tree cannot
  // have. `.json`, ⛔ never `.md`: a markdown literal here would become a
  // candidate for the ledger in `scripts/markdown-test-inputs.mjs`.
  const foreign = path.join(fixture.root, 'foreign-event.json');
  fs.writeFileSync(
    foreign,
    JSON.stringify({
      pull_request: { number: 4242, head: { sha: '0'.repeat(40) }, body: 'The frame is at `untouched.ts:1`.' },
    }),
  );
  const run = runGate(fixture.root, lastCommitRange(fixture), { GITHUB_EVENT_PATH: foreign });

  it('is ⛔ ignored, and the run says so rather than counting it', () => {
    expect(run.output).toContain('THIS TREE DOES NOT CARRY');
    expect(run.output).not.toContain('The frame is at');
  });

  it('leaves the empty-corpus floor standing — BOTH halves of it', () => {
    // ⚠️ The control the patch round set, reasoned before it was read: a run
    // that prints `Corpus: 0` while having silently skipped the section is the
    // same lie one level down. Both, ⛔ never either.
    expect(run.output).toContain('Corpus: 0 body(ies)');
    expect(run.output).toContain('NOT a clean verdict');
    expect(run.output).toContain('measured NOTHING');
  });

  it('⛔ does not move the five born-false controls, which are hermetic by construction', () => {
    // If ANY of them moved when the environment changed, the hermeticity claim in
    // the gate's own docblock would be false — and that, not the test, would be
    // the finding.
    const bornSection = run.output.slice(
      run.output.indexOf('\u2500\u2500 Born false'),
      run.output.indexOf('\u2500\u2500 Self-contradiction'),
    );
    expect(bornSection.match(/^\s+PASS\s/gm)?.length).toBe(5);
    expect(run.output).not.toMatch(/^\s+FAIL\s/m);
  });
});

describe('an event payload for THIS tree', () => {
  const fixture = fixtureRepo('carried-corpus');
  fixture.write('packages/alpha/src/walker.ts', Array.from({ length: 12 }, (_, i) => `export const s${i} = ${i};\n`).join(''));
  fixture.commit('feat(alpha): the walker');
  fixture.write(
    'packages/alpha/src/walker.ts',
    '// inserted\n// inserted\n' + Array.from({ length: 12 }, (_, i) => `export const s${i} = ${i};\n`).join(''),
  );
  const head = fixture.commit('feat(alpha): insert above the cited line');
  const base = fixture.git('rev-parse', 'HEAD~1');

  const payload = path.join(fixture.root, 'event.json');
  fs.writeFileSync(
    payload,
    JSON.stringify({ pull_request: { number: 1, head: { sha: head }, body: 'The subject is `walker.ts:6`.' } }),
  );
  const run = runGate(fixture.root, ['--base', base, '--head', head], { GITHUB_EVENT_PATH: payload });

  it('IS read — the mechanism the whole no-new-workflow design rests on still works', () => {
    // ⛔ The repair must not throw the mechanism away to silence the tests. The
    // pull request body is where two of the three carded instances lived, and
    // the event payload is the only way to reach it without a new workflow.
    expect(run.output).toContain('carried by this tree');
    expect(run.output).toContain('Corpus: 1 body(ies)');
    expect(run.output).toContain('this change moves packages/alpha/src/walker.ts:6 to :8');
  });
});

// ── 7. the SELF-CONTRADICTION reading (objectui#9841) ────────────────────────
//
// One changeset read against ITSELF: a package its own front matter declares,
// negated in its own body. The four structural changeset gates judge the front
// matter; the two readings above judge a body against a diff; nothing read the
// two halves of one file against each other.
//
// What these cases pin, in the order this reading can fail:
//
//  1. It FIRES on the carded shape, and stays SILENT on the repair that landed
//     on the same pull request — the discrimination the whole coordinate rests
//     on.
//  2. BORN FALSE and WENT FALSE are DIFFERENT ANSWERS, decided from the branch's
//     own revisions. The carded sentence was TRUE when written, and a gate that
//     reported it as false-when-written would be making an accusation the
//     history refutes.
//  3. TWO DISTINCT FLOORS (objectui#9744). A `0` from a reader that read nothing
//     and a `0` from a clean corpus are the same character, so neither may print
//     what the other prints, and neither may print the clean tick.
//  4. HERMETICITY IS STRUCTURAL. This reading takes no ambient input, and a
//     poisoned `GITHUB_EVENT_PATH` cannot move a byte of its section.

/**
 * The VERDICT words this reading printed, one per finding.
 *
 * Read off the finding lines rather than searched for in the section: the
 * section's closing prose explains what a WENT FALSE verdict is and is not, so a
 * substring search over the whole section reports a verdict that was never
 * reached. The distinction this pins is the one objectui#9841 required, and a
 * pin that matches explanatory prose pins nothing.
 */
function verdicts(output: string): string[] {
  return [...selfSection(output).matchAll(/^\s+(BORN FALSE|WENT FALSE|UNDATED)\b/gm)].map((hit) => hit[1]);
}

/** The self-contradiction section of one run, sliced off the rest of the log. */
function selfSection(output: string): string {
  const start = output.indexOf('── Self-contradiction');
  if (start === -1) return '';
  const rest = output.slice(start);
  const end = rest.indexOf('\n✅  No pending changeset');
  return end === -1 ? rest : rest.slice(0, end);
}

/** A fixture whose `packages/beta` is a real workspace package too. */
function twoPackageFixture(label: string): { fixture: Fixture; base: string } {
  const fixture = fixtureRepo(label);
  fixture.write('packages/beta/package.json', JSON.stringify({ name: '@fixture/beta', version: '1.0.0' }));
  const base = fixture.commit('chore(beta): give the second package a manifest');
  return { fixture, base };
}

/**
 * The carded instance's geometry, in a throwaway repository.
 *
 * Round one writes the changeset declaring `@fixture/beta` only, with a sentence
 * that `packages/alpha` is untouched — TRUE at that revision. Round two does the
 * work in `packages/alpha` and adds the declaration that falsifies the sentence,
 * in the same commit, exactly as `21896172a9` did.
 */
const INSTANCE_BODY =
  '⛔ **No published face moves.** `packages/alpha` is untouched: the accept set is the one both ' +
  'faces already shipped, and this is the implementation catching up to it.\n';

describe('a changeset that declares a package its own body says is untouched', () => {
  const { fixture, base } = twoPackageFixture('self-went-false');
  fixture.write('.changeset/9841-instance.md', `---\n'@fixture/beta': patch\n---\n\n${INSTANCE_BODY}`);
  fixture.commit('fix(beta): round one — the sentence is true here');
  fixture.write('packages/alpha/src/index.ts', 'export const alpha = 2;\n');
  fixture.write(
    '.changeset/9841-instance.md',
    `---\n'@fixture/alpha': patch\n'@fixture/beta': patch\n---\n\n${INSTANCE_BODY}`,
  );
  const head = fixture.commit('fix(alpha): round two — the declaration arrives with the work');
  const run = runGate(fixture.root, ['--base', base, '--head', head]);

  it('reports the declaration its own body negates', () => {
    expect(run.output).toContain('.changeset/9841-instance.md  declares `@fixture/alpha`');
    expect(run.output).toContain('`packages/alpha` is untouched');
  });

  it('reads the DIRECTORY spelling, which is the one the carded instance used', () => {
    // A reading that knew only npm names would have been silent on the artefact
    // it exists for: objectui#9796 wrote `packages/types`, never `@object-ui/types`.
    expect(run.output).toContain('`packages/alpha` is untouched');
  });

  it('⭐ calls it WENT FALSE — it was TRUE at the revision that wrote it', () => {
    // ⛔ The accusation this reading must never make about this sentence: the
    // revision that wrote it declared `@fixture/beta` and nothing else, so the
    // sentence was true. Asserted as the EXACT verdict set, so a reader that
    // printed both would fail here rather than satisfy a substring search.
    expect(verdicts(run.output)).toEqual(['WENT FALSE']);
  });

  it('does not block, and says in its own words that it is not a prose judgement', () => {
    expect(run.status).toBe(0);
    expect(run.output).toContain('NOT a prose judgement');
    expect(run.output).toContain('NAME THE ASPECT, AND NAME WHAT DOES MOVE');
  });

  it('⛔ never prints the clean tick beside a finding', () => {
    expect(selfSection(run.output)).not.toContain('is either not negated');
  });
});

describe('a changeset that declares the package and negates it in the SAME revision', () => {
  const { fixture, base } = twoPackageFixture('self-born-false');
  fixture.write('packages/alpha/src/index.ts', 'export const alpha = 3;\n');
  fixture.write('.changeset/9841-born.md', `---\n'@fixture/alpha': patch\n---\n\n${INSTANCE_BODY}`);
  const head = fixture.commit('fix(alpha): both halves land together');
  const run = runGate(fixture.root, ['--base', base, '--head', head]);

  it('⭐ calls it BORN FALSE — and that is a DIFFERENT answer from the case above', () => {
    // The pair is the point. A `dateClaim` that always returned one verdict
    // passes one of these two describes and fails the other; a count of findings
    // moves in neither. This is the assertion that reddens when the distinction
    // is removed.
    expect(verdicts(run.output)).toEqual(['BORN FALSE']);
  });

  it('still reports the finding itself', () => {
    expect(run.output).toContain('.changeset/9841-born.md  declares `@fixture/alpha`');
    expect(run.status).toBe(0);
  });
});

describe("a pending changeset this change falsifies by adding ONE front-matter line", () => {
  // ⚠️ The oldest and most obvious WENT FALSE there is, and the one a branch
  // walk alone gets WRONG. The changeset was already in the tree at the base,
  // carrying a true sentence; this change adds the declaration that falsifies
  // it. Walking only `base..head` finds the single commit that did that, sees
  // the declaration it just added, and would report BORN FALSE — accusing the
  // author of writing something untrue weeks before this branch existed.
  const { fixture, base: preexisting } = twoPackageFixture('self-preexisting');
  fixture.write('.changeset/9841-pending.md', `---\n'@fixture/beta': patch\n---\n\n${INSTANCE_BODY}`);
  const base = fixture.commit('chore(beta): a pending declaration, true when written');
  fixture.write('packages/alpha/src/index.ts', 'export const alpha = 7;\n');
  fixture.write(
    '.changeset/9841-pending.md',
    `---\n'@fixture/alpha': patch\n'@fixture/beta': patch\n---\n\n${INSTANCE_BODY}`,
  );
  const head = fixture.commit('fix(alpha): the work reaches alpha, and the declaration with it');
  const run = runGate(fixture.root, ['--base', base, '--head', head]);

  it('⭐ is WENT FALSE, dated from the front matter the sentence was standing against', () => {
    expect(verdicts(run.output)).toEqual(['WENT FALSE']);
  });

  it('reports it at all — a MODIFIED changeset is in this corpus, not only an added one', () => {
    expect(run.output).toContain('.changeset/9841-pending.md  declares `@fixture/alpha`');
    expect(preexisting).not.toBe(base);
  });
});

describe('the firing control — the repair that landed on objectui#9796', () => {
  const { fixture, base } = twoPackageFixture('self-repaired');
  fixture.write('packages/alpha/src/index.ts', 'export const alpha = 4;\n');
  fixture.write(
    '.changeset/9841-repaired.md',
    "---\n'@fixture/alpha': patch\n---\n\n" +
      '⛔ No type, no accept set, no export and no runtime behaviour moves in `@fixture/alpha`: ' +
      'every changed line in `packages/alpha/src/index.ts` is a docblock line.\n',
  );
  const head = fixture.commit('fix(alpha): the repaired wording');
  const run = runGate(fixture.root, ['--base', base, '--head', head]);

  it('⛔ stays silent — an ASPECT-scoped negation is correct English and correct practice', () => {
    // The whole measured corpus behind this coordinate is this shape. Reporting
    // it would teach authors to delete a correct sentence, which is worse than
    // the defect.
    expect(selfSection(run.output)).not.toContain('are negated by the body');
  });

  it('is green BECAUSE IT LOOKED, and says which corpus it read', () => {
    expect(run.output).toContain('Corpus: 1 changeset(s) this change adds or modifies, 1 of them declaring');
    expect(run.output).toContain('is either not negated');
    expect(run.status).toBe(0);
  });
});

describe('⛔ the two floors — silence and cleanliness never print the same thing', () => {
  // objectui#9744: an assertion whose whole job is "I measured nothing" is the
  // FIRST one to distrust. The two floors below are one level apart and must
  // stay textually distinct from each other and from the clean tick.
  const { fixture: emptyFixture, base: emptyBase } = twoPackageFixture('self-floor-none');
  emptyFixture.write('packages/alpha/src/index.ts', 'export const alpha = 5;\n');
  const emptyHead = emptyFixture.commit('fix(alpha): a change that carries no changeset at all');
  const emptyRun = runGate(emptyFixture.root, ['--base', emptyBase, '--head', emptyHead]);

  const { fixture: silentFixture, base: silentBase } = twoPackageFixture('self-floor-nodecl');
  silentFixture.write('.changeset/9841-internal.md', `---\n---\n\n${INSTANCE_BODY}`);
  const silentHead = silentFixture.commit('chore(alpha): an empty-frontmatter declaration');
  const silentRun = runGate(silentFixture.root, ['--base', silentBase, '--head', silentHead]);

  it('FLOOR ONE — no corpus at all is ⛔ not a clean verdict', () => {
    const section = selfSection(emptyRun.output);
    expect(section).toContain('adds and modifies NO changeset');
    expect(section).toContain('measured nothing');
    expect(section).not.toContain('is either not negated');
    expect(section).not.toContain('Read, but nothing to judge');
  });

  it('FLOOR TWO — a corpus that declares nothing is ⛔ neither clean nor floor one', () => {
    const section = selfSection(silentRun.output);
    expect(section).toContain('Read, but nothing to judge');
    expect(section).toContain('Not the same answer as a clean one');
    expect(section).not.toContain('is either not negated');
    expect(section).not.toContain('adds and modifies NO changeset');
  });

  it('⭐ the two floors are not the same sentence — a reader can tell which zero this is', () => {
    expect(selfSection(emptyRun.output)).not.toBe(selfSection(silentRun.output));
  });

  it("a body that declares no bump is never a contradiction — it publishes nothing", () => {
    // The body here is the carded sentence verbatim. It is reported by nothing,
    // because an empty front matter reaches no CHANGELOG.
    expect(silentRun.output).not.toContain('are negated by the body');
  });
});

describe('⛔ hermeticity — the ambient repository cannot reach this reading', () => {
  // objectui#9744, measured on the reading above this one: `GITHUB_EVENT_PATH`
  // is exported to EVERY process on a runner, and an ungated read made that
  // reading's corpus AMBIENT — a fixture run picked up the real pull request
  // body of whatever build was live, and its empty-corpus floor slid a level in
  // CI while passing locally. This reading takes no environment at all, and that
  // is the property pinned here rather than a convention anyone has to keep.
  const { fixture, base } = twoPackageFixture('self-hermetic');
  fixture.write('packages/alpha/src/index.ts', 'export const alpha = 6;\n');
  fixture.write(
    '.changeset/9841-clean.md',
    "---\n'@fixture/alpha': patch\n---\n\nThe alpha walker is rewritten; the published face is unchanged.\n",
  );
  const head = fixture.commit('fix(alpha): a clean declaration');

  const payload = path.join(fixture.root, 'poison.json');
  fs.writeFileSync(
    payload,
    JSON.stringify({
      pull_request: {
        number: 1,
        head: { sha: head },
        // The carded contradiction, verbatim, in an AMBIENT body. If a single
        // byte of it reaches this reading, the two runs below differ.
        body: `---\n'@fixture/alpha': patch\n---\n\n${INSTANCE_BODY}`,
      },
    }),
  );

  const hermetic = runGate(fixture.root, ['--base', base, '--head', head]);
  const poisoned = runGate(fixture.root, ['--base', base, '--head', head], { GITHUB_EVENT_PATH: payload });

  it('reads the same corpus with the variable set and unset', () => {
    expect(selfSection(poisoned.output)).toBe(selfSection(hermetic.output));
  });

  it('⛔ never adopts the ambient body as a changeset of its own', () => {
    expect(selfSection(poisoned.output)).toContain('Corpus: 1 changeset(s)');
    expect(selfSection(poisoned.output)).not.toContain('are negated by the body');
  });

  it('the variable WAS live for that run — otherwise this control proves nothing', () => {
    // The born-false reading above DOES read it, so its own report moves. A run
    // where the payload was ignored outright would make the comparison vacuous.
    expect(poisoned.output).toContain('carried by this tree');
    expect(hermetic.output).not.toContain('carried by this tree');
  });
});

describe('the self-contradiction controls', () => {
  it('all fire, and the discrimination pair answers two different ways', () => {
    const results = evaluateSelfContradictionControls();
    expect(results.every((control) => control.ok)).toBe(true);
    expect(results.map((control) => control.id)).toContain(
      'a-bare-package-spelling-negated-in-its-own-declaring-body',
    );
    expect(results.map((control) => control.id)).toContain(
      'the-repair-that-landed-on-that-pull-request-is-silent',
    );
  });

  it('⭐ a reader that reports EVERYTHING fails them — a control suite that cannot fail is decoration', () => {
    const shouting = (source: string): unknown[] =>
      declaredPackages(source).map((name) => ({ package: name, spelling: name, claim: 'everything', sentence: '' }));
    const results = evaluateSelfContradictionControls(shouting as never);
    expect(results.some((control) => !control.ok)).toBe(true);
  });

  it('⭐ a reader that reports NOTHING fails them too', () => {
    const mute = (): unknown[] => [];
    const results = evaluateSelfContradictionControls(mute as never);
    expect(results.filter((control) => !control.ok).map((control) => control.id)).toEqual([
      'a-bare-package-spelling-negated-in-its-own-declaring-body',
      'the-npm-name-spelling-fires-as-well-as-the-directory',
    ]);
  });
});

describe('selfContradictions — the coordinate itself', () => {
  const dirOf = (name: string): string | null => (name === '@object-ui/types' ? 'packages/types' : null);
  const declaring = (body: string): string => `---\n'@object-ui/types': patch\n---\n\n${body}\n`;

  it('fires when nothing but a copula sits between the package and the negation', () => {
    expect(selfContradictions(declaring('`packages/types` is untouched.'), dirOf)).toHaveLength(1);
    expect(selfContradictions(declaring('`@object-ui/types` remains unchanged.'), dirOf)).toHaveLength(1);
    expect(selfContradictions(declaring('Nothing in `packages/types` moves.'), dirOf)).toHaveLength(1);
  });

  it('⛔ is silent when an ASPECT sits between them — the whole measured corpus is this shape', () => {
    expect(selfContradictions(declaring('`@object-ui/types` re-exports all four names unchanged.'), dirOf)).toEqual([]);
    expect(selfContradictions(declaring("`packages/types`' type-checks are unchanged."), dirOf)).toEqual([]);
    expect(selfContradictions(declaring('No published face moves in `@object-ui/types`.'), dirOf)).toEqual([]);
  });

  it('⛔ is silent about a package the front matter does not declare', () => {
    // The finding is a contradiction WITH A DECLARATION. A body naming what it
    // did not touch is how a changeset states its blast radius.
    expect(selfContradictions(declaring('`packages/core` is untouched.'), dirOf)).toEqual([]);
  });

  it('⛔ never matches a longer path inside the package directory', () => {
    const body = 'The corpus — `packages/types/examples/data-display.json` — is untouched.';
    expect(selfContradictions(declaring(body), dirOf)).toEqual([]);
  });

  it('counts one contradiction, not two, when both spellings reach the same claim', () => {
    const body = '`packages/types` is untouched.\n\n`packages/types` is untouched.';
    expect(selfContradictions(declaring(body), dirOf)).toHaveLength(1);
  });

  it('reads nothing at all out of a body whose front matter declares no bump', () => {
    expect(selfContradictions('---\n---\n\n`packages/types` is untouched.\n', dirOf)).toEqual([]);
  });
});

describe('declaredPackages', () => {
  it('keeps the NAMES the four structural gates only count', () => {
    expect(declaredPackages("---\n'@object-ui/types': patch\n\"@object-ui/core\": minor\n---\n\nbody\n")).toEqual([
      '@object-ui/types',
      '@object-ui/core',
    ]);
  });

  it('is empty for an unterminated front matter, exactly as describeDeclaration is', () => {
    expect(declaredPackages("---\n'@object-ui/types': patch\n\nno close\n")).toEqual([]);
  });

  it('is empty for a no-release declaration', () => {
    expect(declaredPackages('---\n---\n\nInternal only.\n')).toEqual([]);
  });
});

describe('packageDirectories', () => {
  it('maps this repository’s own packages to the directories that carry them', () => {
    const map = packageDirectories(repoRoot, null);
    expect(map.get('@object-ui/types')).toBe('packages/types');
  });

  it('⛔ never maps the workspace root, whose directory contains every path', () => {
    const root = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { name?: string };
    expect(packageDirectories(repoRoot, null).has(root.name ?? '')).toBe(false);
  });
});
