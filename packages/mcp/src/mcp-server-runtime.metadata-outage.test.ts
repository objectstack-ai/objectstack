// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6055, ADR-0110 D3 — MCP side] A metadata plane that could not be READ is
 * not an agent (or an object) that nobody declared.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `mcp-server-runtime.ts` resolved the `agent_prompt` body through
 * `metadataService.get('agent', name)` and answered its `undefined` with
 * `Error: Agent "X" not found`. `MetadataManager.get()` answers an unreachable
 * loader chain with exactly the `undefined` a never-declared name produces
 * (#5840), so during a metadata outage an MCP client was told, positively, what
 * the author had declared — from a read that never happened.
 *
 * The same shape sat one bridge over in the same file: the
 * `objectstack://objects/{objectName}` resource answered `getObject()`'s
 * `undefined` with `Object "X" not found`.
 *
 * Both were **fail-closed** — no instructions and no schema were served either
 * way — so this is a diagnosis defect, not a security one, and the fix must
 * keep it that way. Every degraded case below therefore asserts BOTH halves:
 * the answer is correctly classified, AND nothing was served.
 *
 * ---------------------------------------------------------------------------
 * Why the assertions are not `toThrow()`, and what stands in for an envelope
 * ---------------------------------------------------------------------------
 * Neither surface throws, before or after: MCP answers `prompts/get` with a
 * `GetPromptResult` and `resources/read` with a `ReadResourceResult`, and
 * neither type carries an error envelope (only `CallToolResult` has `isError`).
 * There is no ADR-0112 `code`+`status` on the wire to pin, so the strongest
 * available discriminator is used instead, per surface:
 *
 *   - the RESOURCE body is JSON, so it carries `code`/`status` structurally and
 *     both answers are pinned on them (`SERVICE_UNAVAILABLE`/503 vs
 *     `RESOURCE_NOT_FOUND`/404);
 *   - the PROMPT body is plain text, so the classification travels in the text
 *     and is pinned as: carries `SERVICE_UNAVAILABLE`, says "unknown", and does
 *     NOT say "not found".
 *
 * On top of that, every pair is pinned as a pair: the outage answer and the
 * miss answer must not be equal. That is the fact the defect was — before the
 * fix the two were byte-identical — and it is the one assertion that cannot be
 * satisfied by a mis-worded improvement.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, taken on this consumer. These doubles feed `getDiagnosed`'s
 * return contract directly, so reverting the producer (`MetadataManager`)
 * cannot move this file — only restoring the pre-#6055 reads here can. The
 * reversion is defined as: `agent_prompt` back to
 * `await metadataService.get('agent', name)` with the single `if (!raw)`, and
 * the resource back to `getObject()` with the bare
 * `{ error: 'Object "X" not found' }` body.
 *
 * Predicted, written down before running: **8 red / 9 green**, split
 * 4 red / 6 green on the prompt and 4 red / 3 green on the resource.
 *
 * ⚠️ One case is predicted GREEN in BOTH directions, and that is the point of
 * it rather than a gap: *"DEGRADED: access is still refused"*. The pre-fix code
 * served no instructions during an outage either — it was fail-closed and
 * merely mis-described — so an assertion that pins the affordance CANNOT go red
 * on this fix's reversion. It is an invariant pin, not coverage of the change,
 * and it is what would go red if a future "fix" here started serving a body.
 * Reporting it as part of the red count would be a fabricated number; the
 * measured result is recorded in the PR body as it came out.
 *
 * The doubles declare metadata reads only — no engine write verb — so there is
 * no `delete`/`update` dispatch for `check:engine-double-contract` to scan and
 * no guard to hand-mirror.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IMetadataService } from '@objectstack/spec/contracts';
import {
  buildAgentPromptResult,
  buildObjectSchemaResource,
} from './mcp-server-runtime.js';

type AnyRecord = Record<string, any>;

const LOADER_FAILURE = 'database: connect ECONNREFUSED 10.0.0.5:5432';

const AGENT = { name: 'data_chat', instructions: 'You answer questions about the data.' };
const OBJECT = { name: 'acct', label: 'Account', fields: { title: { type: 'text' } } };

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as AnyRecord;
}

/**
 * Build a metadata-service double.
 *
 * Every REQUIRED member of `IMetadataService` is present and throws, so a code
 * path that reaches one this fix should not touch fails loudly instead of
 * resolving `undefined` and looking like the very absence under test.
 */
function makeService(overrides: AnyRecord): IMetadataService {
  const unexpected = (member: string) => async () => {
    throw new Error(`double: ${member}() should not be called by this surface`);
  };
  return {
    register: unexpected('register'),
    get: unexpected('get'),
    list: unexpected('list'),
    unregister: unexpected('unregister'),
    exists: unexpected('exists'),
    listNames: unexpected('listNames'),
    getObject: unexpected('getObject'),
    listObjects: unexpected('listObjects'),
    ...overrides,
  } as unknown as IMetadataService;
}

/** Every loader behind the metadata service is down; nothing answered. */
const inOutage = (extra: AnyRecord = {}) =>
  makeService({
    get: vi.fn(async () => undefined),
    getObject: vi.fn(async () => undefined),
    getDiagnosed: vi.fn(async () => ({ data: undefined, degraded: true, errors: [LOADER_FAILURE] })),
    ...extra,
  });

/** The read HAPPENED and nobody declared this name. */
const withMiss = (extra: AnyRecord = {}) =>
  makeService({
    get: vi.fn(async () => undefined),
    getObject: vi.fn(async () => undefined),
    getDiagnosed: vi.fn(async () => ({ data: undefined, degraded: false, errors: [] })),
    ...extra,
  });

/** A healthy service holding `body`. */
const holding = (body: unknown, extra: AnyRecord = {}) =>
  makeService({
    get: vi.fn(async () => body),
    getObject: vi.fn(async () => body),
    getDiagnosed: vi.fn(async () => ({ data: body, degraded: false, errors: [] })),
    ...extra,
  });

/**
 * A service that predates `getDiagnosed` (#5840 declared it OPTIONAL). It
 * cannot report the distinction, so this surface must degrade to exactly what
 * it did before — never probe a member that is not there, never throw.
 */
const legacy = (body?: unknown) =>
  makeService({
    get: vi.fn(async () => body),
    getObject: vi.fn(async () => body),
  });

const promptText = (r: { messages: Array<{ content: { text: string } }> }) => r.messages[0].content.text;
const promptRole = (r: { messages: Array<{ role: string }> }) => r.messages[0].role;
const resourceBody = (r: { contents: Array<{ text: string }> }) => JSON.parse(r.contents[0].text);

// ─────────────────────────────────────────────────────────────────────────────
// agent_prompt — the call site the issue names
// ─────────────────────────────────────────────────────────────────────────────

describe('agent_prompt — a metadata outage is not "Agent not found" (#6055)', () => {
  it('PRESENT: serves the agent instructions (unchanged)', async () => {
    const svc = holding(AGENT);
    const result = await buildAgentPromptResult(svc, { agentName: 'data_chat' });

    expect(promptRole(result)).toBe('assistant');
    expect(promptText(result)).toContain('You answer questions about the data.');
  });

  it('PRESENT: still folds the UI context hints in (unchanged)', async () => {
    const result = await buildAgentPromptResult(holding(AGENT), {
      agentName: 'data_chat',
      objectName: 'acct',
      recordId: 'r1',
      viewName: 'all',
    });

    expect(promptText(result)).toContain('--- Current Context ---');
    expect(promptText(result)).toContain('Current object: acct');
    expect(promptText(result)).toContain('Selected record ID: r1');
    expect(promptText(result)).toContain('Current view: all');
  });

  it('GENUINELY ABSENT: the not-found answer is preserved, byte for byte', async () => {
    const result = await buildAgentPromptResult(withMiss(), { agentName: 'data_chat' });

    // Verbatim: a miss is a real fact about what the author declared, and this
    // surface was always right to state it. The fix must not reword it.
    expect(promptText(result)).toBe('Error: Agent "data_chat" not found');
  });

  it('DEGRADED: answers SERVICE_UNAVAILABLE, and never the not-found claim', async () => {
    const result = await buildAgentPromptResult(inOutage(), { agentName: 'data_chat' });
    const text = promptText(result);

    expect(text).toContain('SERVICE_UNAVAILABLE');
    expect(text).toContain('whether agent "data_chat" exists is unknown');
    expect(text).not.toMatch(/not found/);
  });

  it('DEGRADED: access is still refused — no instructions are served', async () => {
    const result = await buildAgentPromptResult(inOutage(), { agentName: 'data_chat' });

    // Fail-closed, before and after. A body here would be a security
    // regression, not a nicety — the defect was the DESCRIPTION, never the
    // affordance.
    expect(promptRole(result)).toBe('user');
    expect(promptText(result)).not.toContain(AGENT.instructions);
  });

  it('the outage and the miss no longer collapse to the same answer', async () => {
    const outage = promptText(await buildAgentPromptResult(inOutage(), { agentName: 'data_chat' }));
    const miss = promptText(await buildAgentPromptResult(withMiss(), { agentName: 'data_chat' }));

    // Same surface, same agent name, same (absent) result — only the health of
    // the metadata plane differs. Before #6055 both produced
    // `Error: Agent "data_chat" not found`.
    expect(outage).not.toBe(miss);
    expect(miss).toMatch(/not found/);
    expect(outage).toMatch(/SERVICE_UNAVAILABLE/);
  });

  it('reads through getDiagnosed, not get, when the service offers it', async () => {
    const svc = inOutage();
    await buildAgentPromptResult(svc, { agentName: 'data_chat' });

    // If `get` were still the read, the verdict would be unreachable and the
    // case above could only pass by accident.
    expect((svc as AnyRecord).getDiagnosed).toHaveBeenCalledWith('agent', 'data_chat');
    expect((svc as AnyRecord).get).not.toHaveBeenCalled();
  });

  it('logs the outage once, with the consequence and the fix', async () => {
    const logger = makeLogger();
    await buildAgentPromptResult(inOutage(), { agentName: 'data_chat' }, logger as any);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [line, detail] = logger.warn.mock.calls[0];
    expect(String(line)).toContain('no instructions were served');
    expect(String(line)).toContain('Fix:');
    expect(detail).toMatchObject({ agentName: 'data_chat', errors: [LOADER_FAILURE] });
    // A miss is not a degradation and must not log at all.
    const quiet = makeLogger();
    await buildAgentPromptResult(withMiss(), { agentName: 'data_chat' }, quiet as any);
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  it('a service that predates getDiagnosed behaves exactly as it did', async () => {
    const missing = legacy();
    expect(promptText(await buildAgentPromptResult(missing, { agentName: 'data_chat' })))
      .toBe('Error: Agent "data_chat" not found');
    expect((missing as AnyRecord).get).toHaveBeenCalledWith('agent', 'data_chat');

    const present = legacy(AGENT);
    expect(promptText(await buildAgentPromptResult(present, { agentName: 'data_chat' })))
      .toContain(AGENT.instructions);
  });

  it('a missing agentName argument is still refused before any read', async () => {
    // `makeService`'s required members all throw, so reaching a read here fails
    // the test rather than passing quietly.
    const result = await buildAgentPromptResult(makeService({}), {});
    expect(promptText(result)).toBe('Error: agentName argument is required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// objectstack://objects/{objectName} — the same family, one bridge over
// ─────────────────────────────────────────────────────────────────────────────

describe('object_schema resource — a metadata outage is not "Object not found" (#6055)', () => {
  it('PRESENT: serves the object schema (unchanged)', async () => {
    const body = resourceBody(await buildObjectSchemaResource(holding(OBJECT), 'acct'));

    expect(body).toMatchObject({ name: 'acct', label: 'Account' });
    expect(body.fields).toEqual([{ name: 'title', type: 'text', label: 'title', required: false }]);
  });

  it('PRESENT: the hit path costs no second read', async () => {
    const svc = holding(OBJECT);
    await buildObjectSchemaResource(svc, 'acct');

    // `getObject` stays the resolver: it is its own contract member, and #6055
    // declined to presume an equivalence the contract did not then document
    // (Prime Directive #12).
    //
    // [#6724] The parenthetical that used to sit here — "`MetadataFacade.
    // getObject` is NOT `get('object', name)`" — was false. The two hand back
    // the identical object on every implementation this repo ships (pinned by
    // `packages/objectql/src/metadata-service-getobject-equivalence.test.ts`,
    // PR #6839; documented on `IMetadataService.getObject` by PR #6723).
    // Whether the resolver should change is a separate call this correction
    // does not make. What this case pins is unchanged either way: the
    // diagnosed read is a verdict probe on the MISS path only.
    expect((svc as AnyRecord).getObject).toHaveBeenCalledWith('acct');
    expect((svc as AnyRecord).getDiagnosed).not.toHaveBeenCalled();
  });

  it('GENUINELY ABSENT: not-found, classified 404 / RESOURCE_NOT_FOUND', async () => {
    const body = resourceBody(await buildObjectSchemaResource(withMiss(), 'acct'));

    expect(body).toEqual({
      error: 'Object "acct" not found',
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('DEGRADED: unavailable, classified 503 / SERVICE_UNAVAILABLE, no schema served', async () => {
    const body = resourceBody(await buildObjectSchemaResource(inOutage(), 'acct'));

    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.status).toBe(503);
    expect(body.error).toContain('whether object "acct" exists is unknown');
    expect(body.error).not.toMatch(/not found/);
    // Fail-closed: still no schema.
    expect(body.fields).toBeUndefined();
    expect(body.name).toBeUndefined();
  });

  it('the outage and the miss no longer collapse to the same answer', async () => {
    const outage = resourceBody(await buildObjectSchemaResource(inOutage(), 'acct'));
    const miss = resourceBody(await buildObjectSchemaResource(withMiss(), 'acct'));

    expect(outage).not.toEqual(miss);
    expect([outage.code, outage.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expect([miss.code, miss.status]).toEqual(['RESOURCE_NOT_FOUND', 404]);
  });

  it('probes the object type by name when the resolver came back empty', async () => {
    const svc = inOutage();
    await buildObjectSchemaResource(svc, 'acct');

    expect((svc as AnyRecord).getObject).toHaveBeenCalledWith('acct');
    expect((svc as AnyRecord).getDiagnosed).toHaveBeenCalledWith('object', 'acct');
  });

  it('a service that predates getDiagnosed behaves exactly as it did', async () => {
    const missing = legacy();
    const body = resourceBody(await buildObjectSchemaResource(missing, 'acct'));

    expect(body.error).toBe('Object "acct" not found');
    expect((missing as AnyRecord).getObject).toHaveBeenCalledWith('acct');

    const present = legacy(OBJECT);
    expect(resourceBody(await buildObjectSchemaResource(present, 'acct'))).toMatchObject({
      name: 'acct',
      label: 'Account',
    });
  });
});
