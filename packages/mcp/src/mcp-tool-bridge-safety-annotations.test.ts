// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `bridgeTools` puts in a bridged tool's `annotations` — and what it must
 * stop putting there.
 *
 * THE DEFECT. `registerToolFromDefinition` built both safety hints from the
 * tool's NAME, as membership tests against two literal sets of seven names in
 * `mcp-server-runtime.ts`. Every other bridged tool — every tool an app
 * registers under its own name, every action-backed tool — reached each MCP
 * client as `readOnlyHint: false, destructiveHint: false`: not a missing
 * annotation but a positive claim of "not read-only, and not destructive", the
 * most permissive pair the annotation can express, over a surface where
 * `destructiveHint` is what a host reads to decide whether to interrupt the
 * user before a call. The definition already carried the answer
 * (`AIToolDefinition.requiresConfirmation`) and the bridge never read it.
 *
 * WHY THESE CASES DRIVE A REAL `StdioServerTransport`. What a client receives
 * is only visible on the wire, and the pins that were green through the whole
 * defect asserted the bridge's log line, which stays true of a bridge that
 * annotates wrongly. Each case below speaks newline-delimited JSON-RPC down a
 * real transport attached to the real long-lived server and reads
 * `tools/list`, exactly as a desktop MCP host does — the shape
 * `mcp-tool-bridge-input-schema.test.ts` established for the same call site.
 * The client harness is duplicated from that file on purpose: a pin that
 * exists to observe the wire should not be able to go green because a sibling
 * pin's helper changed.
 *
 * WHAT THE CONTROLS ARE FOR. `a platform read-only name` and `delete_field`
 * assert byte-identical annotations before and after the fix, so a red from
 * the cases around them is a statement about the change rather than about the
 * harness or the transport.
 *
 * ABSENCE IS THE ASSERTION in three cases. `toBeUndefined()` on a hint is not
 * a weaker `toBe(false)`: MCP has no spelling for "unknown" other than
 * omission, and the SDK's own `ToolAnnotationsSchema` documents the defaults
 * that then apply (`readOnlyHint` false, `destructiveHint` **true**), which is
 * the conservative reading the old `false` inverted.
 *
 * THE SECOND DEFECT, PINNED HERE TOO. `openWorldHint: false` was asserted for
 * every bridged tool from no source at all — the sibling of the above, one
 * hint later. It is now sourced the same way the `readOnlyHint` fallback is,
 * from platform-registered names (`PLATFORM_PROVIDED_TOOL_NAMES`), and
 * omitted for everyone else.
 *
 * ⚠️ AND ITS OMISSION IS PINNED DIFFERENTLY, ON PURPOSE. The same SDK schema
 * documents `openWorldHint` as **`Default: true`**, so an omitted world hint
 * is read as an OPEN world — the one place in this file where absence is not
 * the cautious answer, only the honest one. A future reader tempted to make
 * the three hints behave alike has to make these pins red first, which is the
 * point of stating it here as well as at the call site.
 *
 * ⚠️ ABSENCE MEANS AN ABSENT KEY, and these cases say so with
 * `Object.hasOwn`, not with `toBeUndefined()`. A spread of
 * `{ openWorldHint: undefined }` would satisfy `toBeUndefined()` while still
 * putting the property on the object; every such case below carries a
 * same-object positive control (a platform tool listed in the same call) so a
 * `false` from {@link hasHint} is a reading rather than a typo'd key name.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AIToolDefinition, ToolCallPart } from '@objectstack/spec/contracts';
import { PLATFORM_PROVIDED_TOOL_NAMES } from '@objectstack/spec/system';

import * as serverRuntimeModule from './mcp-server-runtime.js';
import {
  MCPServerRuntime,
  PLATFORM_READ_ONLY_TOOL_NAMES,
  PLATFORM_DESTRUCTIVE_TOOL_NAMES,
} from './mcp-server-runtime.js';
import type { ToolRegistry, ToolExecutionResult } from './types.js';

// ---------------------------------------------------------------------------
// A real stdio client: newline-delimited JSON-RPC over the transport's pipes
// ---------------------------------------------------------------------------

interface JsonRpcFrame {
  jsonrpc: string;
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

interface StdioSession {
  rpc(method: string, params?: unknown): Promise<JsonRpcFrame>;
  notify(method: string, params?: unknown): void;
  close(): Promise<void>;
}

async function openStdio(server: McpServer): Promise<StdioSession> {
  const serverStdin = new PassThrough();
  const serverStdout = new PassThrough();
  const transport = new StdioServerTransport(serverStdin, serverStdout);
  await server.connect(transport);

  let nextId = 1;
  let buffered = '';
  const waiting = new Map<number, (frame: JsonRpcFrame) => void>();

  serverStdout.on('data', (chunk: Buffer | string) => {
    buffered += String(chunk);
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line) continue;
      let frame: JsonRpcFrame;
      try {
        frame = JSON.parse(line) as JsonRpcFrame;
      } catch {
        continue;
      }
      const resolve = typeof frame.id === 'number' ? waiting.get(frame.id) : undefined;
      if (resolve && typeof frame.id === 'number') {
        waiting.delete(frame.id);
        resolve(frame);
      }
    }
  });

  return {
    rpc(method, params) {
      const id = nextId++;
      return new Promise<JsonRpcFrame>((resolve, reject) => {
        const giveUp = setTimeout(
          () => reject(new Error(`stdio: no answer to "${method}" (id ${id}) within 5s`)),
          5_000,
        );
        waiting.set(id, (frame) => {
          clearTimeout(giveUp);
          resolve(frame);
        });
        serverStdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`,
        );
      });
    },
    notify(method, params) {
      serverStdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
    },
    async close() {
      await transport.close().catch(() => {});
    },
  };
}

function makeRegistry(tools: AIToolDefinition[]): ToolRegistry {
  return {
    getAll: () => tools,
    async execute(toolCall: ToolCallPart): Promise<ToolExecutionResult> {
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: `executed ${toolCall.toolName}` },
      } as ToolExecutionResult;
    },
  };
}

/** Bridge `tools`, then read what a client sees in `tools/list`. */
async function annotationsOf(
  tools: AIToolDefinition[],
): Promise<{ session: StdioSession; byName: Record<string, any> }> {
  const runtime = new MCPServerRuntime({ name: 'annotation-pin', version: '0.0.0-test' });
  runtime.bridgeTools(makeRegistry(tools));
  const session = await openStdio(runtime.server);
  await session.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'annotation-pin', version: '0.0.0' },
  });
  session.notify('notifications/initialized');

  const listed = (await session.rpc('tools/list')).result?.tools ?? [];
  return { session, byName: Object.fromEntries(listed.map((t: any) => [t.name, t])) };
}

/**
 * Own-property presence on the PARSED WIRE object.
 *
 * ⚠️ Not `toBeUndefined()`, which a spread of `{ openWorldHint: undefined }`
 * would also satisfy while still putting the property on the object — the
 * distinction these cases exist to make. ⛔ And not `Object`.`hasOwn` either:
 * that is ES2022 and this repo compiles at `lib: ["ES2020"]`, so it type-errors
 * where the runtime (Node 22) would have run it happily — a gap this package's
 * own `typecheck` cannot report, because its tsconfig excludes test files.
 */
const hasHint = (annotations: Record<string, unknown> | undefined, hint: string): boolean =>
  Object.prototype.hasOwnProperty.call(annotations ?? {}, hint);

const tool = (name: string, extra: Partial<AIToolDefinition> = {}): AIToolDefinition => ({
  name,
  description: `the ${name} tool`,
  parameters: { type: 'object', properties: {} },
  ...extra,
});

// ---------------------------------------------------------------------------

describe('bridgeTools — the safety annotations a client receives', () => {
  let openSession: StdioSession | undefined;

  afterEach(async () => {
    await openSession?.close();
    openSession = undefined;
  });

  it('CONTROL: a platform read-only name keeps `readOnlyHint: true` (unchanged by this fix)', async () => {
    const s = await annotationsOf([tool('query_records'), tool('list_objects')]);
    openSession = s.session;

    expect(s.byName.query_records.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(s.byName.list_objects.annotations.readOnlyHint).toBe(true);
  });

  it('CONTROL: `delete_field` keeps `destructiveHint: true` (unchanged by this fix)', async () => {
    const s = await annotationsOf([tool('delete_field')]);
    openSession = s.session;

    expect(s.byName.delete_field.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it('a tool that declares `requiresConfirmation: true` is served `destructiveHint: true`', async () => {
    const s = await annotationsOf([tool('delete_opportunity', { requiresConfirmation: true })]);
    openSession = s.session;

    expect(s.byName.delete_opportunity.annotations.destructiveHint).toBe(true);
    expect(s.byName.delete_opportunity.annotations.readOnlyHint).toBe(false);
  });

  it('a tool that declares `requiresConfirmation: false` is served `destructiveHint: false` and no read-only claim', async () => {
    const s = await annotationsOf([tool('add_task_comment', { requiresConfirmation: false })]);
    openSession = s.session;

    expect(s.byName.add_task_comment.annotations.destructiveHint).toBe(false);
    expect(s.byName.add_task_comment.annotations.readOnlyHint).toBeUndefined();
  });

  it('a tool that declares nothing is served NEITHER hint — not a fabricated `false`', async () => {
    const s = await annotationsOf([tool('send_invoice_email')]);
    openSession = s.session;

    const annotations = s.byName.send_invoice_email.annotations ?? {};
    expect(annotations.destructiveHint).toBeUndefined();
    expect(annotations.readOnlyHint).toBeUndefined();
    // ...and no world hint either. `send_invoice_email` is the case in the
    // name: an app tool that reaches an outbound service was being told to
    // every client as closed-world.
    expect(hasHint(annotations, 'openWorldHint')).toBe(false);
  });

  it('what the definition declares outranks what its name suggests', async () => {
    const s = await annotationsOf([tool('query_records', { requiresConfirmation: true })]);
    openSession = s.session;

    expect(s.byName.query_records.annotations.destructiveHint).toBe(true);
    expect(s.byName.query_records.annotations.readOnlyHint).toBe(false);
  });

  it('`aggregate_records` gets no name-derived hint here — it is the object bridge\'s tool, not a platform tool name', async () => {
    const s = await annotationsOf([tool('aggregate_records')]);
    openSession = s.session;

    expect(PLATFORM_PROVIDED_TOOL_NAMES.has('aggregate_records')).toBe(false);
    expect(s.byName.aggregate_records.annotations.readOnlyHint).toBeUndefined();
    expect(s.byName.aggregate_records.annotations.destructiveHint).toBeUndefined();
    // Nor a world hint from this bridge. It gets one at its OWN registration
    // site in `mcp-http-tools.ts`, which is where that fact is known.
    expect(hasHint(s.byName.aggregate_records.annotations, 'openWorldHint')).toBe(false);
  });

  /**
   * ONE of the two directions that keep the name fallback from drifting back
   * into folklore: only a name the platform itself registers may receive a
   * hint it did not declare. Driving every platform name at once also proves
   * the fallback is a SUBSET of that registry rather than merely overlapping
   * it.
   *
   * ⚠️ Its ITERATION SOURCE is the registry, which is exactly what bounds it.
   * A name WITHDRAWN from `PLATFORM_TOOLS_BY_PACKAGE` while it stays in a
   * local set is not among the tools bridged here, so nothing drives it,
   * `annotated` never contains it, and this case stays green. The other
   * direction is pinned by the sibling describe at the foot of this file,
   * which iterates the local sets instead.
   */
  it('no tool outside `PLATFORM_PROVIDED_TOOL_NAMES` receives a hint it did not declare', async () => {
    const platform = [...PLATFORM_PROVIDED_TOOL_NAMES].map((name) => tool(name));
    const strangers = [
      'aggregate_records',
      'delete_record',
      'void_invoice',
      'archive_account',
      'delete_opportunity',
      'send_invoice_email',
    ].map((name) => tool(name));

    const s = await annotationsOf([...platform, ...strangers]);
    openSession = s.session;

    const annotated = Object.values(s.byName)
      .filter((t: any) => t.annotations?.readOnlyHint !== undefined || t.annotations?.destructiveHint !== undefined)
      .map((t: any) => t.name)
      .sort();

    expect(annotated.length).toBeGreaterThan(0);
    for (const name of annotated) {
      expect(PLATFORM_PROVIDED_TOOL_NAMES.has(name)).toBe(true);
    }
    for (const stranger of strangers) {
      expect(s.byName[stranger.name].annotations.readOnlyHint).toBeUndefined();
      expect(s.byName[stranger.name].annotations.destructiveHint).toBeUndefined();
    }
  });

  // ── openWorldHint ────────────────────────────────────────────────────────

  it('CONTROL: a platform-registered name still receives `openWorldHint: false`', async () => {
    const s = await annotationsOf([
      tool('query_records'),
      tool('list_objects'),
      // Platform names OUTSIDE the two safety-class sets. These are the tools
      // a fallback keyed on those sets instead of the registry would have
      // silently flipped to the protocol's open-world default.
      tool('create_object'),
      tool('list_metadata'),
      tool('describe_metadata'),
    ]);
    openSession = s.session;

    for (const name of ['query_records', 'list_objects', 'create_object', 'list_metadata', 'describe_metadata']) {
      expect(PLATFORM_PROVIDED_TOOL_NAMES.has(name)).toBe(true);
      expect(s.byName[name].annotations.openWorldHint).toBe(false);
    }
    // The safety hints are sourced separately: `create_object` is a platform
    // name in NEITHER safety set, so it keeps the world hint and no other.
    expect(s.byName.create_object.annotations.readOnlyHint).toBeUndefined();
    expect(s.byName.create_object.annotations.destructiveHint).toBeUndefined();
  });

  it('an app-registered tool receives NO `openWorldHint` KEY — absence, not `undefined`', async () => {
    const s = await annotationsOf([
      tool('check_weather'),
      tool('ask_llm', { requiresConfirmation: false }),
      tool('delete_opportunity', { requiresConfirmation: true }),
      // Positive control in the same `tools/list` answer: `hasOwn` must be
      // able to say `true` about this exact wire object, or the `false`s
      // below would be indistinguishable from a misspelled key.
      tool('query_records'),
    ]);
    openSession = s.session;

    expect(hasHint(s.byName.query_records.annotations, 'openWorldHint')).toBe(true);

    for (const name of ['check_weather', 'ask_llm', 'delete_opportunity']) {
      const annotations = s.byName[name].annotations ?? {};
      expect(hasHint(annotations, 'openWorldHint')).toBe(false);
      expect(annotations.openWorldHint).toBeUndefined();
    }

    // Independently sourced: declaring `requiresConfirmation` buys the SAFETY
    // hints and buys nothing about the world, which is the whole point of the
    // two derivations being separate.
    expect(s.byName.delete_opportunity.annotations.destructiveHint).toBe(true);
    expect(s.byName.ask_llm.annotations.destructiveHint).toBe(false);
  });

  /**
   * The world-hint counterpart of the fallback invariant above, driven across
   * the whole registry at once: `openWorldHint: false` is a claim the platform
   * can source about the tools it registers, and about nothing else.
   */
  it('exactly the platform-registered names carry `openWorldHint`, and every one of them carries `false`', async () => {
    const platform = [...PLATFORM_PROVIDED_TOOL_NAMES].map((name) => tool(name));
    const strangers = [
      'aggregate_records',
      'action_close_deal',
      'check_weather',
      'send_invoice_email',
      'void_invoice',
    ].map((name) => tool(name));

    const s = await annotationsOf([...platform, ...strangers]);
    openSession = s.session;

    const withWorldHint = Object.values(s.byName)
      .filter((t: any) => hasHint(t.annotations, 'openWorldHint'))
      .map((t: any) => t.name)
      .sort();

    // ⚠️ Non-vacuity first: `toEqual` between two empty arrays passes, so an
    // unbuilt or empty registry would make every assertion below say nothing.
    expect(PLATFORM_PROVIDED_TOOL_NAMES.size).toBeGreaterThan(0);
    expect(withWorldHint.length).toBe(PLATFORM_PROVIDED_TOOL_NAMES.size);
    expect(withWorldHint).toEqual([...PLATFORM_PROVIDED_TOOL_NAMES].sort());
    for (const name of withWorldHint) {
      expect(s.byName[name].annotations.openWorldHint).toBe(false);
    }

    // `action_close_deal` is the family case stated explicitly: the runtime
    // materialises `action_<name>` wrappers around an app's OWN actions, so a
    // membership test widened to `PLATFORM_TOOL_FAMILY_PREFIXES` would put
    // this bridge back to claiming a closed world over app-defined behaviour.
    expect(hasHint(s.byName.action_close_deal.annotations, 'openWorldHint')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE DIRECTION THE CASE ABOVE CANNOT SEE (#13486).
 *
 * `safetyAnnotations` keeps two literal name sets that are hand copies of
 * `PLATFORM_TOOLS_BY_PACKAGE`. The registry-driven pin above catches a name
 * added to a set but never registered. It is structurally blind to the
 * reverse: a name REMOVED from the registry while it stays in a set is simply
 * not one of the tools that pin bridges, so nothing drives it and the case
 * stays green.
 *
 * ⚠️ WHY THAT REVERSE MATTERS WHILE THE DATA IS CLEAN. The harm is not "a tool
 * the platform no longer registers keeps a hint" — that tool is gone. These
 * sets annotate BY NAME, so once a name leaves the registry, a PLUGIN
 * registering a tool of that name inherits a `readOnlyHint` it never declared.
 * A safety annotation acquired by name collision, from a stale literal.
 *
 * THE ITERATION SOURCE IS THE POINT. These cases iterate the two sets — the
 * thing that can drift — and check each name against the registry. ⛔ The
 * names are never re-typed here: a hard-coded list of the six would be a THIRD
 * hand copy, i.e. the defect this pins, and it would pin a copy against a copy
 * without ever reading what `safetyAnnotations` actually consults.
 *
 * These cases deliberately do not drive the transport. The wire behaviour of
 * both sets is already pinned by the two CONTROL cases at the head of this
 * file; what is unpinned is the CONTENT of the sets, which is data.
 */
describe('the hand-maintained safety name sets cannot drift out of the registry', () => {
  /**
   * The sets under test, keyed by their module-export name so a failure names
   * the set to edit. VALUES are imported, never re-typed — see above.
   */
  const COVERED_SETS: Readonly<Record<string, ReadonlySet<string>>> = {
    PLATFORM_READ_ONLY_TOOL_NAMES,
    PLATFORM_DESTRUCTIVE_TOOL_NAMES,
  };

  it('every name in the two safety sets is still a name the platform registers', () => {
    // Non-vacuity first, on both sides: an empty registry would make every
    // `has()` below false rather than silently true, but an empty SET would
    // make the loop run zero times and pass saying nothing.
    expect(PLATFORM_PROVIDED_TOOL_NAMES.size).toBeGreaterThan(0);

    const checked: string[] = [];
    for (const [setName, names] of Object.entries(COVERED_SETS)) {
      expect(names.size).toBeGreaterThan(0);
      for (const name of names) {
        checked.push(name);
        expect(
          PLATFORM_PROVIDED_TOOL_NAMES.has(name),
          `\`${setName}\` still carries \`${name}\`, which \`PLATFORM_TOOLS_BY_PACKAGE\` no longer registers. ` +
            `Delete the name from the set — do NOT widen the registry to match it. ` +
            `Left there, any plugin registering a tool called \`${name}\` inherits a safety hint it never declared.`,
        ).toBe(true);
      }
    }
    expect(checked.length).toBeGreaterThan(0);
  });

  /**
   * ⚠️ The case above can only iterate the sets it was told about. A third
   * name-keyed set added to `mcp-server-runtime.ts` would be annotating tools
   * with nothing holding its contents to the registry, and no existing
   * assertion would notice — the same silence, one set over.
   *
   * This guard closes that by discovering the sets from the module's own
   * exports. It cannot see a set that is left PRIVATE, which is why the source
   * docblock instructs the author to export it; what it can do is refuse to
   * let an exported one go unpinned.
   */
  it('COVERAGE GUARD: every name-keyed safety set the module exports is covered above', () => {
    const exported = Object.entries(serverRuntimeModule)
      .filter(([name, value]) => /^PLATFORM_[A-Z0-9_]*_TOOL_NAMES$/.test(name) && value instanceof Set)
      .map(([name]) => name)
      .sort();

    // Non-vacuity: without this, a regex that matches nothing would leave two
    // empty arrays agreeing with each other.
    expect(exported.length).toBeGreaterThan(0);
    expect(exported).toEqual(Object.keys(COVERED_SETS).sort());
  });
});
