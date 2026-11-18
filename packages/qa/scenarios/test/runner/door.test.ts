// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Door mode's arms (`door.ts`) and the live driver's door turn: the rules file
 * a maintainer supplies, read and judged before any card runs; the skills less
 * the omitted ones; and a door turn that holds the app's MCP draft door, the
 * arm's skills and rules, and no project file. Every rule text here is
 * invented for the test.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAskSkills } from '../../src/runner/ask-skills.js';
import { makeDriver, parseArgs } from '../../src/runner/cli.js';
import { doorArmText, DoorRulesRefusedError, omitSkills, readDoorRules, renderDoorRules } from '../../src/runner/door.js';
import { ClaudeCodeDriver, DOOR_DENIED_TOOLS, RecordedDriver, type AuthorTask, type DriverInfo } from '../../src/runner/driver.js';
import { renderSummaryTable, summaryTables, type SummaryRecord } from '../../src/runner/summary.js';
import type { ParsedTurn } from '../../src/runner/transcript.js';

const root = mkdtempSync(join(tmpdir(), 'scenario-door-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** An invented rules file: three rules, one set of two. */
const RULES = {
  rules: [
    { id: 'rule-a', text: 'Give every object a label in the language of the card.' },
    { id: 'rule-b', text: 'Save one item per call.' },
    { id: 'rule-c', text: 'Read a verdict before saving the next item.' },
  ],
  sets: { 'set-x': ['rule-a', 'rule-b'] },
};

/** Write `content` (an object as JSON, or raw text) to a new file and answer its path. */
function rulesFile(content: unknown = RULES, name = 'rules.json'): string {
  const dir = mkdtempSync(join(root, 'rules-'));
  const file = join(dir, name);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

/** A directory of two skills, `build-app` and `other`. */
function skillsDir(): string {
  const dir = mkdtempSync(join(root, 'skills-'));
  for (const name of ['build-app', 'other']) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: An invented skill.\n---\nStep one.\n`);
  }
  return dir;
}

describe('readDoorRules — the maintainer’s rules file, read once and judged before any card runs', () => {
  it('a valid file: every rule active, the record names the file, its sha256 and the ids, never a text', () => {
    const file = rulesFile();
    const { info, rules } = readDoorRules(file);
    expect(rules.map((r) => r.id)).toEqual(['rule-a', 'rule-b', 'rule-c']);
    expect(info).toEqual({ file: 'rules.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), active: ['rule-a', 'rule-b', 'rule-c'], omitted: [] });
    expect(JSON.stringify(info)).not.toContain('Save one item');
  });

  it('the selector omits rule ids and named sets, in file order, and the record states it', () => {
    const file = rulesFile();
    const bySet = readDoorRules(file, { omit: 'set-x' });
    expect(bySet.rules.map((r) => r.id)).toEqual(['rule-c']);
    expect(bySet.info).toMatchObject({ active: ['rule-c'], omitted: ['rule-a', 'rule-b'], omit: 'set-x' });
    const byId = readDoorRules(file, { omit: 'rule-c, rule-a' });
    expect(byId.info).toMatchObject({ active: ['rule-b'], omitted: ['rule-a', 'rule-c'] });
  });

  const refused = (file: string, why: RegExp, opts?: Parameters<typeof readDoorRules>[1]) => {
    let thrown: unknown;
    try {
      readDoorRules(file, opts);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DoorRulesRefusedError);
    expect((thrown as Error).message).toMatch(new RegExp(`^the door rules file \`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` is refused: `));
    expect((thrown as Error).message).toMatch(why);
  };

  it('⛔ a missing file, a directory, or a file that is no JSON is refused, naming the file', () => {
    refused(join(root, 'nowhere.json'), /no such file/);
    refused(mkdtempSync(join(root, 'dir-')), /no such file/);
    refused(rulesFile('{ "rules": [ '), /it is no JSON/);
  });

  it('⛔ a malformed file is refused, naming each path that is wrong', () => {
    refused(rulesFile({ ...RULES, extra: true }), /extra/);
    refused(rulesFile({ rules: [] }), /`rules`: the file holds no rule/);
    refused(rulesFile({ rules: [{ id: 'rule-a', text: '   ' }] }), /`rules\.0\.text`: a rule text is not empty/);
    refused(rulesFile({ rules: [{ id: 'rule a', text: 'x' }] }), /`rules\.0\.id`: a rule id is letters/);
    refused(rulesFile({ rules: [{ id: 'rule-a', text: 'x', weight: 2 }] }), /weight/);
    refused(rulesFile({ rules: [{ id: 'rule-a', text: 'x' }], sets: { s: [] } }), /`sets\.s`: a set names at least one rule/);
  });

  it('⛔ a duplicate id, a set naming no rule of the file, and a set named like a rule are refused', () => {
    refused(rulesFile({ rules: [RULES.rules[0], RULES.rules[0]] }), /the rule id `rule-a` appears twice/);
    refused(rulesFile({ rules: RULES.rules, sets: { s: ['rule-a', 'rule-z'] } }), /the set `s` names `rule-z`, which the file holds no rule of/);
    refused(rulesFile({ rules: RULES.rules, sets: { 'rule-a': ['rule-b'] } }), /the set `rule-a` is named like a rule/);
  });

  it('⛔ a selector naming nothing in the file, with an empty entry, or omitting every rule is refused', () => {
    const file = rulesFile();
    refused(file, /the selector names `rule-z`, which is neither a rule id nor a set of the file/, { omit: 'rule-a,rule-z' });
    refused(file, /has an empty entry/, { omit: 'rule-a,' });
    refused(file, /the selector omits every rule/, { omit: 'set-x,rule-c' });
  });

  it('⛔ a rules file inside this runner’s own checkout is refused: the file is the maintainer’s', () => {
    const checkout = mkdtempSync(join(root, 'checkout-'));
    mkdirSync(join(checkout, 'deep'));
    const inside = join(checkout, 'deep', 'rules.json');
    writeFileSync(inside, JSON.stringify(RULES));
    refused(inside, /inside this runner’s own checkout/, { repoRoot: checkout });
    expect(readDoorRules(rulesFile(), { repoRoot: checkout }).info.active).toHaveLength(3);
  });

  it('renderDoorRules: the client’s instruction file, each active rule under its id, texts verbatim', () => {
    expect(renderDoorRules(readDoorRules(rulesFile(), { omit: 'rule-b' }).rules)).toBe(
      '# Authoring rules\n\nFollow these rules for every metadata item you save as a draft.\n\n## rule-a\n\nGive every object a label in the language of the card.\n\n## rule-c\n\nRead a verdict before saving the next item.\n',
    );
  });
});

describe('omitSkills and the arm’s text', () => {
  it('leaves the named skills out of the bundle and names them; a name the bundle does not hold is refused', () => {
    const bundle = readAskSkills(skillsDir(), '--door-skills');
    const { bundle: less, omitted } = omitSkills(bundle, ['build-app']);
    expect(less.info.skills.map((s) => s.name)).toEqual(['other']);
    expect([...less.files.keys()]).toEqual(['other']);
    expect(omitted).toEqual(['build-app']);
    expect(() => omitSkills(bundle, ['nope'])).toThrow(/--door-skill-omit names `nope`, which .* holds no skill of \(it holds `build-app`, `other`\)/);
  });

  it('doorArmText states each arm; no arm at all reads as none and none', () => {
    expect(doorArmText(undefined)).toBe('skills: none · rules: none');
    const skills = readAskSkills(skillsDir()).info;
    const rules = readDoorRules(rulesFile(), { omit: 'set-x' }).info;
    expect(doorArmText({ skills: { dir: skills.dir, skills: skills.skills.slice(1) }, skillsOmitted: ['build-app'], rules })).toMatch(
      /^skills: other \(sha256 [0-9a-f]{12}\), less build-app · rules: rules\.json \(sha256 [0-9a-f]{12}\) 1 active, 2 omitted \(set-x\)$/,
    );
  });
});

/**
 * A stand-in `claude`: `--version` and `auth status` as a subscription login
 * answers them; a turn answers its argument list, every file its working
 * directory holds, and the MCP config file it was handed.
 */
const STAND_IN = `#!/usr/bin/env node
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.0 (stand-in)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' })); process.exit(0); }
const walk = (d, out) => { for (const e of readdirSync(d).sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, out); else out.push(relative(process.cwd(), p)); } return out; };
const cfg = args.indexOf('--mcp-config') >= 0 ? JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')) : null;
let prompt = '';
process.stdin.on('data', (d) => { prompt += d; });
process.stdin.on('end', () => {
  const text = JSON.stringify({ argv: args, files: walk(process.cwd(), []), cfg, prompt });
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'stand-in' }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 }));
});
`;

describe('the live driver’s door turn: the draft door, the arm, and no project', { timeout: 30_000 }, () => {
  const bin = join(root, 'claude');
  writeFileSync(bin, STAND_IN);
  chmodSync(bin, 0o755);
  const TOKEN = 'tok-invented-0001';
  const doorTask = (): AuthorTask => ({
    card: 'c',
    mode: 'door',
    phase: 'build',
    step: 'author',
    cwd: mkdtempSync(join(root, 'client-')),
    prompt: 'Build the app through the draft door.',
    tier: 'control',
    door: { mcp: { url: 'http://127.0.0.1:9/api/v1/mcp', token: TOKEN } },
  });
  const read = (t: ParsedTurn) => JSON.parse(t.replyText) as { argv: string[]; files: string[]; cfg: { mcpServers: Record<string, { url: string; headers: Record<string, string> }> }; prompt: string };
  const between = (argv: string[], flag: string) => {
    const from = argv.indexOf(flag) + 1;
    const to = argv.findIndex((a, i) => i >= from && a.startsWith('--'));
    return argv.slice(from, to === -1 ? undefined : to);
  };
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    vi.stubEnv('CLAUDE_CODE_EFFORT_LEVEL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('no arm: the turn may call `mcp__app` alone, every file and command tool is denied, its directory holds nothing, and it returns no files', async () => {
    const driver = new ClaudeCodeDriver({ bin });
    const result = await driver.author(doorTask());
    const seen = read(result.turn);
    expect(between(seen.argv, '--allowedTools')).toEqual(['mcp__app']);
    expect(between(seen.argv, '--disallowedTools')).toEqual([...DOOR_DENIED_TOOLS]);
    expect(seen.argv).toContain('--strict-mcp-config');
    expect(seen.files).toEqual([]);
    expect(result.files).toBeUndefined();
    expect(seen.prompt).toBe('Build the app through the draft door.');
    expect('door' in driver.info()).toBe(false);
  });

  it('⛔ the token reaches the client in its MCP config only: never on argv, never in its directory', async () => {
    const task = doorTask();
    const seen = read((await new ClaudeCodeDriver({ bin }).author(task)).turn);
    expect(seen.cfg.mcpServers.app).toEqual({ type: 'http', url: 'http://127.0.0.1:9/api/v1/mcp', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(seen.argv.join(' ')).not.toContain(TOKEN);
    expect(seen.argv[seen.argv.indexOf('--mcp-config') + 1]!.startsWith(task.cwd)).toBe(false);
    expect(seen.files).toEqual([]);
  });

  it('with the arm: the skills under `.claude/skills/` less the omitted one, the active rules as `CLAUDE.md`, `Skill` allowed, and the record states the arm', async () => {
    const dir = skillsDir();
    const rules = readDoorRules(rulesFile(), { omit: 'rule-b' });
    const driver = new ClaudeCodeDriver({ bin, doorSkillsDir: dir, doorSkillOmit: ['build-app'], doorRules: rules });
    const task = doorTask();
    const seen = read((await driver.author(task)).turn);
    expect(seen.files).toEqual(['.claude/skills/other/SKILL.md', 'CLAUDE.md']);
    expect(between(seen.argv, '--allowedTools')).toEqual(['mcp__app', 'Skill']);
    expect(seen.prompt).toBe('Build the app through the draft door.'); // the prompt is the same text in every arm
    const info = driver.info().door!;
    expect(info.skills!.skills.map((s) => s.name)).toEqual(['other']);
    expect(info.skillsOmitted).toEqual(['build-app']);
    expect(info.rules).toEqual(rules.info);
  });

  it('⛔ an omission without a skills directory, or naming a skill it does not hold, is refused when the driver is made', () => {
    expect(() => new ClaudeCodeDriver({ bin, doorSkillOmit: ['x'] })).toThrow(/--door-skill-omit leaves skills out of --door-skills, which is not given/);
    expect(() => new ClaudeCodeDriver({ bin, doorSkillsDir: skillsDir(), doorSkillOmit: ['x'] })).toThrow(/--door-skill-omit names `x`/);
  });

  it('a scratch authoring turn is untouched by the door arm: its own tools, no rules file, no door skill in the project', async () => {
    const cwd = mkdtempSync(join(root, 'project-'));
    const driver = new ClaudeCodeDriver({ bin, doorSkillsDir: skillsDir(), doorRules: readDoorRules(rulesFile()) });
    const { turn } = await driver.author({ card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd, prompt: 'Build it.', tier: 'control' });
    const seen = JSON.parse(turn.replyText) as { argv: string[]; files: string[] };
    expect(between(seen.argv, '--allowedTools')).toEqual(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill']);
    expect(seen.argv).not.toContain('--disallowedTools');
    expect(seen.files.filter((f) => f === 'CLAUDE.md' || f.startsWith('.claude/skills/'))).toEqual([]);
  });
});

describe('door mode on the command line', () => {
  it('parses each door flag; a door flag without door mode, or an omission without what it omits from, is refused', () => {
    const a = parseArgs(['--modes', 'door', '--door-skills', '/s', '--door-skill-omit', 'a, b', '--door-rules', '/r.json', '--door-rules-omit', 'set-x']);
    expect(a).toMatchObject({ modes: ['door'], doorSkills: '/s', doorSkillOmit: ['a', 'b'], doorRules: '/r.json', doorRulesOmit: 'set-x' });
    expect(() => parseArgs(['--door-rules', '/r.json'])).toThrow(/--door-rules sets door mode's arm, and --modes does not include door/);
    expect(() => parseArgs(['--modes', 'door', '--door-skill-omit', 'a'])).toThrow(/--door-skill-omit leaves skills out of --door-skills, which is not given/);
    expect(() => parseArgs(['--modes', 'door', '--door-rules', '--modes'])).toThrow(/--door-rules takes a rules file/);
  });

  it('⛔ Codex and an external command are given no door; a replay refuses every door flag as every live flag', () => {
    expect(() => makeDriver('codex', { doorRules: '/r.json' })).toThrow(/door mode is driven by the live `claude` driver/);
    expect(() => makeDriver('external:./agent.mjs', { doorSkills: '/s' })).toThrow(/door mode is driven by the live `claude` driver/);
    expect(() => makeDriver('recorded:/nowhere.json', { doorSkills: '/s' })).toThrow(/--door-skills applies to the live driver only/);
    expect(() => makeDriver('claude', { doorRulesOmit: 'set-x' })).toThrow(/--door-rules-omit leaves rules out of --door-rules/);
  });

  it('⛔ a malformed rules file refuses the run when the driver is made, before any card runs', () => {
    expect(() => makeDriver('claude', { doorRules: rulesFile('not json') })).toThrow(DoorRulesRefusedError);
    const checkout = mkdtempSync(join(root, 'checkout-'));
    const inside = join(checkout, 'rules.json');
    writeFileSync(inside, JSON.stringify(RULES));
    expect(() => makeDriver('claude', { doorRules: inside }, { repoRoot: checkout })).toThrow(/inside this runner’s own checkout/);
  });
});

describe('a replay and a summary state the door arm', () => {
  const arm = { rules: { file: 'rules.json', sha256: 'c'.repeat(64), active: ['rule-a'], omitted: ['rule-b'], omit: 'rule-b' } };
  const info: DriverInfo = { driver: 'claude-code-cli', version: '2.1.0', authMethod: 'oauth_token', apiBilled: false, door: arm };

  it('a replay of a door recording states the arm it was made in', () => {
    expect(new RecordedDriver({ driver: info, turns: {}, files: {} }).info().door).toEqual(arm);
    const { door: _dropped, ...without } = info;
    expect('door' in new RecordedDriver({ driver: without, turns: {}, files: {} }).info()).toBe(false);
  });

  const record = (file: string, door?: DriverInfo['door']): SummaryRecord =>
    ({
      file,
      record: { app: 'c', env: { driver: { driver: 'claude-code-cli', ...(door ? { door } : {}) } }, scorecard: { card: 'c', modes: [{ mode: 'door', first: {} }] } },
    }) as unknown as SummaryRecord;

  it('⛔ runs in two arms are never summed: the table is refused, naming both arms', () => {
    const [table] = summaryTables([record('with.json', arm), record('without.json')]);
    expect(table!.refused).toEqual([
      `the runs differ in door arm: \`door arm: skills: none · rules: rules.json (sha256 ${'c'.repeat(12)}) 1 active, 1 omitted (rule-b)\` (\`with.json\`) vs \`door arm: skills: none · rules: none\` (\`without.json\`)`,
    ]);
  });

  it('runs with no arm print no arm; runs in one arm print it', () => {
    const [none] = summaryTables([record('a.json'), record('b.json')]);
    expect(none!.refused).toEqual([]);
    expect(renderSummaryTable(none!)).not.toContain('door arm');
    const [one] = summaryTables([record('a.json', arm), record('b.json', arm)]);
    expect(renderSummaryTable(one!)).toContain(`door arm: skills: none · rules: rules.json (sha256 ${'c'.repeat(12)}) 1 active, 1 omitted (rule-b)`);
  });
});
