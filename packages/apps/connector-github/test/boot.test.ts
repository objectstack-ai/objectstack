// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Boot test: the app, booted the way `objectstack serve` composes it
 * (`bootStack` from `@objectstack/verify`), materializes its declarative
 * `github_mcp` instance against a FAKE MCP client — no call reaches GitHub.
 *
 * The one substitution is the MCP client: the app's own `ConnectorMcpPlugin`
 * is replaced (by plugin name, `BootOptions.extraPlugins`) with one whose
 * `clientFactory` answers `tools/list` and `tools/call` from a fixture and
 * records the transport it was handed. Everything else is the shipped app:
 * the connector entry, the flows, and the administrator's path to a working
 * instance — boot with no credential (the instance is degraded, naming the
 * reference), set the value through the credential door, run a flow.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
// Paid at module load, before vitest's clocked windows: both reach the whole
// runtime through their `dist/` builds.
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { ConnectorMcpPlugin, type McpClientLike, type McpTransport } from '@objectstack/connector-mcp';
import stack from '../objectstack.config.js';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REF = 'GITHUB_MCP_TOKEN';
const FIXTURE_TOKEN = 'github_pat_fixture_not_a_real_token';

/** The tools the fake server lists: the two the app includes, and one it must not expose. */
const TOOLS = [
  { name: 'search_issues', description: 'Search issues', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  {
    name: 'issue_read',
    description: 'Get issue details',
    inputSchema: {
      type: 'object',
      properties: { method: { type: 'string' }, owner: { type: 'string' }, repo: { type: 'string' }, issue_number: { type: 'number' } },
      required: ['method', 'owner', 'repo', 'issue_number'],
    },
  },
  { name: 'issue_write', description: 'Create or update issue', inputSchema: { type: 'object', properties: {} } },
];

interface Descriptor {
  name: string;
  state?: string;
  degradedReason?: string;
  actions?: Array<{ key: string }>;
}

describe('connector-github app — boot against a fake MCP server', () => {
  const transports: McpTransport[] = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let booted: VerifyStack;
  let token: string;
  const saved = process.env[REF];

  beforeAll(async () => {
    delete process.env[REF];
    const client: McpClientLike = {
      listTools: async () => TOOLS,
      callTool: async (name, args) => {
        calls.push({ name, args });
        return { content: [{ type: 'text', text: `${name} fixture answer` }] };
      },
      close: async () => {},
    };
    booted = await bootStack(stack, {
      hostRoot: APP_ROOT,
      extraPlugins: [
        new ConnectorMcpPlugin({
          clientFactory: async (transport) => {
            transports.push(transport);
            return client;
          },
        }),
      ],
    });
    token = await booted.signIn();
  }, 120_000);

  afterAll(async () => {
    await booted?.stop();
    if (saved === undefined) delete process.env[REF];
    else process.env[REF] = saved;
  });

  const descriptor = async (): Promise<Descriptor | undefined> => {
    const res = await booted.apiAs(token, 'GET', '/automation/connectors');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { connectors?: Descriptor[] } };
    return body.data?.connectors?.find((c) => c.name === 'github_mcp');
  };

  it('with no credential set, the instance is degraded naming its credentialRef and nothing was dialled', async () => {
    const gh = await descriptor();
    expect(gh, 'github_mcp is not in the connector registry').toBeDefined();
    expect(gh!.state).toBe('degraded');
    expect(gh!.degradedReason).toContain(REF);
    expect(transports).toEqual([]);
  });

  it('a flow run while the credential is unset fails, naming the credential, and dials nothing', async () => {
    const res = await booted.apiAs(token, 'POST', '/automation/github_search_issues/trigger', {
      params: { query: 'repo:acme/app is:open' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('FLOW_FAILED');
    expect(body.error?.message).toContain(REF);
    expect(calls).toEqual([]);
    expect(transports).toEqual([]);
  });

  it('once the administrator sets the credential, it materializes with only the included read tools', async () => {
    const put = await booted.apiAs(token, 'PUT', `/automation/connectors/credential-refs/${REF}`, { value: FIXTURE_TOKEN });
    expect(put.status, await put.clone().text()).toBeLessThan(300);

    let gh = await descriptor();
    for (let i = 0; i < 40 && gh?.state !== 'ready'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      gh = await descriptor();
    }
    expect(gh?.state, gh?.degradedReason).toBe('ready');
    expect(gh!.actions?.map((a) => a.key).sort()).toEqual(['issue_read', 'search_issues']);

    // The transport the executor dialled: GitHub's URL, the read-only header,
    // and the token folded into the Authorization header GitHub documents.
    const http = transports.at(-1);
    expect(http?.kind).toBe('http');
    if (http?.kind !== 'http') return;
    expect(http.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(http.headers?.['X-MCP-Readonly']).toBe('true');
    expect(http.headers?.Authorization).toBe(`Bearer ${FIXTURE_TOKEN}`);
  });

  it('github_search_issues dispatches search_issues with the query and returns its content', async () => {
    const res = await booted.apiAs(token, 'POST', '/automation/github_search_issues/trigger', {
      params: { query: 'repo:acme/app is:open label:bug' },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(calls.at(-1)).toEqual({ name: 'search_issues', args: { query: 'repo:acme/app is:open label:bug' } });
    expect(text).toContain('search_issues fixture answer');
  });

  it('github_get_issue dispatches issue_read with method get and the issue coordinates', async () => {
    const res = await booted.apiAs(token, 'POST', '/automation/github_get_issue/trigger', {
      params: { owner: 'acme', repo: 'app', issue_number: 42 },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(calls.at(-1)).toEqual({
      name: 'issue_read',
      args: { method: 'get', owner: 'acme', repo: 'app', issue_number: 42 },
    });
    expect(text).toContain('issue_read fixture answer');
  });
});
