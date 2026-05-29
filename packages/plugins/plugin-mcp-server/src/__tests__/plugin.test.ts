// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPServerPlugin } from '../plugin.js';

// ---------------------------------------------------------------------------
// Mock PluginContext
// ---------------------------------------------------------------------------

function createMockPluginContext(services: Record<string, any> = {}) {
  const serviceRegistry = new Map<string, any>(Object.entries(services));

  return {
    registerService: vi.fn((name: string, service: any) => {
      serviceRegistry.set(name, service);
    }),
    getService: vi.fn(<T>(name: string): T => {
      if (!serviceRegistry.has(name)) {
        throw new Error(`Service "${name}" not found`);
      }
      return serviceRegistry.get(name) as T;
    }),
    replaceService: vi.fn(),
    getServices: vi.fn(() => serviceRegistry),
    hook: vi.fn(),
    trigger: vi.fn(async () => {}),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getKernel: vi.fn(() => ({})),
  };
}

function createMockAIService() {
  return {
    chat: vi.fn(),
    complete: vi.fn(),
    toolRegistry: {
      getAll: () => [
        { name: 'list_objects', description: 'List objects', parameters: {} },
        { name: 'query_records', description: 'Query records', parameters: {} },
      ],
      execute: vi.fn(async () => ({
        type: 'tool-result',
        toolCallId: 'test',
        toolName: 'test',
        output: { type: 'text', value: '{}' },
      })),
    },
  };
}

function createMockMetadataService() {
  return {
    listObjects: vi.fn(async () => []),
    getObject: vi.fn(async () => null),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    getRegisteredTypes: vi.fn(async () => ['object', 'agent']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

function createMockDataEngine() {
  return {
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => []),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPServerPlugin', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Ensure MCP_SERVER_ENABLED is NOT set unless explicitly done in a test
    delete process.env.OS_MCP_SERVER_ENABLED;
    delete process.env.OS_MCP_SERVER_NAME;
    delete process.env.OS_MCP_SERVER_TRANSPORT;
  });

  describe('metadata', () => {
    it('should have correct plugin metadata', () => {
      const plugin = new MCPServerPlugin();
      expect(plugin.name).toBe('com.objectstack.plugin-mcp-server');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.type).toBe('standard');
    });
  });

  describe('init', () => {
    it('should register MCP service on init', async () => {
      const plugin = new MCPServerPlugin();
      const ctx = createMockPluginContext();

      await plugin.init(ctx as any);

      expect(ctx.registerService).toHaveBeenCalledWith('mcp', expect.any(Object));
      expect(ctx.logger.info).toHaveBeenCalledWith('[MCP] Plugin initialized');
    });

    it('should respect MCP_SERVER_NAME env var', async () => {
      process.env.OS_MCP_SERVER_NAME = 'custom-name';
      const plugin = new MCPServerPlugin();
      const ctx = createMockPluginContext();

      await plugin.init(ctx as any);

      const registeredRuntime = (ctx.registerService as any).mock.calls[0][1];
      expect(registeredRuntime).toBeDefined();
    });

    it('should use plugin option name when env var not set', async () => {
      const plugin = new MCPServerPlugin({ name: 'my-mcp-server' });
      const ctx = createMockPluginContext();

      await plugin.init(ctx as any);

      expect(ctx.registerService).toHaveBeenCalledWith('mcp', expect.any(Object));
    });
  });

  describe('start', () => {
    it('should bridge tools when AI service is available', async () => {
      const aiService = createMockAIService();
      const metadataService = createMockMetadataService();
      const dataEngine = createMockDataEngine();

      const ctx = createMockPluginContext({
        ai: aiService,
        metadata: metadataService,
        data: dataEngine,
      });

      const plugin = new MCPServerPlugin();
      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[MCP] Server ready but not started'),
      );
      expect(ctx.trigger).toHaveBeenCalledWith('mcp:ready', expect.any(Object));
    });

    it('should handle missing AI service gracefully', async () => {
      const metadataService = createMockMetadataService();
      const ctx = createMockPluginContext({ metadata: metadataService });

      const plugin = new MCPServerPlugin();
      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[MCP] AI service not available, skipping tool bridging',
      );
    });

    it('should handle missing metadata service gracefully', async () => {
      const aiService = createMockAIService();
      const ctx = createMockPluginContext({ ai: aiService });

      const plugin = new MCPServerPlugin();
      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[MCP] Metadata service not available, skipping resource bridging',
      );
    });

    it('should handle missing data engine gracefully', async () => {
      const aiService = createMockAIService();
      const metadataService = createMockMetadataService();
      const ctx = createMockPluginContext({ ai: aiService, metadata: metadataService });

      const plugin = new MCPServerPlugin();
      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      expect(ctx.logger.debug).toHaveBeenCalledWith(
        '[MCP] Data engine not available, skipping record resources',
      );
    });

    it('should not auto-start when MCP_SERVER_ENABLED is not set', async () => {
      const ctx = createMockPluginContext();

      const plugin = new MCPServerPlugin();
      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[MCP] Server ready but not started'),
      );
    });

    it('should trigger mcp:ready hook', async () => {
      const ctx = createMockPluginContext();

      const plugin = new MCPServerPlugin();
      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      expect(ctx.trigger).toHaveBeenCalledWith('mcp:ready', expect.any(Object));
    });
  });

  describe('destroy', () => {
    it('should clean up on destroy', async () => {
      const ctx = createMockPluginContext();

      const plugin = new MCPServerPlugin();
      await plugin.init(ctx as any);

      // Should not throw
      await plugin.destroy();
    });

    it('should handle destroy without init', async () => {
      const plugin = new MCPServerPlugin();
      // Should not throw
      await plugin.destroy();
    });
  });
});
