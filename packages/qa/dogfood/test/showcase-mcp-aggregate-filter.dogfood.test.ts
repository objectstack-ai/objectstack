// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #28550 — MCP `aggregate_records` and the REST query door give ONE answer to a
// per-aggregation `filter`, through the real showcase + security + MCP stack.
//
// THE DEFECT, measured by QA on the stock showcase: the MCP tool's aggregation
// entry was a non-strict zod object, so an entry's `filter` was stripped before
// the call reached the engine. The same body answered
//
//   MCP   `rows:    [{ n: 5, all: 5 }]`   (the filter dropped)
//   REST  `records: [{ n: 2, all: 5 }]`   (the filter applied)
//
// and a per-aggregation filter on a field the caller cannot read answered the
// unfiltered count through MCP, where REST refused it 403 PERMISSION_DENIED.
//
// WHAT IS PINNED. Both answers are read here, from the same principal, on the
// same rows, and compared — never a hand-computed constant on one side only:
//
//   1. the filtered and unfiltered counts agree between MCP and REST, and are
//      DIFFERENT from each other (non-vacuous: a dropped filter would make them
//      equal, which is exactly how the defect looked);
//   2. both equal the count the engine reads in system context;
//   3. a member whose permission set marks `budget` `readable: false` gets the
//      security middleware's own refusal on BOTH doors (403 PERMISSION_DENIED),
//      not an unfiltered count — the refusal comes from the engine path, since
//      `packages/mcp` evaluates no filter;
//   4. an undeclared entry key is refused by MCP, naming the key.
//
// CONTROLS. The same member's UNFILTERED count is served by both doors and
// agrees, so the refusal in (3) is the predicate's and not the member's read of
// the object.
//
// Why a private boot rather than the worker-shared showcase: this file saves a
// permission set and loads the MCP plugin, which the shared harness excludes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const OBJECT = 'showcase_project';
const SCRATCH_SET = 'showcase_scratch_mcp_aggregate_budget_deny';
const MEMBER = 'mcp-aggregate-filter@verify.test';

/** The reported body: a filtered count beside an unfiltered one. */
const FILTERED_PAIR = [
  { function: 'count', alias: 'n', filter: { status: 'active' } },
  { function: 'count', alias: 'all' },
];

function mcpBody(method: string, params?: unknown, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

describe('showcase: MCP aggregate_records honours a per-aggregation filter as REST does (#28550)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;

  /** POST /api/v1/mcp tools/call; returns `{ isError, payload }` with the text content parsed. */
  async function mcpAggregate(token: string, args: Record<string, unknown>) {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(mcpBody('tools/call', { name: 'aggregate_records', arguments: args })),
    });
    expect(res.status, `MCP transport: ${await res.clone().text()}`).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, `JSON-RPC error: ${JSON.stringify(rpc.error)}`).toBeUndefined();
    const text: string = rpc.result?.content?.[0]?.text ?? '';
    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    return { isError: rpc.result?.isError === true, payload, text };
  }

  /** POST /api/v1/data/:object/query with the same aggregation body. */
  async function restAggregate(token: string, body: Record<string, unknown>) {
    const res = await stack.apiAs(token, 'POST', `/data/${OBJECT}/query`, body);
    return { status: res.status, body: (await res.json()) as any };
  }

  async function systemCount(where: Record<string, unknown>): Promise<number> {
    return Number(await ql.count(OBJECT, { where, context: SYS }));
  }

  beforeAll(async () => {
    stack = await bootShowcase({
      extraPlugins: [new MCPServerPlugin()],
      security: showcaseAppDefaultSecurity(),
    });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');

    // A scratch set that denies READ on `budget` only: the app's everyone
    // baseline already grants read on `showcase_project`, so the set adds
    // nothing but the field deny. Object-qualified key (a bare `budget` key
    // enforces nothing).
    const authored = await stack.apiAs(adminTok, 'PUT', `/meta/permission/${SCRATCH_SET}`, {
      name: SCRATCH_SET,
      label: 'Scratch: FLS read deny on showcase_project.budget (#28550)',
      objects: {},
      fields: { [`${OBJECT}.budget`]: { readable: false, editable: false } },
    });
    expect(authored.status, 'scratch set authored through the metadata door').toBeLessThan(300);
    const ps = await catalogPermissionSet(ql, SCRATCH_SET);
    expect(ps, 'scratch permission set served by the catalog').toBeTruthy();
    const memberId = (await ql.findOne('sys_user', { where: { email: MEMBER }, context: SYS }))?.id;
    expect(memberId, 'member provisioned').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: memberId, permission_set: ps.name }, { context: SYS });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the reported body: MCP and REST give one answer, and the filter narrows it', async () => {
    const active = await systemCount({ status: 'active' });
    const total = await systemCount({});
    // Non-vacuous fixture: the seed must hold rows the filter excludes.
    expect(active, 'seeded active projects').toBeGreaterThan(0);
    expect(active, 'seeded projects that are not active').toBeLessThan(total);

    const mcp = await mcpAggregate(adminTok, { objectName: OBJECT, aggregations: FILTERED_PAIR });
    expect(mcp.isError, mcp.text).toBe(false);
    const rest = await restAggregate(adminTok, { aggregations: FILTERED_PAIR });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);

    const mcpRow = mcp.payload.rows?.[0];
    const restRow = (rest.body.records ?? rest.body.data)?.[0];
    expect({ n: Number(mcpRow?.n), all: Number(mcpRow?.all) }).toEqual({ n: active, all: total });
    expect({ n: Number(restRow?.n), all: Number(restRow?.all) }).toEqual({ n: active, all: total });
  });

  it('grouped: each group\'s filtered count agrees between MCP and REST', async () => {
    const body = {
      groupBy: ['health'],
      aggregations: [
        { function: 'count', alias: 'active_n', filter: { status: 'active' } },
        { function: 'count', alias: 'all' },
      ],
    };
    const mcp = await mcpAggregate(adminTok, { objectName: OBJECT, ...body });
    expect(mcp.isError, mcp.text).toBe(false);
    const rest = await restAggregate(adminTok, body);
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    const norm = (rows: any[]) =>
      [...rows]
        .map((r) => ({ health: r.health ?? null, active_n: Number(r.active_n), all: Number(r.all) }))
        .sort((a, b) => String(a.health).localeCompare(String(b.health)));
    expect(norm(mcp.payload.rows ?? [])).toEqual(norm(rest.body.records ?? rest.body.data ?? []));
  });

  it('an undeclared entry key is refused by MCP, naming the key', async () => {
    const mcp = await mcpAggregate(adminTok, {
      objectName: OBJECT,
      aggregations: [{ function: 'count', alias: 'n', bogusKey: 1 }],
    });
    expect(mcp.isError).toBe(true);
    expect(mcp.text).toContain('bogusKey');
  });

  it('a filter on a field the caller cannot read is refused 403 PERMISSION_DENIED on BOTH doors', async () => {
    const aggregations = [
      { function: 'count', alias: 'big', filter: { budget: { $gt: 0 } } },
      { function: 'count', alias: 'all' },
    ];
    const rest = await restAggregate(memberTok, { aggregations });
    expect(rest.status, JSON.stringify(rest.body)).toBe(403);
    expect(rest.body?.error?.code ?? rest.body?.code).toBe('PERMISSION_DENIED');

    const mcp = await mcpAggregate(memberTok, { objectName: OBJECT, aggregations });
    expect(mcp.isError, `MCP served an answer: ${mcp.text}`).toBe(true);
    expect(mcp.payload?.error?.code).toBe('PERMISSION_DENIED');
    expect(mcp.payload?.error?.status).toBe(403);
  });

  it('CONTROL — the same member\'s unfiltered count is served by both doors and agrees', async () => {
    const aggregations = [{ function: 'count', alias: 'all' }];
    const mcp = await mcpAggregate(memberTok, { objectName: OBJECT, aggregations });
    expect(mcp.isError, mcp.text).toBe(false);
    const rest = await restAggregate(memberTok, { aggregations });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    const restAll = Number((rest.body.records ?? rest.body.data)?.[0]?.all);
    expect(Number(mcp.payload.rows?.[0]?.all)).toBe(restAll);
    expect(restAll).toBeGreaterThan(0);
  });
});
