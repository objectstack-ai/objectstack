import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTROL_ACTION,
  DECLARED_EXCEPTIONS,
  DEFAULT_SPELLING,
  FLOORS,
  censusFailures,
  classify,
  listWorkflows,
  parseRefs,
  scan,
  workflowDir,
} from '../check-action-ref-convention.mjs';

/**
 * objectui#8465 — the convention for how this repository spells an action
 * reference, and the proof that the gate enforcing it can actually fail.
 *
 * The card's finding was a SOLE INSTANCE, not a spelling: one of 13 references
 * was written differently from the other twelve, and it was the only one that
 * had never resolved — 236 runs, 0 successes, eight months of silence. A gate
 * against that has exactly one job, and it is not "reject SHAs": it is to make
 * an off-convention reference impossible to add without writing down why.
 *
 * Which makes the red branch the entire value of this file. A gate over
 * `.github/workflows/**` is validated by nothing else in the repository — not
 * the type checker, not ESLint, not a schema — so if its scan silently stops
 * finding references it reports a clean tree forever, and that renders exactly
 * like success. Every mutation below is asserted to have APPLIED before its
 * result is read.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('the tree follows the convention today', () => {
  it('is green: no undeclared off-convention reference, no stale exception', () => {
    const result = scan(repoRoot);
    expect(
      result.offenders.map((o: { file: string; line: number; ref: string }) => `${o.file}:${o.line} ${o.ref}`),
      'These action references are spelled differently from the repository default and nothing ' +
        'says why. Either spell them as a floating major tag, or declare them in ' +
        'DECLARED_EXCEPTIONS in scripts/check-action-ref-convention.mjs with a reason and an issue.',
    ).toEqual([]);
    expect(
      result.stale.map((e: { workflow: string; action: string }) => `${e.workflow} :: ${e.action}`),
      'These DECLARED_EXCEPTIONS entries match no off-convention reference any more — delete them. ' +
        'An escape hatch nobody removes is how a baseline turns into a permanent skip-list.',
    ).toEqual([]);
  });

  it('the census is trustworthy — floors met and the positive control found', () => {
    // A zero means nothing without a term known to be present in the same run.
    // The gate carries that control itself; this asserts it is doing so.
    const result = scan(repoRoot);
    expect(censusFailures(result)).toEqual([]);
    expect(result.census.controlPresent, `${CONTROL_ACTION} must appear in some workflow`).toBe(true);
    expect(result.census.workflowFiles).toBeGreaterThanOrEqual(FLOORS.workflowFiles);
    expect(result.census.distinctRefs).toBeGreaterThanOrEqual(FLOORS.distinctRefs);
  });

  it('reproduces the census independently of the gate parser', () => {
    // The gate's own count is not evidence for the gate. This reads the same
    // directory with a different method and requires the two to agree, so a
    // parser that quietly narrows its population is caught by the disagreement.
    const dir = workflowDir(repoRoot);
    const files = listWorkflows(dir);
    const naive = new Set<string>();
    for (const file of files) {
      for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        if (/^\s*#/.test(line)) continue;
        const m = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/.exec(line);
        if (m) naive.add(m[1].replace(/^['"]|['"]$/g, ''));
      }
    }
    const fromGate = new Set<string>(scan(repoRoot).distinct);
    expect([...naive].sort()).toEqual([...fromGate].sort());
    expect(naive.size).toBeGreaterThan(5);
  });
});

describe('the exception table stays honest', () => {
  it('every entry carries an issue and a real reason', () => {
    for (const entry of DECLARED_EXCEPTIONS as Array<{
      workflow: string;
      action: string;
      issue: string;
      reason: string;
    }>) {
      expect(entry.issue, `${entry.workflow} :: ${entry.action} must name the issue that owns it`).toMatch(
        /#\d+/,
      );
      expect(
        entry.reason.length,
        `DECLARED_EXCEPTIONS[${entry.workflow} :: ${entry.action}] must carry a real justification — ` +
          '"it was like that already" is the defect, not a reason',
      ).toBeGreaterThan(40);
      expect(
        fs.existsSync(path.join(workflowDir(repoRoot), entry.workflow)),
        `DECLARED_EXCEPTIONS names ${entry.workflow}, which is not a workflow file`,
      ).toBe(true);
    }
  });
});

describe('the gate can fail (non-vacuity)', () => {
  const dir = workflowDir(repoRoot);

  /** A scan over a throwaway copy of `.github/workflows/`, so nothing on disk moves. */
  function scanMutated(mutate: (files: Map<string, string>) => void, exceptions = DECLARED_EXCEPTIONS) {
    const files = new Map<string, string>();
    for (const file of listWorkflows(dir)) {
      files.set(file, fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    const before = new Map(files);
    mutate(files);
    const changed = [...files].some(([name, text]) => before.get(name) !== text) || files.size !== before.size;
    expect(changed, 'mutation did not apply — the unmutated tree would have been scanned').toBe(true);

    const root = fs.mkdtempSync(path.join(repoRoot, 'node_modules', '.action-ref-convention-'));
    try {
      const target = path.join(root, '.github', 'workflows');
      fs.mkdirSync(target, { recursive: true });
      for (const [name, text] of files) fs.writeFileSync(path.join(target, name), text);
      return scan(root, { exceptions });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it('goes red on an undeclared SHA pin — the exact shape of objectui#8465', () => {
    const result = scanMutated((files) => {
      const name = 'repo-gates.yml';
      files.set(
        name,
        files.get(name)!.replace('uses: actions/checkout@v7', 'uses: actions/checkout@' + 'a'.repeat(40)),
      );
    });
    expect(result.offenders.map((o: { file: string; kind: string }) => `${o.file} ${o.kind}`)).toContain(
      'repo-gates.yml sha',
    );
  });

  it('goes red on an undeclared floating BRANCH ref, not only on SHAs', () => {
    // The convention is a spelling, not an anti-SHA rule. `@main` is the other
    // direction of the same defect: a reference nothing around it looks like.
    const result = scanMutated((files) => {
      const name = 'repo-gates.yml';
      files.set(name, files.get(name)!.replace('uses: actions/checkout@v7', 'uses: actions/checkout@main'));
    });
    expect(result.offenders.map((o: { ref: string }) => o.ref)).toContain('actions/checkout@main');
  });

  it('goes red on a stale exception — an entry that matches nothing', () => {
    // This case used to mutate the real `stale.yml`, whose SHA pin was the first
    // entry DECLARED_EXCEPTIONS held. objectui#8548 deleted that workflow and the
    // entry with it, so the shape is reproduced over a synthetic entry — which is
    // stricter, not weaker: the assertion no longer depends on one particular
    // workflow surviving. The synthetic entry is APPENDED to the real table, so
    // the tree's own declared exceptions stay declared and the only entry under
    // test is this one, whatever the real table holds (objectui#11174 added one).
    //
    // Both halves are pinned, because only the pair says the entry is doing
    // work. An entry that never silences anything would satisfy the second half
    // on its own.
    const declared = [
      ...DECLARED_EXCEPTIONS,
      {
        workflow: 'repo-gates.yml',
        action: 'actions/checkout',
        issue: 'objectui#8465',
        reason: 'synthetic entry for the non-vacuity proof below — not a real exception',
      },
    ];
    const shaPin = (files: Map<string, string>) => {
      const name = 'repo-gates.yml';
      files.set(
        name,
        files.get(name)!.replace('uses: actions/checkout@v7', 'uses: actions/checkout@' + 'a'.repeat(40)),
      );
    };

    // Matching: the ref is off-convention and the entry names it, so nothing is
    // reported from either direction.
    const matching = scanMutated(shaPin, declared);
    expect(matching.offenders).toEqual([]);
    expect(matching.stale).toEqual([]);

    // Orphaned: the workflow the entry names is deleted — literally what
    // objectui#8548 did to the real table. The entry now matches nothing and
    // must be reported, loudly, so that deleting a workflow cannot leave a
    // permanently red `main` behind it.
    const orphaned = scanMutated((files) => {
      shaPin(files);
      files.delete('repo-gates.yml');
    }, declared);
    expect(orphaned.offenders).toEqual([]);
    expect(orphaned.stale.map((e: { workflow: string }) => e.workflow)).toEqual(['repo-gates.yml']);
  });

  it('goes red when the census collapses, instead of reporting a clean tree', () => {
    const result = scanMutated((files) => {
      for (const name of [...files.keys()].slice(1)) files.delete(name);
    });
    // The offender list is empty here — which is precisely why the floors have
    // to be a separate, louder verdict. Without them this reads as success.
    expect(result.offenders).toEqual([]);
    expect(censusFailures(result).length).toBeGreaterThan(0);
  });

  it('a declared exception silences the offender, and only that one', () => {
    // Appended to the real table for the reason the stale-exception case gives:
    // the tree's own declared exceptions stay declared, so `fake` is the only
    // entry whose effect this case reads.
    const fake = [
      ...DECLARED_EXCEPTIONS,
      { workflow: 'repo-gates.yml', action: 'actions/checkout', issue: 'objectui#1', reason: 'x'.repeat(50) },
    ];
    // Two off-convention refs, in two different workflows, and `fake` names only
    // the first. The second is the whole point of the case: until objectui#8548
    // it was `stale.yml`'s real SHA pin, which the tree no longer carries, so it
    // is injected here instead. ⛔ Do not drop it and keep only the silenced
    // half — a gate that reported nothing at all would pass that alone.
    const result = scanMutated((files) => {
      files.set(
        'repo-gates.yml',
        files.get('repo-gates.yml')!.replace('uses: actions/checkout@v7', 'uses: actions/checkout@main'),
      );
      files.set(
        'shadcn-check.yml',
        files
          .get('shadcn-check.yml')!
          .replace('uses: actions/checkout@v7', 'uses: actions/checkout@' + 'd'.repeat(40)),
      );
    }, fake);
    // The ref `fake` covers is silenced...
    expect(result.offenders.map((o: { ref: string }) => o.ref)).not.toContain('actions/checkout@main');
    expect(result.stale).toEqual([]);
    // ...and ONLY that one: the second workflow's SHA is undeclared and is
    // reported. Proof that what silences a reference is an entry naming it, not
    // the gate being lax about off-convention spellings.
    expect(result.offenders.map((o: { file: string; kind: string }) => `${o.file} ${o.kind}`)).toEqual([
      'shadcn-check.yml sha',
    ]);
  });
});

describe('prose cannot be mistaken for a reference', () => {
  it('ignores action refs written inside comments', () => {
    // objectui#8465's triage hit this: a `changesets/action@v1` followed by a
    // trailing backtick, inside prose, read as a 14th reference. Every workflow
    // in this repository discusses action refs in comments — this gate's own
    // workflow header does, at length.
    const source = [
      '# see `changesets/action@v1` and actions/stale@' + 'b'.repeat(40),
      '        # uses: actions/checkout@main',
      '        uses: actions/checkout@v7',
    ].join('\n');
    expect(parseRefs(source, 'sample.yml').map((r: { ref: string }) => r.ref)).toEqual([
      'actions/checkout@v7',
    ]);
  });

  it("does not count this gate's own workflow header as references", () => {
    const source = fs.readFileSync(path.join(dirOf(), 'repo-gates.yml'), 'utf8');
    expect(parseRefs(source, 'repo-gates.yml').map((r: { ref: string }) => r.ref)).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      // In file order: the pinned @objectstack build's restore (objectui#12957),
      // the build's turbo cache restore and save (objectui#13348), then the
      // pinned build's save.
      'actions/cache/restore@v6',
      'actions/cache/restore@v6',
      'actions/cache/save@v6',
      'actions/cache/save@v6',
    ]);
  });

  function dirOf() {
    return workflowDir(repoRoot);
  }
});

describe('classification', () => {
  it('accepts the declared default and nothing looser', () => {
    expect(DEFAULT_SPELLING.test('v7')).toBe(true);
    expect(DEFAULT_SPELLING.test('v9')).toBe(true);
    // A full semver tag is NOT the default: `@v9.0.0` does not float, so it
    // carries the same "nothing else looks like this" exposure as a SHA.
    expect(DEFAULT_SPELLING.test('v9.0.0')).toBe(false);
    expect(classify('actions/cache/restore@v6').conforms).toBe(true);
    expect(classify('actions/stale@' + 'c'.repeat(40))).toMatchObject({ kind: 'sha', conforms: false });
    expect(classify('owner/action@v1.2.3')).toMatchObject({ kind: 'other', conforms: false });
    expect(classify('owner/action')).toMatchObject({ kind: 'unversioned', conforms: false });
  });

  it('exempts by shape the refs that carry no version to spell', () => {
    // Stated rather than left implicit: neither shape occurs in the tree today,
    // and an unexplained silent pass is the thing this gate exists to remove.
    expect(classify('./.github/actions/local')).toMatchObject({ kind: 'local', conforms: true });
    expect(classify('docker://alpine:3.20')).toMatchObject({ kind: 'docker', conforms: true });
  });
});

describe('the gate is wired into CI', () => {
  const workflow = path.join(workflowDir(repoRoot), 'repo-gates.yml');

  it('has a workflow that runs it', () => {
    expect(fs.existsSync(workflow), 'action-ref-convention.yml must exist').toBe(true);
    const text = fs.readFileSync(workflow, 'utf8');
    expect(text).toContain('node scripts/check-action-ref-convention.mjs');
  });

  it('runs on pull requests and on queue builds, with no path filter', () => {
    // A path filter here would be self-defeating in the one direction that
    // matters: the population this gate scans IS `.github/workflows/`, and
    // `ci.yml` / `lint.yml` skip their expensive steps on such a change.
    const text = fs.readFileSync(workflow, 'utf8');
    const on = text.slice(text.indexOf('\non:'));
    const uncommented = on
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(uncommented).toMatch(/^ {2}pull_request:/m);
    expect(uncommented).toMatch(/^ {2}merge_group:/m);
    expect(uncommented).not.toMatch(/paths(-ignore)?:/);
  });

  it('is reachable as a package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:action-ref-convention']).toBe(
      'node scripts/check-action-ref-convention.mjs',
    );
  });
});
