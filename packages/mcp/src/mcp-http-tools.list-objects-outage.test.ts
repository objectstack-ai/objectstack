// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6504 (consumer sweep) — the `list_objects` TOOL publishes `totalCount`, and
 * a count taken over a known-partial listing is the strongest false claim a
 * read can make.
 *
 * ---------------------------------------------------------------------------
 * Why this surface, when PR #7721 already closed its sibling
 * ---------------------------------------------------------------------------
 * PR #7721 fixed `objectstack://objects` — the RESOURCE — because it rendered
 * `{ objects, totalCount }` and told an MCP client, with a number, that the
 * environment contained fewer objects than it does. The `list_objects` TOOL
 * renders the SAME payload from the same underlying listing and was not
 * covered: the resource is served by `MCPServerRuntime` off `IMetadataService`
 * directly, while the tool is served through the injected `McpDataBridge` (the
 * stdio bridge in this package, the HTTP bridge in `packages/runtime`), so the
 * two paths never met. A client asking "how many objects does this app have?"
 * therefore got an honest answer over one door and a confident wrong integer
 * over the other, depending on which primitive it happened to use.
 *
 * The fix is the resource's, in the resource's words: withhold the CLAIM, not
 * the data. Healthy stays byte-identical; degraded serves the same objects with
 * `totalCount` ABSENT and `partial` / `returnedCount` / `warning` plus the 503
 * envelope in its place. A client reading `totalCount` then gets `undefined` —
 * which fails, or renders as nothing — where a plausible integer would have
 * been believed.
 *
 * ---------------------------------------------------------------------------
 * DOUBLES HERE, and where the real loader failure is pinned instead
 * ---------------------------------------------------------------------------
 * `packages/mcp` does not depend on `@objectstack/metadata` — adding it for a
 * test would be a larger change than the fix — so the bridge below is a double,
 * the same split PR #7721 and #6055 both took and stated rather than papered
 * over. The verdict these doubles hand back is the exact shape
 * `MetadataManager.listDiagnosed()` returns from a live `ECONNRESET`, pinned
 * against a real `DatabaseLoader` in
 * `packages/metadata/src/metadata-manager-list-diagnosed.test.ts` and, for this
 * sweep's consumer half, in
 * `packages/runtime/src/list-diagnosed-consumer-sweep.test.ts` — which drives
 * the runtime's implementation of this very bridge member off a real failing
 * loader. What is pinned HERE is the only thing that lives here: what the tool
 * renders once it holds the verdict.
 *
 * Everything below drives the REAL MCP HTTP transport (`tools/call`), not the
 * handler in isolation, so the payload asserted is the one a client receives.
 *
 * ---------------------------------------------------------------------------
 * Both directions, on the COUNT
 * ---------------------------------------------------------------------------
 * The load-bearing pair is two answers with the SAME objects and the same
 * length — one from an outage, one from a genuinely small environment — where
 * only the presence of `totalCount` may differ. A test asserting merely that
 * `partial` appears would pass on a build that also kept publishing the wrong
 * total beside it, which is the failure this is guarding against, so the
 * ABSENCE of the key is asserted explicitly in the degraded direction and its
 * presence in the healthy one.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red. Reversion is defined as restoring the pre-#6504 tool body —
 * `const objects = await bridge.listObjects()` and an unconditional
 * `{ objects: visible, totalCount: visible.length }` — leaving
 * `listObjectsDiagnosed` declared on the interface and implemented on both
 * bridges, but unread. That is the *declared-but-unconsumed* shape, and it is
 * the ablation worth taking, because a whole-file revert would also delete the
 * interface member and turn the optionality cases red for the wrong reason.
 *
 * Predicted, written down before running: **3 red / 3 green** of the 6. Red are
 * the three cases that discriminate on the withheld claim (the degraded
 * payload, the same-count pair, and the system-object filter's
 * `returnedCount`). Green are the healthy byte-identical case and both
 * optionality cases — a bridge with no diagnosed member takes the same code
 * path in either direction, which is exactly what makes the member optional.
 * Measured result is recorded in the PR body as it came out.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge, McpObjectSummary } from './mcp-http-tools.js';

const LOADER_FAILURE = 'database: read ECONNRESET';

/** The one object that survived the outage, plus a system object for the filter case. */
const READABLE: McpObjectSummary[] = [
  { name: 'task', label: 'Task', fieldCount: 4 },
  { name: 'sys_user', label: 'User', fieldCount: 9 },
];

type BridgeOpts = {
  objects?: McpObjectSummary[];
  /** Omit entirely to model a bridge predating #6504 (the member is optional). */
  diagnosed?: { degraded: boolean; errors: string[] } | 'absent';
};

function makeBridge(opts: BridgeOpts = {}): McpDataBridge {
  const objects = opts.objects ?? READABLE;
  const bridge: any = {
    async listObjects() { return objects; },
    async describeObject(name: string) { return { name }; },
    async query() { return { records: [] }; },
    async get() { return {}; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return { success: true }; },
  };
  if (opts.diagnosed !== 'absent') {
    const verdict = opts.diagnosed ?? { degraded: false, errors: [] };
    bridge.listObjectsDiagnosed = async () => ({ objects, ...verdict });
  }
  return bridge as McpDataBridge;
}

/** Call `list_objects` over the real transport and hand back its parsed body. */
async function listObjects(
  runtime: MCPServerRuntime,
  bridge: McpDataBridge,
  toolOptions?: Record<string, unknown>,
): Promise<any> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'list_objects', arguments: {} },
  };
  const res = await runtime.handleHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
    { bridge, parsedBody: body, ...(toolOptions ? { toolOptions } : {}) } as any,
  );
  const json: any = await res.json();
  expect(json.error, 'precondition: the tool must have answered').toBeUndefined();
  expect(json.result?.isError, 'precondition: the tool must not have errored').not.toBe(true);
  return JSON.parse(json.result.content[0].text);
}

describe('#6504 — list_objects withholds its totalCount on a known-partial listing', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 't', version: '1.0.0' });
  });

  it('healthy: `{ objects, totalCount }`, unchanged — a complete read may state its count', async () => {
    const body = await listObjects(runtime, makeBridge({ diagnosed: { degraded: false, errors: [] } }));

    expect(body.totalCount).toBe(1);
    expect(body.objects.map((o: any) => o.name)).toEqual(['task']);
    // Nothing from the degraded branch leaks into a healthy answer.
    expect(body.partial).toBeUndefined();
    expect(body.warning).toBeUndefined();
    expect(body.code).toBeUndefined();
  });

  it('degraded: the SAME objects, `totalCount` ABSENT, and a structural 503 envelope', async () => {
    const body = await listObjects(
      runtime,
      makeBridge({ diagnosed: { degraded: true, errors: [LOADER_FAILURE] } }),
    );

    // The data is still served — this is a diagnosis fix, not a functional one.
    expect(body.objects.map((o: any) => o.name)).toEqual(['task']);

    // The claim, and only the claim, is withheld. `undefined` rather than a
    // smaller integer is the entire point: a client reading it fails loudly
    // instead of believing a number nobody established.
    expect(body.totalCount).toBeUndefined();
    expect('totalCount' in body, 'the key must be ABSENT, not present-and-nullish').toBe(false);

    expect(body.partial).toBe(true);
    expect(body.returnedCount).toBe(1);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.status).toBe(503);
    expect(body.warning).toMatch(/known to be INCOMPLETE/);
    // The sentence names the served count as a FLOOR, never as a total.
    expect(body.warning).toMatch(/at least that many objects/);
  });

  it('the outage and the small environment differ ONLY in the claim, never in the data', async () => {
    // The pair that gives the verdict meaning: byte-equal object lists, equal
    // lengths, opposite entitlement to publish a total.
    const outage = await listObjects(
      runtime,
      makeBridge({ diagnosed: { degraded: true, errors: [LOADER_FAILURE] } }),
    );
    const small = await listObjects(
      runtime,
      makeBridge({ diagnosed: { degraded: false, errors: [] } }),
    );

    expect(outage.objects).toEqual(small.objects);
    expect(outage.objects).toHaveLength(small.objects.length);
    expect(small.totalCount).toBe(1);
    expect(outage.totalCount).toBeUndefined();
    expect(outage.returnedCount).toBe(small.totalCount);
  });

  it('`returnedCount` counts what is SERVED — after the system-object filter, not before', async () => {
    // Naming the pre-filter number would restate the same over-claim one field
    // along: the client can see two objects and would be told about three.
    const body = await listObjects(
      runtime,
      makeBridge({
        objects: [
          { name: 'task' },
          { name: 'invoice' },
          { name: 'sys_user' },
        ],
        diagnosed: { degraded: true, errors: [LOADER_FAILURE] },
      }),
      { allowSystemObjects: false },
    );

    expect(body.objects.map((o: any) => o.name)).toEqual(['task', 'invoice']);
    expect(body.returnedCount).toBe(2);
    expect(body.warning).toMatch(/2 are being served/);
  });

  it('a bridge PREDATING listObjectsDiagnosed behaves exactly as before', async () => {
    // The optionality is the bridge's own graceful-degradation contract, and a
    // host that cannot ask its metadata service for a verdict must not have one
    // invented for it.
    const body = await listObjects(runtime, makeBridge({ diagnosed: 'absent' }));

    expect(body.totalCount).toBe(1);
    expect(body.partial).toBeUndefined();
  });

  it('a bridge predating it does not become "degraded" merely by being old', async () => {
    // The direction that matters for a false ALARM: absence of the member is
    // "cannot report", never "known-partial". Asserted separately from the case
    // above because that one would also pass if the 503 envelope were emitted
    // alongside a totalCount.
    const body = await listObjects(runtime, makeBridge({ diagnosed: 'absent' }));

    expect(body.code).toBeUndefined();
    expect(body.status).toBeUndefined();
    expect(body.warning).toBeUndefined();
    expect(body.returnedCount).toBeUndefined();
  });
});
