import { describe, it, expect } from 'vitest';
import {
  ToolSchema,
  ToolCategorySchema,
  defineTool,
  type Tool,
} from './tool.zod';

describe('ToolCategorySchema', () => {
  it('should accept all tool categories', () => {
    const categories = ['data', 'action', 'flow', 'integration', 'vector_search', 'analytics', 'utility'] as const;

    categories.forEach(category => {
      expect(ToolCategorySchema.parse(category)).toBe(category);
    });
  });

  it('should reject invalid category', () => {
    expect(() => ToolCategorySchema.parse('unknown')).toThrow();
  });
});

describe('ToolSchema', () => {
  it('should accept minimal tool', () => {
    const tool: Tool = {
      name: 'list_records',
      label: 'List Records',
      description: 'List records from a data object',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
        },
        required: ['objectName'],
      },
    };

    const result = ToolSchema.parse(tool);
    expect(result.name).toBe('list_records');
    expect(result.active).toBe(true);
    expect(result.builtIn).toBe(false);
  });

  it('should accept full tool', () => {
    const tool = {
      name: 'create_case',
      label: 'Create Support Case',
      description: 'Creates a new support case record',
      category: 'action' as const,
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Case subject' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['subject'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          caseNumber: { type: 'string' },
        },
      },
      objectName: 'support_case',
      permissions: ['case.create', 'support.agent'],
      active: true,
      builtIn: false,
    };

    const result = ToolSchema.parse(tool);
    expect(result.name).toBe('create_case');
    expect(result.category).toBe('action');
    expect(result.objectName).toBe('support_case');
    expect(result.permissions).toEqual(['case.create', 'support.agent']);
  });

  it('should enforce snake_case for tool name', () => {
    const validNames = ['list_records', 'create_case', '_internal_tool', 'query_orders'];
    validNames.forEach(name => {
      expect(() => ToolSchema.parse({
        name,
        label: 'Test',
        description: 'Test',
        parameters: {},
      })).not.toThrow();
    });

    const invalidNames = ['listRecords', 'Create-Case', '123tool'];
    invalidNames.forEach(name => {
      expect(() => ToolSchema.parse({
        name,
        label: 'Test',
        description: 'Test',
        parameters: {},
      })).toThrow();
    });
  });

  it('should enforce snake_case for objectName', () => {
    expect(() => ToolSchema.parse({
      name: 'test_tool',
      label: 'Test',
      description: 'Test',
      parameters: {},
      objectName: 'supportCase',
    })).toThrow();

    expect(() => ToolSchema.parse({
      name: 'test_tool',
      label: 'Test',
      description: 'Test',
      parameters: {},
      objectName: 'support_case',
    })).not.toThrow();
  });

  it('should accept built-in tool flag', () => {
    const tool = ToolSchema.parse({
      name: 'describe_object',
      label: 'Describe Object',
      description: 'Get object schema and field metadata',
      parameters: { type: 'object', properties: { objectName: { type: 'string' } } },
      builtIn: true,
    });
    expect(tool.builtIn).toBe(true);
  });
});

describe('defineTool', () => {
  it('should return a parsed tool', () => {
    const tool = defineTool({
      name: 'query_records',
      label: 'Query Records',
      description: 'Search and filter records',
      category: 'data',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
          filters: { type: 'object' },
        },
        required: ['objectName'],
      },
    });

    expect(tool.name).toBe('query_records');
    expect(tool.category).toBe('data');
    expect(tool.active).toBe(true);
  });

  it('should apply defaults', () => {
    const tool = defineTool({
      name: 'simple_tool',
      label: 'Simple Tool',
      description: 'A simple tool',
      parameters: {},
    });

    expect(tool.active).toBe(true);
    expect(tool.builtIn).toBe(false);
  });

  it('should throw on invalid tool name', () => {
    expect(() => defineTool({
      name: 'InvalidName',
      label: 'Test',
      description: 'Test',
      parameters: {},
    })).toThrow();
  });

  // ── #3715 / ADR-0033 §2 — the retired `requiresConfirmation` safety flag ──
  // Removing a key from a NON-strict schema would swap one silent no-op for
  // another (zod strips it wordlessly). These pin the loud rejection AND the
  // prescription it must carry — the parse error is the one channel a consumer
  // bumping @objectstack/spec is guaranteed to hit.

  it('REJECTS the retired `requiresConfirmation` instead of silently stripping it', () => {
    const authored = {
      name: 'delete_everything',
      label: 'Delete Everything',
      description: 'Destructive',
      parameters: {},
      requiresConfirmation: true,
    };
    expect(() => ToolSchema.parse(authored)).toThrow(/requiresConfirmation/);
    expect(() => defineTool(authored as never)).toThrow();
  });

  it('the rejection names the REAL gate, not merely the removal', () => {
    let message = '';
    try {
      ToolSchema.parse({
        name: 't', label: 'T', description: 'd', parameters: {}, requiresConfirmation: true,
      });
    } catch (e) {
      message = String((e as Error).message);
    }
    // FROM → TO: the action-level flag is the only path that stops execution.
    expect(message).toMatch(/ai\.requiresConfirmation/);
    expect(message).toMatch(/#3715/);
  });

  it('rejects an unrelated unknown key too (strictness is not special-cased)', () => {
    expect(() => ToolSchema.parse({
      name: 't', label: 'T', description: 'd', parameters: {}, notAToolField: 1,
    })).toThrow(/notAToolField/);
  });
});
