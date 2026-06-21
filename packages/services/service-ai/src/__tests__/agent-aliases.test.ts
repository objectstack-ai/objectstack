// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Back-compat for the Path A agent rename (`data_chat`→`ask`, and cloud's
 * `metadata_assistant`→`build` registered via the public registry). Verifies
 * the alias table and that AgentRuntime.loadAgent normalizes a legacy name to
 * its canonical record so old `/agents/:name/chat` links keep resolving.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { AgentRuntime } from '../agent-runtime.js';
import { DATA_CHAT_AGENT, DEFAULT_DATA_AGENT_NAME, LEGACY_DATA_AGENT_NAME } from '../agents/index.js';
import { registerAgentAlias, resolveAgentAlias } from '../agents/agent-aliases.js';

function mockMetadata(overrides: Partial<IMetadataService> = {}): IMetadataService {
  return {
    register: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
    getObject: vi.fn(async () => undefined),
    listObjects: vi.fn(async () => []),
    ...overrides,
  } as unknown as IMetadataService;
}

describe('agent-aliases', () => {
  it('seeds the framework data-agent rename', () => {
    expect(DEFAULT_DATA_AGENT_NAME).toBe('ask');
    expect(LEGACY_DATA_AGENT_NAME).toBe('data_chat');
    expect(resolveAgentAlias('data_chat')).toBe('ask');
  });

  it('passes unknown / canonical names through unchanged', () => {
    expect(resolveAgentAlias('ask')).toBe('ask');
    expect(resolveAgentAlias('sales_assistant')).toBe('sales_assistant');
  });

  it('lets another package register its own rename (e.g. cloud build agent)', () => {
    registerAgentAlias('metadata_assistant', 'build');
    expect(resolveAgentAlias('metadata_assistant')).toBe('build');
    // No-ops that must not corrupt the table.
    registerAgentAlias('', 'x');
    registerAgentAlias('same', 'same');
    expect(resolveAgentAlias('same')).toBe('same');
  });
});

describe('AgentRuntime.loadAgent (alias-aware)', () => {
  it('resolves a legacy name to the renamed agent record', async () => {
    const get = vi.fn(async (_type: string, name: string) =>
      name === DEFAULT_DATA_AGENT_NAME ? DATA_CHAT_AGENT : undefined,
    );
    const runtime = new AgentRuntime(mockMetadata({ get: get as never }));

    const viaLegacy = await runtime.loadAgent('data_chat');
    expect(viaLegacy?.name).toBe('ask');
    expect(get).toHaveBeenCalledWith('agent', 'ask');

    const viaCanonical = await runtime.loadAgent('ask');
    expect(viaCanonical?.name).toBe('ask');
  });

  it('returns undefined for a genuinely unknown agent', async () => {
    const runtime = new AgentRuntime(mockMetadata());
    expect(await runtime.loadAgent('nope')).toBeUndefined();
  });
});
