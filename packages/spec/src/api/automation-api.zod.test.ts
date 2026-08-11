import { describe, it, expect } from 'vitest';
import {
  AutomationFlowPathParamsSchema,
  AutomationRunPathParamsSchema,
  ListFlowsRequestSchema,
  FlowSummarySchema,
  ListFlowsResponseSchema,
  GetFlowRequestSchema,
  GetFlowResponseSchema,
  CreateFlowRequestSchema,
  CreateFlowResponseSchema,
  UpdateFlowRequestSchema,
  UpdateFlowResponseSchema,
  DeleteFlowRequestSchema,
  DeleteFlowResponseSchema,
  TriggerFlowRequestSchema,
  TriggerFlowResponseSchema,
  ToggleFlowRequestSchema,
  ToggleFlowResponseSchema,
  ListRunsRequestSchema,
  ListRunsResponseSchema,
  GetRunRequestSchema,
  GetRunResponseSchema,
  AutomationApiErrorCode,
  AutomationApiContracts,
} from './automation-api.zod';
import { ExecutionStatus } from '../automation/execution.zod';

// ==========================================
// Path Parameters
// ==========================================

describe('AutomationFlowPathParamsSchema', () => {
  it('should accept a valid flow name', () => {
    const result = AutomationFlowPathParamsSchema.parse({ name: 'approval_flow' });
    expect(result.name).toBe('approval_flow');
  });
});

describe('AutomationRunPathParamsSchema', () => {
  it('should accept valid flow name + run ID', () => {
    const result = AutomationRunPathParamsSchema.parse({ name: 'approval_flow', runId: 'exec_001' });
    expect(result.name).toBe('approval_flow');
    expect(result.runId).toBe('exec_001');
  });
});

// ==========================================
// List Flows
// ==========================================

describe('ListFlowsRequestSchema', () => {
  it('should accept minimal request with defaults', () => {
    const result = ListFlowsRequestSchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.status).toBeUndefined();
    expect(result.type).toBeUndefined();
  });

  it('should accept full request', () => {
    const result = ListFlowsRequestSchema.parse({
      status: 'active',
      type: 'schedule',
      limit: 10,
      cursor: 'abc123',
    });
    expect(result.status).toBe('active');
    expect(result.type).toBe('schedule');
    expect(result.limit).toBe(10);
  });

  it('should reject invalid status', () => {
    expect(() => ListFlowsRequestSchema.parse({ status: 'running' })).toThrow();
  });
});

describe('FlowSummarySchema', () => {
  it('should accept a valid flow summary', () => {
    const result = FlowSummarySchema.parse({
      name: 'approval_flow',
      label: 'Approval Flow',
      type: 'autolaunched',
      status: 'active',
      version: 1,
      enabled: true,
    });
    expect(result.name).toBe('approval_flow');
    expect(result.enabled).toBe(true);
  });

  it('should accept summary with optional fields', () => {
    const result = FlowSummarySchema.parse({
      name: 'daily_sync',
      label: 'Daily Sync',
      type: 'schedule',
      status: 'active',
      version: 3,
      enabled: true,
      nodeCount: 12,
      lastRunAt: '2026-02-01T10:00:00Z',
    });
    expect(result.nodeCount).toBe(12);
    expect(result.lastRunAt).toBe('2026-02-01T10:00:00Z');
  });
});

describe('ListFlowsResponseSchema', () => {
  it('should accept a valid response', () => {
    const result = ListFlowsResponseSchema.parse({
      success: true,
      data: {
        flows: [{
          name: 'test_flow',
          label: 'Test',
          type: 'api',
          status: 'draft',
          version: 1,
          enabled: false,
        }],
        hasMore: false,
      },
    });
    expect(result.data.flows).toHaveLength(1);
    expect(result.data.hasMore).toBe(false);
  });
});

// ==========================================
// Get Flow
// ==========================================

describe('GetFlowRequestSchema', () => {
  it('should accept a flow name', () => {
    const result = GetFlowRequestSchema.parse({ name: 'my_flow' });
    expect(result.name).toBe('my_flow');
  });
});

describe('GetFlowResponseSchema', () => {
  it('should accept a response wrapping a FlowSchema', () => {
    const result = GetFlowResponseSchema.parse({
      success: true,
      data: {
        name: 'approval_flow',
        label: 'Approval Flow',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    });
    expect(result.data.name).toBe('approval_flow');
    expect(result.data.nodes).toHaveLength(2);
  });
});

// ==========================================
// Create Flow
// ==========================================

describe('CreateFlowRequestSchema', () => {
  it('should accept a valid flow definition', () => {
    const result = CreateFlowRequestSchema.parse({
      name: 'new_flow',
      label: 'New Flow',
      type: 'api',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });
    expect(result.name).toBe('new_flow');
    expect(result.status).toBe('draft'); // default
  });

  it('should reject invalid flow name', () => {
    expect(() => CreateFlowRequestSchema.parse({
      name: 'InvalidName',
      label: 'Bad',
      type: 'api',
      nodes: [],
      edges: [],
    })).toThrow();
  });
});

describe('CreateFlowResponseSchema', () => {
  it('should accept a response wrapping a FlowSchema', () => {
    const result = CreateFlowResponseSchema.parse({
      success: true,
      data: {
        name: 'new_flow',
        label: 'New Flow',
        type: 'api',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('new_flow');
  });
});

// ==========================================
// Update Flow
// ==========================================

describe('UpdateFlowRequestSchema', () => {
  it('should accept a partial update', () => {
    const result = UpdateFlowRequestSchema.parse({
      name: 'my_flow',
      definition: { label: 'Updated Label' },
    });
    expect(result.name).toBe('my_flow');
    expect(result.definition.label).toBe('Updated Label');
  });
});

describe('UpdateFlowResponseSchema', () => {
  it('should accept a valid response', () => {
    const result = UpdateFlowResponseSchema.parse({
      success: true,
      data: {
        name: 'my_flow',
        label: 'Updated Label',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    });
    expect(result.data.label).toBe('Updated Label');
  });
});

// ==========================================
// Delete Flow
// ==========================================

describe('DeleteFlowRequestSchema', () => {
  it('should accept a flow name', () => {
    const result = DeleteFlowRequestSchema.parse({ name: 'old_flow' });
    expect(result.name).toBe('old_flow');
  });
});

describe('DeleteFlowResponseSchema', () => {
  it('should accept a valid response', () => {
    const result = DeleteFlowResponseSchema.parse({
      success: true,
      data: { name: 'old_flow', deleted: true },
    });
    expect(result.data.deleted).toBe(true);
  });
});

// ==========================================
// Trigger Flow
// ==========================================

describe('TriggerFlowRequestSchema', () => {
  it('should accept minimal trigger request', () => {
    const result = TriggerFlowRequestSchema.parse({ name: 'my_flow' });
    expect(result.name).toBe('my_flow');
    expect(result.record).toBeUndefined();
  });

  it('should accept full trigger request', () => {
    const result = TriggerFlowRequestSchema.parse({
      name: 'approval_flow',
      record: { id: 'rec-1', amount: 50000 },
      object: 'opportunity',
      event: 'on_create',
      userId: 'user_123',
      params: { priority: 'high' },
    });
    expect(result.name).toBe('approval_flow');
    expect(result.object).toBe('opportunity');
    expect(result.event).toBe('on_create');
  });
});

describe('TriggerFlowResponseSchema', () => {
  it('should accept a successful trigger response', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        output: { status: 'approved' },
        durationMs: 42,
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.durationMs).toBe(42);
  });

  it('should accept a failed trigger response', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: false,
        error: 'Flow step 3 failed: timeout',
        durationMs: 5000,
      },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('timeout');
  });
});

// ==========================================
// Toggle Flow
// ==========================================

describe('ToggleFlowRequestSchema', () => {
  it('should accept enable request', () => {
    const result = ToggleFlowRequestSchema.parse({
      name: 'my_flow',
      enabled: true,
    });
    expect(result.enabled).toBe(true);
  });

  it('should accept disable request', () => {
    const result = ToggleFlowRequestSchema.parse({
      name: 'my_flow',
      enabled: false,
    });
    expect(result.enabled).toBe(false);
  });

  it('should reject missing enabled field', () => {
    expect(() => ToggleFlowRequestSchema.parse({ name: 'my_flow' })).toThrow();
  });
});

describe('ToggleFlowResponseSchema', () => {
  it('should accept a valid response', () => {
    const result = ToggleFlowResponseSchema.parse({
      success: true,
      data: { name: 'my_flow', enabled: true },
    });
    expect(result.data.enabled).toBe(true);
  });
});

// ==========================================
// List Runs
// ==========================================

describe('ListRunsRequestSchema', () => {
  it('should accept minimal request', () => {
    const result = ListRunsRequestSchema.parse({ name: 'my_flow' });
    expect(result.limit).toBe(20);
    expect(result.status).toBeUndefined();
  });

  it('should accept full request', () => {
    const result = ListRunsRequestSchema.parse({
      name: 'my_flow',
      status: 'completed',
      limit: 5,
      cursor: 'page2',
    });
    expect(result.status).toBe('completed');
    expect(result.limit).toBe(5);
  });

  it('should reject invalid status', () => {
    expect(() => ListRunsRequestSchema.parse({
      name: 'my_flow',
      status: 'success',
    })).toThrow();
  });

  it('declares exactly the canonical ExecutionStatus set (#7359)', () => {
    // The wire's filter and the runtime boundary that now enforces it must
    // accept ONE set. The boundary reads `ExecutionStatus.options`; this pins
    // that the schema does too, so a member added to the enum cannot end up
    // advertised by one and refused with a 400 by the other. The members used
    // to be re-listed inline here — identical, but only by hand.
    for (const member of ExecutionStatus.options) {
      expect(
        () => ListRunsRequestSchema.parse({ name: 'my_flow', status: member }),
        `?status=${member} is a declared ExecutionStatus but the request schema refuses it`,
      ).not.toThrow();
    }
  });
});

describe('ListRunsResponseSchema', () => {
  it('should accept a response with execution logs', () => {
    const result = ListRunsResponseSchema.parse({
      success: true,
      data: {
        runs: [{
          id: 'exec_001',
          flowName: 'my_flow',
          status: 'completed',
          trigger: { type: 'api' },
          steps: [],
          startedAt: '2026-02-01T10:00:00Z',
        }],
        hasMore: false,
      },
    });
    expect(result.data.runs).toHaveLength(1);
    expect(result.data.runs[0].status).toBe('completed');
  });
});

// ==========================================
// Get Run
// ==========================================

describe('GetRunRequestSchema', () => {
  it('should accept valid path params', () => {
    const result = GetRunRequestSchema.parse({ name: 'my_flow', runId: 'exec_001' });
    expect(result.name).toBe('my_flow');
    expect(result.runId).toBe('exec_001');
  });
});

describe('GetRunResponseSchema', () => {
  it('should accept a response with execution log and steps', () => {
    const result = GetRunResponseSchema.parse({
      success: true,
      data: {
        id: 'exec_001',
        flowName: 'my_flow',
        status: 'completed',
        trigger: { type: 'api', userId: 'user_123' },
        steps: [{
          nodeId: 'start',
          nodeType: 'start',
          status: 'success',
          startedAt: '2026-02-01T10:00:00Z',
          durationMs: 1,
        }],
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T10:00:01Z',
        durationMs: 1000,
      },
    });
    expect(result.data.steps).toHaveLength(1);
    expect(result.data.durationMs).toBe(1000);
  });
});

// ==========================================
// Error Codes
// ==========================================

describe('AutomationApiErrorCode', () => {
  it('should accept all valid error codes', () => {
    const valid = [
      'flow_not_found', 'flow_already_exists', 'flow_validation_failed',
      'flow_disabled', 'execution_not_found', 'execution_failed',
      'execution_timeout', 'node_executor_not_found', 'concurrent_execution_limit',
    ];
    valid.forEach((v) => {
      expect(() => AutomationApiErrorCode.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid error codes', () => {
    expect(() => AutomationApiErrorCode.parse('invalid_code')).toThrow();
  });
});

// ==========================================
// Contract Registry
// ==========================================

describe('AutomationApiContracts', () => {
  it('should define all 9 contract endpoints', () => {
    expect(Object.keys(AutomationApiContracts)).toHaveLength(9);
  });

  it('should define correct HTTP methods', () => {
    expect(AutomationApiContracts.listFlows.method).toBe('GET');
    expect(AutomationApiContracts.getFlow.method).toBe('GET');
    expect(AutomationApiContracts.createFlow.method).toBe('POST');
    expect(AutomationApiContracts.updateFlow.method).toBe('PUT');
    expect(AutomationApiContracts.deleteFlow.method).toBe('DELETE');
    expect(AutomationApiContracts.triggerFlow.method).toBe('POST');
    expect(AutomationApiContracts.toggleFlow.method).toBe('POST');
    expect(AutomationApiContracts.listRuns.method).toBe('GET');
    expect(AutomationApiContracts.getRun.method).toBe('GET');
  });

  it('should define correct paths', () => {
    expect(AutomationApiContracts.listFlows.path).toBe('/api/automation');
    expect(AutomationApiContracts.getFlow.path).toBe('/api/automation/:name');
    expect(AutomationApiContracts.createFlow.path).toBe('/api/automation');
    expect(AutomationApiContracts.updateFlow.path).toBe('/api/automation/:name');
    expect(AutomationApiContracts.deleteFlow.path).toBe('/api/automation/:name');
    expect(AutomationApiContracts.triggerFlow.path).toBe('/api/automation/:name/trigger');
    expect(AutomationApiContracts.toggleFlow.path).toBe('/api/automation/:name/toggle');
    expect(AutomationApiContracts.listRuns.path).toBe('/api/automation/:name/runs');
    expect(AutomationApiContracts.getRun.path).toBe('/api/automation/:name/runs/:runId');
  });

  it('should have input and output schemas for all endpoints', () => {
    for (const [key, contract] of Object.entries(AutomationApiContracts)) {
      expect(contract.input, `${key} should have input schema`).toBeDefined();
      expect(contract.output, `${key} should have output schema`).toBeDefined();
    }
  });
});
