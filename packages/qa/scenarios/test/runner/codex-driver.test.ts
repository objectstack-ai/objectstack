// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--driver codex` against a stand-in `codex` script, never the real CLI: the
 * subscription-only login guard, the JSONL reader on the event shapes measured
 * on codex-cli 0.167.0, the per-turn profile that carries the persona's key
 * (0600, under `$CODEX_HOME`, removed after the turn), and the flags the CLI
 * has an equivalent for.
 */

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeDriver, parseArgs } from '../../src/runner/cli.js';
import { ApiBillingRefusedError, type AskTask, type AuthorTask } from '../../src/runner/driver.js';
import { assertCodexSubscriptionLogin, CodexDriver, codexProfileToml, codexSubscriptionOnlyEnv, parseCodexJsonl } from '../../src/runner/drivers/codex.js';
import { authorNotMeasured } from '../../src/runner/orchestrate.js';
import type { ParsedTurn } from '../../src/runner/transcript.js';

const KEY = 'sk-scenario-codex-key-31c7';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** `codex exec --json` output in the event shapes of codex-cli 0.167.0 (`exec_events.rs` at rust-v0.167.0). */
const JSONL = [
  '{"type":"thread.started","thread_id":"01a1b78f-f368-7742-9db6-9e4225d05450"}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"Reconnecting... 2/5 (stream disconnected before completion)"}',
  '{"type":"item.started","item":{"id":"item_0","type":"mcp_tool_call","server":"app","tool":"list_objects","arguments":{},"result":null,"error":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_0","type":"mcp_tool_call","server":"app","tool":"list_objects","arguments":{},"result":{"content":[{"type":"text","text":"{\\"objects\\":[{\\"name\\":\\"account\\"}]}"}],"structured_content":null},"error":null,"status":"completed"}}',
  '{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"app","tool":"aggregate_records","arguments":{"objectName":"account"},"result":null,"error":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"app","tool":"aggregate_records","arguments":{"objectName":"account"},"result":null,"error":{"message":"{\\"error\\":{\\"code\\":\\"PERMISSION_DENIED\\",\\"status\\":403}}"},"status":"failed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"ls","aggregated_output":"src\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.started","item":{"id":"item_3","type":"mcp_tool_call","server":"app","tool":"query_records","arguments":{"objectName":"contact"},"result":null,"error":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"I could not count them."}}',
  '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
  '{"type":"item.completed","item":{"id":"item_5","type":"agent_mes', // a torn line from a killed process
].join('\n');

describe('parseCodexJsonl — the turn a `codex exec --json` run printed', () => {
  it('pairs each tool call with its result, keeps the error flag and the order, and joins the agent messages', () => {
    const t = parseCodexJsonl(JSONL);
    expect(t.replyText).toBe('I could not count them.');
    expect(t.toolCalls).toEqual([
      { name: 'list_objects', rawName: 'mcp__app__list_objects', input: {}, output: '{"objects":[{"name":"account"}]}' },
      { name: 'aggregate_records', rawName: 'mcp__app__aggregate_records', input: { objectName: 'account' }, output: '{"error":{"code":"PERMISSION_DENIED","status":403}}', isError: true },
      { name: 'command_execution', rawName: 'command_execution', input: { command: 'ls' }, output: 'src\n' },
      // Started, never completed: the turn was cut short — kept, with no output.
      { name: 'query_records', rawName: 'mcp__app__query_records', input: { objectName: 'contact' }, output: undefined },
    ]);
    expect(t.meta).toEqual({ resultSubtype: 'success', isError: false });
  });

  it('a failed turn says why; a stream that never ended has no result, and a notice is not an end', () => {
    const failed = parseCodexJsonl(['{"type":"turn.started"}', '{"type":"turn.failed","error":{"message":"usage limit reached"}}']);
    expect(failed.meta).toEqual({ resultSubtype: 'turn.failed: usage limit reached', isError: true });
    expect(authorNotMeasured(failed)).toBe('author turn failed: turn.failed: usage limit reached (is_error)');
    const cut = parseCodexJsonl(JSONL.split('\n').slice(0, 4));
    expect(cut.meta.resultSubtype).toBeUndefined();
  });
});

describe('the Codex cost guard — a ChatGPT plan login only, never an API-billed model', () => {
  it('refuses an API key in the environment, an API-key login, no login and any login that is not the plan', () => {
    const refusal = (env: NodeJS.ProcessEnv, status: string) => {
      try {
        assertCodexSubscriptionLogin(env, status);
      } catch (e) {
        return e instanceof ApiBillingRefusedError ? e.message : `not a billing refusal: ${String(e)}`;
      }
      return undefined;
    };
    expect(assertCodexSubscriptionLogin({}, 'WARNING: proceeding\nLogged in using ChatGPT\n')).toBe('chatgpt');
    expect(refusal({ OPENAI_API_KEY: 'sk-x' }, 'Logged in using ChatGPT')).toMatch(/^the scenario runner drives a local Codex login only, never an API-billed model: `OPENAI_API_KEY` is set\. Unset it and run `codex login`/);
    expect(refusal({ CODEX_API_KEY: 'sk-x' }, 'Logged in using ChatGPT')).toMatch(/`CODEX_API_KEY` is set/);
    expect(refusal({}, 'API key configured - sk-fake-***-0000\nAuthentication is checked when you send a request.')).toMatch(/reports an API-key login\./);
    expect(refusal({}, 'Not logged in')).toMatch(/reports no login\./);
    expect(refusal({}, '')).toMatch(/reports no login\./);
    const other = refusal({}, 'Logged in using access token - tok-***-9');
    expect(other).toMatch(/reports a login that is not a ChatGPT plan \(Logged in using access token\)\./);
    expect(other).not.toContain('tok-');
    // An empty variable is unset; the guard reads the CALLER's environment.
    expect(assertCodexSubscriptionLogin({ OPENAI_API_KEY: '' }, 'Logged in using ChatGPT')).toBe('chatgpt');
  });

  it('strips the billing variables from every child environment', () => {
    const env = codexSubscriptionOnlyEnv({ OPENAI_API_KEY: 'a', CODEX_API_KEY: 'b', PATH: '/bin' });
    expect(env).toEqual({ PATH: '/bin' });
  });

  it('the profile layer: the app server with the key as a header, every server of the user’s own config off', () => {
    expect(codexProfileToml({ app: { url: 'http://127.0.0.1:3000/api/v1/mcp', apiKey: 'k"1' }, disable: ['github', 'my server'] })).toBe(
      [
        '[mcp_servers."app"]',
        'url = "http://127.0.0.1:3000/api/v1/mcp"',
        'http_headers = { Authorization = "Bearer k\\"1" }',
        '',
        '[mcp_servers."github"]',
        'enabled = false',
        '',
        '[mcp_servers."my server"]',
        'enabled = false',
        '',
      ].join('\n'),
    );
    expect(codexProfileToml({ disable: [] })).toBe('');
  });
});

/**
 * A stand-in for the `codex` CLI. `--version` answers `codex-cli 0.167.0
 * (stand-in)`; `login status` answers on stderr as the real CLI does, by
 * `STAND_IN_LOGIN` (`chatgpt` default, `apikey`, `none`); `mcp list --json`
 * answers `STAND_IN_SERVERS` (default none). `exec` reads its prompt from
 * stdin and the profile `-p NAME` from `$CODEX_HOME/NAME.config.toml`, then
 * acts on the prompt's first word: `HANG` waits to be killed (exit 143 on
 * SIGTERM), `CRASH` exits 1, `FAIL` ends `turn.failed`, anything else answers
 * one MCP call and an agent message whose text is a JSON report — its argv,
 * the profile's mode and text with the key's hash in place of the key, and
 * whether the key was on argv or in the environment.
 */
const STAND_IN = `#!/usr/bin/env node
const { readFileSync, statSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
process.on('SIGTERM', () => { process.stderr.write('stand-in: terminated\\n'); process.exit(143); });
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli 0.167.0 (stand-in)'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') {
  const how = process.env.STAND_IN_LOGIN || 'chatgpt';
  if (how === 'chatgpt') { process.stderr.write('Logged in using ChatGPT\\n'); process.exit(0); }
  if (how === 'apikey') { process.stderr.write('API key configured - sk-abc-***-1234\\n'); process.exit(0); }
  process.stderr.write('Not logged in\\n'); process.exit(1);
}
if (args[0] === 'mcp' && args[1] === 'list') { console.log(process.env.STAND_IN_SERVERS || '[]'); process.exit(0); }
if (args[0] !== 'exec') { process.stderr.write('stand-in: unknown command\\n'); process.exit(2); }
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const ev = (o) => console.log(JSON.stringify(o));
  ev({ type: 'thread.started', thread_id: 't1' });
  ev({ type: 'turn.started' });
  if (input.startsWith('HANG')) { setInterval(() => {}, 1000); return; }
  if (input.startsWith('CRASH')) { process.stderr.write('stand-in: could not start a session\\n'); process.exit(1); }
  if (input.startsWith('FAIL')) { ev({ type: 'turn.failed', error: { message: 'usage limit reached' } }); process.exit(1); }
  const profile = args[args.indexOf('-p') + 1];
  const file = join(process.env.CODEX_HOME, profile + '.config.toml');
  const text = readFileSync(file, 'utf8');
  const m = /Bearer ([^"]+)"/.exec(text);
  const key = m ? m[1] : undefined;
  const report = {
    argv: args,
    stdinLength: input.length,
    profileFile: file,
    profileMode: (statSync(file).mode & 0o777).toString(8),
    profile: key ? text.split(key).join('KEY') : text,
    keySha: key ? createHash('sha256').update(key).digest('hex') : null,
    keyOnArgv: key ? args.some((a) => a.includes(key)) : false,
    keyInEnv: key ? Object.values(process.env).some((v) => typeof v === 'string' && v.includes(key)) : false,
    billingEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY'].filter((k) => process.env[k] !== undefined),
  };
  ev({ type: 'item.completed', item: { id: 'i0', type: 'mcp_tool_call', server: 'app', tool: 'query_records', arguments: { objectName: 'x' }, result: { content: [{ type: 'text', text: '{"records":[]}' }], structured_content: null }, error: null, status: 'completed' } });
  ev({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: JSON.stringify(report) } });
  ev({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } });
});
`;

describe('the Codex driver against a stand-in `codex`: the prompt on stdin, the key in a 0600 profile only, and a turn that does not finish recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-codex-stand-in-'));
  const bin = join(dir, 'codex');
  writeFileSync(bin, STAND_IN);
  chmodSync(bin, 0o755);
  const home = join(dir, 'codex-home');
  mkdirSync(home);
  const author = (prompt: string): AuthorTask => ({ card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd: mkdtempSync(join(dir, 'project-')), prompt, tier: 'starter' });
  const ask = (prompt: string): AskTask => ({ card: 'c', mode: 'scratch', phase: 'run', step: 'q', persona: 'sdr', prompt, mcp: { url: 'http://127.0.0.1:9/api/v1/mcp', apiKey: KEY } });
  const report = (t: ParsedTurn) => JSON.parse(t.replyText) as { argv: string[]; stdinLength: number; profileFile: string; profileMode: string; profile: string; keySha: string | null; keyOnArgv: boolean; keyInEnv: boolean; billingEnv: string[] };
  const valueOf = (argv: string[], flag: string) => (argv.indexOf(flag) === -1 ? undefined : argv[argv.indexOf(flag) + 1]);
  const configs = (argv: string[]) => argv.flatMap((a, i) => (argv[i - 1] === '-c' ? [a] : []));
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('CODEX_API_KEY', '');
    vi.stubEnv('CODEX_HOME', home);
    vi.stubEnv('PATH', `${dir}${delimiter}${process.env.PATH ?? ''}`);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('names its version and login in the record, and refuses an API-key login before any card runs', () => {
    expect(new CodexDriver({ bin, codexHome: home }).info()).toEqual({ driver: 'codex-cli', version: 'codex-cli 0.167.0 (stand-in)', authMethod: 'chatgpt', apiBilled: false, authorTimeoutMs: 60 * 60_000 });
    vi.stubEnv('STAND_IN_LOGIN', 'apikey');
    expect(() => new CodexDriver({ bin, codexHome: home })).toThrow(ApiBillingRefusedError);
    vi.stubEnv('STAND_IN_LOGIN', 'none');
    expect(() => new CodexDriver({ bin, codexHome: home })).toThrow(/reports no login/);
    vi.stubEnv('STAND_IN_LOGIN', 'chatgpt');
    vi.stubEnv('OPENAI_API_KEY', 'sk-live');
    expect(() => new CodexDriver({ bin, codexHome: home })).toThrow(/`OPENAI_API_KEY` is set/);
  });

  it('an ask turn: `codex exec --json` on the plan login, read-only, the prompt on stdin, the key only in a 0600 profile that is gone after', async () => {
    vi.stubEnv('STAND_IN_SERVERS', JSON.stringify([{ name: 'github' }]));
    const turn = await new CodexDriver({ bin, codexHome: home }).ask(ask('how many accounts? '.repeat(10_000)));
    const r = report(turn);
    expect(r.argv.slice(0, 4)).toEqual(['exec', '--json', '--ephemeral', '--skip-git-repo-check']);
    expect(configs(r.argv)).toEqual(['forced_login_method="chatgpt"', 'approval_policy="never"']);
    expect([valueOf(r.argv, '-s'), r.argv[r.argv.length - 1], valueOf(r.argv, '-m')]).toEqual(['read-only', '-', undefined]);
    expect(r.stdinLength).toBe('how many accounts? '.length * 10_000);
    expect(r).toMatchObject({ profileMode: '600', keySha: sha(KEY), keyOnArgv: false, keyInEnv: false, billingEnv: [] });
    expect(r.profile).toBe(codexProfileToml({ app: { url: 'http://127.0.0.1:9/api/v1/mcp', apiKey: 'KEY' }, disable: ['github'] }));
    expect(existsSync(r.profileFile)).toBe(false);
    expect(readdirSync(home)).toEqual([]);
    expect(turn.toolCalls).toEqual([{ name: 'query_records', rawName: 'mcp__app__query_records', input: { objectName: 'x' }, output: '{"records":[]}' }]);
    expect(turn.meta).toMatchObject({ resultSubtype: 'success', isError: false, process: { exit: 0, timedOut: false, timeoutMs: 5 * 60_000 } });
    // The stream names no model: the record says so rather than guess one.
    expect(turn.meta.model).toBeUndefined();
  });

  it('an author turn: workspace-write in the project directory with the network open, no app server, the user’s servers off', async () => {
    vi.stubEnv('STAND_IN_SERVERS', JSON.stringify([{ name: 'github' }]));
    const task = author('build it');
    const { turn } = await new CodexDriver({ bin, codexHome: home }).author(task);
    const r = report(turn);
    expect([valueOf(r.argv, '-s'), valueOf(r.argv, '-C')]).toEqual(['workspace-write', task.cwd]);
    expect(configs(r.argv)).toEqual(['forced_login_method="chatgpt"', 'approval_policy="never"', 'sandbox_workspace_write.network_access=true']);
    expect(r.profile).toBe(codexProfileToml({ disable: ['github'] }));
    expect(authorNotMeasured(turn)).toBeUndefined();
  });

  it('a user server named `app` is refused: the runner serves the app under that name', () => {
    vi.stubEnv('STAND_IN_SERVERS', JSON.stringify([{ name: 'app' }]));
    expect(() => new CodexDriver({ bin, codexHome: home })).toThrow(/declares an MCP server named `app`/);
  });

  it('a turn the timeout kills, a CLI that exits without a result, and a failed turn: each recorded and not measured', async () => {
    const d = new CodexDriver({ bin, codexHome: home, authorTimeoutMs: 1200 });
    const hung = (await d.author(author('HANG'))).turn;
    expect(hung.meta.resultSubtype).toBe('no-result(exit 143)');
    expect(hung.meta.process).toMatchObject({ exit: 143, timedOut: true, timeoutMs: 1200, stderrTail: 'stand-in: terminated' });
    expect(authorNotMeasured(hung)).toBe('author timed out after 0.02 min');
    const crashed = (await d.author(author('CRASH'))).turn;
    expect(authorNotMeasured(crashed)).toBe('author turn failed: no-result(exit 1)');
    const failed = (await d.author(author('FAIL'))).turn;
    expect(authorNotMeasured(failed)).toBe('author turn failed: turn.failed: usage limit reached (is_error)');
    expect(readdirSync(home)).toEqual([]);
  });

  it('`--model` reaches `-m` on every turn, `--author-model` / `--ask-model` set the two kinds apart, and the turn records what it asked for', async () => {
    const apart = makeDriver('codex', parseArgs(['--model', 'gpt-5', '--author-model', 'gpt-5-codex']));
    const built = (await apart.author(author('x'))).turn;
    const asked = await apart.ask(ask('x'));
    expect([valueOf(report(built).argv, '-m'), built.meta.process!.requestedModel]).toEqual(['gpt-5-codex', 'gpt-5-codex']);
    expect([valueOf(report(asked).argv, '-m'), asked.meta.process!.requestedModel]).toEqual(['gpt-5', 'gpt-5']);
    expect(apart.info()).toMatchObject({ driver: 'codex-cli', authorModel: 'gpt-5-codex', askModel: 'gpt-5' });
    expect(makeDriver('codex', parseArgs(['--author-timeout', '90'])).info().authorTimeoutMs).toBe(90 * 60_000);
  });

  it('the turn caps have no Codex equivalent, so `--author-max-turns` and `--ask-max-turns` are refused at the start', () => {
    expect(() => makeDriver('codex', parseArgs(['--author-max-turns', '300']))).toThrow(/^--author-max-turns has no equivalent in the Codex CLI/);
    expect(() => makeDriver('codex', parseArgs(['--author-max-turns', '300', '--ask-max-turns', '20']))).toThrow(/^--author-max-turns, --ask-max-turns have no equivalent in the Codex CLI/);
  });
});
