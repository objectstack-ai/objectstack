// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `agent_prompt` is advertised only where an agent can answer it.
 *
 * The long-lived server (the one the stdio transport serves) used to register
 * `agent_prompt` unconditionally, with an `agentName` argument described as
 * `e.g. "ask", "build"`. On an open-framework boot that registers no agent at
 * all, `prompts/list` therefore advertised a prompt nothing could serve, its
 * description taught two names that resolve to nothing, and `prompts/get`
 * answered each of them with a SUCCESSFUL prompt result whose one message is
 * `Error: Agent "ask" not found` — text an MCP client hands its model as
 * instructions.
 *
 * The skill projection in the same file already follows "declared IS served":
 * a skill that cannot be served is not listed, and a get on it is a JSON-RPC
 * -32602. These pins hold `agent_prompt` to the same rule:
 *
 * - no agent registered, and the read says so ⇒ not listed; a get is the
 *   protocol's own unknown-prompt error, not a fabricated success;
 * - agents registered ⇒ listed, the argument names only registered agents,
 *   and a miss answers exactly what it answered before (#6055 kept that text
 *   byte-stable on purpose);
 * - the read could not say (degraded, or it threw) ⇒ still listed: an outage
 *   is not absence, and the prompt then answers the honest #6055 outage text
 *   at get time. The argument names no agent, since none is known.
 *
 * Driven over the real wire (an in-memory transport into the same `McpServer`
 * the stdio transport attaches to): the decision under test is what a client
 * can list and fetch, so the client's view is the assertion.
 */

import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MCPServerRuntime } from './mcp-server-runtime.js';

const SKILL = {
  name: 'case_management',
  label: 'Case Management',
  description: 'Handles support case lifecycle',
  instructions: 'Triage the case, then resolve it once the caller confirms.',
  active: true,
};

const AGENT = {
  name: 'support_triage',
  label: 'Support Triage',
  instructions: 'You triage support cases.',
  active: true,
};

interface ServiceShape {
  agents?: unknown[];
  skills?: unknown[];
  agentList?: () => Promise<{ items: unknown[]; degraded: boolean; errors: string[] }>;
}

function metadataService({ agents = [], skills = [SKILL], agentList }: ServiceShape = {}) {
  const byName = (items: unknown[], name: string) =>
    (items as Array<{ name: string }>).find((i) => i.name === name) ?? undefined;
  return {
    listObjects: vi.fn(async () => []),
    getObject: vi.fn(async () => undefined),
    get: vi.fn(async (type: string, name: string) => {
      if (type === 'agent') return byName(agents, name);
      if (type === 'skill') return byName(skills, name);
      return undefined;
    }),
    list: vi.fn(async (type: string) => {
      if (type === 'agent') return agents;
      if (type === 'skill') return skills;
      return [];
    }),
    listDiagnosed: vi.fn(async (type: string) => {
      if (type === 'agent' && agentList) return agentList();
      const items = type === 'agent' ? agents : type === 'skill' ? skills : [];
      return { items, degraded: false, errors: [] };
    }),
    exists: vi.fn(async () => false),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

async function connect(service: ReturnType<typeof metadataService>, log = logger()) {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9', logger: log as never });
  await runtime.bridgePrompts(service as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    log,
    close: async () => {
      await client.close();
      await runtime.stop().catch(() => {});
    },
  };
}

function agentNameDescription(prompts: Array<{ name: string; arguments?: Array<{ name: string; description?: string }> }>) {
  const prompt = prompts.find((p) => p.name === 'agent_prompt');
  return prompt?.arguments?.find((a) => a.name === 'agentName')?.description;
}

describe('agent_prompt — advertised only where an agent can answer it', () => {
  it('a boot that registers no agent does not list agent_prompt', async () => {
    const session = await connect(metadataService({ agents: [] }));
    try {
      const listed = await session.client.listPrompts();
      const names = listed.prompts.map((p) => p.name);
      // The skill is still projected, so the absence below is a decision about
      // this one prompt, not an empty or missing prompt surface.
      expect(names).toContain('case_management');
      expect(names).not.toContain('agent_prompt');
    } finally {
      await session.close();
    }
  });

  it('a get of agent_prompt on that boot is the protocol error, not a successful "not found" message', async () => {
    const session = await connect(metadataService({ agents: [] }));
    try {
      const outcome = await session.client
        .getPrompt({ name: 'agent_prompt', arguments: { agentName: 'ask' } })
        .then((result) => ({ result, error: undefined }), (error: { code?: number }) => ({ result: undefined, error }));
      expect(outcome.result).toBeUndefined();
      expect(outcome.error?.code).toBe(-32602);
    } finally {
      await session.close();
    }
  });

  it('says once at boot why the prompt is not advertised', async () => {
    const session = await connect(metadataService({ agents: [] }));
    try {
      const lines = session.log.info.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('agent_prompt') && l.includes('no agent'))).toBe(true);
      expect(lines).not.toContain('[MCP] Agent prompts bridged');
    } finally {
      await session.close();
    }
  });

  it('a boot with agents lists it, and the argument names only agents the boot holds', async () => {
    const session = await connect(metadataService({ agents: [AGENT] }));
    try {
      const listed = await session.client.listPrompts();
      expect(listed.prompts.map((p) => p.name)).toContain('agent_prompt');
      const description = agentNameDescription(listed.prompts);
      expect(description).toContain('"support_triage"');
      expect(description).not.toContain('"ask"');
      expect(description).not.toContain('"build"');
      expect(session.log.info).toHaveBeenCalledWith('[MCP] Agent prompts bridged');
    } finally {
      await session.close();
    }
  });

  it('on that boot a registered agent is served and a miss answers exactly as before (#6055)', async () => {
    const session = await connect(metadataService({ agents: [AGENT] }));
    try {
      const served = await session.client.getPrompt({ name: 'agent_prompt', arguments: { agentName: 'support_triage' } });
      expect(served.messages[0].content).toEqual({ type: 'text', text: 'You triage support cases.' });

      const miss = await session.client.getPrompt({ name: 'agent_prompt', arguments: { agentName: 'nope' } });
      expect(miss.messages).toEqual([
        { role: 'user', content: { type: 'text', text: 'Error: Agent "nope" not found' } },
      ]);
    } finally {
      await session.close();
    }
  });

  it('an agent read that reports itself degraded keeps the prompt listed, naming no agent', async () => {
    const session = await connect(
      metadataService({
        agentList: async () => ({ items: [], degraded: true, errors: ['loader sys_metadata: connection refused'] }),
      }),
    );
    try {
      const listed = await session.client.listPrompts();
      expect(listed.prompts.map((p) => p.name)).toContain('agent_prompt');
      const description = agentNameDescription(listed.prompts) ?? '';
      expect(description).not.toContain('"ask"');
      expect(description).not.toContain('e.g.');
      expect(session.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('agent_prompt'),
        expect.objectContaining({ errors: ['loader sys_metadata: connection refused'] }),
      );
    } finally {
      await session.close();
    }
  });

  it('an agent read that throws keeps the prompt listed', async () => {
    const session = await connect(
      metadataService({
        agentList: async () => {
          throw new Error('unknown metadata type');
        },
      }),
    );
    try {
      const listed = await session.client.listPrompts();
      expect(listed.prompts.map((p) => p.name)).toContain('agent_prompt');
      expect(session.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('agent_prompt'),
        expect.objectContaining({ errors: ['unknown metadata type'] }),
      );
    } finally {
      await session.close();
    }
  });

  it('with no agent and no skill the prompts capability is not advertised at all (#8034)', async () => {
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
    await runtime.bridgePrompts(metadataService({ agents: [], skills: [] }) as never);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(client.getServerCapabilities()?.prompts).toBeUndefined();
    } finally {
      await client.close();
      await runtime.stop().catch(() => {});
    }
  });
});

/**
 * [#31514] `agent_prompt` reads an agent through the protocol, the read
 * `GET /api/v1/meta/agent/NAME` serves, and its advertisement reads the
 * protocol's listing, `GET /api/v1/meta/agent`'s. An agent a package ships
 * lives in the registry the protocol reads; the kernel `metadata` service holds
 * no copy of it, so the metadata double below holds none (`get` answers
 * `undefined`, `list` answers `[]`), and the protocol double serves it. The
 * real-kernel twin of these pins is
 * `packages/qa/dogfood/test/mcp-stdio-package-object-discovery.test.ts`.
 */
describe('agent_prompt — one reader with GET /meta/agent/NAME (the protocol)', () => {
  const PACKAGE_AGENT = {
    name: 'pkg_helper',
    label: 'Package Helper',
    instructions: 'You help with what the package ships.',
    active: true,
  };

  /** A protocol double: the merged listing and the by-name read, over `agents` and `skills`. */
  function protocol({ agents = [PACKAGE_AGENT], skills = [SKILL], byName }: {
    agents?: unknown[];
    skills?: unknown[];
    byName?: (request: { type: string; name: string }) => Promise<unknown>;
  } = {}) {
    const itemsOf = (type: string) => (type === 'agent' ? agents : type === 'skill' ? skills : []);
    return {
      getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items: itemsOf(type) })),
      getMetaItem: vi.fn(byName ?? (async ({ type, name }: { type: string; name: string }) => ({
        type,
        name,
        item: (itemsOf(type) as Array<{ name: string }>).find((i) => i.name === name),
      }))),
    };
  }

  async function connectWith(service: ReturnType<typeof metadataService>, read: unknown) {
    const log = logger();
    const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9', logger: log as never });
    await runtime.bridgePrompts(service as never, read as never);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
    return {
      client,
      log,
      close: async () => {
        await client.close();
        await runtime.stop().catch(() => {});
      },
    };
  }

  /** Every call the metadata double took for the `agent` type. */
  const agentCallsOn = (service: ReturnType<typeof metadataService>) =>
    [service.get, service.list, service.listDiagnosed]
      .flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls)
      .filter((args) => args[0] === 'agent');

  it('a boot whose only agent a package ships lists agent_prompt, and the argument names that agent', async () => {
    const service = metadataService({ agents: [] });
    const session = await connectWith(service, protocol());
    try {
      const listed = await session.client.listPrompts();
      expect(listed.prompts.map((p) => p.name)).toContain('agent_prompt');
      expect(agentNameDescription(listed.prompts)).toContain('"pkg_helper"');
    } finally {
      await session.close();
    }
  });

  it('serves the package agent with the instructions the protocol\'s by-name read answers, and never asks the metadata service for it', async () => {
    const service = metadataService({ agents: [] });
    const read = protocol();
    const session = await connectWith(service, read);
    try {
      const served = await session.client.getPrompt({ name: 'agent_prompt', arguments: { agentName: 'pkg_helper' } });
      const answered = (await read.getMetaItem({ type: 'agent', name: 'pkg_helper' })) as { item: { instructions: string } };
      expect(served.messages).toEqual([
        { role: 'assistant', content: { type: 'text', text: answered.item.instructions } },
      ]);
      expect(read.getMetaItem).toHaveBeenCalledWith({ type: 'agent', name: 'pkg_helper' });
      expect(agentCallsOn(service).filter((args) => args[1] === 'pkg_helper')).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('CONTROL: an environment agent is served as before', async () => {
    const service = metadataService({ agents: [AGENT] });
    const session = await connectWith(service, protocol({ agents: [AGENT, PACKAGE_AGENT] }));
    try {
      const listed = await session.client.listPrompts();
      expect(agentNameDescription(listed.prompts)).toContain('"support_triage"');
      const served = await session.client.getPrompt({
        name: 'agent_prompt',
        arguments: { agentName: 'support_triage', objectName: 'case' },
      });
      expect(served.messages).toEqual([
        { role: 'assistant', content: { type: 'text', text: 'You triage support cases.\n\n--- Current Context ---\nCurrent object: case' } },
      ]);
    } finally {
      await session.close();
    }
  });

  it('a name the protocol does not serve keeps today\'s miss answer', async () => {
    const session = await connectWith(metadataService({ agents: [] }), protocol());
    try {
      const miss = await session.client.getPrompt({ name: 'agent_prompt', arguments: { agentName: 'nope' } });
      expect(miss.messages).toEqual([
        { role: 'user', content: { type: 'text', text: 'Error: Agent "nope" not found' } },
      ]);
    } finally {
      await session.close();
    }
  });

  it('a by-name read refused SERVICE_UNAVAILABLE (503) answers the #6055 outage text and serves no instructions', async () => {
    const outage = Object.assign(new Error('The metadata store could not be read.'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
    const session = await connectWith(
      metadataService({ agents: [] }),
      protocol({ byName: async () => { throw outage; } }),
    );
    try {
      const answer = await session.client.getPrompt({ name: 'agent_prompt', arguments: { agentName: 'pkg_helper' } });
      expect(answer.messages).toHaveLength(1);
      expect(answer.messages[0].role).toBe('user');
      const text = (answer.messages[0].content as { text: string }).text;
      expect(text.startsWith('Error: SERVICE_UNAVAILABLE — ')).toBe(true);
      expect(text).not.toContain(PACKAGE_AGENT.instructions);
      expect(session.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('agent prompt refused'),
        expect.objectContaining({ agentName: 'pkg_helper' }),
      );
    } finally {
      await session.close();
    }
  });
  it('a host whose read has the listing but no by-name read reads the metadata service for both the roster and the get', async () => {
    // One decision per host. The listing alone would let the roster advertise a
    // package agent that the get, still on the metadata service, answers "not
    // found": the #28940 defect again, on a host `bridgePrompts`' parameter type
    // accepts.
    const service = metadataService({ agents: [AGENT] });
    const listingOnly = { getMetaItems: vi.fn(protocol().getMetaItems) };
    const session = await connectWith(service, listingOnly);
    try {
      const listed = await session.client.listPrompts();
      const description = agentNameDescription(listed.prompts) ?? '';
      expect(description).toContain('"support_triage"');
      expect(description).not.toContain('pkg_helper');
      expect(listingOnly.getMetaItems).not.toHaveBeenCalledWith({ type: 'agent' });
      const served = await session.client.getPrompt({ name: 'agent_prompt', arguments: { agentName: 'support_triage' } });
      expect(served.messages).toEqual([
        { role: 'assistant', content: { type: 'text', text: 'You triage support cases.' } },
      ]);
    } finally {
      await session.close();
    }
  });

  it('a by-name read that throws anything but SERVICE_UNAVAILABLE travels as a protocol error and serves no instructions', async () => {
    const session = await connectWith(
      metadataService({ agents: [] }),
      protocol({ byName: async () => { throw Object.assign(new Error('registry exploded'), { code: 'INTERNAL' }); } }),
    );
    try {
      const got = session.client.getPrompt({ name: 'agent_prompt', arguments: { agentName: 'pkg_helper' } });
      await expect(got).rejects.toThrow(/registry exploded/);
      await expect(got).rejects.not.toThrow(PACKAGE_AGENT.instructions);
      expect(session.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('agent prompt refused'), expect.anything());
    } finally {
      await session.close();
    }
  });

  it('a degraded roster verdict with the protocol present and no agent named keeps the prompt listed, naming no agent', async () => {
    const session = await connectWith(
      metadataService({
        agentList: async () => ({ items: [], degraded: true, errors: ['loader sys_metadata: connection refused'] }),
      }),
      protocol({ agents: [] }),
    );
    try {
      const listed = await session.client.listPrompts();
      expect(listed.prompts.map((p) => p.name)).toContain('agent_prompt');
      expect(agentNameDescription(listed.prompts) ?? '').not.toContain('e.g.');
      expect(session.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('agent_prompt'),
        expect.objectContaining({ errors: ['loader sys_metadata: connection refused'] }),
      );
    } finally {
      await session.close();
    }
  });
});
