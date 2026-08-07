// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MCPServerRuntime } from '../mcp-server-runtime.js';
import type { MCPServerRuntimeConfig } from '../mcp-server-runtime.js';
import type { AIToolDefinition, ToolCallPart } from '@objectstack/spec/contracts';
import type { ToolRegistry, ToolExecutionResult } from '../types.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockToolRegistry(tools: AIToolDefinition[] = []): ToolRegistry {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<string>>();

  return {
    getAll: () => tools,
    execute: vi.fn(async (toolCall: ToolCallPart): Promise<ToolExecutionResult> => {
      const handler = handlers.get(toolCall.toolName);
      if (!handler) {
        return {
          type: 'tool-result',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          output: { type: 'text', value: `Tool "${toolCall.toolName}" not found` },
          isError: true,
        };
      }
      const args = typeof toolCall.input === 'string'
        ? JSON.parse(toolCall.input)
        : (toolCall.input as Record<string, unknown>) ?? {};
      const content = await handler(args);
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: content },
      };
    }),
    // Expose for test setup
    _setHandler: (name: string, fn: (args: Record<string, unknown>) => Promise<string>) => {
      handlers.set(name, fn);
    },
  } as ToolRegistry & { _setHandler: (name: string, fn: any) => void };
}

function createMockMetadataService() {
  const objects: Record<string, any> = {
    account: {
      name: 'account',
      label: 'Account',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        email: { type: 'email', label: 'Email' },
        status: { type: 'select', label: 'Status' },
      },
      enable: { softDelete: true },
    },
    contact: {
      name: 'contact',
      label: 'Contact',
      fields: {
        first_name: { type: 'text', label: 'First Name', required: true },
        last_name: { type: 'text', label: 'Last Name', required: true },
      },
    },
  };

  const agents: Record<string, any> = {
    data_chat: {
      name: 'data_chat',
      label: 'Data Assistant',
      role: 'Business Data Analyst',
      instructions: 'You are a helpful data assistant.',
      active: true,
    },
    metadata_assistant: {
      name: 'metadata_assistant',
      label: 'Metadata Assistant',
      role: 'Schema Designer',
      instructions: 'You help design data schemas.',
      active: true,
    },
  };

  const skills: Record<string, any> = {
    case_management: {
      name: 'case_management',
      label: 'Case Management',
      description: 'Handles support case lifecycle',
      surface: 'ask',
      instructions: 'Triage the case, then resolve it once the caller confirms.',
      tools: ['action_resolve_case'],
      active: true,
    },
    // No `instructions` half — nothing for an MCP client to fetch, so it is
    // deliberately not projected (#3905).
    toolbox: {
      name: 'toolbox',
      label: 'Toolbox',
      surface: 'both',
      tools: ['query_records'],
      active: true,
    },
  };

  return {
    listObjects: vi.fn(async () => Object.values(objects)),
    getObject: vi.fn(async (name: string) => objects[name] ?? null),
    get: vi.fn(async (type: string, name: string) => {
      if (type === 'agent') return agents[name] ?? null;
      if (type === 'skill') return skills[name] ?? null;
      return null;
    }),
    list: vi.fn(async (type: string) => {
      if (type === 'agent') return Object.values(agents);
      if (type === 'skill') return Object.values(skills);
      return [];
    }),
    exists: vi.fn(async (type: string, name: string) => {
      if (type === 'agent') return name in agents;
      return false;
    }),
    getRegisteredTypes: vi.fn(async () => ['object', 'app', 'view', 'agent', 'tool']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}


function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPServerRuntime', () => {
  let runtime: MCPServerRuntime;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    runtime = new MCPServerRuntime({
      name: 'test-objectstack',
      version: '1.0.0-test',
      logger: mockLogger as any,
    });
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const defaultRuntime = new MCPServerRuntime();
      expect(defaultRuntime).toBeDefined();
      expect(defaultRuntime.isStarted).toBe(false);
    });

    it('should create with custom config', () => {
      expect(runtime).toBeDefined();
      expect(runtime.isStarted).toBe(false);
    });

    it('should expose the underlying McpServer', () => {
      expect(runtime.server).toBeDefined();
    });
  });

  describe('bridgeTools', () => {
    it('should bridge all tools from ToolRegistry', () => {
      const tools: AIToolDefinition[] = [
        {
          name: 'list_objects',
          description: 'List all objects',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'query_records',
          description: 'Query records',
          parameters: { type: 'object', properties: { objectName: { type: 'string' } }, required: ['objectName'] },
        },
      ];

      const registry = createMockToolRegistry(tools);
      runtime.bridgeTools(registry);

      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Bridged 2 tools from ToolRegistry');
    });

    it('should bridge zero tools gracefully', () => {
      const registry = createMockToolRegistry([]);
      runtime.bridgeTools(registry);

      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Bridged 0 tools from ToolRegistry');
    });

    it('should bridge all 9 standard tools', () => {
      const standardTools: AIToolDefinition[] = [
        { name: 'create_object', description: 'Create object', parameters: {} },
        { name: 'add_field', description: 'Add field', parameters: {} },
        { name: 'modify_field', description: 'Modify field', parameters: {} },
        { name: 'delete_field', description: 'Delete field', parameters: {} },
        { name: 'list_objects', description: 'List objects', parameters: {} },
        { name: 'describe_object', description: 'Describe object', parameters: {} },
        { name: 'query_records', description: 'Query records', parameters: {} },
        { name: 'get_record', description: 'Get record', parameters: {} },
        { name: 'aggregate_data', description: 'Aggregate data', parameters: {} },
      ];

      const registry = createMockToolRegistry(standardTools);
      runtime.bridgeTools(registry);

      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Bridged 9 tools from ToolRegistry');
    });
  });

  describe('bridgeResources', () => {
    it('should bridge metadata resources', () => {
      const metadataService = createMockMetadataService();
      runtime.bridgeResources(metadataService as any);

      // Should register: object_list, object_schema, metadata_types (3 resources, no dataEngine = no record_by_id)
      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Bridged 3 resource endpoints');
    });

    it('should bridge record resources when a principal-bound reader is provided', () => {
      const metadataService = createMockMetadataService();
      const getRecord = async () => null; // principal-bound reader (ADR-0101)
      runtime.bridgeResources(metadataService as any, getRecord);

      // Should register: object_list, object_schema, record_by_id, metadata_types (4 resources)
      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Bridged 4 resource endpoints');
    });

    it('should skip metadata_types when getRegisteredTypes is not available', () => {
      const metadataService = createMockMetadataService();
      delete (metadataService as any).getRegisteredTypes;
      runtime.bridgeResources(metadataService as any);

      // Should register: object_list, object_schema only (2 resources)
      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Bridged 2 resource endpoints');
    });
  });

  describe('bridgePrompts', () => {
    it('should register agent prompt', async () => {
      const metadataService = createMockMetadataService();
      await runtime.bridgePrompts(metadataService as any);

      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Agent prompts bridged');
    });

    it('projects every skill that carries instructions, and only those (#3905)', async () => {
      const metadataService = createMockMetadataService();
      await runtime.bridgePrompts(metadataService as any);

      // `case_management` has instructions; `toolbox` does not.
      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Bridged 1 skill prompts');

      // Drive the real wire: an MCP client sees the skill on prompts/list and
      // gets its instructions back from prompts/get.
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await Promise.all([
        runtime.server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      const listed = await client.listPrompts();
      const names = listed.prompts.map((p) => p.name);
      expect(names).toContain('case_management');
      expect(names).not.toContain('toolbox');
      expect(listed.prompts.find((p) => p.name === 'case_management')?.description).toBe(
        'Handles support case lifecycle',
      );

      const fetched = await client.getPrompt({ name: 'case_management' });
      expect(fetched.messages[0].content).toEqual({
        type: 'text',
        text: 'Triage the case, then resolve it once the caller confirms.',
      });

      await client.close();
      await runtime.stop().catch(() => {});
    });

    it('survives a metadata service that cannot list skills', async () => {
      const metadataService = createMockMetadataService();
      metadataService.list = vi.fn(async (type: string) => {
        if (type === 'skill') throw new Error('unknown metadata type');
        return [];
      }) as any;

      await runtime.bridgePrompts(metadataService as any);

      // Agent prompts still bridged; the failure is reported, not swallowed.
      expect(mockLogger.info).toHaveBeenCalledWith('[MCP] Agent prompts bridged');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not read skill metadata'),
      );
    });
  });

  describe('lifecycle', () => {
    it('should not be started initially', () => {
      expect(runtime.isStarted).toBe(false);
    });

    it('start() is a no-op for HTTP transport (served per-request via dispatcher)', async () => {
      const httpRuntime = new MCPServerRuntime({
        transport: 'http',
        logger: mockLogger as any,
      });

      await httpRuntime.start();

      // HTTP is served per-request through handleHttpRequest(), not a
      // long-lived connect() — so start() does not mark the server started
      // and must not warn that HTTP is unsupported.
      expect(httpRuntime.isStarted).toBe(false);
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        '[MCP] HTTP transport is not yet supported. Use stdio transport.',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[MCP] HTTP transport ready (served per-request at /api/v1/mcp).',
      );
    });

    it('should be idempotent on stop when not started', async () => {
      await runtime.stop();
      expect(runtime.isStarted).toBe(false);
    });
  });
});
