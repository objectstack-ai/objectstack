// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--self-test`: the runner's own fixtures, in both directions, with no model
 * and no network. Shaped after `scripts/check-agent-model-declared.mjs`
 * (AGENTS.md, "Writing a `--self-test`"): the table's row labels are the
 * battery roster, pinned as a literal with a floor of one case each and a
 * pinned roster size, and the verdict sets a module-level flag the dispatch
 * refuses to exit 0 without.
 *
 * It must be able to fail: the grader is injected, so a broken grader (one
 * that passes every answer, say) reds the grader rows, and the suite pins that.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApiBillingRefusedError } from '../runner/driver.js';
import { armArgs, placeCaseFiles, prepareArmWorkdir } from './arms.js';
import { loadSkillEvalCatalog, notUserInvocable, parseEvalFile, type SkillEvalCase } from './cases.js';
import { type Grader, gradeAnswer } from './grade.js';
import { judgeTurn, planRound, preflight, regradeRecords, type SkillEvalRunRecord } from './run.js';
import { summariseRound } from './summary.js';

/** Row label → minimum cases registered. A row is a battery; deleting one must red. */
export const SELF_TEST_BATTERIES = Object.freeze({
  'grader: every must_contain present and no must_not_contain → PASS': 1,
  'grader: a must_contain token absent → FAIL, naming it': 1,
  'grader: a must_not_contain token present → FAIL, naming it': 1,
  'grader: a case-only difference → FAIL (tokens match case-sensitively)': 1,
  'grader: an empty answer against a must_contain → FAIL': 1,
  'reader: a case asserting nothing → REFUSED, never graded': 1,
  'reader: a non-string assertion token → REFUSED': 1,
  'reader: the catalog under test loads cases with no refusal': 1,
  'arms: the with-skill project holds the bundle without its evals/': 1,
  'arms: the no-skill project holds no skill': 1,
  'arms: argv loads project settings only, four tools, no MCP server': 1,
  'judge: a with-skill turn whose init lists no bundle → INVALID': 1,
  'judge: a no-skill turn whose init lists a bundle → INVALID': 1,
  'judge: a turn ending error_max_turns → ERROR, out of the denominator': 1,
  'judge: a no-skill turn launching a catalog bundle → INVALID': 1,
  'judge: a with-skill turn on a bundle the init line never lists → graded, its evidence named': 1,
  'reader: `user-invocable: false` frontmatter → a bundle the init line never lists': 1,
  'judge: a graded with-skill turn → its answer judged by the grader': 1,
  'guard: ANTHROPIC_API_KEY set → the round refuses to start': 1,
  'summary: no-skill ≥ with-skill is named; invalid turns stay out of the rate': 1,
  'regrade: a case changed since the round → SET APART, never graded against the new text': 1,
  'reader: a trigger case reads with no assertions; one carrying assertions → REFUSED': 1,
  'reader: a `files` entry outside evals/files/ → REFUSED': 1,
  'reader: a bundle whose trigger cases are all positive → REFUSED': 1,
  'judge: a trigger case the turn loaded, by a Skill launch or a read → PASS; not loaded → FAIL': 1,
  'judge: a should-not-trigger case the turn loaded → FAIL; left alone → PASS': 1,
  'round: a trigger case runs on the with-skill arm only': 1,
  'arms: a case\'s files land in the turn\'s project on both arms': 1,
  'summary: trigger cases are tallied apart from the behaviour pass rates': 1,
});

/** The roster's own size, pinned: a deleted row takes its floor with it otherwise. */
export const SELF_TEST_BATTERY_FLOOR = 29;

let selfTestReachedVerdict = false;
/** Whether the last {@link runSelfTest} reached its verdict line. */
export const selfTestReached = (): boolean => selfTestReachedVerdict;

export interface SelfTestDeps {
  /** The grader under test; the real one by default. */
  grade?: Grader;
  /** The catalog the reader row loads (the workspace `skills/` from the CLI). */
  skillsRoot: string;
  log?: (line: string) => void;
  err?: (line: string) => void;
}

export interface SelfTestResult {
  failed: number;
  cases: number;
}

const fixtureCase = (over: Partial<SkillEvalCase> = {}): SkillEvalCase => ({
  bundle: 'demo-skill',
  file: 'demo.json',
  id: 1,
  key: 'demo-skill/demo#1',
  prompt: 'Find active accounts, case-insensitively by email.',
  mustContain: ["engine.find('account'", '$icontains'],
  mustNotContain: ['$contains:'],
  ...over,
});

/** A minimal stream-json transcript: init (with `skills`), optional Skill call, optional Read, result. */
const stream = (o: { skills: string[]; answer?: string; subtype?: string; invoked?: string; read?: string }): string =>
  [
    { type: 'system', subtype: 'init', model: 'fixture-model', skills: o.skills, mcp_servers: [] },
    ...(o.invoked ? [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: o.invoked } }] } }] : []),
    ...(o.read ? [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: o.read } }] } }] : []),
    ...(o.answer !== undefined ? [{ type: 'assistant', message: { content: [{ type: 'text', text: o.answer }] } }] : []),
    { type: 'result', subtype: o.subtype ?? 'success', is_error: false, num_turns: 2, result: o.answer ?? '', total_cost_usd: 0.01, duration_ms: 10, permission_denials: [] },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');

const exited = (stdout: string) => ({ stdout, process: { elapsedMs: 1, exit: 0, timedOut: false, timeoutMs: 1000 } });

const GOOD = "engine.find('account', { where: { email: { $icontains: '@company.com' } } })";

export function runSelfTest(deps: SelfTestDeps): SelfTestResult {
  selfTestReachedVerdict = false;
  const grade = deps.grade ?? gradeAnswer;
  const log = deps.log ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const scratch = mkdtempSync(join(tmpdir(), 'skill-eval-selftest-'));
  const fixtureRoot = join(scratch, 'skills');
  mkdirSync(join(fixtureRoot, 'demo-skill', 'evals'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'demo-skill', 'rules'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\n---\n');
  writeFileSync(join(fixtureRoot, 'demo-skill', 'rules', 'filters.md'), '$icontains\n');
  writeFileSync(join(fixtureRoot, 'demo-skill', 'evals', 'demo.json'), '{"evals":[]}');

  const judge = (c: SkillEvalCase, arm: 'with-skill' | 'no-skill', stdout: string): SkillEvalRunRecord =>
    judgeTurn(c, arm, 1, exited(stdout), { bundles: ['demo-skill', 'other-skill', 'quiet-skill'], unlisted: ['quiet-skill'] }, 'fixture', grade);

  type Row = { label: keyof typeof SELF_TEST_BATTERIES | string; run: () => true | string };
  const rows: Row[] = [
    {
      label: 'grader: every must_contain present and no must_not_contain → PASS',
      run: () => (grade(GOOD, fixtureCase()).pass ? true : 'a conforming answer was graded FAIL'),
    },
    {
      label: 'grader: a must_contain token absent → FAIL, naming it',
      run: () => {
        const g = grade("engine.find('account', { where: { email: { $endsWith: '@company.com' } } })", fixtureCase());
        return !g.pass && g.missing.join() === '$icontains' ? true : `expected FAIL missing [$icontains], got pass=${g.pass} missing=[${g.missing.join(', ')}]`;
      },
    },
    {
      label: 'grader: a must_not_contain token present → FAIL, naming it',
      run: () => {
        const g = grade(`${GOOD} // or { $contains: 'x' }`, fixtureCase());
        return !g.pass && g.forbidden.join() === '$contains:' ? true : `expected FAIL forbidden [$contains:], got pass=${g.pass} forbidden=[${g.forbidden.join(', ')}]`;
      },
    },
    {
      label: 'grader: a case-only difference → FAIL (tokens match case-sensitively)',
      run: () => (grade(GOOD.replace('$icontains', '$IContains'), fixtureCase()).pass ? 'a token differing only in case was graded present' : true),
    },
    {
      label: 'grader: an empty answer against a must_contain → FAIL',
      run: () => (grade('', fixtureCase()).pass ? 'an empty answer was graded PASS' : true),
    },
    {
      label: 'reader: a case asserting nothing → REFUSED, never graded',
      run: () => {
        const r = parseEvalFile('demo-skill', 'x.json', JSON.stringify({ evals: [{ id: 1, prompt: 'p', assertions: { must_contain: [], must_not_contain: [] } }] }));
        return r.cases.length === 0 && r.refusals.length === 1 ? true : `expected one refusal and no case, got ${r.cases.length} case(s), ${r.refusals.length} refusal(s)`;
      },
    },
    {
      label: 'reader: a non-string assertion token → REFUSED',
      run: () => {
        const r = parseEvalFile('demo-skill', 'x.json', JSON.stringify({ evals: [{ id: 1, prompt: 'p', assertions: { must_contain: [{ token: 'x' }] } }] }));
        return r.cases.length === 0 && r.refusals.length === 1 ? true : `expected one refusal and no case, got ${r.cases.length} case(s), ${r.refusals.length} refusal(s)`;
      },
    },
    {
      label: 'reader: the catalog under test loads cases with no refusal',
      run: () => {
        const cat = loadSkillEvalCatalog(deps.skillsRoot);
        if (cat.refusals.length) return `${cat.refusals.length} refusal(s), first: ${cat.refusals[0]!.path}: ${cat.refusals[0]!.message}`;
        return cat.cases.length > 0 ? true : `no case under ${deps.skillsRoot}: an empty catalog would run nothing and read as a clean round`;
      },
    },
    {
      label: 'arms: the with-skill project holds the bundle without its evals/',
      run: () => {
        const d = prepareArmWorkdir('with-skill', 'demo-skill', fixtureRoot, scratch);
        const skill = join(d.cwd, '.claude', 'skills', 'demo-skill');
        const ok = existsSync(join(skill, 'SKILL.md')) && existsSync(join(skill, 'rules', 'filters.md')) && !existsSync(join(skill, 'evals'));
        rmSync(d.root, { recursive: true, force: true });
        return ok ? true : 'the copied bundle lacks SKILL.md or rules/, or carries evals/';
      },
    },
    {
      label: 'arms: the no-skill project holds no skill',
      run: () => {
        const d = prepareArmWorkdir('no-skill', 'demo-skill', fixtureRoot, scratch);
        const ok = !existsSync(join(d.cwd, '.claude'));
        rmSync(d.root, { recursive: true, force: true });
        return ok ? true : 'the no-skill project has a .claude/ directory';
      },
    },
    {
      label: 'arms: argv loads project settings only, four tools, no MCP server',
      run: () => {
        const a = armArgs('/x/mcp.json', { maxTurns: 9 });
        const after = (f: string) => a[a.indexOf(f) + 1];
        const ok = a[0] === '-p' && after('--setting-sources') === 'project' && after('--tools') === 'Read,Glob,Grep,Skill' && after('--mcp-config') === '/x/mcp.json' && a.includes('--strict-mcp-config') && after('--max-turns') === '9' && !a.includes('--model');
        return ok ? true : `unexpected argv: ${a.join(' ')}`;
      },
    },
    {
      label: 'judge: a with-skill turn whose init lists no bundle → INVALID',
      run: () => {
        const r = judge(fixtureCase(), 'with-skill', stream({ skills: ['debug'], answer: GOOD }));
        return r.verdict === 'invalid' ? true : `got ${r.verdict}`;
      },
    },
    {
      label: 'judge: a no-skill turn whose init lists a bundle → INVALID',
      run: () => {
        const r = judge(fixtureCase(), 'no-skill', stream({ skills: ['other-skill'], answer: GOOD }));
        return r.verdict === 'invalid' ? true : `got ${r.verdict}`;
      },
    },
    {
      label: 'judge: a turn ending error_max_turns → ERROR, out of the denominator',
      run: () => {
        const r = judge(fixtureCase(), 'no-skill', stream({ skills: [], answer: GOOD, subtype: 'error_max_turns' }));
        return r.verdict === 'error' ? true : `got ${r.verdict}`;
      },
    },
    {
      label: 'judge: a no-skill turn launching a catalog bundle → INVALID',
      run: () => {
        const r = judge(fixtureCase(), 'no-skill', stream({ skills: [], invoked: 'quiet-skill', answer: GOOD }));
        return r.verdict === 'invalid' ? true : `got ${r.verdict}`;
      },
    },
    {
      label: 'judge: a with-skill turn on a bundle the init line never lists → graded, its evidence named',
      run: () => {
        const c = fixtureCase({ bundle: 'quiet-skill', key: 'quiet-skill/demo#1' });
        const launched = judge(c, 'with-skill', stream({ skills: ['debug'], invoked: 'quiet-skill', answer: GOOD }));
        const silent = judge(c, 'with-skill', stream({ skills: ['debug'], answer: 'no idea' }));
        return launched.verdict === 'pass' && launched.armEvidence === 'launched' && silent.verdict === 'fail' && silent.armEvidence === 'not-shown'
          ? true
          : `expected pass/launched then fail/not-shown, got ${launched.verdict}/${launched.armEvidence} then ${silent.verdict}/${silent.armEvidence}`;
      },
    },
    {
      label: 'reader: `user-invocable: false` frontmatter → a bundle the init line never lists',
      run: () =>
        notUserInvocable('---\nname: q\nuser-invocable: false\n---\nbody') && !notUserInvocable('---\nname: q\n---\nuser-invocable: false\n') && !notUserInvocable('---\nname: q\nuser-invocable: true\n---\n')
          ? true
          : 'the frontmatter reader misjudged `user-invocable`',
    },
    {
      label: 'judge: a graded with-skill turn → its answer judged by the grader',
      run: () => {
        const pass = judge(fixtureCase(), 'with-skill', stream({ skills: ['demo-skill'], invoked: 'demo-skill', answer: GOOD }));
        const fail = judge(fixtureCase(), 'with-skill', stream({ skills: ['demo-skill'], answer: 'no idea' }));
        return pass.verdict === 'pass' && pass.skillsInvoked.join() === 'demo-skill' && pass.armEvidence === 'init-line' && fail.verdict === 'fail'
          ? true
          : `expected pass (Skill launched) then fail, got ${pass.verdict} [${pass.skillsInvoked.join()}] then ${fail.verdict}`;
      },
    },
    {
      label: 'guard: ANTHROPIC_API_KEY set → the round refuses to start',
      run: () => {
        const loggedIn = () => ({ status: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' }), stderr: '' });
        try {
          preflight('claude', { ANTHROPIC_API_KEY: 'fixture' }, loggedIn);
        } catch (e) {
          return e instanceof ApiBillingRefusedError ? true : `refused with the wrong error: ${String(e)}`;
        }
        return 'the preflight accepted an environment carrying ANTHROPIC_API_KEY';
      },
    },
    {
      label: 'summary: no-skill ≥ with-skill is named; invalid turns stay out of the rate',
      run: () => {
        const c = fixtureCase();
        const rec = (arm: 'with-skill' | 'no-skill', verdict: SkillEvalRunRecord['verdict']) => ({ ...judge(c, arm, stream({ skills: arm === 'with-skill' ? ['demo-skill'] : [], answer: GOOD })), verdict });
        const s = summariseRound([c], [rec('with-skill', 'pass'), rec('with-skill', 'invalid'), rec('no-skill', 'pass')], []);
        const b = s.bundles[0]!;
        return b.withSkill.rate === 1 && b.withSkill.invalid === 1 && b.noSkillAtLeastWithSkill.join() === c.key ? true : `got with-skill rate ${b.withSkill.rate}, invalid ${b.withSkill.invalid}, flagged [${b.noSkillAtLeastWithSkill.join()}]`;
      },
    },
    {
      label: 'regrade: a case changed since the round → SET APART, never graded against the new text',
      run: () => {
        const c = fixtureCase();
        const was = judge(c, 'with-skill', stream({ skills: ['demo-skill'], answer: GOOD }));
        const reworded = fixtureCase({ mustContain: ['$startsWith'] });
        const out = regradeRecords([was], [c.key], [reworded], { bundles: ['demo-skill'], unlisted: [] }, grade);
        const same = regradeRecords([was], [c.key], [c], { bundles: ['demo-skill'], unlisted: [] }, grade);
        return out.records.length === 0 && out.cases.length === 0 && out.setApart.changed.join() === c.key && same.records.length === 1 && same.setApart.changed.length === 0
          ? true
          : `expected the reworded case set apart and the unchanged one regraded, got ${out.records.length} regraded / set apart [${out.setApart.changed.join()}], then ${same.records.length} regraded`;
      },
    },
    {
      label: 'reader: a trigger case reads with no assertions; one carrying assertions → REFUSED',
      run: () => {
        const r = parseEvalFile('demo-skill', 't.json', JSON.stringify({ evals: [{ id: 1, prompt: 'p', should_trigger: false, files: [] }, { id: 2, prompt: 'p', should_trigger: true, assertions: { must_contain: ['x'] } }, { id: 3, prompt: 'p', should_trigger: 'yes' }] }));
        return r.cases.length === 1 && r.cases[0]!.shouldTrigger === false && r.refusals.length === 2 ? true : `expected one trigger case and two refusals, got ${r.cases.length} case(s) [${r.cases.map((c) => String(c.shouldTrigger)).join()}], ${r.refusals.length} refusal(s)`;
      },
    },
    {
      label: 'reader: a `files` entry outside evals/files/ → REFUSED',
      run: () => {
        const bad = ['rules/x.md', 'evals/files/../SKILL.md', 'evals/files/', '/etc/passwd'].map((f) => parseEvalFile('demo-skill', 'f.json', JSON.stringify({ evals: [{ id: 1, prompt: 'p', files: [f], assertions: { must_contain: ['x'] } }] })));
        const good = parseEvalFile('demo-skill', 'f.json', JSON.stringify({ evals: [{ id: 1, prompt: 'p', files: ['evals/files/src/a.ts'], assertions: { must_contain: ['x'] } }] }));
        return bad.every((r) => r.cases.length === 0 && r.refusals.length === 1) && good.cases[0]?.files?.join() === 'evals/files/src/a.ts' ? true : `refused ${bad.filter((r) => r.refusals.length === 1).length} of 4 bad entries; the good one read as [${good.cases[0]?.files?.join() ?? 'refused'}]`;
      },
    },
    {
      label: 'reader: a bundle whose trigger cases are all positive → REFUSED',
      run: () => {
        writeFileSync(join(fixtureRoot, 'demo-skill', 'evals', 'triggers.json'), JSON.stringify({ evals: [{ id: 1, prompt: 'p', should_trigger: true }] }));
        const one = loadSkillEvalCatalog(fixtureRoot);
        writeFileSync(join(fixtureRoot, 'demo-skill', 'evals', 'triggers.json'), JSON.stringify({ evals: [{ id: 1, prompt: 'p', should_trigger: true }, { id: 2, prompt: 'q', should_trigger: false }] }));
        const both = loadSkillEvalCatalog(fixtureRoot);
        rmSync(join(fixtureRoot, 'demo-skill', 'evals', 'triggers.json'));
        return one.refusals.length === 1 && both.refusals.length === 0 && both.cases.length === 2 ? true : `expected an all-positive set refused and a mixed one read, got ${one.refusals.length} then ${both.refusals.length} refusal(s)`;
      },
    },
    {
      label: 'judge: a trigger case the turn loaded, by a Skill launch or a read → PASS; not loaded → FAIL',
      run: () => {
        const c = fixtureCase({ shouldTrigger: true, mustContain: [], mustNotContain: [] });
        const launched = judge(c, 'with-skill', stream({ skills: ['demo-skill'], invoked: 'demo-skill', answer: 'x' }));
        const read = judge(c, 'with-skill', stream({ skills: ['demo-skill'], read: '/tmp/t/project/.claude/skills/demo-skill/SKILL.md', answer: 'x' }));
        const otherRead = judge(c, 'with-skill', stream({ skills: ['demo-skill'], read: '/tmp/t/project/.claude/skills/demo-skill-two/SKILL.md', answer: 'x' }));
        const none = judge(c, 'with-skill', stream({ skills: ['demo-skill'], answer: GOOD }));
        return launched.verdict === 'pass' && launched.trigger?.loadedBy.join() === 'skill-tool' && read.verdict === 'pass' && read.trigger?.loadedBy.join() === 'read' && otherRead.verdict === 'fail' && none.verdict === 'fail'
          ? true
          : `expected pass/pass/fail/fail, got ${launched.verdict}/${read.verdict}/${otherRead.verdict}/${none.verdict}`;
      },
    },
    {
      label: 'judge: a should-not-trigger case the turn loaded → FAIL; left alone → PASS',
      run: () => {
        const c = fixtureCase({ shouldTrigger: false, mustContain: [], mustNotContain: [] });
        const loaded = judge(c, 'with-skill', stream({ skills: ['demo-skill'], invoked: 'demo-skill', answer: 'x', subtype: 'error_max_turns' }));
        const alone = judge(c, 'with-skill', stream({ skills: ['demo-skill'], answer: 'x' }));
        const cut = judge(c, 'with-skill', stream({ skills: ['demo-skill'], answer: 'x', subtype: 'error_max_turns' }));
        return loaded.verdict === 'fail' && alone.verdict === 'pass' && cut.verdict === 'error' ? true : `expected fail/pass/error, got ${loaded.verdict}/${alone.verdict}/${cut.verdict}`;
      },
    },
    {
      label: 'round: a trigger case runs on the with-skill arm only',
      run: () => {
        const jobs = planRound([fixtureCase(), fixtureCase({ id: 2, key: 'demo-skill/demo#2', shouldTrigger: true, mustContain: [] })], 1);
        const onNoSkill = judge(fixtureCase({ shouldTrigger: true, mustContain: [] }), 'no-skill', stream({ skills: [], answer: 'x' }));
        const arms = jobs.map((j) => `${String(j.case.id)}:${j.arm}`).join();
        return arms === '1:with-skill,1:no-skill,2:with-skill' && onNoSkill.verdict === 'invalid' ? true : `planned [${arms}]; a no-skill trigger turn read ${onNoSkill.verdict}`;
      },
    },
    {
      label: 'arms: a case\'s files land in the turn\'s project on both arms',
      run: () => {
        mkdirSync(join(fixtureRoot, 'demo-skill', 'evals', 'files', 'src'), { recursive: true });
        writeFileSync(join(fixtureRoot, 'demo-skill', 'evals', 'files', 'src', 'task.object.ts'), 'export {};\n');
        const ok = (['with-skill', 'no-skill'] as const).every((arm) => {
          const d = prepareArmWorkdir(arm, 'demo-skill', fixtureRoot);
          placeCaseFiles(['evals/files/src'], 'demo-skill', fixtureRoot, d.cwd);
          const placed = existsSync(join(d.cwd, 'src', 'task.object.ts')) && !existsSync(join(d.cwd, 'evals'));
          rmSync(d.root, { recursive: true, force: true });
          return placed;
        });
        rmSync(join(fixtureRoot, 'demo-skill', 'evals', 'files'), { recursive: true, force: true });
        return ok ? true : 'a case file did not land at its path below evals/files/ on both arms';
      },
    },
    {
      label: 'summary: trigger cases are tallied apart from the behaviour pass rates',
      run: () => {
        const b = fixtureCase();
        const pos = fixtureCase({ id: 2, key: 'demo-skill/demo#2', shouldTrigger: true, mustContain: [] });
        const neg = fixtureCase({ id: 3, key: 'demo-skill/demo#3', shouldTrigger: false, mustContain: [] });
        const s = summariseRound(
          [b, pos, neg],
          [judge(b, 'with-skill', stream({ skills: ['demo-skill'], answer: GOOD })), judge(pos, 'with-skill', stream({ skills: ['demo-skill'], answer: 'x' })), judge(neg, 'with-skill', stream({ skills: ['demo-skill'], invoked: 'demo-skill', answer: 'x' }))],
          [],
        );
        const t = s.triggers.bundles[0];
        return s.cases.length === 1 && s.totals.withSkill.pass === 1 && s.totals.withSkill.fail === 0 && t?.missedLoads.join() === pos.key && t.falseLoads.join() === neg.key && s.triggers.cases.length === 2
          ? true
          : `behaviour cases ${s.cases.length} (with-skill ${s.totals.withSkill.pass}/${s.totals.withSkill.fail}); missed [${t?.missedLoads.join() ?? ''}], false [${t?.falseLoads.join() ?? ''}]`;
      },
    },
  ];

  let failed = 0;
  const seen = new Map<string, number>();
  try {
    for (const row of rows) {
      seen.set(row.label, (seen.get(row.label) ?? 0) + 1);
      let verdict: true | string;
      try {
        verdict = row.run();
      } catch (e) {
        verdict = `threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (verdict === true) log(`  ✓ ${row.label}`);
      else {
        failed += 1;
        err(`  ✗ ${row.label}: ${verdict}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // The floor: every declared row ran, no undeclared row ran, the roster is its pinned size.
  const declared = Object.keys(SELF_TEST_BATTERIES) as Array<keyof typeof SELF_TEST_BATTERIES>;
  const floor = (m: string) => {
    failed += 1;
    err(`✗ self-test floor: ${m}`);
  };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  for (const [label, n] of seen) {
    if (!(label in SELF_TEST_BATTERIES)) floor(`row "${label}" ran but is not declared in SELF_TEST_BATTERIES`);
    if (n > 1) floor(`row label "${label}" is used ${n} times: two rows sharing a label are one battery`);
  }
  for (const label of declared) {
    if ((seen.get(label) ?? 0) < SELF_TEST_BATTERIES[label]) floor(`battery "${label}" DID NOT RUN`);
  }

  if (failed > 0) {
    err(`\n✗ skill-evals self-test: ${failed} failure(s) (rows and floor).`);
    return { failed, cases: rows.length };
  }
  log(`\n✓ skill-evals self-test: ${rows.length} rows pass.`);
  selfTestReachedVerdict = true;
  return { failed, cases: rows.length };
}
