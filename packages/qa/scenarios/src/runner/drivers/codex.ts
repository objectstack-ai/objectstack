// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `--driver codex`: the OpenAI Codex CLI in non-interactive mode, on the
 * developer's own ChatGPT plan, under the same cost ruling as the Claude
 * driver (cloud#3600): never an API-billed model.
 *
 * What this reads of the CLI was measured on `codex-cli 0.167.0` (the PR that
 * added the driver records each reading):
 *
 *   - `codex exec --json … -` runs one turn with the prompt read from stdin and
 *     prints JSONL events: `thread.started`, `turn.started`, `item.started` /
 *     `item.updated` / `item.completed` (items `agent_message`,
 *     `mcp_tool_call` {server, tool, arguments, result {content,
 *     structured_content}, error, status}, `command_execution`,
 *     `file_change`, `web_search`, `todo_list`, `reasoning`, `error`), then
 *     `turn.completed` {usage} or `turn.failed` {error}; a top-level `error`
 *     event is a notice (`Reconnecting... 2/5`), not the turn's end. No event
 *     names the model served, and there is no agentic-turn count or cap.
 *   - `-m MODEL` asks for a model; `-s read-only|workspace-write` the sandbox;
 *     `-C DIR` the working root; `--ephemeral` keeps no session file;
 *     `--skip-git-repo-check` runs outside a git repository; `-c key=value`
 *     overrides one config key (refused when unknown under `--strict-config`).
 *   - `-p NAME` layers `$CODEX_HOME/NAME.config.toml` over the user's config.
 *     An HTTP MCP server there with `http_headers` sends them on every
 *     request (seen: `Authorization: Bearer …` on the `initialize` POST), and
 *     `enabled = false` turns a server of the user's config off for the call.
 *     `--ignore-user-config` would drop the profile too, so it is not used.
 *   - `codex login status` prints (on stderr) `Logged in using ChatGPT` for a
 *     plan login, `API key configured - sk-…` for an API key, `Not logged in`;
 *     with `-c forced_login_method="chatgpt"` an API-key login reads as not
 *     logged in, so every turn passes it.
 *
 * ⛔ The persona's API key reaches the CLI only in a 0600 profile file under
 * `$CODEX_HOME`, removed when the turn returns; argv carries the profile's
 * NAME, never the key, and the environment never carries it.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApiBillingRefusedError, DEFAULT_AUTHOR_TIMEOUT_MIN, snapshotSources, type AgentDriver, type AskTask, type AuthorResult, type AuthorTask, type DriverInfo } from '../driver.js';
import type { ParsedTurn, RunnerToolCall } from '../transcript.js';
import { contentText, noResult, runTurnProcess } from './process.js';

/** Environment variables that would make the Codex CLI bill an API key instead of the ChatGPT login. */
export const CODEX_API_BILLING_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY'] as const;

const CODEX_LOGIN = { tool: 'Codex', login: 'codex login' } as const;

/** The child environment: the caller's, with every Codex API-billing variable removed. */
export function codexSubscriptionOnlyEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of CODEX_API_BILLING_ENV) delete out[k];
  return out;
}

/**
 * Refuse an API-billed configuration; answer the login method otherwise. Pure
 * over its inputs: `status` is what `codex login status` printed (stdout and
 * stderr). Only a ChatGPT plan login runs; an API key, an access token, a
 * cloud provider's key — any login that is not the plan — is refused.
 */
export function assertCodexSubscriptionLogin(env: NodeJS.ProcessEnv, status: string): string {
  for (const k of CODEX_API_BILLING_ENV) {
    if (env[k] !== undefined && env[k] !== '') throw new ApiBillingRefusedError(`\`${k}\` is set`, CODEX_LOGIN);
  }
  if (/Logged in using ChatGPT/.test(status)) return 'chatgpt';
  if (/API key/i.test(status)) throw new ApiBillingRefusedError('`codex login status` reports an API-key login', CODEX_LOGIN);
  if (/Not logged in/i.test(status) || status.trim() === '') throw new ApiBillingRefusedError('`codex login status` reports no login', CODEX_LOGIN);
  // The first line, never what follows a ` - `: the CLI prints a masked credential there.
  const line = status.trim().split('\n').find((l) => /logged in/i.test(l)) ?? status.trim().split('\n')[0]!;
  throw new ApiBillingRefusedError(`\`codex login status\` reports a login that is not a ChatGPT plan (${line.split(' - ')[0]!.trim()})`, CODEX_LOGIN);
}

/** Every `-c` override each `codex exec` turn passes: the plan login only, and no approval prompt to wait on. */
export const CODEX_TURN_CONFIG = ['forced_login_method="chatgpt"', 'approval_policy="never"'] as const;

/** The MCP server name the runner's app is served under, as in the Claude driver (`mcp__app__…`). */
export const CODEX_APP_SERVER = 'app';

/**
 * A Codex profile layer (TOML): the app's MCP server with the persona's key as
 * a header, and every server of the user's own config turned off — the answer
 * may come from the app alone. JSON string literals are valid TOML basic
 * strings, so every value and key is written through `JSON.stringify`.
 */
export function codexProfileToml(opts: { app?: { url: string; apiKey: string }; disable: readonly string[] }): string {
  const lines: string[] = [];
  if (opts.app) {
    lines.push(`[mcp_servers.${JSON.stringify(CODEX_APP_SERVER)}]`, `url = ${JSON.stringify(opts.app.url)}`, `http_headers = { Authorization = ${JSON.stringify(`Bearer ${opts.app.apiKey}`)} }`, '');
  }
  for (const name of opts.disable) lines.push(`[mcp_servers.${JSON.stringify(name)}]`, 'enabled = false', '');
  return lines.join('\n');
}

const isBag = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read `codex exec --json` output (the whole stdout, or its lines) into a turn. */
export function parseCodexJsonl(stream: string | readonly string[]): ParsedTurn {
  const lines = typeof stream === 'string' ? stream.split('\n') : stream;
  const texts: string[] = [];
  const calls: RunnerToolCall[] = [];
  const byId = new Map<string, RunnerToolCall>();
  const meta: ParsedTurn['meta'] = {};

  /** The call an item is (created on its first event), or `undefined` for an item that is no tool call. */
  const callOf = (item: Record<string, unknown>): RunnerToolCall | undefined => {
    const id = typeof item.id === 'string' ? item.id : undefined;
    const known = id ? byId.get(id) : undefined;
    if (known) return known;
    let call: RunnerToolCall | undefined;
    if (item.type === 'mcp_tool_call') {
      const tool = String(item.tool ?? '');
      call = { name: tool, rawName: `mcp__${String(item.server ?? '')}__${tool}`, input: item.arguments ?? {}, output: undefined };
    } else if (item.type === 'command_execution') {
      call = { name: 'command_execution', rawName: 'command_execution', input: { command: item.command }, output: undefined };
    } else if (item.type === 'file_change') {
      call = { name: 'file_change', rawName: 'file_change', input: { changes: item.changes }, output: undefined };
    } else if (item.type === 'web_search') {
      call = { name: 'web_search', rawName: 'web_search', input: { query: item.query }, output: undefined };
    }
    if (call) {
      calls.push(call);
      if (id) byId.set(id, call);
    }
    return call;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let ev: unknown;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue; // a torn final line from a killed process
    }
    if (!isBag(ev)) continue;

    if (ev.type === 'turn.completed') {
      meta.resultSubtype = 'success';
      meta.isError = false;
    } else if (ev.type === 'turn.failed') {
      const message = isBag(ev.error) && typeof ev.error.message === 'string' ? ev.error.message : '';
      meta.resultSubtype = `turn.failed${message ? `: ${message.slice(0, 200)}` : ''}`;
      meta.isError = true;
    } else if ((ev.type === 'item.started' || ev.type === 'item.updated' || ev.type === 'item.completed') && isBag(ev.item)) {
      const item = ev.item;
      if (item.type === 'agent_message') {
        if (ev.type === 'item.completed' && typeof item.text === 'string') texts.push(item.text);
        continue;
      }
      const call = callOf(item);
      if (!call || ev.type !== 'item.completed') continue;
      if (item.type === 'mcp_tool_call') {
        const result = isBag(item.result) ? item.result : undefined;
        const error = isBag(item.error) && typeof item.error.message === 'string' ? item.error.message : undefined;
        call.output = result ? (Array.isArray(result.content) && result.content.length > 0 ? contentText(result.content) : (result.structured_content ?? contentText(result.content))) : error;
        if (item.status === 'failed' || error !== undefined) call.isError = true;
      } else if (item.type === 'command_execution') {
        call.output = item.aggregated_output;
        if (item.status !== 'completed' || (typeof item.exit_code === 'number' && item.exit_code !== 0)) call.isError = true;
      } else if (item.type === 'file_change') {
        call.output = item.status;
        if (item.status === 'failed') call.isError = true;
      } else if (item.type === 'web_search') {
        call.output = item.results ?? null;
      }
    }
  }

  return { replyText: texts.join('\n\n'), toolCalls: calls, meta };
}

export interface CodexDriverOptions {
  /** The CLI binary; default `codex`. */
  bin?: string;
  /** Where the CLI keeps its config and login; default `$CODEX_HOME`, else `~/.codex`. The per-turn profile is written here. */
  codexHome?: string;
  /** Wall-clock budget per authoring turn (build and iterate), ms; default {@link DEFAULT_AUTHOR_TIMEOUT_MIN}. */
  authorTimeoutMs?: number;
  /** Wall-clock budget per question or operation, ms; default 5 min. */
  askTimeoutMs?: number;
  /** The model passed as `-m` on every turn; the login's default otherwise. */
  model?: string;
  /** The model for an authoring turn (build and iterate), in place of {@link model}. */
  authorModel?: string;
  /** The model for a question or operation turn, in place of {@link model}. */
  askModel?: string;
}

export class CodexDriver implements AgentDriver {
  private readonly bin: string;
  private readonly home: string;
  private readonly version: string;
  private readonly authMethod: string;
  /** The MCP servers of the user's own config, each turned off for every turn. */
  private readonly userServers: string[];

  constructor(private readonly opts: CodexDriverOptions = {}) {
    this.bin = opts.bin ?? 'codex';
    this.home = opts.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
    const env = this.env();
    const ver = spawnSync(this.bin, ['--version'], { encoding: 'utf8', env });
    if (ver.status !== 0) throw new Error(`\`${this.bin} --version\` failed: is the Codex CLI installed? ${ver.stderr ?? ''}`.trim());
    this.version = ver.stdout.trim();
    // Judged on the CALLER's environment: a key set there is a configuration
    // error worth stopping on even though every child is spawned without it.
    const status = spawnSync(this.bin, ['login', 'status'], { encoding: 'utf8', env });
    this.authMethod = assertCodexSubscriptionLogin(process.env, `${status.stdout ?? ''}\n${status.stderr ?? ''}`);
    const list = spawnSync(this.bin, ['mcp', 'list', '--json'], { encoding: 'utf8', env });
    let servers: unknown;
    try {
      servers = JSON.parse(list.stdout);
    } catch {
      /* refused below */
    }
    if (list.status !== 0 || !Array.isArray(servers)) throw new Error(`\`${this.bin} mcp list --json\` failed, so the MCP servers of your own config cannot be turned off for the run: ${(list.stderr ?? '').trim().slice(-500)}`);
    this.userServers = servers.filter(isBag).map((s) => String(s.name));
    if (this.userServers.includes(CODEX_APP_SERVER)) {
      throw new Error(`your Codex config declares an MCP server named \`${CODEX_APP_SERVER}\`, the name the runner serves the app under: rename it for the run`);
    }
  }

  private env(): NodeJS.ProcessEnv {
    return codexSubscriptionOnlyEnv({ ...process.env, CODEX_HOME: this.home });
  }

  private get authorTimeoutMs(): number {
    return this.opts.authorTimeoutMs ?? DEFAULT_AUTHOR_TIMEOUT_MIN * 60_000;
  }

  private get authorModel(): string | undefined {
    return this.opts.authorModel ?? this.opts.model;
  }

  private get askModel(): string | undefined {
    return this.opts.askModel ?? this.opts.model;
  }

  info(): DriverInfo {
    return {
      driver: 'codex-cli',
      version: this.version,
      authMethod: this.authMethod,
      apiBilled: false,
      authorTimeoutMs: this.authorTimeoutMs,
      ...(this.authorModel ? { authorModel: this.authorModel } : {}),
      ...(this.askModel ? { askModel: this.askModel } : {}),
    };
  }

  /** One `codex exec` turn under a profile written for it alone (0600), removed when the turn returns. */
  private async turn(opts: { cwd: string; prompt: string; timeoutMs: number; model: string | undefined; sandbox: string[]; profile: string }): Promise<ParsedTurn> {
    const name = `scenario-runner-${randomBytes(8).toString('hex')}`;
    const file = join(this.home, `${name}.config.toml`);
    writeFileSync(file, opts.profile, { mode: 0o600 });
    try {
      const args = [
        'exec', '--json', '--ephemeral', '--skip-git-repo-check',
        ...CODEX_TURN_CONFIG.flatMap((c) => ['-c', c]),
        '-p', name,
        ...opts.sandbox,
        '-C', opts.cwd,
        ...(opts.model ? ['-m', opts.model] : []),
        '-',
      ];
      const run = await runTurnProcess(this.bin, args, { cwd: opts.cwd, input: opts.prompt, timeoutMs: opts.timeoutMs, env: this.env() });
      const turn = parseCodexJsonl(run.stdout);
      turn.meta.process = { ...run.process, ...(opts.model ? { requestedModel: opts.model } : {}) };
      if (turn.meta.resultSubtype === undefined) turn.meta.resultSubtype = noResult(run.process);
      return turn;
    } finally {
      rmSync(file, { force: true });
    }
  }

  async author(task: AuthorTask): Promise<AuthorResult> {
    const turn = await this.turn({
      cwd: task.cwd,
      prompt: task.prompt,
      timeoutMs: this.authorTimeoutMs,
      model: this.authorModel,
      // The project directory is writable and the network open, as the Claude driver's Bash is.
      sandbox: ['-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true'],
      profile: codexProfileToml({ disable: this.userServers }),
    });
    return { turn, files: snapshotSources(task.cwd) };
  }

  async ask(task: AskTask): Promise<ParsedTurn> {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-ask-'));
    try {
      return await this.turn({
        cwd: dir,
        prompt: task.prompt,
        timeoutMs: this.opts.askTimeoutMs ?? 5 * 60_000,
        model: this.askModel,
        sandbox: ['-s', 'read-only'],
        profile: codexProfileToml({ app: { url: task.mcp.url, apiKey: task.mcp.apiKey }, disable: this.userServers }),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
