// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The skill-evals runner (`src/skill-evals/`): the login guard it imports,
 * the grader, the self-test's ability to fail, the arms' argv and working
 * directories, the rate-limit stop and the round summary. No model and no
 * network: a turn is an injected function or a stand-in `claude` script, and
 * every catalog is a fixture written here.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiBillingRefusedError } from '../../src/runner/driver.js';
import type { TurnProcessRun } from '../../src/runner/drivers/process.js';
import { ARM_TOOLS, armArgs, prepareArmWorkdir } from '../../src/skill-evals/arms.js';
import { hashCase, loadSkillEvalCatalog, notUserInvocable, parseEvalFile, selectBundles, type SkillEvalCase } from '../../src/skill-evals/cases.js';
import { main, parseSkillEvalArgs, regradeRound, ROUND_RECORD_SCHEMA } from '../../src/skill-evals/cli.js';
import { gradeAnswer } from '../../src/skill-evals/grade.js';
import { executeRound, judgeTurn, planRound, preflight, rateLimitStop, regradeRecord, regradeRecords, type SkillEvalRunRecord } from '../../src/skill-evals/run.js';
import { runSelfTest, SELF_TEST_BATTERIES, SELF_TEST_BATTERY_FLOOR, selfTestReached } from '../../src/skill-evals/self-test.js';
import { renderSummaryMarkdown, summariseRound } from '../../src/skill-evals/summary.js';

const scratch = mkdtempSync(join(tmpdir(), 'skill-evals-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A two-bundle catalog in the shape every `skills/BUNDLE/evals/*.json` uses. */
function writeCatalog(): string {
  const root = mkdtempSync(join(scratch, 'skills-'));
  const bundle = (name: string, evals: unknown[]) => {
    mkdirSync(join(root, name, 'evals'), { recursive: true });
    mkdirSync(join(root, name, 'rules'), { recursive: true });
    writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    writeFileSync(join(root, name, 'rules', 'a.md'), 'rule\n');
    writeFileSync(join(root, name, 'evals', 'cases.json'), JSON.stringify({ skill_name: name, evals }));
  };
  const ev = (id: number, mc: string[], mnc: string[] = []) => ({ id, prompt: `prompt ${id}`, expected_output: 'x', files: [], assertions: { must_contain: mc, must_not_contain: mnc } });
  bundle('alpha-skill', [ev(1, ['$icontains']), ev(2, ['orderBy'], ['joins:'])]);
  bundle('beta-skill', [ev(1, ['defineView'])]);
  mkdirSync(join(root, 'not-a-bundle')); // no SKILL.md: not a bundle
  return root;
}

const okLogin = JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' });
const fakeSpawn = (auth: string) => (_bin: string, args: string[]) =>
  args[0] === 'auth' ? { status: 0, stdout: auth, stderr: '' } : args[0] === '--version' ? { status: 0, stdout: '2.1.326 (Claude Code)\n', stderr: '' } : { status: 0, stdout: '', stderr: '' };

const stream = (o: { skills: string[]; answer?: string; subtype?: string; utilization?: number; status?: string }) =>
  [
    { type: 'system', subtype: 'init', model: 'm-1', skills: o.skills, mcp_servers: [] },
    ...(o.utilization !== undefined || o.status ? [{ type: 'rate_limit_event', rate_limit_info: { status: o.status ?? 'allowed', rateLimitType: 'seven_day', utilization: o.utilization ?? 0.1 } }] : []),
    ...(o.answer !== undefined ? [{ type: 'assistant', message: { content: [{ type: 'text', text: o.answer }] } }] : []),
    { type: 'result', subtype: o.subtype ?? 'success', is_error: false, num_turns: 1, result: o.answer ?? '', total_cost_usd: 0.25, duration_ms: 5, permission_denials: [] },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');
const exited = (stdout: string): TurnProcessRun => ({ stdout, process: { elapsedMs: 1, exit: 0, timedOut: false, timeoutMs: 1000 } });

describe('the login guard, imported from the scenario runner: a round refuses an API-billed configuration before any turn', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('refuses to start with ANTHROPIC_API_KEY set, though the CLI reports a subscription login', () => {
    expect(() => preflight('claude', { ANTHROPIC_API_KEY: 'sk-x' }, fakeSpawn(okLogin))).toThrow(ApiBillingRefusedError);
    expect(() => preflight('claude', { ANTHROPIC_API_KEY: 'sk-x' }, fakeSpawn(okLogin))).toThrow(/`ANTHROPIC_API_KEY` is set/);
  });

  it('refuses ANTHROPIC_AUTH_TOKEN, an API-key login and no login; answers the login method otherwise', () => {
    expect(() => preflight('claude', { ANTHROPIC_AUTH_TOKEN: 't' }, fakeSpawn(okLogin))).toThrow(ApiBillingRefusedError);
    expect(() => preflight('claude', {}, fakeSpawn(JSON.stringify({ loggedIn: true, authMethod: 'api_key' })))).toThrow(/API-key login/);
    expect(() => preflight('claude', {}, fakeSpawn('not json'))).toThrow(/no login/);
    expect(preflight('claude', {}, fakeSpawn(okLogin))).toEqual({ version: '2.1.326 (Claude Code)', authMethod: 'oauth_token' });
  });

  it('the command line refuses with the key set, and the stand-in `claude` is never asked a turn', async () => {
    const dir = mkdtempSync(join(scratch, 'bin-'));
    const bin = join(dir, 'claude');
    const marker = join(dir, 'turn-asked');
    writeFileSync(
      bin,
      `#!/usr/bin/env node\nconst a = process.argv.slice(2);\nif (a[0] === 'auth') console.log(${JSON.stringify(okLogin)});\nelse if (a[0] === '--version') console.log('2.1.326 (Claude Code)');\nelse require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`,
    );
    chmodSync(bin, 0o755);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-x');
    await expect(main(['--skills-from', 'workspace', '--bin', bin, '--out', join(dir, 'out')])).rejects.toThrow(ApiBillingRefusedError);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });
});

describe('the grader: every must_contain present, no must_not_contain, literal and case-sensitive', () => {
  const c = { mustContain: ["engine.find('account'", '$icontains'], mustNotContain: ['$contains:'] };
  it('passes a conforming answer', () => {
    expect(gradeAnswer("engine.find('account', { email: { $icontains: 'a' } })", c)).toEqual({ pass: true, missing: [], forbidden: [] });
  });
  it('fails on a missing token and on a forbidden one, naming each', () => {
    expect(gradeAnswer("engine.find('account', {})", c)).toEqual({ pass: false, missing: ['$icontains'], forbidden: [] });
    expect(gradeAnswer("engine.find('account', { $icontains: 1, $contains: 2 })", c)).toEqual({ pass: false, missing: [], forbidden: ['$contains:'] });
  });
  it('a case-only difference is not a match', () => {
    expect(gradeAnswer("engine.find('account', { $IContains: 1 })", c).pass).toBe(false);
  });
});

describe('--self-test can fail', () => {
  it('passes with the real grader and reaches its verdict', () => {
    const lines: string[] = [];
    const r = runSelfTest({ skillsRoot: writeCatalog(), log: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(r.failed).toBe(0);
    expect(selfTestReached()).toBe(true);
    expect(Object.keys(SELF_TEST_BATTERIES)).toHaveLength(SELF_TEST_BATTERY_FLOOR);
    expect(r.cases).toBe(SELF_TEST_BATTERY_FLOOR);
  });

  it('reds on a broken grader that passes every answer, and never reaches its verdict', () => {
    const errs: string[] = [];
    const r = runSelfTest({ skillsRoot: writeCatalog(), grade: () => ({ pass: true, missing: [], forbidden: [] }), log: () => {}, err: (l) => errs.push(l) });
    expect(r.failed).toBeGreaterThan(0);
    expect(selfTestReached()).toBe(false);
    expect(errs.join('\n')).toContain('grader: a must_contain token absent → FAIL, naming it');
  });

  it('reds on an empty catalog: a round over nothing is not a clean round', () => {
    const empty = mkdtempSync(join(scratch, 'empty-'));
    const errs: string[] = [];
    expect(runSelfTest({ skillsRoot: empty, log: () => {}, err: (l) => errs.push(l) }).failed).toBe(1);
    expect(errs.join('\n')).toContain('reader: the catalog under test loads cases with no refusal');
  });
});

describe('the reader', () => {
  it('reads every bundle with a SKILL.md, keys each case, and narrows by --skills', () => {
    const cat = loadSkillEvalCatalog(writeCatalog());
    expect(cat.bundles).toEqual(['alpha-skill', 'beta-skill']);
    expect(cat.refusals).toEqual([]);
    expect(cat.cases.map((c) => c.key)).toEqual(['alpha-skill/cases#1', 'alpha-skill/cases#2', 'beta-skill/cases#1']);
    expect(selectBundles(cat, ['beta-skill']).map((c) => c.key)).toEqual(['beta-skill/cases#1']);
    expect(() => selectBundles(cat, ['gamma-skill'])).toThrow(/`gamma-skill`, not a bundle/);
  });
  it('refuses a case asserting nothing, a non-string token and a repeated id, never grading them', () => {
    const r = parseEvalFile('b', 'f.json', JSON.stringify({ evals: [
      { id: 1, prompt: 'p', assertions: { must_contain: [], must_not_contain: [] } },
      { id: 2, prompt: 'p', assertions: { must_contain: [3] } },
      { id: 3, prompt: 'p', assertions: { must_contain: ['x'] } },
      { id: 3, prompt: 'p', assertions: { must_contain: ['y'] } },
    ] }));
    expect(r.cases.map((c) => c.id)).toEqual([3]);
    expect(r.refusals.map((x) => x.path)).toEqual(['b/evals/f.json: evals[0]', 'b/evals/f.json: evals[1]', 'b/evals/f.json: evals[3]']);
  });
});

describe('the arms: one fresh directory per turn, differing only in the bundle', () => {
  it('argv: project settings only, the four tools, no MCP server, no session kept; model and effort only when asked', () => {
    const a = armArgs('/r/mcp.json', { maxTurns: 7 });
    const after = (f: string) => a[a.indexOf(f) + 1];
    expect(a[0]).toBe('-p');
    expect(after('--setting-sources')).toBe('project');
    expect(after('--tools')).toBe(ARM_TOOLS.join(','));
    expect(after('--allowedTools')).toBe('Skill');
    expect(after('--mcp-config')).toBe('/r/mcp.json');
    expect(after('--max-turns')).toBe('7');
    expect(a).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json']));
    expect(a).not.toContain('--model');
    expect(a).not.toContain('--effort');
    expect(armArgs('/r/mcp.json', { maxTurns: 7, model: 'opus', effort: 'high' }).slice(-4)).toEqual(['--model', 'opus', '--effort', 'high']);
  });

  it('with-skill holds the bundle without evals/; no-skill holds nothing; the MCP config is empty and outside the project', () => {
    const root = writeCatalog();
    const w = prepareArmWorkdir('with-skill', 'alpha-skill', root, scratch);
    expect(readdirSync(join(w.cwd, '.claude', 'skills'))).toEqual(['alpha-skill']);
    expect(readdirSync(join(w.cwd, '.claude', 'skills', 'alpha-skill')).sort()).toEqual(['SKILL.md', 'rules']);
    expect(JSON.parse(readFileSync(w.mcpConfigPath, 'utf8'))).toEqual({ mcpServers: {} });
    expect(w.mcpConfigPath.startsWith(w.cwd)).toBe(false);
    const n = prepareArmWorkdir('no-skill', 'alpha-skill', root, scratch);
    expect(readdirSync(n.cwd)).toEqual([]);
  });

  it('a round hands each turn its arm\'s directory, the prompt on stdin and an environment with no API key or effort override; records land and directories go', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-should-not-reach');
    vi.stubEnv('CLAUDE_CODE_EFFORT_LEVEL', 'max');
    try {
      const root = writeCatalog();
      const cat = loadSkillEvalCatalog(root);
      const cases = selectBundles(cat, ['alpha-skill']);
      const seen: Array<{ args: readonly string[]; cwd: string; input: string; skills: string[]; envKey: boolean; envEffort: boolean }> = [];
      const out = mkdtempSync(join(scratch, 'out-'));
      const exec = await executeRound(planRound(cases, 1), {
        bin: 'claude', skillsRoot: root, catalog: { bundles: cat.bundles, unlisted: cat.unlistedBundles }, outDir: out, maxTurns: 5, caseTimeoutMs: 1000, concurrency: 1, maxUtilization: 0.9,
        runTurn: async (_bin, args, o) => {
          const skillsDir = join(o.cwd, '.claude', 'skills');
          const skills = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
          seen.push({ args, cwd: o.cwd, input: o.input, skills, envKey: o.env.ANTHROPIC_API_KEY !== undefined, envEffort: o.env.CLAUDE_CODE_EFFORT_LEVEL !== undefined });
          return exited(stream({ skills, answer: 'uses $icontains and orderBy' }));
        },
      });
      expect(seen.map((s) => [s.input, s.skills.join()])).toEqual([['prompt 1', 'alpha-skill'], ['prompt 1', ''], ['prompt 2', 'alpha-skill'], ['prompt 2', '']]);
      expect(seen.every((s) => !s.envKey && !s.envEffort)).toBe(true);
      expect(seen.every((s) => !existsSync(s.cwd))).toBe(true);
      expect(exec.records.map((r) => r.verdict)).toEqual(['pass', 'pass', 'pass', 'pass']);
      expect(readdirSync(join(out, 'runs')).sort()).toEqual([
        'alpha-skill__cases__1__no-skill__r1.json', 'alpha-skill__cases__1__with-skill__r1.json',
        'alpha-skill__cases__2__no-skill__r1.json', 'alpha-skill__cases__2__with-skill__r1.json',
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('stops scheduling turns once the rate-limit window reaches --max-utilization; the rest is not run, never failed', async () => {
    const root = writeCatalog();
    const cat = loadSkillEvalCatalog(root);
    const exec = await executeRound(planRound(cat.cases, 1), {
      bin: 'claude', skillsRoot: root, catalog: { bundles: cat.bundles, unlisted: cat.unlistedBundles }, outDir: mkdtempSync(join(scratch, 'out-')), maxTurns: 5, caseTimeoutMs: 1000, concurrency: 1, maxUtilization: 0.9,
      runTurn: async () => exited(stream({ skills: ['alpha-skill'], answer: '$icontains', utilization: 0.95 })),
    });
    expect(exec.records).toHaveLength(1);
    expect(exec.notRun).toHaveLength(5);
    expect(exec.stopped?.reason).toMatch(/utilization 0.95/);
    expect(rateLimitStop({ status: 'rejected' }, 0.9)).toMatch(/rejected/);
    expect(rateLimitStop({ status: 'allowed_warning', utilization: 0.5 }, 0.9)).toBeUndefined();
  });
});

describe('judging a turn and summarising a round', () => {
  const c: SkillEvalCase = { bundle: 'alpha-skill', file: 'cases.json', id: 1, key: 'alpha-skill/cases#1', prompt: 'p', mustContain: ['$icontains'], mustNotContain: ['joins:'] };
  const judge = (arm: 'with-skill' | 'no-skill', stdout: string, run?: Partial<TurnProcessRun['process']>) =>
    judgeTurn(c, arm, 1, { stdout, process: { elapsedMs: 1, exit: 0, timedOut: false, timeoutMs: 1, ...run } }, { bundles: ['alpha-skill', 'beta-skill'], unlisted: [] }, 't');

  it('pass / fail by the tokens; invalid when the arm is not the one meant; error when there is no answer', () => {
    expect(judge('with-skill', stream({ skills: ['alpha-skill'], answer: '$icontains' })).verdict).toBe('pass');
    expect(judge('with-skill', stream({ skills: ['alpha-skill'], answer: '$icontains joins:' }))).toMatchObject({ verdict: 'fail', forbidden: ['joins:'] });
    expect(judge('with-skill', stream({ skills: ['debug'], answer: '$icontains' })).verdict).toBe('invalid');
    expect(judge('no-skill', stream({ skills: ['beta-skill'], answer: '$icontains' })).verdict).toBe('invalid');
    expect(judge('no-skill', stream({ skills: [], answer: '$icontains', subtype: 'error_max_turns' })).verdict).toBe('error');
    expect(judge('no-skill', stream({ skills: [], answer: '$icontains' }), { exit: null, timedOut: true }).verdict).toBe('error');
  });

  it('per bundle: each arm\'s rate over measured turns only, the with-skill failures, the cases where no-skill ≥ with-skill', () => {
    const d: SkillEvalCase = { ...c, id: 2, key: 'alpha-skill/cases#2' };
    const rec = (k: SkillEvalCase, arm: 'with-skill' | 'no-skill', answer: string) => judgeTurn(k, arm, 1, exited(stream({ skills: arm === 'with-skill' ? ['alpha-skill'] : [], answer })), { bundles: ['alpha-skill'], unlisted: [] }, 't');
    const s = summariseRound(
      [c, d],
      [rec(c, 'with-skill', '$icontains'), rec(c, 'no-skill', 'nothing'), rec(d, 'with-skill', 'nothing'), rec(d, 'no-skill', '$icontains'), judge('with-skill', stream({ skills: ['debug'], answer: '$icontains' }))],
      [{ case: c, arm: 'no-skill' }],
    );
    const b = s.bundles[0]!;
    expect(b.withSkill).toMatchObject({ pass: 1, fail: 1, invalid: 1, rate: 0.5 });
    expect(b.noSkill).toMatchObject({ pass: 1, fail: 1, notRun: 1, rate: 0.5 });
    expect(b.withSkillFailures).toEqual(['alpha-skill/cases#2']);
    expect(b.noSkillAtLeastWithSkill).toEqual(['alpha-skill/cases#2']);
    expect(s.cases.find((x) => x.key === d.key)?.withSkillMissing).toEqual(['$icontains']);
    expect(s.reportedCostUsd).toBe(1.25);
    const md = renderSummaryMarkdown(s, { title: 'T', lines: [] }, { forGitHub: true });
    expect(md).toContain('| alpha-skill | 2 | 1/2 (50%) | 1/2 (50%) | 1 | 1 | 1 invalid / 1 not run |');
  });

  it('spells angle brackets out for GitHub and escapes a pipe in a token cell', () => {
    const s = summariseRound([{ ...c, mustContain: ['<ObjectChart', 'a|b'] }], [judgeTurn({ ...c, mustContain: ['<ObjectChart', 'a|b'] }, 'with-skill', 1, exited(stream({ skills: ['alpha-skill'], answer: 'x' })), { bundles: ['alpha-skill'], unlisted: [] }, 't')], []);
    const md = renderSummaryMarkdown(s, { title: 'T', lines: [] }, { forGitHub: true });
    expect(md).toContain('`(lt)ObjectChart` `a\\|b`');
    expect(md).not.toContain('<');
  });
});

describe('the command line flags', () => {
  it('defaults, and refusals of an unknown flag or a bad value', () => {
    expect(parseSkillEvalArgs([])).toMatchObject({ skillsFrom: 'workspace', repeats: 1, concurrency: 2, maxTurns: 16, caseTimeoutMin: 5, maxUtilization: 0.9, dryRun: false, selfTest: false });
    expect(parseSkillEvalArgs(['--skills', 'a, b', '--repeats', '3', '--dry-run'])).toMatchObject({ skills: ['a', 'b'], repeats: 3, dryRun: true });
    expect(() => parseSkillEvalArgs(['--repeats', '0'])).toThrow(/at least 1/);
    expect(() => parseSkillEvalArgs(['--max-utilization', '1.5'])).toThrow(/fraction/);
    expect(() => parseSkillEvalArgs(['--skils', 'a'])).toThrow(/unknown flag/);
    expect(() => parseSkillEvalArgs(['--out'])).toThrow(/needs a value/);
  });
});

describe('a bundle the init line never lists (`user-invocable: false`), and --regrade', () => {
  const quiet: SkillEvalCase = { bundle: 'quiet-skill', file: 'cases.json', id: 1, key: 'quiet-skill/cases#1', prompt: 'p', mustContain: ['$icontains'], mustNotContain: [] };
  const view = { bundles: ['quiet-skill', 'alpha-skill'], unlisted: ['quiet-skill'] };

  it('the reader names it from the SKILL.md frontmatter only', () => {
    expect(notUserInvocable('---\nname: q\nuser-invocable: false\n---\n')).toBe(true);
    expect(notUserInvocable('---\nname: q\n---\nuser-invocable: false\n')).toBe(false);
    const root = writeCatalog();
    writeFileSync(join(root, 'beta-skill', 'SKILL.md'), '---\nname: beta-skill\nuser-invocable: false\n---\n');
    expect(loadSkillEvalCatalog(root).unlistedBundles).toEqual(['beta-skill']);
  });

  it('a with-skill turn on it is graded, with its evidence; a no-skill turn launching a catalog bundle is invalid', () => {
    const r = judgeTurn(quiet, 'with-skill', 1, exited([stream({ skills: ['debug'] }).split('\n')[0], JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Skill', input: { skill: 'quiet-skill' } }] } }), ...stream({ skills: ['debug'], answer: '$icontains' }).split('\n').slice(1)].join('\n')), view, 't');
    expect(r).toMatchObject({ verdict: 'pass', armEvidence: 'launched', skillsInvoked: ['quiet-skill'] });
    expect(judgeTurn(quiet, 'with-skill', 1, exited(stream({ skills: ['debug'], answer: 'x' })), view, 't')).toMatchObject({ verdict: 'fail', armEvidence: 'not-shown' });
    expect(judgeTurn({ ...quiet, bundle: 'alpha-skill', key: 'alpha-skill/cases#1' }, 'with-skill', 1, exited(stream({ skills: ['debug'], answer: '$icontains' })), view, 't').verdict).toBe('invalid');
    const launchedInNoSkill = [stream({ skills: [] }).split('\n')[0], JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Skill', input: { skill: 'quiet-skill' } }] } }), ...stream({ skills: [], answer: '$icontains' }).split('\n').slice(1)].join('\n');
    expect(judgeTurn(quiet, 'no-skill', 1, exited(launchedInNoSkill), view, 't')).toMatchObject({ verdict: 'invalid', reason: 'the no-skill turn launched `quiet-skill`' });
  });

  it('--regrade re-draws a recorded verdict from the record alone and keeps what it was', () => {
    const was = judgeTurn(quiet, 'with-skill', 1, exited(stream({ skills: ['debug'], answer: '$icontains' })), { bundles: view.bundles, unlisted: [] }, 't');
    expect(was.verdict).toBe('invalid');
    const now = regradeRecord(was, quiet, view);
    expect(now).toMatchObject({ verdict: 'pass', armEvidence: 'not-shown', regradedFrom: 'invalid', answer: '$icontains' });
    expect(now.reason).toBeUndefined();
    // A second regrade keeps the verdict the turn was given, and drops it once the verdict is back to it.
    expect(regradeRecord(now, quiet, view)).toMatchObject({ verdict: 'pass', regradedFrom: 'invalid' });
    expect(regradeRecord(now, quiet, { bundles: view.bundles, unlisted: [] })).toMatchObject({ verdict: 'invalid' });
    expect(regradeRecord(now, quiet, { bundles: view.bundles, unlisted: [] }).regradedFrom).toBeUndefined();
  });
});

describe('--regrade grades an old answer only against the case that ran', () => {
  const c: SkillEvalCase = { bundle: 'alpha-skill', file: 'cases.json', id: 1, key: 'alpha-skill/cases#1', prompt: 'p', mustContain: ['$icontains'], mustNotContain: [] };
  const d: SkillEvalCase = { ...c, id: 2, key: 'alpha-skill/cases#2', mustContain: ['orderBy'] };
  const view = { bundles: ['alpha-skill'], unlisted: [] };
  const rec = (k: SkillEvalCase, answer: string) => judgeTurn(k, 'with-skill', 1, exited(stream({ skills: ['alpha-skill'], answer })), view, 't');

  it('every record carries the hash of its case as run: prompt and both token lists, not expected_output', () => {
    expect(rec(c, '$icontains').caseHash).toBe(hashCase(c));
    const withOutput: SkillEvalCase = { ...c, expectedOutput: 'other' };
    expect(hashCase(withOutput)).toBe(hashCase(c));
    expect(hashCase({ ...c, prompt: 'p2' })).not.toBe(hashCase(c));
    expect(hashCase({ ...c, mustNotContain: ['x'] })).not.toBe(hashCase(c));
  });

  it('an unchanged case regrades normally; a changed one is set apart, never regraded; a record with no hash is regraded and counted', () => {
    const reworded = { ...d, mustContain: ['sort:'] };
    const unhashed: SkillEvalRunRecord = { ...rec(c, 'nothing'), verdict: 'pass' };
    delete unhashed.caseHash;
    const out = regradeRecords([rec(d, 'orderBy'), unhashed], [c.key, d.key], [c, reworded], view);
    expect(out.setApart).toEqual({ changed: [d.key], removed: [] });
    expect(out.cases.map((x) => x.key)).toEqual([c.key]);
    expect(out.records.map((r) => [r.key, r.verdict, r.regradedFrom])).toEqual([[c.key, 'fail', 'pass']]);
    expect(out).toMatchObject({ changed: 1, unhashed: 1, added: [] });
    expect(() => regradeRecord(rec(d, 'orderBy'), reworded, view)).toThrow(/has changed since the turn ran/);
    // Unchanged on both sides: regraded, no flip, nothing set apart.
    const same = regradeRecords([rec(c, '$icontains'), rec(d, 'orderBy')], [c.key, d.key], [c, d], view);
    expect(same).toMatchObject({ changed: 0, unhashed: 0, setApart: { changed: [], removed: [] } });
    expect(same.records.map((r) => r.verdict)).toEqual(['pass', 'pass']);
  });

  it('a case removed since the round is set apart; one added since is left out, never counted as not run', () => {
    const e: SkillEvalCase = { ...c, id: 3, key: 'alpha-skill/cases#3' };
    const out = regradeRecords([rec(c, '$icontains'), rec(d, 'orderBy')], [c.key, d.key], [c, e], view);
    expect(out.setApart).toEqual({ changed: [], removed: [d.key] });
    expect(out.added).toEqual([e.key]);
    expect(out.cases.map((x) => x.key)).toEqual([c.key]);
  });

  it('the command: a reworded case keeps its record bytes and leaves the pass rates; the summary names it and the unhashed records', async () => {
    const root = writeCatalog();
    const cat = loadSkillEvalCatalog(root);
    const dir = mkdtempSync(join(scratch, 'round-'));
    const exec = await executeRound(planRound(cat.cases, 1), {
      bin: 'claude', skillsRoot: root, catalog: { bundles: cat.bundles, unlisted: cat.unlistedBundles }, outDir: dir, maxTurns: 5, caseTimeoutMs: 1000, concurrency: 1, maxUtilization: 0.9,
      runTurn: async (_bin, _args, o) => {
        const skillsDir = join(o.cwd, '.claude', 'skills');
        return exited(stream({ skills: existsSync(skillsDir) ? readdirSync(skillsDir) : [], answer: 'orderBy defineView' }));
      },
    });
    const summary = summariseRound(cat.cases, exec.records, []);
    writeFileSync(join(dir, 'round.json'), JSON.stringify({ schema: ROUND_RECORD_SCHEMA, round: 'r', runner: { repo: 'x', sha: 'y' }, startedAt: 't', finishedAt: 't', wallMs: 1, skills: { source: 'workspace skills/', bundles: cat.bundles, allBundles: true }, driver: { driver: 'claude-code-cli', version: 'v', authMethod: 'oauth_token', apiBilled: false, servedModels: [], maxTurns: 5, caseTimeoutMs: 1, concurrency: 1, maxUtilization: 0.9 }, scope: { cases: 3, arms: ['with-skill', 'no-skill'], repeats: 1, plannedTurns: 6, ranTurns: 6, notRunTurns: 0 }, summary }));
    // beta-skill's records predate case hashes; alpha-skill#2 is reworded after the round.
    for (const f of readdirSync(join(dir, 'runs')).filter((n) => n.startsWith('beta-skill'))) {
      const r = JSON.parse(readFileSync(join(dir, 'runs', f), 'utf8')) as SkillEvalRunRecord;
      delete r.caseHash;
      writeFileSync(join(dir, 'runs', f), JSON.stringify(r));
    }
    const evalsFile = join(root, 'alpha-skill', 'evals', 'cases.json');
    const doc = JSON.parse(readFileSync(evalsFile, 'utf8')) as { evals: Array<{ assertions: { must_contain: string[] } }> };
    doc.evals[1]!.assertions.must_contain = ['sort:'];
    writeFileSync(evalsFile, JSON.stringify(doc));
    const reworded = ['alpha-skill__cases__2__with-skill__r1.json', 'alpha-skill__cases__2__no-skill__r1.json'];
    const bytesBefore = reworded.map((f) => readFileSync(join(dir, 'runs', f), 'utf8'));

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(regradeRound(dir, loadSkillEvalCatalog(root), 'workspace skills/')).toBe(0);
    } finally {
      log.mockRestore();
    }
    const round = JSON.parse(readFileSync(join(dir, 'round.json'), 'utf8')) as { regraded: Record<string, unknown>; summary: { cases: Array<{ key: string }>; totals: { withSkill: { pass: number; fail: number } } } };
    expect(round.regraded).toMatchObject({ changed: 0, unhashed: 2, setApart: { changed: ['alpha-skill/cases#2'], removed: [] }, added: [] });
    expect(round.summary.cases.map((x) => x.key)).toEqual(['alpha-skill/cases#1', 'beta-skill/cases#1']);
    expect(round.summary.totals.withSkill).toMatchObject({ pass: 1, fail: 1 });
    expect(reworded.map((f) => readFileSync(join(dir, 'runs', f), 'utf8'))).toEqual(bytesBefore);
    const md = readFileSync(join(dir, 'summary.md'), 'utf8');
    expect(md).toContain('1 case(s) changed since the round, set apart: not regraded and out of every pass rate below: `alpha-skill/cases#2`');
    expect(md).toContain('2 record(s) carry no case hash');
    expect(md).not.toContain('| alpha-skill/cases#2 |');
  });
});
