// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { ToolRegistry } from '../tools/tool-registry.js';
import { registerDataTools } from '../tools/data-tools.js';

/**
 * Verify the actor → ObjectQL ExecutionContext bridge for the
 * built-in data tools. These tests guard against silent regressions
 * where an AI tool call would bypass row-level security by omitting
 * the engine context.
 */
describe('permission-aware data tools', () => {
  function buildRegistryAndSpy(): {
    registry: ToolRegistry;
    findSpy: ReturnType<typeof vi.fn>;
    findOneSpy: ReturnType<typeof vi.fn>;
    aggSpy: ReturnType<typeof vi.fn>;
  } {
    const findSpy = vi.fn(async () => []);
    const findOneSpy = vi.fn(async () => null);
    const aggSpy = vi.fn(async () => []);
    const engine = {
      find: findSpy,
      findOne: findOneSpy,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: aggSpy,
    } as unknown as IDataEngine;
    const registry = new ToolRegistry();
    registerDataTools(registry, { dataEngine: engine });
    return { registry, findSpy, findOneSpy, aggSpy };
  }

  it('promotes ctx.actor into ExecutionContext on query_records (RLS engages)', async () => {
    const { registry, findSpy } = buildRegistryAndSpy();
    await registry.execute(
      {
        type: 'tool-call',
        toolCallId: 'tc-1',
        toolName: 'query_records',
        input: { objectName: 'task' },
      } as never,
      {
        actor: {
          id: 'user_42',
          name: 'Alice',
          roles: ['member'],
          permissions: ['data:read'],
        },
        environmentId: 'env_x',
      },
    );
    expect(findSpy).toHaveBeenCalledOnce();
    const [, opts] = findSpy.mock.calls[0];
    expect(opts.context).toEqual({
      userId: 'user_42',
      roles: ['member'],
      permissions: ['data:read'],
      isSystem: false,
      tenantId: 'env_x',
    });
  });

  it('falls back to isSystem:true when no actor is supplied (legacy callers)', async () => {
    const { registry, findSpy } = buildRegistryAndSpy();
    await registry.execute({
      type: 'tool-call',
      toolCallId: 'tc-2',
      toolName: 'query_records',
      input: { objectName: 'task' },
    } as never);
    const [, opts] = findSpy.mock.calls[0];
    expect(opts.context).toEqual({ roles: [], permissions: [], isSystem: true });
  });

  it('threads actor into get_record (findOne)', async () => {
    const { registry, findOneSpy } = buildRegistryAndSpy();
    findOneSpy.mockResolvedValueOnce({ id: 't1', name: 'foo' });
    await registry.execute(
      {
        type: 'tool-call',
        toolCallId: 'tc-3',
        toolName: 'get_record',
        input: { objectName: 'task', recordId: 't1' },
      } as never,
      { actor: { id: 'user_7' } },
    );
    const [, opts] = findOneSpy.mock.calls[0];
    expect(opts.context.userId).toBe('user_7');
    expect(opts.context.isSystem).toBe(false);
  });

  it('threads actor into aggregate_data', async () => {
    const { registry, aggSpy } = buildRegistryAndSpy();
    await registry.execute(
      {
        type: 'tool-call',
        toolCallId: 'tc-4',
        toolName: 'aggregate_data',
        input: {
          objectName: 'task',
          aggregations: [{ function: 'count', alias: 'n' }],
        },
      } as never,
      { actor: { id: 'user_11', roles: ['admin'] } },
    );
    const [, opts] = aggSpy.mock.calls[0];
    expect(opts.context.userId).toBe('user_11');
    expect(opts.context.roles).toEqual(['admin']);
    expect(opts.context.isSystem).toBe(false);
  });
});
