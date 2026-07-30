import { describe, it, expect } from 'vitest';
import {
  ToolSchema,
  defineTool,
  type Tool,
} from './tool.zod';

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
  });

  it('should accept full tool', () => {
    const tool = {
      name: 'create_case',
      label: 'Create Support Case',
      description: 'Creates a new support case record',
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
    };

    const result = ToolSchema.parse(tool);
    expect(result.name).toBe('create_case');
    expect(result.objectName).toBe('support_case');
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
});

describe('defineTool', () => {
  it('should return a parsed tool', () => {
    const tool = defineTool({
      name: 'query_records',
      label: 'Query Records',
      description: 'Search and filter records',
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

  // ── #3896 audit close-out — the four inert authoring keys are retired ──
  // `permissions` promised an invocation gate nothing enforced; `active: false`
  // read as "withdrawn" while the tool kept reaching the LLM set; `category` /
  // `builtIn` were display-only. Each rejection must carry its own
  // prescription, and the two dangerous ones must name the REAL mechanism.

  it.each([
    ['permissions', ['case.create']],
    ['active', false],
    ['category', 'action'],
    ['builtIn', true],
  ])('REJECTS the retired `%s` with its prescription', (key, value) => {
    let message = '';
    try {
      ToolSchema.parse({
        name: 't', label: 'T', description: 'd', parameters: {}, [key]: value,
      });
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toContain(key);
    expect(message).toMatch(/#3896/);
  });

  it('the `permissions` rejection points at the gate the middleware actually runs', () => {
    let message = '';
    try {
      ToolSchema.parse({
        name: 't', label: 'T', description: 'd', parameters: {}, permissions: ['x'],
      });
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/requiredPermissions/);
    expect(message).toMatch(/ADR-0066/);
  });

  it('the `active` rejection says how to actually withdraw a tool', () => {
    let message = '';
    try {
      ToolSchema.parse({
        name: 't', label: 'T', description: 'd', parameters: {}, active: false,
      });
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/skills?\/agents|skill\/agent/i);
  });
});
