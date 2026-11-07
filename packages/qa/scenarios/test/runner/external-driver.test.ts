// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--driver external:COMMAND` against a stand-in command
 * (`fixtures/fake-external-driver.mjs`): the stdin/stdout contract, a call
 * that does not answer as a failed turn with a named reason, and — end to end
 * over the real crm card, through the run record, the recording, the
 * scorecard and the gallery export — the persona's key reaching the command
 * in a 0600 file only, and no written artifact carrying it.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportGallery } from '../../src/export/exporter.js';
import { makeDriver, parseArgs } from '../../src/runner/cli.js';
import { RecordedDriver, stepKey, type AgentDriver, type AskTask, type AuthorResult, type AuthorTask, type DriverInfo } from '../../src/runner/driver.js';
import { EXTERNAL_DRIVER_CONTRACT, ExternalDriver, parseExternalCommand } from '../../src/runner/drivers/external.js';
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
      contract: EXTERNAL_DRIVER_CONTRACT,
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
    expect(input).toMatchObject({ contract: EXTERNAL_DRIVER_CONTRACT, kind: 'ask', step: { card: 'c', mode: 'scratch', phase: 'run', step: 'q1', persona: 'sdr' }, prompt: 'ECHO how many accounts?', limits: { timeoutMs: 5 * 60_000 } });
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
  ) {}
  info(): DriverInfo {
    return this.external.info();
  }
  private write(task: AuthorTask | AskTask, t: ParsedTurn) {
    const answer = { replyText: t.replyText, toolCalls: t.toolCalls.map((c) => ({ name: c.name, input: c.input, output: c.output, ...(c.isError ? { isError: true } : {}) })) };
    writeFileSync(join(this.script, `${encodeURIComponent(stepKey(task))}.json`), JSON.stringify(answer));
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
