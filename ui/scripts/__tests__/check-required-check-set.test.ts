import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import {
  EXIT_BREACHED,
  EXIT_CANNOT_RUN,
  EXIT_OK,
  PINNED_CONTEXTS,
  WATCHED_CONTEXTS,
  evaluate,
  exitCodeFor,
  selfTest,
} from '../check-required-check-set.mjs';
import { REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const GATE = 'scripts/check-required-check-set.mjs';
const WORKFLOW = '.github/workflows/required-check-set-patrol.yml';
const FIXTURES = 'scripts/__tests__/fixtures/required-check-set';
/**
 * The verbatim live answer of 2026-10-12, taken the day objectui#12240 was
 * executed and before the maintainer's ruleset edit. That card's window is
 * this reading: between its pull request merging and the maintainer removing
 * `Spec Main Shape Gate` from the ruleset, the live set is exactly this one and
 * the declaration is `RULING_FIXTURE`. A case below asserts the evaluator calls
 * that `drifted` — reported, exit 0, never red.
 */
const LIVE_2026_10_12_FIXTURE = `${FIXTURES}/live-2026-10-12.json`;
/**
 * The set objectui#12240's ruling installs — the maintainer's ruling B on
 * objectui#12214's open question 1 (ACCEPT 6123370050): `Spec Main Shape Gate`
 * leaves the required set, and `Governed Surface Queue Guard`, enrolled under
 * objectui#6596 and never declared here, is. The CONTROL fixture: the dated
 * reading above with exactly that one entry removed, every other rule
 * byte-identical. It replaced objectui#9969's control, which watched the gate
 * that card enrolled.
 */
const RULING_FIXTURE = `${FIXTURES}/ruling-12240.json`;
/**
 * The verbatim live answer of 2026-09-14, kept because it is a real reading and
 * because objectui#9499's window was worth pinning: between that pull request
 * merging and the maintainer adding `Test` to the ruleset, the live set was
 * exactly this one. The case below asserts the evaluator still calls it
 * `drifted` — reported, exit 0, never red — against today's declaration.
 */
const LIVE_2026_09_14_FIXTURE = `${FIXTURES}/live-2026-09-14.json`;
const LIVE_FIXTURE = RULING_FIXTURE;
const ABLATED_FIXTURE = `${FIXTURES}/type-check-removed.json`;

/**
 * objectui#9422. The merge queue's required-check set lives in GitHub ruleset
 * 11776024 — repository settings, not this repository. Dropping a member from
 * it reds no gate and leaves no trace in any diff, and the one time that state
 * existed here (objectui#3523) three pull requests merged with `Type Check` at
 * `conclusion=failure`.
 *
 * `scripts/check-required-check-set.mjs` is the patrol that reads it. This file
 * holds four separate things, because the patrol has four distinct ways to stop
 * meaning anything:
 *
 *   1. the LOGIC — `--self-test`, offline, including the ablation;
 *   2. the ABLATION through the real CLI, over a COMMITTED fixture of the live
 *      API response with exactly one member removed, against the unablated
 *      fixture as its control. A gate never observed failing is decoration;
 *   3. the DECLARATION's integrity — every name the patrol pins or watches must
 *      also be a name this repository already declares blocking in
 *      `REQUIRED_CONTEXTS`, so the two lists cannot drift into watching
 *      different pipelines;
 *   4. the WIRING — the workflow exists, is scheduled, and runs this script.
 *      A patrol nobody runs is indistinguishable from a patrol that passes,
 *      and this is the half of the patrol's own liveness that a diff can see.
 *
 * ⚠️ What this file deliberately does NOT assert: that the live ruleset is
 * intact. That reading needs the network and belongs to the scheduled run. A
 * test that reached the API would be red whenever GitHub was slow, on every
 * pull request, which is the noise the patrol's whole design avoids.
 */

/** The shape `GET /repos/{owner}/{repo}/rules/branches/{branch}` answers with. */
type Rule = {
  type: string;
  parameters?: { required_status_checks?: Array<{ context?: string; integration_id?: number }> };
};

const readFixture = (rel: string): Rule[] => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const runGate = (args: string[]) =>
  spawnSync(process.execPath, [path.join(ROOT, GATE), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'objectstack-ai/objectui', QUEUE_BASE_BRANCH: 'main' },
  });

describe('check-required-check-set — the logic', () => {
  it('passes its own offline self-test', async () => {
    // Captured so a passing run does not print 32 lines into every suite; the
    // capture is restored in `finally` so a throw cannot leave console silenced.
    const log: string[] = [];
    const out = console.log;
    const err = console.error;
    console.log = (...a: unknown[]) => void log.push(a.join(' '));
    console.error = (...a: unknown[]) => void log.push(a.join(' '));
    let code: number;
    try {
      code = await selfTest();
    } finally {
      console.log = out;
      console.error = err;
    }
    expect(log.join('\n'), 'the self-test produced no output at all — it did not run').toMatch(/self-test/);
    expect(code, log.join('\n')).toBe(0);
  });

  it('runs `--self-test` as a real child process and exits 0', () => {
    const r = runGate(['--self-test']);
    expect(`${r.stdout}${r.stderr}`).toMatch(/cases pass/);
    expect(r.status).toBe(EXIT_OK);
  });
});

describe('check-required-check-set — the ablation, through the CLI', () => {
  /**
   * The control comes FIRST on purpose. If the unablated fixture did not read
   * green through this same code path, the red below would be evidence of
   * nothing — a gate that fails on everything is not a gate.
   */
  it('CONTROL: the unablated fixture of the live response reads INTACT (exit 0)', () => {
    const r = runGate(['--fixture', LIVE_FIXTURE]);
    expect(r.stdout).toContain('The required-check set is intact');
    expect(r.status).toBe(EXIT_OK);
  });

  it('ABLATION: the same response with `Type Check` removed REDS the gate (exit 3)', () => {
    const r = runGate(['--fixture', ABLATED_FIXTURE]);
    expect(r.status).toBe(EXIT_BREACHED);
    expect(r.stdout).toContain('Pinned contexts missing from the required set: `Type Check`');
    expect(r.stdout).not.toContain('✅');
  });

  it('the two fixtures differ by exactly the ablated member, and by nothing else', () => {
    const live = readFixture(LIVE_FIXTURE);
    const ablated = readFixture(ABLATED_FIXTURE);
    const contexts = (rules: Rule[]): string[] =>
      rules.flatMap((r) =>
        r.type === 'required_status_checks'
          ? (r.parameters?.required_status_checks ?? []).map((c) => String(c.context))
          : [],
      );
    expect(contexts(live)).toContain('Type Check');
    expect(contexts(ablated)).not.toContain('Type Check');
    expect(contexts(ablated)).toEqual(contexts(live).filter((c: string) => c !== 'Type Check'));
    // Everything that is not the required_status_checks rule is byte-identical,
    // so the ablation cannot be passing for some second reason.
    const others = (rules: Rule[]) => JSON.stringify(rules.filter((r) => r.type !== 'required_status_checks'));
    expect(others(ablated)).toBe(others(live));
  });

  it('an answer it cannot read exits 2 — never 0, and never a breach it did not see', () => {
    const bad = path.join(ROOT, FIXTURES, 'live-2026-09-14.json');
    const r = spawnSync(process.execPath, [path.join(ROOT, GATE), '--fixture', `${bad}.does-not-exist`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status).toBe(EXIT_CANNOT_RUN);
    expect(r.stderr).toContain('could not take a reading');
    expect(r.stdout).not.toContain('✅');
  });
});

describe('check-required-check-set — the committed fixture is the live shape', () => {
  const live = () => readFixture(LIVE_FIXTURE);

  it('carries the five rule types the endpoint answered with', () => {
    expect(live().map((r) => r.type).sort()).toEqual(
      ['deletion', 'merge_queue', 'non_fast_forward', 'pull_request', 'required_status_checks'].sort(),
    );
  });

  it('declares exactly the contexts the patrol pins and watches', () => {
    const reading = evaluate({ rules: live(), branch: 'main', repository: 'objectstack-ai/objectui' });
    expect(reading.contexts).toHaveLength(PINNED_CONTEXTS.length + WATCHED_CONTEXTS.length);
    expect(reading.verdict).toBe('intact');
    // Positive control and nonsense control in the same assertion block, so a
    // membership test that stopped discriminating cannot read as agreement.
    expect(reading.contexts).toContain('Type Check');
    expect(reading.contexts).not.toContain('Type Checq');
  });

  it('is a fixture and not the gate itself: emptying it does not read as intact', () => {
    expect(evaluate({ rules: [], branch: 'main' }).verdict).toBe('breached');
  });

  /**
   * objectui#9499's three-step change, pinned at its middle step.
   *
   * The ruling replaces four required contexts with one, and the maintainer's
   * clicks bracket the merge: remove the four, merge this, add `Test`. The old
   * and the new names are never both satisfiable, so while the window is open
   * the live answer is the 2026-09-14 one above and the declaration is the
   * ruling's. This asserts what the patrol does with that — and the direction
   * is the whole point of objectui#9422's two tiers: a rename is REPORTED, at
   * exit 0, and never manufactures a red on healthy work.
   */
  it('reads the pre-ruling live answer as DRIFTED, naming both halves', () => {
    const reading = evaluate({
      rules: readFixture(LIVE_2026_09_14_FIXTURE),
      branch: 'main',
      repository: 'objectstack-ai/objectui',
    });

    expect(reading.verdict).toBe('drifted');
    expect(exitCodeFor(reading.verdict)).toBe(EXIT_OK);
    // `Governed Surface Queue Guard` is missing from this dated answer too: it
    // was not enrolled until objectui#6596 and not declared here until
    // objectui#12240. The fixture is a verbatim reading and stays as it was.
    expect(reading.missingWatched).toEqual(['Test', 'Governed Surface Queue Guard']);
    expect(reading.unexpected).toEqual([
      'Test (shard 1/4)',
      'Test (shard 2/4)',
      'Test (shard 3/4)',
      'Test (shard 4/4)',
    ]);
    // The pinned tier is untouched by the rename, which is why this is drift
    // and not a breach.
    expect(reading.missingPinned).toEqual([]);
  });

  /**
   * objectui#12240's window, pinned at its middle step — objectui#9499's shape
   * run the other way. The ruling REMOVES a context: the pull request that
   * declares the new set merges, and the maintainer edits the ruleset in the
   * same sitting. Between the two the live answer is the dated reading of
   * 2026-10-12 and the declaration is the ruling's. The patrol must NAME the
   * leftover context and stay at exit 0: a ruled removal must not manufacture
   * a red on healthy work, which is objectui#9422's two tiers doing their job.
   */
  it('reads the live answer of the day objectui#12240 was executed as DRIFTED, naming `Spec Main Shape Gate`', () => {
    const contexts = (rules: Rule[]): string[] =>
      rules.flatMap((r) =>
        r.type === 'required_status_checks'
          ? (r.parameters?.required_status_checks ?? []).map((c) => String(c.context))
          : [],
      );
    // The two fixtures differ by exactly that one context and nothing else, so
    // the drift below cannot be caused by some second difference.
    expect(contexts(readFixture(RULING_FIXTURE))).toEqual(
      contexts(readFixture(LIVE_2026_10_12_FIXTURE)).filter((c) => c !== 'Spec Main Shape Gate'),
    );
    const others = (rules: Rule[]) => JSON.stringify(rules.filter((r) => r.type !== 'required_status_checks'));
    expect(others(readFixture(RULING_FIXTURE))).toBe(others(readFixture(LIVE_2026_10_12_FIXTURE)));

    const reading = evaluate({
      rules: readFixture(LIVE_2026_10_12_FIXTURE),
      branch: 'main',
      repository: 'objectstack-ai/objectui',
    });
    expect(reading.verdict).toBe('drifted');
    expect(reading.unexpected).toEqual(['Spec Main Shape Gate']);
    expect(reading.missingWatched).toEqual([]);
    expect(reading.missingPinned).toEqual([]);

    const r = runGate(['--fixture', LIVE_2026_10_12_FIXTURE]);
    expect(r.status).toBe(EXIT_OK);
    expect(r.stdout).toContain('Required but not declared here: `Spec Main Shape Gate`.');
    expect(r.stdout).not.toContain('✅');
    expect(r.stderr).toContain('DRIFTED');
  });

  it('the context objectui#12240 removed is neither pinned nor watched', () => {
    const declared = [...PINNED_CONTEXTS, ...WATCHED_CONTEXTS];
    expect(declared).not.toContain('Spec Main Shape Gate');
    // Control: the same membership test finds the name that ruling declared.
    expect(declared).toContain('Governed Surface Queue Guard');
  });
});

describe('check-required-check-set — the declaration cannot drift from the repository', () => {
  /**
   * `REQUIRED_CONTEXTS` (`scripts/dependabot-merge-gate.mjs`) is where this
   * repository already writes down that a check is blocking and reports on
   * every pull request; `content/docs/guide/ci-cd-pipeline.md` calls it "a
   * human's answer" to which contexts may be required. The nine names in the
   * live ruleset are a subset of it — measured 2026-09-14, 9 of 26 — so a
   * rename that updates that list and forgets this one fails here instead of
   * quietly leaving the patrol watching a name nothing produces.
   */
  it('every pinned and watched name is declared blocking in REQUIRED_CONTEXTS', () => {
    const declared = new Set(REQUIRED_CONTEXTS);
    const undeclared = [...PINNED_CONTEXTS, ...WATCHED_CONTEXTS].filter((c) => !declared.has(c));
    expect(undeclared, `these names are watched by the patrol but not declared blocking: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('CONTROL: a name that is not declared blocking is detected as such', () => {
    expect(new Set(REQUIRED_CONTEXTS).has('Type Checq')).toBe(false);
    expect(new Set(REQUIRED_CONTEXTS).has('Type Check')).toBe(true);
  });

  it('the pinned tier is non-empty, so the gate cannot pass on any answer at all', () => {
    expect(PINNED_CONTEXTS.length).toBeGreaterThan(0);
    expect(PINNED_CONTEXTS).toContain('Type Check');
  });

  it('the two tiers do not overlap', () => {
    expect(WATCHED_CONTEXTS.filter((c) => PINNED_CONTEXTS.includes(c))).toEqual([]);
  });
});

describe('check-required-check-set — the wiring', () => {
  it('package.json runs the gate under `check:required-check-set`', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:required-check-set']).toContain(GATE);
  });

  const workflow = (): Record<string, unknown> => parseYaml(fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8'));

  /**
   * YAML 1.1 reads a bare `on:` key as the BOOLEAN true, so `doc.on` is
   * `undefined` and an assertion reaching for it would pass over an empty
   * object — a wiring pin that asserts nothing. Both spellings are read, and
   * the triggers assertion below fails loudly if neither resolves.
   */
  const triggers = (): Record<string, unknown> => {
    const doc = workflow();
    const on = doc[String(true)] ?? doc.on;
    if (!on || typeof on !== 'object') {
      throw new Error(`could not read the \`on:\` block of ${WORKFLOW} — keys were ${Object.keys(doc).join(', ')}`);
    }
    return on as Record<string, unknown>;
  };

  it('the patrol workflow exists and is SCHEDULED — the half of its liveness a diff can see', () => {
    const on = triggers();
    const schedule = on.schedule as Array<{ cron?: string }> | undefined;
    expect(Array.isArray(schedule)).toBe(true);
    expect(schedule).not.toHaveLength(0);
    expect(schedule?.[0]?.cron).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
    expect(on).toHaveProperty('workflow_dispatch');
  });

  it('the patrol has NO pull_request leg — it must never gate a pull request', () => {
    const on = triggers();
    expect(on).not.toHaveProperty('pull_request');
    expect(on).not.toHaveProperty('pull_request_target');
    expect(on).not.toHaveProperty('merge_group');
  });

  it('the workflow actually invokes this script', () => {
    expect(fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8')).toContain(GATE);
  });

  it('the patrol asks for no write permission at all — it READS the ruleset', () => {
    const perms = workflow().permissions;
    expect(perms).toEqual({ contents: 'read' });
  });

  it('a run that could not read must fail the job, so a broken transport is never a silent green', () => {
    const yml = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');
    expect(yml).toContain(String(EXIT_CANNOT_RUN));
    expect(yml).toContain(String(EXIT_BREACHED));
    // Captured with no pipe in between — `node … | tail` reports the pipe's
    // status and every verdict would collapse to 0.
    expect(yml).toMatch(/exit_code=\$code/);
  });
});

/**
 * objectui#9502. Four sentences in this tree told an author that the ruleset
 * cannot be read from here. All four were TRUE when written — objectui#4959
 * recorded a merge landing while all four `Test (shard N/4)` jobs were
 * `in_progress`, which is possible only if none of them was required — and the
 * ruleset was edited afterwards (`updated_at` 2026-08-24) without the prose
 * moving. An author who trusted one of them and re-sharded the test jobs would
 * block every pull request in the repository on contexts that can never be
 * produced again.
 *
 * The repair was to POINT at this gate instead of restating its answer, so this
 * block asserts the pointer rather than the answer: nothing it reads could go
 * stale the next time a maintainer edits the ruleset.
 *
 * ⚠️ The population is named in words: the three files objectui#9502 repaired.
 * `AGENTS.md` carried a fourth instance and is deliberately NOT in that set.
 * objectui#9502 left it standing — it is governed surface, and its
 * parenthetical also covered who may bypass the ruleset, which the endpoint
 * this gate reads does not carry — and objectui#9520 then split it along that
 * line: its required-checks half points at this gate, and "从仓内读不到" stays
 * on the bypass-actors half alone, where it was measured true. So it still
 * cannot join `REPAIRED` (the "makes no cannot-be-read claim" case would go red
 * on that true half, which is exactly what Leg 2 below asserts it carries), and
 * it is still what makes the control below real: the same detector, run over
 * `AGENTS.md`, must FIRE. A zero from a detector never observed firing is
 * decoration.
 */
describe('check-required-check-set — the prose points here instead of answering (#9502)', () => {
  /** The three files objectui#9502 repaired. */
  const REPAIRED = [
    'content/docs/guide/ci-cd-pipeline.md',
    '.github/workflows/dependabot-auto-merge.yml',
    'scripts/dependabot-merge-gate.mjs',
  ];

  /**
   * The carrier objectui#9502 left standing and objectui#9520 split: the one
   * file that still writes "从仓内读不到", on its bypass-actors half, where it is
   * true — and this block's positive control.
   */
  const SPLIT_CARRIER = 'AGENTS.md';

  /**
   * The claim being hunted: the ruleset cannot be READ from this repository.
   * Matched on joined text, because every carrier was wrapped across lines and a
   * per-line reader could not see any of them.
   */
  const CANNOT_READ =
    /nothing (?:here|in this repository) can read|从仓内读不到|cannot be read from (?:here|this repository)/i;

  const flatten = (rel: string): string =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');

  it('CONTROL: the detector fires — on a constructed sentence, and on real tree content', () => {
    // Leg 1, self-contained: the regex is proven able to return non-zero here,
    // so the zeros below do not rest on any other file staying as it is.
    expect(CANNOT_READ.test('that set is a surface nothing here can read')).toBe(true);
    expect(CANNOT_READ.test('that set is a surface nothing here can change')).toBe(false);

    // Leg 2, the same detector over real content: `AGENTS.md` still carries the
    // phrase, deliberately, on the bypass-actors half of its ruleset bullet —
    // the one place in the tree it is true, which is where objectui#9520 kept it
    // when it split that bullet. ⚠️ Said per AGENTS.md #9 rather than left to be
    // assumed: this detector cannot tell which half a phrase sits on, so this
    // leg does NOT hold the bullet's required-checks half to its pointer, and
    // nothing else in this file does either. If this leg ever goes red the bypass
    // half was re-worded or ruled on again — a legitimate change, not a bug
    // here. The remedy is to move the inventory docblock in the gate with it and
    // retire this leg, NOT to weaken the detector.
    expect(
      CANNOT_READ.test(flatten(SPLIT_CARRIER)),
      `${SPLIT_CARRIER} no longer carries the phrase this detector hunts (its bypass-actors half did, ` +
        `deliberately). If that half was re-worded, update the inventory docblock in ${GATE} to match ` +
        'and drop this leg. Leg 1 above keeps the detector honest either way.',
    ).toBe(true);
  });

  it.each(REPAIRED)('%s makes no "cannot be read" claim', (rel) => {
    const flat = flatten(rel);

    // Anchor first: a file that moved or emptied would pass the assertion below
    // vacuously. Each anchor is a phrase the repaired passage must still carry.
    expect(flat, `${rel} no longer mentions the required set at all`).toMatch(
      /required[\s-]check|checks are required|required set/i,
    );

    // The historical quotation in `dependabot-merge-gate.mjs` is explicitly
    // labelled as the sentence that was replaced, so it is matched by neither
    // half of the detector — it says "carrying the shards", not "can read".
    expect(CANNOT_READ.test(flat), `${rel} still claims this surface cannot be read`).toBe(false);
  });

  it.each(REPAIRED)('%s points at this gate rather than restating its answer', (rel) => {
    expect(flatten(rel)).toContain('check-required-check-set');
  });

  it('no repaired file restates which contexts the ruleset currently holds', () => {
    // Pinning a spelling is what created the card: `Test (shard N/4)` named as a
    // present-tense member of the required set is the exact sentence an author
    // would act on. The shard names may still appear — `REQUIRED_CONTEXTS`
    // declares them — so the detector looks for the CLAIM, not the names.
    const RESTATES = /(?:required set|checks are required|required[\s-]check set)[^.]{0,80}\b(?:contains|holds|carries|includes)\b/i;

    // Control, same regex, one argument changed: a sentence of the forbidden
    // shape is detected. Proven able to return non-zero before any zero below.
    expect(RESTATES.test('the required set contains the four shards today')).toBe(true);

    for (const rel of REPAIRED) {
      expect(RESTATES.test(flatten(rel)), `${rel} restates the ruleset's membership`).toBe(false);
    }
  });

  it("the gate's own docblock inventories every repaired carrier, and the one objectui#9520 split", () => {
    const docblock = fs.readFileSync(path.join(ROOT, GATE), 'utf8').slice(0, 4000);
    for (const rel of [...REPAIRED, SPLIT_CARRIER]) {
      expect(docblock, `${GATE} no longer names ${rel} in its inventory`).toContain(rel);
    }
    // The write half is the reason the sentences were not simply deleted.
    expect(docblock).toMatch(/WRITE half/);
  });
});
