// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Claude Code's headless output (`claude -p --output-format stream-json
 * --verbose`) read into the plain `{ replyText, toolCalls }` turn the Run
 * graders take (`RunTranscript`, `@objectstack/scenarios/score`).
 *
 * The stream is one JSON object per line. The shapes this reads were measured
 * against Claude Code 2.1 (the runner's PR records the reading):
 *
 *   {"type":"system","subtype":"init","model":…,"mcp_servers":[{name,status}]}
 *   {"type":"assistant","message":{"content":[{type:"text",text} |
 *                                              {type:"tool_use",id,name,input} | …]}}
 *   {"type":"user","message":{"content":[{type:"tool_result",tool_use_id,
 *                                         content: string | [{type:"text",text}…],
 *                                         is_error?}]}}
 *   {"type":"result","subtype":"success"|…,"is_error","num_turns","result",
 *    "total_cost_usd"}
 *
 * A tool call is paired with its result by id; a call that never got a result
 * keeps `output: undefined` (the turn was cut short — reported, not hidden).
 * MCP tool names arrive prefixed `mcp__<server>__`; the prefix is dropped so a
 * call reads as the app's own tool name (`query_records`), which is what the
 * observation builder and the leak grader match on.
 *
 * Every assistant text block joins into `replyText` — the reply the asker
 * reads includes the narration between tool calls, so a value leaked there is
 * a leak. The final `result` text is not appended again: it repeats the last
 * text block.
 */

import type { RunToolCall, RunTranscript } from '../score/index.js';

/** A tool call as the runner keeps it: the graders' shape plus the error flag. */
export interface RunnerToolCall extends RunToolCall {
  /** The tool result was flagged `is_error`. */
  isError?: boolean;
  /** The name as the stream carried it (`mcp__app__query_records`). */
  rawName: string;
}

/**
 * What the live driver saw of the CLI process behind a turn — no part of the
 * stream itself. It travels in `meta` so a recording carries it and a replay
 * re-reads a killed or failed turn as the run saw it.
 */
export interface TurnProcess {
  /** Wall-clock time from spawn to exit, ms. */
  elapsedMs: number;
  /** The exit code; `null` when the process ended on a signal or never started. */
  exit: number | null;
  signal?: string;
  /** The runner's own timeout (`timeoutMs`) killed it with SIGTERM. */
  timedOut: boolean;
  timeoutMs: number;
  /**
   * The `--max-turns` the CLI was given: a turn that reaches it ends
   * `error_max_turns`. Absent on a turn recorded before the runner kept it.
   */
  maxTurns?: number;
  /**
   * The `--model` the CLI was given; absent ⇒ none, the login's default. The
   * model it was served is the stream's own `meta.model`.
   */
  requestedModel?: string;
  /** The end of what the CLI wrote to stderr (at most 2,000 characters). */
  stderrTail?: string;
  /** The process could not be started or fed its prompt (`spawn ENOENT`, `write EPIPE`). */
  error?: string;
}

export interface ParsedTurn extends RunTranscript {
  toolCalls: RunnerToolCall[];
  meta: {
    /** Set by the live driver, absent on a parse alone ({@link TurnProcess}). */
    process?: TurnProcess;
    /** The model the session was served, from the stream's init line (`claude-sonnet-4-5-20250929`). */
    model?: string;
    /** MCP servers the session reported at init, with their connection status. */
    mcpServers?: Array<{ name: string; status: string }>;
    numTurns?: number;
    /** The result line's `subtype` (`success`, `error_max_turns`, …); absent ⇒ the stream ended without one. */
    resultSubtype?: string;
    isError?: boolean;
    /**
     * The CLI's own cost estimate. Under a subscription login it is notional —
     * nothing is billed per token — and the run record says which login ran.
     */
    reportedCostUsd?: number;
  };
}

const MCP_PREFIX = /^mcp__.+?__/;

/** `mcp__app__query_records` → `query_records`; any other name unchanged. */
export function toolNameOf(raw: string): string {
  return raw.replace(MCP_PREFIX, '');
}

function isBag(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A tool result's content as the text the model was given. */
function resultText(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.filter(isBag).filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text as string);
    if (texts.length === content.length) return texts.join('\n');
    return content;
  }
  return content;
}

/** Parse a stream-json transcript (the whole stdout, or its lines). */
export function parseStreamJson(stream: string | readonly string[]): ParsedTurn {
  const lines = typeof stream === 'string' ? stream.split('\n') : stream;
  const texts: string[] = [];
  const calls: RunnerToolCall[] = [];
  const byId = new Map<string, RunnerToolCall>();
  const meta: ParsedTurn['meta'] = {};

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

    if (ev.type === 'system' && ev.subtype === 'init') {
      if (typeof ev.model === 'string') meta.model = ev.model;
      if (Array.isArray(ev.mcp_servers)) {
        meta.mcpServers = ev.mcp_servers.filter(isBag).map((s) => ({ name: String(s.name), status: String(s.status) }));
      }
    } else if (ev.type === 'result') {
      if (typeof ev.subtype === 'string') meta.resultSubtype = ev.subtype;
      if (typeof ev.is_error === 'boolean') meta.isError = ev.is_error;
      if (typeof ev.num_turns === 'number') meta.numTurns = ev.num_turns;
      if (typeof ev.total_cost_usd === 'number') meta.reportedCostUsd = ev.total_cost_usd;
    } else if ((ev.type === 'assistant' || ev.type === 'user') && isBag(ev.message) && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (!isBag(block)) continue;
        if (ev.type === 'assistant' && block.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text);
        } else if (ev.type === 'assistant' && block.type === 'tool_use' && typeof block.id === 'string') {
          const rawName = String(block.name ?? '');
          const call: RunnerToolCall = { name: toolNameOf(rawName), rawName, input: block.input ?? {}, output: undefined };
          calls.push(call);
          byId.set(block.id, call);
        } else if (ev.type === 'user' && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const call = byId.get(block.tool_use_id);
          if (!call) continue;
          call.output = resultText(block.content);
          if (block.is_error === true) call.isError = true;
        }
      }
    }
  }

  return { replyText: texts.join('\n\n'), toolCalls: calls, meta };
}

/** A coded refusal inside a tool output: the scorer's reading, re-exported here where the runner reads it. */
export { refusalCodeOf, refusalOf } from '../score/scenario-run-grade.js';
