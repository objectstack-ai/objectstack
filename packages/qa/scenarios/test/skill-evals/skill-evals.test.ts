// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The skill-evals runner (`src/skill-evals/`): the login guard it imports,
 * the grader, the self-test's ability to fail, the arms' argv and working
 * directories, the rate-limit stop and the round summary. No model and no
 * network: a turn is an injected function or a stand-in `claude` script, and
 * every catalog is a fixture written here.
 */

import { createHash } from 'node:crypto';
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
    const w = prepareArmWorkdir('with-skill', 'alpha-skill', root);
    const n = prepareArmWorkdir('no-skill', 'alpha-skill', root);
    try {
      expect(w.root.startsWith(join(tmpdir(), 'skill-eval-'))).toBe(true);
      expect(readdirSync(join(w.cwd, '.claude', 'skills'))).toEqual(['alpha-skill']);
      expect(readdirSync(join(w.cwd, '.claude', 'skills', 'alpha-skill')).sort()).toEqual(['SKILL.md', 'rules']);
      expect(JSON.parse(readFileSync(w.mcpConfigPath, 'utf8'))).toEqual({ mcpServers: {} });
      expect(w.mcpConfigPath.startsWith(w.cwd)).toBe(false);
      expect(readdirSync(n.cwd)).toEqual([]);
    } finally {
      rmSync(w.root, { recursive: true, force: true });
      rmSync(n.root, { recursive: true, force: true });
    }
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

describe('trigger cases: graded on whether the with-skill turn loaded the bundle, reported beside the behaviour cases', () => {
  const view = { bundles: ['alpha-skill', 'beta-skill'], unlisted: [] };
  const pos: SkillEvalCase = { bundle: 'alpha-skill', file: 'triggers.json', id: 1, key: 'alpha-skill/triggers#1', prompt: 'design an object', mustContain: [], mustNotContain: [], shouldTrigger: true };
  const neg: SkillEvalCase = { ...pos, id: 2, key: 'alpha-skill/triggers#2', prompt: 'a near miss', shouldTrigger: false };
  /** A stream whose turn launched `invoked` with the Skill tool and/or read `read`. */
  const turn = (o: { invoked?: string; read?: string; subtype?: string }) => {
    const [init, ...rest] = stream({ skills: ['alpha-skill'], answer: 'an answer', ...(o.subtype ? { subtype: o.subtype } : {}) }).split('\n');
    const calls = [
      ...(o.invoked ? [{ type: 'tool_use', id: 's', name: 'Skill', input: { skill: o.invoked } }] : []),
      ...(o.read ? [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: o.read } }] : []),
    ];
    return exited([init, ...(calls.length ? [JSON.stringify({ type: 'assistant', message: { content: calls } })] : []), ...rest].join('\n'));
  };
  const judgeT = (c: SkillEvalCase, run: TurnProcessRun, arm: 'with-skill' | 'no-skill' = 'with-skill') => judgeTurn(c, arm, 1, run, view, 't');

  it('the reader takes `should_trigger` in place of `assertions`, and refuses a trigger case carrying both or a non-boolean kind', () => {
    const r = parseEvalFile('alpha-skill', 'triggers.json', JSON.stringify({ evals: [
      { id: 1, prompt: 'p', should_trigger: true, files: [] },
      { id: 2, prompt: 'q', should_trigger: false },
      { id: 3, prompt: 'r', should_trigger: true, assertions: { must_contain: ['x'] } },
      { id: 4, prompt: 's', should_trigger: 1 },
    ] }));
    expect(r.cases.map((c) => [c.id, c.shouldTrigger, c.mustContain.length, c.mustNotContain.length])).toEqual([[1, true, 0, 0], [2, false, 0, 0]]);
    expect(r.refusals.map((x) => x.path)).toEqual(['alpha-skill/evals/triggers.json: evals[2]', 'alpha-skill/evals/triggers.json: evals[3]']);
    expect(r.refusals[0]!.message).toMatch(/graded on whether the skill was loaded/);
  });

  it('the catalog refuses a bundle whose trigger cases are all of one kind', () => {
    const root = writeCatalog();
    const write = (evals: unknown[]) => writeFileSync(join(root, 'alpha-skill', 'evals', 'triggers.json'), JSON.stringify({ evals }));
    write([{ id: 1, prompt: 'p', should_trigger: true }, { id: 2, prompt: 'q', should_trigger: true }]);
    expect(loadSkillEvalCatalog(root).refusals).toEqual([{ path: 'alpha-skill/evals', message: expect.stringMatching(/every trigger case is positive/) }]);
    write([{ id: 1, prompt: 'p', should_trigger: false }]);
    expect(loadSkillEvalCatalog(root).refusals[0]?.message).toMatch(/every trigger case is negative/);
    write([{ id: 1, prompt: 'p', should_trigger: true }, { id: 2, prompt: 'q', should_trigger: false }]);
    const cat = loadSkillEvalCatalog(root);
    expect(cat.refusals).toEqual([]);
    expect(cat.cases.filter((c) => c.shouldTrigger !== undefined).map((c) => c.key)).toEqual(['alpha-skill/triggers#1', 'alpha-skill/triggers#2']);
  });

  it('loaded = a Skill launch of the bundle or a Read under its .claude/skills/ directory; pass = loaded as should_trigger says', () => {
    expect(judgeT(pos, turn({ invoked: 'alpha-skill' }))).toMatchObject({ verdict: 'pass', trigger: { shouldTrigger: true, loadedBy: ['skill-tool'] }, missing: [], forbidden: [] });
    expect(judgeT(pos, turn({ read: '/tmp/skill-eval-x/project/.claude/skills/alpha-skill/rules/a.md' }))).toMatchObject({ verdict: 'pass', trigger: { loadedBy: ['read'] }, skillFilesRead: ['alpha-skill/rules/a.md'] });
    expect(judgeT(pos, turn({ invoked: 'alpha-skill', read: 'C:\\t\\project\\.claude\\skills\\alpha-skill\\SKILL.md' })).trigger?.loadedBy).toEqual(['skill-tool', 'read']);
    // Another skill launched, or a file of a same-prefix bundle read, is not this bundle loaded.
    expect(judgeT(pos, turn({ invoked: 'debug', read: '/t/project/.claude/skills/alpha-skill-two/SKILL.md' }))).toMatchObject({ verdict: 'fail', trigger: { loadedBy: [] } });
    expect(judgeT(neg, turn({}))).toMatchObject({ verdict: 'pass', trigger: { shouldTrigger: false, loadedBy: [] } });
    expect(judgeT(neg, turn({ invoked: 'alpha-skill' })).verdict).toBe('fail');
  });

  it('a loaded turn is judged however it ended; an unloaded one cut short is an error; the no-skill arm is invalid', () => {
    expect(judgeT(neg, turn({ invoked: 'alpha-skill', subtype: 'error_max_turns' })).verdict).toBe('fail');
    expect(judgeT(pos, turn({ read: '/t/project/.claude/skills/alpha-skill/SKILL.md', subtype: 'error_max_turns' })).verdict).toBe('pass');
    expect(judgeT(pos, turn({ subtype: 'error_max_turns' }))).toMatchObject({ verdict: 'error', reason: expect.stringMatching(/without loading the bundle/) });
    expect(judgeT(pos, exited(stream({ skills: [], answer: 'x' })), 'no-skill')).toMatchObject({ verdict: 'invalid', reason: 'a trigger case runs on the with-skill arm only' });
    expect(judgeT(pos, exited(stream({ skills: ['debug'], answer: 'x' }))).verdict).toBe('invalid');
  });

  it('a behaviour case hashes as before; a trigger case and a case with files hash their extra fields', () => {
    const b: SkillEvalCase = { bundle: 'alpha-skill', file: 'cases.json', id: 1, key: 'alpha-skill/cases#1', prompt: 'p', mustContain: ['x'], mustNotContain: [] };
    expect(hashCase(b)).toBe(`sha256:${createHash('sha256').update(JSON.stringify(['p', ['x'], []])).digest('hex')}`);
    expect(hashCase({ ...b, files: [] })).toBe(hashCase(b));
    expect(hashCase({ ...b, files: ['evals/files/a.ts'] })).not.toBe(hashCase(b));
    expect(hashCase(pos)).not.toBe(hashCase(neg));
    expect(hashCase(pos)).not.toBe(hashCase({ ...neg, prompt: pos.prompt }));
  });

  it('a round runs a trigger case on the with-skill arm only; the summary tallies it apart from the behaviour rates', async () => {
    const root = writeCatalog();
    writeFileSync(join(root, 'alpha-skill', 'evals', 'triggers.json'), JSON.stringify({ evals: [{ id: 1, prompt: 'load me', should_trigger: true }, { id: 2, prompt: 'leave me', should_trigger: false }] }));
    const cat = loadSkillEvalCatalog(root);
    const cases = selectBundles(cat, ['alpha-skill']);
    const seen: string[] = [];
    const exec = await executeRound(planRound(cases, 1), {
      bin: 'claude', skillsRoot: root, catalog: { bundles: cat.bundles, unlisted: cat.unlistedBundles }, outDir: mkdtempSync(join(scratch, 'out-')), maxTurns: 5, caseTimeoutMs: 1000, concurrency: 1, maxUtilization: 0.9,
      runTurn: async (_bin, _args, o) => {
        const skillsDir = join(o.cwd, '.claude', 'skills');
        const skills = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
        seen.push(`${o.input}|${skills.join()}`);
        // The model launches the skill on every prompt: right for `load me`, a false load for `leave me`.
        const [init, ...rest] = stream({ skills, answer: '$icontains orderBy' }).split('\n');
        const launch = skills.length ? [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'alpha-skill' } }] } })] : [];
        return exited([init, ...launch, ...rest].join('\n'));
      },
    });
    expect(seen).toEqual(['prompt 1|alpha-skill', 'prompt 1|', 'prompt 2|alpha-skill', 'prompt 2|', 'load me|alpha-skill', 'leave me|alpha-skill']);
    const s = summariseRound(cases, exec.records, exec.notRun);
    expect(s.cases.map((c) => c.key)).toEqual(['alpha-skill/cases#1', 'alpha-skill/cases#2']);
    expect(s.totals.withSkill).toMatchObject({ pass: 2, fail: 0 });
    expect(s.triggers.bundles).toEqual([expect.objectContaining({ bundle: 'alpha-skill', cases: 2, missedLoads: [], falseLoads: ['alpha-skill/triggers#2'] })]);
    expect(s.triggers.totals.shouldTrigger).toMatchObject({ pass: 1, fail: 0, rate: 1 });
    expect(s.triggers.totals.shouldNotTrigger).toMatchObject({ pass: 0, fail: 1, rate: 0 });
    expect(s.triggers.cases.map((t) => [t.key, t.loadedBySkillTool, t.loadedByReadOnly])).toEqual([['alpha-skill/triggers#1', 1, 0], ['alpha-skill/triggers#2', 1, 0]]);
    const md = renderSummaryMarkdown(s, { title: 'T', lines: [] });
    expect(md).toContain('## Trigger cases');
    expect(md).toContain('| alpha-skill | 2 | 1/1 (100%) | 0/1 (0%) | 0 | 1 | 0 |');
    expect(md).toContain('| alpha-skill/triggers#2 | no | 0/1 (0%) | 1 / 0 |');
    // A round with no trigger case renders no trigger section.
    expect(renderSummaryMarkdown(summariseRound([], [], []), { title: 'T', lines: [] })).not.toContain('## Trigger cases');
  });

  it('--regrade keeps a recorded trigger case planned and regrades it from its record', async () => {
    const root = writeCatalog();
    writeFileSync(join(root, 'beta-skill', 'evals', 'triggers.json'), JSON.stringify({ evals: [{ id: 1, prompt: 'load me', should_trigger: true }, { id: 2, prompt: 'leave me', should_trigger: false }] }));
    const cat = loadSkillEvalCatalog(root);
    const dir = mkdtempSync(join(scratch, 'round-'));
    const exec = await executeRound(planRound(cat.cases, 1), {
      bin: 'claude', skillsRoot: root, catalog: { bundles: cat.bundles, unlisted: cat.unlistedBundles }, outDir: dir, maxTurns: 5, caseTimeoutMs: 1000, concurrency: 1, maxUtilization: 0.9,
      runTurn: async (_bin, _args, o) => {
        const skillsDir = join(o.cwd, '.claude', 'skills');
        return exited(stream({ skills: existsSync(skillsDir) ? readdirSync(skillsDir) : [], answer: 'orderBy defineView $icontains' }));
      },
    });
    const summary = summariseRound(cat.cases, exec.records, []);
    writeFileSync(join(dir, 'round.json'), JSON.stringify({ schema: ROUND_RECORD_SCHEMA, round: 'r', runner: { repo: 'x', sha: 'y' }, startedAt: 't', finishedAt: 't', wallMs: 1, skills: { source: 'workspace skills/', bundles: cat.bundles, allBundles: true }, driver: { driver: 'claude-code-cli', version: 'v', authMethod: 'oauth_token', apiBilled: false, servedModels: [], maxTurns: 5, caseTimeoutMs: 1, concurrency: 1, maxUtilization: 0.9 }, scope: { cases: 5, arms: ['with-skill', 'no-skill'], repeats: 1, plannedTurns: 8, ranTurns: 8, notRunTurns: 0 }, summary }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(regradeRound(dir, loadSkillEvalCatalog(root), 'workspace skills/')).toBe(0);
    } finally {
      log.mockRestore();
    }
    const round = JSON.parse(readFileSync(join(dir, 'round.json'), 'utf8')) as { regraded: { added: string[] }; summary: { triggers: { cases: Array<{ key: string; tally: { pass: number; fail: number } }> } } };
    expect(round.regraded.added).toEqual([]);
    expect(round.summary.triggers.cases.map((t) => [t.key, t.tally.pass, t.tally.fail])).toEqual([['beta-skill/triggers#1', 0, 1], ['beta-skill/triggers#2', 1, 0]]);
  });
});

describe('`files`: what a case needs on disk, placed in the turn\'s project on both arms', () => {
  it('the reader takes paths under evals/files/ only', () => {
    const read = (files: unknown) => parseEvalFile('alpha-skill', 'f.json', JSON.stringify({ evals: [{ id: 1, prompt: 'p', files, assertions: { must_contain: ['x'] } }] }));
    expect(read(['evals/files/src/objects/task.object.ts', 'evals/files/crm']).cases[0]?.files).toEqual(['evals/files/src/objects/task.object.ts', 'evals/files/crm']);
    expect(read([]).cases[0]?.files).toBeUndefined();
    for (const bad of [['src/a.ts'], ['evals/files/'], ['evals/files/../SKILL.md'], ['evals/files/./a.ts'], ['evals\\files\\a.ts'], ['/evals/files/a.ts'], 'evals/files/a.ts', [1]]) {
      expect(read(bad).cases, JSON.stringify(bad)).toEqual([]);
    }
  });

  it('the reader refuses a path that would land under the project\'s .claude/, where only the runner puts a skill', () => {
    const read = (files: string[]) => parseEvalFile('alpha-skill', 'f.json', JSON.stringify({ evals: [{ id: 1, prompt: 'p', files, assertions: { must_contain: ['x'] } }] }));
    for (const bad of ['evals/files/.claude/skills/alpha-skill/SKILL.md', 'evals/files/.claude', 'evals/files/.claude/settings.json', 'evals/files/.CLAUDE/skills/x/SKILL.md', 'evals/files/app/.claude/skills/x/SKILL.md']) {
      const r = read([bad]);
      expect(r.cases, bad).toEqual([]);
      expect(r.refusals, bad).toEqual([{ path: 'alpha-skill/evals/f.json: evals[0]', message: expect.stringContaining('`.claude/`') }]);
    }
    for (const good of ['evals/files/.claude-notes.md', 'evals/files/claude/a.md', 'evals/files/.mcp.json']) {
      expect(read([good]).cases[0]?.files, good).toEqual([good]);
    }
  });

  it('the catalog refuses a case naming a file the bundle lacks; a round places each file below evals/files/ in both arms\' projects', async () => {
    const root = writeCatalog();
    const evalsFile = join(root, 'alpha-skill', 'evals', 'cases.json');
    const doc = JSON.parse(readFileSync(evalsFile, 'utf8')) as { evals: Array<{ files: string[] }> };
    doc.evals[0]!.files = ['evals/files/src/objects/task.object.ts', 'evals/files/docs'];
    writeFileSync(evalsFile, JSON.stringify(doc));
    expect(loadSkillEvalCatalog(root).refusals).toEqual([{ path: 'alpha-skill/evals/cases.json: alpha-skill/cases#1', message: expect.stringMatching(/`evals\/files\/src\/objects\/task.object.ts`, which is not in the bundle/) }]);
    mkdirSync(join(root, 'alpha-skill', 'evals', 'files', 'src', 'objects'), { recursive: true });
    mkdirSync(join(root, 'alpha-skill', 'evals', 'files', 'docs'), { recursive: true });
    writeFileSync(join(root, 'alpha-skill', 'evals', 'files', 'src', 'objects', 'task.object.ts'), 'export const task = 1;\n');
    writeFileSync(join(root, 'alpha-skill', 'evals', 'files', 'docs', 'guide.md'), '# guide\n');
    const cat = loadSkillEvalCatalog(root);
    expect(cat.refusals).toEqual([]);
    const placed: string[][] = [];
    await executeRound(planRound(selectBundles(cat, ['alpha-skill']).slice(0, 1), 1), {
      bin: 'claude', skillsRoot: root, catalog: { bundles: cat.bundles, unlisted: cat.unlistedBundles }, outDir: mkdtempSync(join(scratch, 'out-')), maxTurns: 5, caseTimeoutMs: 1000, concurrency: 1, maxUtilization: 0.9,
      runTurn: async (_bin, _args, o) => {
        placed.push([
          readFileSync(join(o.cwd, 'src', 'objects', 'task.object.ts'), 'utf8'),
          readFileSync(join(o.cwd, 'docs', 'guide.md'), 'utf8'),
          String(existsSync(join(o.cwd, 'evals'))),
          String(existsSync(join(o.cwd, '.claude'))),
        ]);
        return exited(stream({ skills: existsSync(join(o.cwd, '.claude')) ? ['alpha-skill'] : [], answer: '$icontains' }));
      },
    });
    expect(placed).toEqual([
      ['export const task = 1;\n', '# guide\n', 'false', 'true'],
      ['export const task = 1;\n', '# guide\n', 'false', 'false'],
    ]);
  });
});
