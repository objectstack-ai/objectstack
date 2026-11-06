// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0106 D1/D5] MCP `describe_object` answers the same field-masked object
// schema the `/meta` door answers, on the real showcase stack: the real
// security plugin, the real REST `/meta` route, MCP over HTTP (`/api/v1/mcp`)
// and MCP over stdio under a real API key minted by the same member.
//
// D1 reads "a field the caller cannot read does not exist for that caller, on
// any plane"; `connect-mcp.mdx` promises an agent the field-level security a
// person gets. Four personas:
//
//  - a member whose scratch set marks `showcase_project.budget` `readable:
//    false`: the field is absent from REST `/meta`, from `describe_object` on
//    both transports and from the stdio object resource, and the field-name
//    sets agree across all of them;
//  - a member with no such set (the control): `budget` is served, on every door;
//  - the admin (D4-exempt): `budget` is served, and the control's answer and
//    the admin's are byte-identical, so an unrestricted caller's answer is the
//    one this tool always gave;
//  - a member whose scratch set denies every field of the object: the `/meta`
//    door refuses `503` and `describe_object` refuses with the same code and
//    status on both transports, never an object with no fields.
//
// The scratch sets live only inside this test's stack; the showcase's
// committed metadata is untouched. A private boot, because this file saves
// permission sets (the shared harness excludes that, see `shared-showcase.ts`).
//
// The stdio session is the plugin's own long-lived server over an in-process
// transport speaking the JSON-RPC a stdio client speaks (a process cannot give
// a test its stdin); every service it reads is this stack's.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin, MCPServerRuntime } from '@objectstack/mcp';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const OBJECT = 'showcase_project';
const DENIED = 'budget';
const DENY_ONE = 'showcase_scratch_mcp_schema_deny_one';
const DENY_ALL = 'showcase_scratch_mcp_schema_deny_all';
const MEMBER = 'mcp-schema-member@verify.test';
const PEER = 'mcp-schema-peer@verify.test';
const WALLED = 'mcp-schema-walled@verify.test';

/** Does `name` occur in `text` as an identifier token? */
const mentions = (text: string, name: string) => (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).includes(name);

interface ToolAnswer {
  isError: boolean;
  text: string;
  json: any;
}

const parse = (text: string) => {
  try { return JSON.parse(text); } catch { return undefined; }
};

/** An in-process MCP transport: the server's replies are matched back to the request that asked. */
function inProcessTransport() {
  const waiting = new Map<number, (frame: any) => void>();
  let nextId = 1;
  const transport: any = {
    onmessage: undefined,
    onclose: undefined,
    onerror: undefined,
    async start() {},
    async close() { transport.onclose?.(); },
    async send(message: any) {
      const resolve = typeof message?.id === 'number' ? waiting.get(message.id) : undefined;
      if (resolve) { waiting.delete(message.id); resolve(message); }
    },
  };
  const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const id = nextId++;
    const giveUp = setTimeout(() => reject(new Error(`no answer to "${method}" (id ${id}) within 10s`)), 10_000);
    waiting.set(id, (frame) => { clearTimeout(giveUp); resolve(frame); });
    transport.onmessage?.({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
  });
  return { transport, rpc, notify: (method: string) => transport.onmessage?.({ jsonrpc: '2.0', method }) };
}

describe('showcase: MCP describe_object answers the field-masked object schema the /meta door answers (ADR-0106)', () => {
  let stack: VerifyStack;
  let ql: any;
  const tokens: Record<string, string> = {};
  const keys: Record<string, string> = {};
  let declaredFields: string[];

  /** POST /api/v1/mcp `tools/call` as `token`, parsed. */
  async function httpTool(token: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status, `tools/call ${name}: ${res.status}`).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, `tools/call ${name} JSON-RPC error: ${JSON.stringify(rpc.error)}`).toBeUndefined();
    const text = rpc.result.content[0].text as string;
    return { isError: rpc.result.isError === true, text, json: parse(text) };
  }

  /** GET /meta/object/OBJECT as `token`: the status and the served item. */
  async function metaItem(token: string): Promise<{ status: number; item: any; text: string }> {
    const res = await stack.apiAs(token, 'GET', `/meta/object/${OBJECT}`);
    const text = await res.text();
    const body = parse(text);
    return { status: res.status, item: body?.item ?? body?.data?.item, text };
  }

  /**
   * A stdio session under `apiKey`: `MCPServerPlugin` with stdio started, over
   * this stack's own services, its long-lived server on an in-process
   * transport. Returns its tool and resource reads.
   */
  async function stdioSession(apiKey: string) {
    const previous = process.env.OS_MCP_STDIO_API_KEY;
    process.env.OS_MCP_STDIO_API_KEY = apiKey;
    try {
      const local = new Map<string, unknown>();
      const ctx: any = {
        registerService: vi.fn((name: string, service: unknown) => local.set(name, service)),
        getService: vi.fn((name: string) => (local.has(name) ? local.get(name) : stack.kernel.getService(name))),
        replaceService: vi.fn(),
        getServices: vi.fn(() => local),
        hook: vi.fn(),
        trigger: vi.fn(async () => {}),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        getKernel: vi.fn(() => stack.kernel),
      };
      const plugin = new MCPServerPlugin({ autoStart: true });
      await plugin.init(ctx);
      const runtime = local.get('mcp') as MCPServerRuntime;
      // `start()` would claim this process's real stdin/stdout.
      vi.spyOn(runtime, 'start').mockResolvedValue(undefined);
      await plugin.start(ctx);
      const session = inProcessTransport();
      await runtime.server.connect(session.transport as never);
      await session.rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'showcase-mcp-describe-object-field-mask', version: '0.0.0' },
      });
      session.notify('notifications/initialized');
      return {
        async tool(name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
          const frame = await session.rpc('tools/call', { name, arguments: args });
          expect(frame.error, `stdio tools/call ${name} failed at the protocol level`).toBeUndefined();
          const text = frame.result.content[0].text as string;
          return { isError: frame.result.isError === true, text, json: parse(text) };
        },
        async resource(uri: string): Promise<any> {
          const frame = await session.rpc('resources/read', { uri });
          expect(frame.error, `stdio resources/read ${uri} failed at the protocol level`).toBeUndefined();
          return parse(frame.result.contents[0].text);
        },
      };
    } finally {
      if (previous === undefined) delete process.env.OS_MCP_STDIO_API_KEY;
      else process.env.OS_MCP_STDIO_API_KEY = previous;
    }
  }

  /** Author a scratch permission set through the metadata door and grant it to `email`. */
  async function grantScratchSet(name: string, fields: Record<string, { readable: boolean; editable: boolean }>, email: string) {
    const authored = await stack.apiAs(tokens.admin!, 'PUT', `/meta/permission/${name}`, {
      name,
      label: `Scratch: ${name}`,
      description: 'Test-authored: an object-schema field deny for the MCP describe_object parity pin.',
      objects: {},
      fields,
    });
    expect(authored.status, `scratch set ${name} authored through the metadata door`).toBeLessThan(300);
    const ps = await catalogPermissionSet(ql, name);
    expect(ps, `scratch set ${name} served by the catalog`).toBeTruthy();
    const userId = (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    expect(userId, `${email} provisioned`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: ps.name }, { context: SYS });
  }

  /** Mint an API key as `token`'s user, for the stdio transport. */
  async function mintKey(token: string, name: string): Promise<string> {
    const minted = await stack.apiAs(token, 'POST', '/keys', { name });
    expect(minted.status, `mint ${name}`).toBe(201);
    const key = String(((await minted.json()) as any)?.data?.key ?? '');
    expect(key.startsWith('osk_'), `${name} is an API key`).toBe(true);
    return key;
  }

  const namesOf = (answer: ToolAnswer) => (answer.json?.fields as Array<{ name: string }> | undefined)?.map((f) => f.name) ?? [];

  beforeAll(async () => {
    stack = await bootShowcase({
      extraPlugins: [new MCPServerPlugin()],
      security: showcaseAppDefaultSecurity(),
    });
    tokens.admin = await stack.signIn();
    tokens.member = await stack.signUp(MEMBER);
    tokens.peer = await stack.signUp(PEER);
    tokens.walled = await stack.signUp(WALLED);
    ql = await stack.kernel.getServiceAsync('objectql');

    // Every field the object declares, as the exempt admin is served it.
    const whole = await metaItem(tokens.admin);
    expect(whole.status).toBe(200);
    declaredFields = Object.keys(whole.item.fields);
    expect(declaredFields, `precondition: ${OBJECT} declares ${DENIED}`).toContain(DENIED);

    const deny = { readable: false, editable: false };
    await grantScratchSet(DENY_ONE, { [`${OBJECT}.${DENIED}`]: deny }, MEMBER);
    await grantScratchSet(DENY_ALL, Object.fromEntries(declaredFields.map((f) => [`${OBJECT}.${f}`, deny])), WALLED);
    keys.member = await mintKey(tokens.member, 'mcp-schema-member-key');
    keys.walled = await mintKey(tokens.walled, 'mcp-schema-walled-key');
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await stack?.stop?.();
  });

  it('a member denied a field: absent from /meta, from describe_object over HTTP and stdio, and from the stdio resource — one field set', async () => {
    const meta = await metaItem(tokens.member);
    expect(meta.status).toBe(200);
    const metaNames = Object.keys(meta.item.fields).sort();
    expect(metaNames).not.toContain(DENIED);
    expect(metaNames.length, 'the strip is per field, not per object').toBeGreaterThan(0);

    const overHttp = await httpTool(tokens.member, 'describe_object', { objectName: OBJECT });
    expect(overHttp.isError).toBe(false);
    expect([...namesOf(overHttp)].sort(), 'MCP over HTTP serves the /meta field set').toEqual(metaNames);
    expect(mentions(overHttp.text, DENIED)).toBe(false);

    const stdio = await stdioSession(keys.member!);
    const overStdio = await stdio.tool('describe_object', { objectName: OBJECT });
    expect(overStdio.isError).toBe(false);
    expect([...namesOf(overStdio)].sort(), 'MCP over stdio serves the /meta field set').toEqual(metaNames);
    expect(mentions(overStdio.text, DENIED)).toBe(false);
    const resource = await stdio.resource(`objectstack://objects/${OBJECT}`);
    expect((resource.fields as Array<{ name: string }>).map((f) => f.name).sort()).toEqual(metaNames);

    // `list_objects` counts the fields that exist for this member.
    for (const listed of [await httpTool(tokens.member, 'list_objects', {}), await stdio.tool('list_objects', {})]) {
      expect(listed.json.objects.find((o: any) => o.name === OBJECT)?.fieldCount).toBe(metaNames.length);
    }
  });

  it('CONTROL — a member with no deny and the exempt admin are served the field, byte-identical', async () => {
    const peerMeta = await metaItem(tokens.peer);
    expect(Object.keys(peerMeta.item.fields)).toContain(DENIED);
    const peer = await httpTool(tokens.peer, 'describe_object', { objectName: OBJECT });
    const admin = await httpTool(tokens.admin, 'describe_object', { objectName: OBJECT });
    expect(namesOf(peer)).toContain(DENIED);
    expect([...namesOf(peer)].sort()).toEqual(Object.keys(peerMeta.item.fields).sort());
    // The unrestricted answer is the whole declaration, the answer this tool always gave.
    expect(peer.text).toBe(admin.text);
    expect([...namesOf(admin)].sort()).toEqual([...declaredFields].sort());
  });

  it('a member denied every field: /meta refuses 503, describe_object refuses with the same code on both transports', async () => {
    const meta = await metaItem(tokens.walled);
    expect(meta.status, meta.text).toBe(503);
    const code = parse(meta.text)?.error?.code ?? parse(meta.text)?.code;
    expect(code).toBe('FIELD_VISIBILITY_UNRESOLVED');

    const overHttp = await httpTool(tokens.walled, 'describe_object', { objectName: OBJECT });
    const stdio = await stdioSession(keys.walled!);
    const overStdio = await stdio.tool('describe_object', { objectName: OBJECT });
    for (const refused of [overHttp, overStdio]) {
      expect(refused.isError).toBe(true);
      expect({ code: refused.json?.error?.code, status: refused.json?.error?.status })
        .toEqual({ code: 'FIELD_VISIBILITY_UNRESOLVED', status: 503 });
      expect(refused.json?.fields).toBeUndefined();
      expect(mentions(refused.text, DENIED)).toBe(false);
    }
  });
});
