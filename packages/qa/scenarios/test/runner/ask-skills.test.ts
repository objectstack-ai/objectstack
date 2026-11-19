// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--ask-skills DIR`: the ask client's skills directory (`ask-skills.ts`).
 * Off by default, and then the ask turn's argument list, its directory and the
 * driver's record are exactly what they were; on, each turn's directory holds
 * the skills under `.claude/skills/`, the turn may use `Skill`, and the record
 * names each skill with its version and sha256.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askSkillsText, placeAskSkills, readAskSkills, skillVersionOf } from '../../src/runner/ask-skills.js';
import { makeDriver, parseArgs } from '../../src/runner/cli.js';
import { ClaudeCodeDriver, RecordedDriver, RecordingDriver, type AgentDriver, type AskTask, type AuthorTask, type DriverInfo } from '../../src/runner/driver.js';
import { renderSummaryTable, summaryTables, type SummaryRecord } from '../../src/runner/summary.js';
import type { ParsedTurn } from '../../src/runner/transcript.js';

/**
 * A case-insensitive filesystem (macOS, Windows), stood in for on any host:
 * while `on`, `existsSync` answers a path true when its directory holds the
 * name in any case, as such a filesystem does. Off, `node:fs` answers as ever.
 */
const caseInsensitive = vi.hoisted(() => ({ on: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const { basename, dirname } = await import('node:path');
  const anyCase = (p: string) => {
    if (fs.existsSync(p)) return true;
    const d = dirname(p);
    return fs.existsSync(d) && fs.statSync(d).isDirectory() && fs.readdirSync(d).some((n) => n.toLowerCase() === basename(p).toLowerCase());
  };
  return { ...fs, existsSync: (p: import('node:fs').PathLike) => (caseInsensitive.on ? anyCase(String(p)) : fs.existsSync(p)) };
});

const SKILL_MD = '---\nname: ask-data\ndescription: Answer business questions through the governed datasets.\nmetadata:\n  version: 1.2.0\n---\n\nCall list_datasets first.\n';

const root = mkdtempSync(join(tmpdir(), 'scenario-ask-skills-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A directory of skills: `ask-data` (with a reference file) and `fallback`. */
function skillsDir(skillMd = SKILL_MD): string {
  const dir = mkdtempSync(join(root, 'skills-'));
  mkdirSync(join(dir, 'ask-data', 'references'), { recursive: true });
  writeFileSync(join(dir, 'ask-data', 'SKILL.md'), skillMd);
  writeFileSync(join(dir, 'ask-data', 'references', 'rule.md'), 'One hit wins; two hits ask.\n');
  mkdirSync(join(dir, 'fallback'));
  writeFileSync(join(dir, 'fallback', 'SKILL.md'), '---\nname: fallback\nversion: "0.1"\n---\nLabel the fallback.\n');
  mkdirSync(join(dir, 'not-a-skill'));
  writeFileSync(join(dir, 'not-a-skill', 'notes.md'), 'no SKILL.md here');
  return dir;
}

describe('readAskSkills — the directory read once, as the record states it', () => {
  it('a directory of skills: each subdirectory holding SKILL.md, by name, with its declared version and the sha256 of its files', () => {
    const dir = skillsDir();
    const { info, files } = readAskSkills(dir);
    expect(info.dir).toBe(dir);
    expect(info.skills.map((s) => [s.name, s.version])).toEqual([
      ['ask-data', '1.2.0'],
      ['fallback', '0.1'],
    ]);
    expect(info.skills.every((s) => /^[0-9a-f]{64}$/.test(s.sha256))).toBe(true);
    expect([...files.get('ask-data')!.keys()]).toEqual(['SKILL.md', 'references/rule.md']);
    expect(askSkillsText(info)).toMatch(/^ask-data@1\.2\.0 \(sha256 [0-9a-f]{12}\), fallback@0\.1 \(sha256 [0-9a-f]{12}\)$/);
  });

  it('one skill directory is one skill named after it; the hash follows the bytes, so one changed word is another version', () => {
    const dir = skillsDir();
    const one = readAskSkills(join(dir, 'ask-data')).info.skills;
    expect(one.map((s) => s.name)).toEqual(['ask-data']);
    expect(one[0]!.sha256).toBe(readAskSkills(dir).info.skills[0]!.sha256);
    const edited = readAskSkills(skillsDir(SKILL_MD.replace('first', 'once'))).info.skills[0]!;
    expect(edited.sha256).not.toBe(one[0]!.sha256);
    expect(edited.version).toBe('1.2.0'); // the declared version did not move: the hash says it is other text
  });

  it('a path that is no directory, or holds no skill, is refused before any turn runs', () => {
    expect(() => readAskSkills(join(root, 'nowhere'))).toThrow(/which is no directory/);
    const empty = mkdtempSync(join(root, 'empty-'));
    mkdirSync(join(empty, 'docs'));
    expect(() => readAskSkills(empty)).toThrow(/holds no skill/);
  });

  it('the declared version: top level or under `metadata`; none without front matter', () => {
    expect(skillVersionOf('---\nversion: 2\n---\n')).toBe('2');
    expect(skillVersionOf(SKILL_MD)).toBe('1.2.0');
    expect(skillVersionOf('# no front matter\nversion: 9\n')).toBeUndefined();
    expect(skillVersionOf('---\nname: x\n---\n')).toBeUndefined();
  });

  it('⛔ a skill cannot widen the turn: a front-matter key outside the closed set is refused, naming the skill and the key', () => {
    for (const key of ['allowed-tools: Bash Read', 'model: opus', 'effort: max', 'hooks:\n  PreToolUse: []', 'context: fork', 'agent: general-purpose']) {
      const dir = skillsDir(SKILL_MD.replace('metadata:\n', `${key}\nmetadata:\n`));
      expect(() => readAskSkills(dir), key).toThrow(new RegExp(`skill \`ask-data\` is refused: its front matter declares \`${key.split(':')[0]}\``));
    }
  });

  it('⛔ a nested SKILL.md is held to the same set: the turn is given every file of the skill', () => {
    const dir = skillsDir();
    mkdirSync(join(dir, 'ask-data', 'inner'));
    writeFileSync(join(dir, 'ask-data', 'inner', 'SKILL.md'), '---\nname: inner\nallowed-tools: Bash\n---\n');
    expect(() => readAskSkills(dir)).toThrow(/skill `ask-data` is refused: its front matter declares `allowed-tools`/);
  });

  it('⛔ a front matter this reader cannot be sure of is refused, since an unsure read could hide a key', () => {
    const refused = (md: string) => () => readAskSkills(skillsDir(md));
    expect(refused('  ---\nallowed-tools: Bash\n---\n')).toThrow(/does not open on the first line/);
    expect(refused('\n---\nallowed-tools: Bash\n---\n')).toThrow(/does not open on the first line/);
    expect(refused('---\nname: x\nallowed-tools: Bash\n')).toThrow(/never closed/);
    expect(refused('---\n  name: x\n  allowed-tools: Bash\n---\n')).toThrow(/indented under no key/);
    expect(refused('---\n"allowed-tools": Bash\n---\n')).toThrow(/is no plain `key:` line/);
    expect(refused('---\n{ allowed-tools: Bash }\n---\n')).toThrow(/is no plain `key:` line/);
  });

  it('the keys that describe a skill or narrow who calls it are given, as is a SKILL.md with no front matter', () => {
    const md = '---\r\nname: ask-data\r\ndescription: >\r\n  Two lines\r\n  of description.\r\nlicense: Apache-2.0\r\ncompatibility: objectstack >= 5\r\n# a comment\r\nwhen_to_use: always\r\nargument-hint: none\r\nuser-invocable: false\r\ndisable-model-invocation: false\r\nversion: 3\r\nmetadata:\r\n  allowed-tools: nested keys are not the session’s\r\n---\r\nBody.\r\n';
    expect(readAskSkills(skillsDir(md)).info.skills.map((s) => [s.name, s.version])).toEqual([
      ['ask-data', '3'],
      ['fallback', '0.1'],
    ]);
    expect(readAskSkills(skillsDir('# No front matter\n\nallowed-tools: Bash is body text here.\n')).info.skills).toHaveLength(2);
  });

  it('placeAskSkills writes each skill where a project keeps its own: `.claude/skills/<name>/`', () => {
    const bundle = readAskSkills(skillsDir());
    const cwd = mkdtempSync(join(root, 'cwd-'));
    placeAskSkills(bundle, cwd);
    const listed = readAskSkills(join(cwd, '.claude', 'skills')).info.skills;
    expect(listed).toEqual(bundle.info.skills);
  });
});

describe('readAskSkills — a skill file is matched by its exact spelling, on every filesystem', () => {
  afterEach(() => {
    caseInsensitive.on = false;
  });
  const onBoth = (check: () => void) => {
    for (const on of [true, false]) {
      caseInsensitive.on = on;
      check();
    }
  };

  it('⛔ a skill directory whose file is spelled `skill.md` is refused, naming the file found and the spelling required', () => {
    const dir = mkdtempSync(join(root, 'lower-'));
    writeFileSync(join(dir, 'skill.md'), SKILL_MD);
    onBoth(() =>
      expect(() => readAskSkills(dir)).toThrow(
        `--ask-skills names \`${dir}\`, which holds \`skill.md\`: a skill file is spelled \`SKILL.md\` exactly, ` +
          'or a session reads it on one filesystem and misses it on another; rename it to `SKILL.md`',
      ),
    );
  });

  it('⛔ in a directory of skills, one spelled `Skill.md` is refused by its path, never skipped while the others load', () => {
    const dir = skillsDir();
    mkdirSync(join(dir, 'mixed'));
    writeFileSync(join(dir, 'mixed', 'Skill.md'), '---\nname: mixed\n---\n');
    onBoth(() => expect(() => readAskSkills(dir)).toThrow(`--ask-skills names \`${dir}\`, which holds \`mixed/Skill.md\`: a skill file is spelled \`SKILL.md\` exactly`));
  });

  it('a skill file spelled `SKILL.md` loads as before, on both filesystems', () => {
    const dir = skillsDir();
    onBoth(() => {
      expect(readAskSkills(dir).info.skills.map((s) => [s.name, s.version])).toEqual([
        ['ask-data', '1.2.0'],
        ['fallback', '0.1'],
      ]);
      expect(readAskSkills(join(dir, 'ask-data')).info.skills.map((s) => s.name)).toEqual(['ask-data']);
    });
  });
});

/**
 * A stand-in `claude`: `--version` and `auth status` as a subscription login
 * answers them; a turn answers its argument list and the skill files its
 * working directory holds under `.claude/skills/`.
 */
const STAND_IN = `#!/usr/bin/env node
const { readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.0 (stand-in)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' })); process.exit(0); }
const walk = (d, out) => { let ents = []; try { ents = readdirSync(d); } catch { return out; } for (const e of ents.sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, out); else out.push(relative(process.cwd(), p)); } return out; };
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  const text = JSON.stringify({ argv: args, files: walk(join(process.cwd(), '.claude'), []) });
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'stand-in' }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 }));
});
`;

describe('the live driver with and without `--ask-skills`', { timeout: 30_000 }, () => {
  const bin = join(root, 'claude');
  writeFileSync(bin, STAND_IN);
  chmodSync(bin, 0o755);
  const ask: AskTask = { card: 'c', mode: 'ask', phase: 'run', step: 'q', prompt: 'How much?', mcp: { url: 'http://127.0.0.1:9/api/v1/mcp', apiKey: 'k' } };
  const read = (t: ParsedTurn) => JSON.parse(t.replyText) as { argv: string[]; files: string[] };
  const allowed = (argv: string[]) => argv.slice(argv.indexOf('--allowedTools') + 1);
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    vi.stubEnv('CLAUDE_CODE_EFFORT_LEVEL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('off (the default): the ask turn allows `mcp__app` alone, its directory holds no skill, and the record carries no key for it', async () => {
    const driver = new ClaudeCodeDriver({ bin });
    const seen = read(await driver.ask(ask));
    expect(allowed(seen.argv)).toEqual(['mcp__app']);
    expect(seen.files).toEqual([]);
    expect('askSkills' in driver.info()).toBe(false);
    expect(Object.keys(driver.info())).toEqual(['driver', 'version', 'authMethod', 'apiBilled', 'authorTimeoutMs', 'authorMaxTurns', 'askMaxTurns']);
  });

  it('on: each ask turn’s directory holds the skills under `.claude/skills/`, the turn may use `Skill`, and the record names each skill, version and sha256', async () => {
    const dir = skillsDir();
    const driver = new ClaudeCodeDriver({ bin, askSkillsDir: dir });
    const seen = read(await driver.ask(ask));
    expect(allowed(seen.argv)).toEqual(['mcp__app', 'Skill']);
    expect(seen.files).toEqual(['.claude/skills/ask-data/SKILL.md', '.claude/skills/ask-data/references/rule.md', '.claude/skills/fallback/SKILL.md']);
    expect(driver.info().askSkills).toEqual(readAskSkills(dir).info);
  });

  it('the bytes read at the start are the bytes every turn gets: an edit during the run reaches no turn and does not move the record', async () => {
    const dir = skillsDir();
    const driver = new ClaudeCodeDriver({ bin, askSkillsDir: dir });
    const before = driver.info().askSkills;
    writeFileSync(join(dir, 'ask-data', 'SKILL.md'), 'rewritten mid-run');
    writeFileSync(join(dir, 'ask-data', 'extra.md'), 'added mid-run');
    const seen = read(await driver.ask(ask));
    expect(seen.files).not.toContain('.claude/skills/ask-data/extra.md');
    expect(driver.info().askSkills).toEqual(before);
  });

  it('⛔ a skill whose front matter would widen the turn is refused when the driver is made, before any turn runs', () => {
    const dir = skillsDir(SKILL_MD.replace('metadata:\n', 'allowed-tools: Bash\nmetadata:\n'));
    expect(() => new ClaudeCodeDriver({ bin, askSkillsDir: dir })).toThrow(/skill `ask-data` is refused: its front matter declares `allowed-tools`/);
  });

  it('an authoring turn is untouched by it: its own tools, and no skill written into the project', async () => {
    const cwd = mkdtempSync(join(root, 'project-'));
    const task: AuthorTask = { card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd, prompt: 'Build it.', tier: 'control' };
    const { turn } = await new ClaudeCodeDriver({ bin, askSkillsDir: skillsDir() }).author(task);
    expect(read(turn).files).toEqual([]);
    expect(allowed(read(turn).argv)).toEqual(['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill']);
  });
});

describe('`--ask-skills` on the command line', () => {
  it('parses to the directory; a missing or flag-shaped value is refused', () => {
    expect(parseArgs([]).askSkills).toBeUndefined();
    expect(parseArgs(['--ask-skills', 'skills/ask']).askSkills).toBe('skills/ask');
    expect(() => parseArgs(['--ask-skills'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--ask-skills', '--modes'])).toThrow(/takes a skills directory/);
  });

  it('the live `claude` driver only: Codex and an external command are refused, and a replay refuses it as every live flag', () => {
    expect(() => makeDriver('codex', { askSkills: 'x' })).toThrow(/--ask-skills applies to the live `claude` driver only/);
    expect(() => makeDriver('external:./agent.mjs', { askSkills: 'x' })).toThrow(/--ask-skills applies to the live `claude` driver only/);
    expect(() => makeDriver('recorded:/nowhere.json', { askSkills: 'x' })).toThrow(/--ask-skills applies to the live driver only/);
  });
});

describe('a replay states the skills its recording was made with', () => {
  const info: DriverInfo = { driver: 'claude-code-cli', version: '2.1.0', authMethod: 'oauth_token', apiBilled: false, askSkills: { dir: '/s', skills: [{ name: 'ask-data', sha256: 'a'.repeat(64), version: '1.2.0' }] } };
  it('the recording keeps the live driver’s `askSkills`, and the replay’s record states them; a recording without them states none', async () => {
    const live: AgentDriver = { info: () => info, author: async () => ({ turn: { replyText: '', toolCalls: [], meta: {} } }), ask: async () => ({ replyText: 'ok', toolCalls: [], meta: {} }) };
    const recording = new RecordingDriver(live).recording;
    expect(recording.driver.askSkills).toEqual(info.askSkills);
    expect(new RecordedDriver(recording).info().askSkills).toEqual(info.askSkills);
    const { askSkills: _dropped, ...without } = info;
    expect('askSkills' in new RecordedDriver({ driver: without, turns: {}, files: {} }).info()).toBe(false);
  });
});

describe('summary: runs given other skills are never summed with each other', () => {
  const record = (file: string, askSkills?: DriverInfo['askSkills']): SummaryRecord => ({
    file,
    record: {
      app: 'c',
      env: { driver: { driver: 'claude-code-cli', ...(askSkills ? { askSkills } : {}) } },
      scorecard: { card: 'c', modes: [{ mode: 'ask', first: {} }] },
    },
  } as unknown as SummaryRecord);
  const skills = { dir: '/s', skills: [{ name: 'ask-data', sha256: 'b'.repeat(64) }] };

  it('with and without the skills: the table is refused, naming both sides', () => {
    const [table] = summaryTables([record('with.json', skills), record('without.json')]);
    expect(table!.refused).toEqual([`the runs differ in ask skills: \`ask skills: ask-data (sha256 ${'b'.repeat(12)})\` (\`with.json\`) vs \`ask skills: none\` (\`without.json\`)`]);
  });

  it('runs without skills print the dimensions line they printed before; runs with them add the skills', () => {
    const [none] = summaryTables([record('a.json'), record('b.json')]);
    expect(renderSummaryTable(none!)).not.toContain('ask skills');
    const [some] = summaryTables([record('a.json', skills), record('b.json', skills)]);
    expect(renderSummaryTable(some!)).toContain(` · ask skills: ask-data (sha256 ${'b'.repeat(12)})`);
  });
});
