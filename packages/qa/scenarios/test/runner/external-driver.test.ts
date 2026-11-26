// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--driver external:COMMAND` against a stand-in command
 * (`fixtures/fake-external-driver.mjs`): the stdin/stdout contract, a call
 * that does not answer as a failed turn with a named reason, and — end to end
 * over the real crm card, through the run record, the recording, the
 * scorecard and the gallery export — the persona's key reaching the command
 * in a 0600 file only, and no written artifact carrying it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportGallery } from '../../src/export/exporter.js';
import { makeDriver, parseArgs } from '../../src/runner/cli.js';
import { RecordedDriver, stepKey, type AgentDriver, type AskTask, type AuthorResult, type AuthorTask, type DriverInfo } from '../../src/runner/driver.js';
import { EXTERNAL_DRIVER_CONTRACT, EXTERNAL_DRIVER_CONTRACT_V2, ExternalDriver, parseExternalCommand } from '../../src/runner/drivers/external.js';
import { authorNotMeasured } from '../../src/runner/orchestrate.js';
import { cardScorecard, renderScorecard } from '../../src/runner/scorecard.js';
import type { ParsedTurn } from '../../src/runner/transcript.js';
import { runCrm, tempDir, writeRecord } from '../export/fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = resolve(HERE, 'fixtures/fake-external-driver.mjs');
const COMMAND = `${process.execPath} ${FAKE}`;

/** A key no other text in a run could hold by chance. */
const KEY = 'sk-scenario-e2e-key-9f27c1d4';
/** The stand-in's fingerprint of the key it read (FNV-1a, 32-bit, hex): enough to tell this run's keys apart without logging one. */
const keyPrint = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

const author = (prompt: string, cwd = tempDir('ext-project')): AuthorTask => ({ card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd, prompt, tier: 'starter' });
const ask = (prompt: string): AskTask => ({ card: 'c', mode: 'scratch', phase: 'run', step: 'q1', persona: 'sdr', prompt, mcp: { url: 'http://127.0.0.1:9/api/v1/mcp', apiKey: KEY } });

/** The call an `ECHO` turn read on stdin, its argv, its working directory and what it saw of the key. */
const echoed = (t: ParsedTurn) =>
  JSON.parse(t.replyText) as { input: Record<string, unknown>; argv: string[]; cwd: string; seen?: Record<string, unknown> };

afterEach(() => vi.unstubAllEnvs());

describe('the external driver contract — one process per call, JSON in on stdin, JSON out on stdout', () => {
  it('starts with an `info` call that names the command and its version in every record', () => {
    const d = new ExternalDriver({ command: COMMAND });
    expect(d.info()).toMatchObject({ driver: 'external:fake-agent', version: '1.2.3', apiBilled: false, authMethod: expect.stringMatching(/^not verified/) });
  });

  it('refuses a command that cannot answer `info`, before any card runs', () => {
    vi.stubEnv('FAKE_DRIVER_INFO', 'crash');
    expect(() => new ExternalDriver({ command: COMMAND })).toThrow(/did not answer the `info` call \(exit 4\); stderr: fake: no info for you/);
    vi.stubEnv('FAKE_DRIVER_INFO', 'garbage');
    expect(() => new ExternalDriver({ command: COMMAND })).toThrow(/did not answer the `info` call \(stdout is not one JSON object\)/);
    expect(() => new ExternalDriver({ command: '/nowhere/agent' })).toThrow(/did not answer the `info` call \(spawnSync \/nowhere\/agent ENOENT\)/);
  });

  it('an author call: the task on stdin, run in the project directory, the answer read into the turn', async () => {
    const cwd = tempDir('ext-project');
    writeFileSync(join(cwd, 'objectstack.config.ts'), 'export default {};\n');
    const { turn, files } = await new ExternalDriver({ command: COMMAND }).author(author('ECHO build it', cwd));
    const e = echoed(turn);
    expect(e.input).toEqual({
      contract: EXTERNAL_DRIVER_CONTRACT_V2,
      kind: 'author',
      step: { card: 'c', mode: 'scratch', phase: 'build', step: 'author' },
      prompt: 'ECHO build it',
      cwd,
      tier: 'starter',
      limits: { timeoutMs: 60 * 60_000 },
    });
    expect(e.cwd).toBe(cwd);
    expect(turn.toolCalls).toEqual([
      { name: 'query_records', rawName: 'mcp__app__query_records', input: { objectName: 'x' }, output: '{"records":[]}' },
      { name: 'update_record', rawName: 'update_record', input: { objectName: 'x' }, output: '{"error":{"code":"PERMISSION_DENIED"}}', isError: true },
    ]);
    expect(turn.meta).toMatchObject({ resultSubtype: 'success', isError: false, model: 'fake-model-1', numTurns: 2, process: { exit: 0, timedOut: false } });
    expect(authorNotMeasured(turn)).toBeUndefined();
    expect(files).toEqual({ 'objectstack.config.ts': 'export default {};\n' });
  });

  it('an ask call: the key in a 0600 file named on stdin, never on argv, in the environment or on stdin; the file gone after', async () => {
    const turn = await new ExternalDriver({ command: COMMAND }).ask(ask('ECHO how many accounts?'));
    const { input, argv, seen } = echoed(turn);
    expect(input).toMatchObject({ contract: EXTERNAL_DRIVER_CONTRACT_V2, kind: 'ask', step: { card: 'c', mode: 'scratch', phase: 'run', step: 'q1', persona: 'sdr' }, prompt: 'ECHO how many accounts?', limits: { timeoutMs: 5 * 60_000 } });
    expect(Object.keys(input.mcp as object).sort()).toEqual(['configFile', 'url']);
    expect(seen).toMatchObject({ fileMode: '600', urlMatches: true, runsInConfigDir: true, keyPrint: keyPrint(KEY), keyOnArgv: false, keyInEnv: false, keyOnStdin: false });
    expect(argv.join(' ')).not.toContain(KEY);
    expect(existsSync(seen!.configFile as string)).toBe(false);
    expect(existsSync(dirname(seen!.configFile as string))).toBe(false);
  });

  it('a non-zero exit, prose on stdout, JSON of another shape, or the runner’s timeout: a failed turn with a named reason, never an empty pass', async () => {
    const d = new ExternalDriver({ command: COMMAND, authorTimeoutMs: 1500 });
    const crashed = (await d.author(author('CRASH'))).turn;
    expect([crashed.meta.resultSubtype, crashed.replyText, crashed.toolCalls]).toEqual(['no-result(exit 3)', '', []]);
    expect(crashed.meta.process).toMatchObject({ exit: 3, stderrTail: 'fake: gave up' });
    expect(authorNotMeasured(crashed)).toBe('author turn failed: no-result(exit 3)');

    const prose = await d.ask(ask('GARBAGE'));
    expect([prose.meta.resultSubtype, prose.meta.isError, prose.replyText]).toEqual(['invalid-output(stdout is not one JSON object)', true, '']);

    const shaped = (await d.author(author('SHAPE'))).turn;
    expect(shaped.meta.resultSubtype).toMatch(/^invalid-output\(/);
    expect(authorNotMeasured(shaped)).toMatch(/^author turn failed: invalid-output\(.+\) \(is_error\)$/);

    const hung = (await d.author(author('HANG'))).turn;
    expect(hung.meta.process).toMatchObject({ timedOut: true, timeoutMs: 1500, exit: 143 });
    expect(authorNotMeasured(hung)).toBe('author timed out after 0.03 min');
  });

  it('an answer that reports no usage stays valid, and its turn records no cost and no tokens — none, never a zero', async () => {
    const d = new ExternalDriver({ command: COMMAND });
    for (const turn of [(await d.author(author('ECHO build it'))).turn, await d.ask(ask('ECHO how many?'))]) {
      expect(turn.meta).toMatchObject({ resultSubtype: 'success', isError: false, model: 'fake-model-1', numTurns: 2 });
      expect(Object.keys(turn.meta).filter((k) => ['reportedCostUsd', 'inputTokens', 'outputTokens'].includes(k))).toEqual([]);
      expect(authorNotMeasured(turn)).toBeUndefined();
    }
  });

  it('an answer that reports usage: its cost and tokens are carried into the turn as reported, and a reported zero is a reading', async () => {
    vi.stubEnv('FAKE_DRIVER_USAGE', JSON.stringify({ reportedCostUsd: 0.0123, inputTokens: 1500, outputTokens: 320 }));
    const d = new ExternalDriver({ command: COMMAND });
    expect((await d.author(author('ECHO build it'))).turn.meta).toMatchObject({ resultSubtype: 'success', reportedCostUsd: 0.0123, inputTokens: 1500, outputTokens: 320 });
    vi.stubEnv('FAKE_DRIVER_USAGE', JSON.stringify({ reportedCostUsd: 0 }));
    const free = await d.ask(ask('ECHO how many?'));
    expect(free.meta.reportedCostUsd).toBe(0);
    expect([free.meta.inputTokens, free.meta.outputTokens]).toEqual([undefined, undefined]);
  });

  it('a usage figure of another shape is invalid output, never a figure the runner guesses', async () => {
    const d = new ExternalDriver({ command: COMMAND });
    for (const [usage, path] of [
      [{ reportedCostUsd: -0.5 }, 'reportedCostUsd'],
      [{ reportedCostUsd: '0.42' }, 'reportedCostUsd'],
      [{ reportedCostUsd: null }, 'reportedCostUsd'],
      [{ inputTokens: 1.5 }, 'inputTokens'],
      [{ outputTokens: -1 }, 'outputTokens'],
    ] as const) {
      vi.stubEnv('FAKE_DRIVER_USAGE', JSON.stringify(usage));
      const turn = (await d.author(author('ECHO'))).turn;
      expect([turn.meta.resultSubtype?.startsWith(`invalid-output(\`${path}\`: `), turn.meta.isError, turn.meta.reportedCostUsd]).toEqual([true, true, undefined]);
    }
  });

  it('`external:COMMAND` is split on whitespace, its relative paths resolved where the runner started; an empty one is refused', () => {
    expect(parseExternalCommand('node ./agent.mjs --fast', '/work')).toEqual(['node', '/work/agent.mjs', '--fast']);
    expect(parseExternalCommand('bin/agent ../x', '/work/a')).toEqual(['/work/a/bin/agent', '/work/x']);
    expect(parseExternalCommand('agent-cli --json', '/work')).toEqual(['agent-cli', '--json']);
    expect(() => makeDriver('external:')).toThrow(/needs a command/);
    expect(() => makeDriver('external:   ')).toThrow(/needs a command/);
    expect(() => makeDriver('gemini')).toThrow(/unknown driver `gemini` \(claude, codex, external:COMMAND, recorded:FILE\)/);
  });

  it('every flag reaches the command in `limits`, where it may ignore it; the record states each', async () => {
    const args = parseArgs(['--author-timeout', '90', '--author-max-turns', '450', '--ask-max-turns', '20', '--model', 'm1', '--ask-model', 'm2']);
    const d = makeDriver(`external:${COMMAND}`, args);
    expect(echoed((await d.author(author('ECHO'))).turn).input.limits).toEqual({ timeoutMs: 90 * 60_000, maxTurns: 450, model: 'm1' });
    const asked = await d.ask(ask('ECHO'));
    expect(echoed(asked).input.limits).toEqual({ timeoutMs: 5 * 60_000, maxTurns: 20, model: 'm2' });
    expect(asked.meta.process).toMatchObject({ maxTurns: 20, requestedModel: 'm2' });
    expect(d.info()).toMatchObject({ authorTimeoutMs: 90 * 60_000, authorMaxTurns: { control: 450, starter: 450, delivery: 450 }, askMaxTurns: 20, authorModel: 'm1', askModel: 'm2' });
  });

  it('`--effort` reaches the command in `limits.effort` as typed, `--author-effort` / `--ask-effort` set the two kinds apart, and the record states each', async () => {
    const limitsOf = (t: ParsedTurn) => echoed(t).input.limits as Record<string, unknown>;
    const every = makeDriver(`external:${COMMAND}`, parseArgs(['--effort', 'deep']));
    expect(echoed((await every.author(author('ECHO'))).turn).input.limits).toEqual({ timeoutMs: 60 * 60_000, effort: 'deep' });
    const askedEvery = await every.ask(ask('ECHO'));
    expect([limitsOf(askedEvery).effort, askedEvery.meta.process!.requestedEffort]).toEqual(['deep', 'deep']);
    expect(every.info()).toMatchObject({ authorEffort: 'deep', askEffort: 'deep' });

    const apart = makeDriver(`external:${COMMAND}`, parseArgs(['--effort', 'deep', '--ask-effort', 'quick']));
    const built = (await apart.author(author('ECHO'))).turn;
    const asked = await apart.ask(ask('ECHO'));
    expect([limitsOf(built).effort, built.meta.process!.requestedEffort]).toEqual(['deep', 'deep']);
    expect([limitsOf(asked).effort, asked.meta.process!.requestedEffort]).toEqual(['quick', 'quick']);
    expect(apart.info()).toMatchObject({ authorEffort: 'deep', askEffort: 'quick' });

    // With no effort flag, `limits` carries none and no turn records one.
    const plain = makeDriver(`external:${COMMAND}`, parseArgs([]));
    const none = await plain.ask(ask('ECHO'));
    expect(['effort' in limitsOf(none), none.meta.process!.requestedEffort, plain.info().askEffort]).toEqual([false, undefined, undefined]);
  });
});

/** A token no other text in a run could hold by chance. */
const TOKEN = 'tok-scenario-door-7c41e0aa';

/** A door mode authoring task: an empty directory of its own, the door's endpoint and token. */
const doorAuthor = (prompt: string): AuthorTask => ({
  card: 'c',
  mode: 'door',
  phase: 'build',
  step: 'author',
  cwd: tempDir('ext-door-client'),
  prompt,
  tier: 'control',
  door: { mcp: { url: 'http://127.0.0.1:9/api/v1/mcp', token: TOKEN } },
});

/** A directory of two skills, `build-app` and `other`. */
function doorSkills(): string {
  const dir = tempDir('ext-door-skills');
  for (const name of ['build-app', 'other']) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: An invented skill.\nversion: 1.0.0\n---\nStep one.\n`);
  }
  return dir;
}

describe('door mode over the external driver — contract `objectstack-scenario-driver/2`', () => {
  it('`info` always carries `/1`, the one input every version shares; the contract a command answers is the one every later input carries', async () => {
    const log = join(tempDir('ext-log'), 'calls.jsonl');
    vi.stubEnv('FAKE_DRIVER_LOG', log);
    const current = new ExternalDriver({ command: COMMAND });
    expect([current.contract, current.speaksDoor]).toEqual([EXTERNAL_DRIVER_CONTRACT_V2, true]);
    expect(EXTERNAL_DRIVER_CONTRACT_V2).toBe('objectstack-scenario-driver/2');
    // ⛔ The published constant keeps its value: a command that pins it (a literal schema of `/1`) still answers this runner's `info`.
    expect(EXTERNAL_DRIVER_CONTRACT).toBe('objectstack-scenario-driver/1');
    expect(echoed((await current.author(author('ECHO'))).turn).input.contract).toBe(EXTERNAL_DRIVER_CONTRACT_V2);
    expect(echoed(await current.ask(ask('ECHO'))).input.contract).toBe(EXTERNAL_DRIVER_CONTRACT_V2);

    // A `/1` command answers `info` with no contract, and is still sent `/1` inputs: scratch, template and ask run as before.
    vi.stubEnv('FAKE_DRIVER_CONTRACT', '1');
    const first = new ExternalDriver({ command: COMMAND });
    expect([first.contract, first.speaksDoor]).toEqual([EXTERNAL_DRIVER_CONTRACT, false]);
    const built = (await first.author(author('ECHO'))).turn;
    expect([built.meta.resultSubtype, echoed(built).input.contract]).toEqual(['success', EXTERNAL_DRIVER_CONTRACT]);
    expect(echoed(await first.ask(ask('ECHO'))).input.contract).toBe(EXTERNAL_DRIVER_CONTRACT);
    expect('door' in echoed(built).input).toBe(false);
  });

  it('⛔ an `info` answer naming a contract this runner does not speak is refused before any card runs, naming it', () => {
    vi.stubEnv('FAKE_DRIVER_CONTRACT', 'objectstack-scenario-driver/9');
    expect(() => new ExternalDriver({ command: COMMAND })).toThrow(
      /the command's `info` answer names the contract `objectstack-scenario-driver\/9`, which this runner does not speak \(it speaks `objectstack-scenario-driver\/1`, `objectstack-scenario-driver\/2`\)/,
    );
  });

  it('a door author call: the door on stdin, its token in a 0600 file outside the call’s directory only, gone after; the skills in `door.skillsDir`; no files recorded', async () => {
    const skills = doorSkills();
    const d = new ExternalDriver({ command: COMMAND, doorSkillsDir: skills, doorSkillOmit: ['other'] });
    const task = doorAuthor('ECHO build it through the door');
    const result = await d.author(task);
    const { input, argv, cwd, seen } = echoed(result.turn);
    const door = input.door as { mcp: { url: string; configFile: string }; skillsDir: string };
    expect(input).toMatchObject({
      contract: EXTERNAL_DRIVER_CONTRACT_V2,
      kind: 'author',
      step: { card: 'c', mode: 'door', phase: 'build', step: 'author' },
      prompt: 'ECHO build it through the door',
      cwd: task.cwd,
      tier: 'control',
      limits: { timeoutMs: 60 * 60_000 },
    });
    expect(Object.keys(door).sort()).toEqual(['mcp', 'skillsDir']);
    expect(Object.keys(door.mcp).sort()).toEqual(['configFile', 'url']);
    expect(door.mcp.url).toBe('http://127.0.0.1:9/api/v1/mcp');
    expect(door.skillsDir).toBe(join(task.cwd, '.claude', 'skills'));
    expect(cwd).toBe(task.cwd);
    // ⛔ The token reached the command in the 0600 file only, and that file lies outside the directory the call runs in.
    expect(seen).toMatchObject({ fileMode: '600', urlMatches: true, runsInCwd: true, keyPrint: keyPrint(TOKEN), keyOnArgv: false, keyInEnv: false, keyOnStdin: false });
    expect(door.mcp.configFile.startsWith(task.cwd)).toBe(false);
    expect(argv.join(' ')).not.toContain(TOKEN);
    expect(JSON.stringify(input)).not.toContain(TOKEN);
    expect(existsSync(door.mcp.configFile)).toBe(false);
    expect(existsSync(dirname(door.mcp.configFile))).toBe(false);
    // The arm's skills, less the omission, each with its SKILL.md.
    expect([seen!.skills, seen!.skillMdOf]).toEqual([['build-app'], [true]]);
    // There is no project: nothing of the directory is recorded, and the turn is read as any other.
    expect(result.files).toBeUndefined();
    expect(result.turn.meta).toMatchObject({ resultSubtype: 'success', isError: false, model: 'fake-model-1' });
    expect(authorNotMeasured(result.turn)).toBeUndefined();
    // The record states the arm: the skill given with its sha256 and version, the skill left out.
    expect(d.info().door).toEqual({
      skills: { dir: resolve(skills), skills: [{ name: 'build-app', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), version: '1.0.0' }] },
      skillsOmitted: ['other'],
    });
  });

  it('a door author call with no skills carries no `skillsDir`, its directory stays empty, and the record states no arm', async () => {
    const d = new ExternalDriver({ command: COMMAND });
    const task = doorAuthor('ECHO');
    const { input, seen } = echoed((await d.author(task)).turn);
    expect(Object.keys(input.door as object)).toEqual(['mcp']);
    expect(seen!.skills).toEqual([]);
    expect(readdirSync(task.cwd)).toEqual([]);
    expect('door' in d.info()).toBe(false);
  });

  it('⛔ a `/1` command in door mode: refused before any card runs, naming the contract, and never handed a door', async () => {
    const log = join(tempDir('ext-log'), 'calls.jsonl');
    vi.stubEnv('FAKE_DRIVER_LOG', log);
    vi.stubEnv('FAKE_DRIVER_CONTRACT', '1');
    const d = new ExternalDriver({ command: COMMAND });
    const why = /`fake-agent` speaks `objectstack-scenario-driver\/1`, which has no door; door mode hands an external command the app's MCP draft door on `objectstack-scenario-driver\/2` only/;
    // The run's own check, before any card runs (`main` calls it once the driver is made).
    expect(() => d.assertDoor()).toThrow(why);
    // And the driver's own, should a door task reach it anyway: a named failure, not a silent pass, and no process started.
    await expect(d.author(doorAuthor('ECHO'))).rejects.toThrow(why);
    expect(existsSync(log)).toBe(false);
    // A `/2` command passes the same check.
    vi.unstubAllEnvs();
    expect(() => new ExternalDriver({ command: COMMAND }).assertDoor()).not.toThrow();
  });

  it('the command line: `--door-skills` reaches an external command, the rules arm is refused naming why, and an omission names a skill the directory holds', () => {
    const skills = doorSkills();
    expect(makeDriver(`external:${COMMAND}`, { doorSkills: skills }).info().door).toMatchObject({ skills: { dir: resolve(skills) } });
    expect(() => makeDriver(`external:${COMMAND}`, { doorRules: '/r.json' })).toThrow(
      /--door-rules applies to the live `claude` driver only: the rules reach its client as the `CLAUDE.md` a Claude Code session reads, and the external driver contract carries no rules/,
    );
    expect(() => makeDriver(`external:${COMMAND}`, { doorRules: '/r.json', doorRulesOmit: 'x' })).toThrow(/--door-rules, --door-rules-omit apply to the live `claude` driver only/);
    expect(() => makeDriver(`external:${COMMAND}`, { doorSkills: skills, doorSkillOmit: ['nope'] })).toThrow(/--door-skill-omit names `nope`/);
    expect(() => makeDriver('codex', { doorSkills: skills })).toThrow(/door mode is driven by the live `claude` driver or an external command that speaks `objectstack-scenario-driver\/2`/);
  });
});

/**
 * The fixture's scripted model, its turns sent through the external command:
 * the double still does what the turn did to the in-memory app, and the turn
 * the run records is the one the command printed.
 */
class ThroughCommand implements AgentDriver {
  constructor(
    private readonly scripted: AgentDriver,
    private readonly external: ExternalDriver,
    private readonly script: string,
    /** The usage keys the command adds to a task's answer; none by default. */
    private readonly usage: (task: AuthorTask | AskTask) => Record<string, unknown> = () => ({}),
  ) {}
  info(): DriverInfo {
    return this.external.info();
  }
  private write(task: AuthorTask | AskTask, t: ParsedTurn) {
    const answer = {
      replyText: t.replyText,
      toolCalls: t.toolCalls.map((c) => ({ name: c.name, input: c.input, output: c.output, ...(c.isError ? { isError: true } : {}) })),
      ...this.usage(task),
    };
    // The command reads its answer by the step it is handed, which never carries the confirmation mark
    // (an operation's confirmation turn is told by its prompt): the turn's answer goes where this call reads it.
    const { confirmation: _confirmation, ...step } = task;
    writeFileSync(join(this.script, `${encodeURIComponent(stepKey(step))}.json`), JSON.stringify(answer));
  }
  async author(task: AuthorTask): Promise<AuthorResult> {
    this.write(task, (await this.scripted.author(task)).turn);
    return this.external.author(task);
  }
  async ask(task: AskTask): Promise<ParsedTurn> {
    this.write(task, await this.scripted.ask(task));
    return this.external.ask(task);
  }
}

/** Every file under `dir`, path → text. */
function texts(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(p, readFileSync(p, 'latin1'));
    }
  };
  walk(dir);
  return out;
}

describe('the persona keys, end to end over the external driver — the record, the scorecard and the gallery never carry one', () => {
  it('a full crm run through the command: each key reached it in a 0600 file only, and no written artifact holds any', async () => {
    const script = tempDir('ext-script');
    const log = join(tempDir('ext-log'), 'calls.jsonl');
    vi.stubEnv('FAKE_DRIVER_SCRIPT', script);
    vi.stubEnv('FAKE_DRIVER_LOG', log);
    const external = new ExternalDriver({ command: COMMAND });
    const fx = await runCrm({ keyPrefix: KEY, wrap: (scripted) => new ThroughCommand(scripted, external, script) });

    // The keys were there to leak: every ask read one of this run's keys from a 0600 file, and only there.
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; seen?: Record<string, unknown> });
    const asks = calls.filter((c) => c.kind === 'ask');
    expect(asks.length).toBeGreaterThan(5);
    const keys = new Set([`${KEY}admin`, ...fx.scenario.card.run.personas.map((p) => `${KEY}${p.id}`)].map(keyPrint));
    expect(keys.size).toBe(fx.scenario.card.run.personas.length + 1);
    for (const a of asks) {
      expect(a.seen).toMatchObject({ fileMode: '600', keyOnArgv: false, keyInEnv: false, keyOnStdin: false });
      expect(keys.has(a.seen!.keyPrint as string)).toBe(true);
      expect(existsSync(a.seen!.configFile as string)).toBe(false);
    }

    // What the run writes: the record and the recording where the CLI puts them, the scorecard, and the gallery export.
    const runs = tempDir('ext-runs');
    writeRecord(runs, fx.record);
    writeFileSync(join(runs, 'recording.json'), JSON.stringify(fx.recording, null, 2));
    writeFileSync(join(runs, 'scorecard.md'), renderScorecard(cardScorecard(fx.cardRun)));
    const out = tempDir('ext-gallery');
    const summary = await exportGallery({ runsDir: runs, outDir: out, cards: [fx.scenario], recordings: [fx.recording], guard: () => ({ eligible: true, reasons: [] }), screenshots: false });
    expect(summary.refused).toEqual([]);
    expect(summary.exported.map((e) => e.id)).toEqual([fx.scenario.card.id]);

    const written = new Map([...texts(runs), ...texts(out)]);
    expect(written.size).toBeGreaterThan(8);
    const carrying = [...written].filter(([, text]) => text.includes(KEY)).map(([file]) => file);
    expect(carrying).toEqual([]);

    // And the record and the gallery page name the driver that ran it.
    expect((fx.record.env as { driver: DriverInfo }).driver).toMatchObject({ driver: 'external:fake-agent', version: '1.2.3' });
    expect(readFileSync(join(out, 'apps', fx.scenario.card.id, 'README.md'), 'utf8')).toContain('- Driver: external:fake-agent 1.2.3\n');
    // The command reported no usage: every turn passed all the same, and the page says the cost was not reported.
    expect(readFileSync(join(out, 'apps', fx.scenario.card.id, 'README.md'), 'utf8')).toContain('- Author cost (as the driver reported it): not reported\n');

    // A replay of that recording keeps the driver that made it, and its page says it is a replay.
    const replay = new RecordedDriver(fx.recording, join(runs, 'recording.json')).info();
    expect(replay).toMatchObject({ driver: 'recorded', replayOf: { driver: 'external:fake-agent', version: '1.2.3' } });
    const replayed = { ...fx.record, env: { ...(fx.record.env as object), driver: replay } };
    rmSync(runs, { recursive: true, force: true });
    const runs2 = tempDir('ext-runs');
    writeRecord(runs2, replayed);
    await exportGallery({ runsDir: runs2, outDir: out, cards: [fx.scenario], recordings: [fx.recording], guard: () => ({ eligible: true, reasons: [] }), screenshots: false });
    const page = readFileSync(join(out, 'apps', fx.scenario.card.id, 'README.md'), 'utf8');
    expect(page).toContain('- Driver: external:fake-agent 1.2.3 (re-graded from a recording of that run)\n');
    expect(page).not.toContain(runs);
    // The budget is measured, not vitest's 5 s default. The run starts the
    // stand-in once per turn, one after another: 45 starts (3 author calls,
    // 42 asks over scratch run, scratch iterate-run and template iterate-run).
    // Measured 2.2–2.5 s over 10 local runs at ~50 ms a start. On a Test Core
    // shard one start took 212 ms (the info case) and this case was cut off
    // at 5042 ms (merge-queue run 42414930416). 30 s is ~6x the slowest
    // observed.
  }, 30_000);
});

describe('the usage a command reports, end to end over the external driver — the record, the scorecard and the gallery page', () => {
  it('a crm run whose every authoring turn reported a cost: each turn carries its figures, and the channel’s cost is their sum', async () => {
    const script = tempDir('ext-script');
    vi.stubEnv('FAKE_DRIVER_SCRIPT', script);
    const external = new ExternalDriver({ command: COMMAND });
    // Every authoring turn reports a cost and its tokens; the persona turns report tokens only.
    const usage = (task: AuthorTask | AskTask) => ('cwd' in task ? { reportedCostUsd: 0.25, inputTokens: 1000, outputTokens: 200 } : { inputTokens: 50, outputTokens: 10 });
    const fx = await runCrm({ wrap: (scripted) => new ThroughCommand(scripted, external, script, usage) });

    // The run record: each turn as its command reported it, and nothing it did not report.
    const scratch = fx.cardRun.modes.find((m) => m.mode === 'scratch')!;
    expect(scratch.build!.author).toMatchObject({ resultSubtype: 'success', reportedCostUsd: 0.25, inputTokens: 1000, outputTokens: 200 });
    const question = scratch.run!.questions.find((q) => q.turn)!.turn!;
    expect([question.reportedCostUsd, question.inputTokens, question.outputTokens]).toEqual([undefined, 50, 10]);
    const written = fx.record as { cardRun: typeof fx.cardRun; scorecard: { authorCost: unknown } };
    expect(written.cardRun.modes[0]!.build!.author).toMatchObject({ reportedCostUsd: 0.25 });

    // The scorecard: three authoring turns (scratch build, scratch iterate, template iterate), every one reported.
    expect(written.scorecard.authorCost).toEqual({ turns: 3, reported: 3, usd: 0.75 });
    const table = renderScorecard(cardScorecard(fx.cardRun));
    expect(table).toContain('author cost: $0.75 over 3 author turns\n');
    expect(table).toContain('| Author cost | $0.50 over 2 author turns | $0.25 over 1 author turn |');

    // The gallery page and its scorecard state it too.
    const runs = tempDir('ext-runs');
    writeRecord(runs, fx.record);
    const out = tempDir('ext-gallery');
    const summary = await exportGallery({ runsDir: runs, outDir: out, cards: [fx.scenario], recordings: [fx.recording], guard: () => ({ eligible: true, reasons: [] }), screenshots: false });
    expect(summary.refused).toEqual([]);
    const app = join(out, 'apps', fx.scenario.card.id);
    expect(readFileSync(join(app, 'README.md'), 'utf8')).toContain('- Author cost (as the driver reported it): $0.75 over 3 author turns\n');
    expect(readFileSync(join(app, 'scorecard.md'), 'utf8')).toContain('author cost: $0.75 over 3 author turns\n');
    // The same measured budget as the key case above: one stand-in start per turn, 45 of them.
  }, 30_000);
});
