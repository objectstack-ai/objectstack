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
import type { TriggerFlowResponse } from './automation-api.zod';
import { ExecutionStatus } from '../automation/execution.zod';
import type { AutomationResult } from '../contracts/automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

/**
 * #13078 — the declared `data` of `TriggerFlowResponse` IS the
 * `AutomationResult` contract interface, not merely shaped like it.
 *
 * Both trigger routes relay `IAutomationService.execute`'s declared return
 * through `deps.success(result)` verbatim, and the contract was already
 * correct while `TriggerFlowResponseSchema` declared a strict subset — the
 * #9378/#9510 paused third state (`status`/`runId`/`screen`), `code`, the
 * friendly terminal messages and `summary` were all missing. Same
 * two-files-one-shape drift #6442 fixed for `AnalyticsMetadataResponseSchema`
 * (the reasoning is recorded there); binding the two here is what stops it
 * recurring: narrow either one alone and this goes red.
 *
 * Exported deliberately — an unread alias inside a test body is TS6196, and a
 * `@ts-expect-error`-style pin no program compiles is no pin at all.
 */
export type TriggerFlowDataMatchesContract = Assert< Eq< TriggerFlowResponse['data'], AutomationResult > >;

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
  // [#12206, inherited item ②] The old `.partial()` declared a partial-update
  // capability nothing implements: the engine's `registerFlow` runs
  // `FlowSchema.parse` on the definition, so a bare `{ label }` has always
  // been a 400 against a real server. The request schema now requires the
  // complete definition the engine actually requires.
  it('should reject a partial definition — the engine requires a complete flow', () => {
    expect(() => UpdateFlowRequestSchema.parse({
      name: 'my_flow',
      definition: { label: 'Updated Label' },
    })).toThrow();
  });

  it('should accept a complete flow definition', () => {
    const result = UpdateFlowRequestSchema.parse({
      name: 'my_flow',
      definition: {
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

  // #13078 — the AutomationResult members the schema used to be missing. The
  // PRESERVATION half matters as much as the parse: this schema strips
  // undeclared keys (BaseResponseSchema.extend + plain z.object), so before
  // the widening the paused-run triple below "passed" while the parse silently
  // dropped `status`, the `runId` a caller resumes with and the whole screen.
  it('should preserve the paused-run triple — status, runId and the screen (#9378/#9510 third state)', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        status: 'paused',
        runId: 'run_screen_001',
        screen: {
          nodeId: 'collect_details',
          title: 'Opportunity details',
          fields: [
            { name: 'amount', label: 'Amount', type: 'number', required: true },
            {
              name: 'stage',
              label: 'Stage',
              type: 'select',
              options: [
                { value: 'prospecting', label: 'Prospecting' },
                { value: 'closed_won', label: 'Closed won' },
              ],
            },
            { name: 'close_reason', type: 'text', visibleWhen: 'stage == "closed_won"' },
          ],
        },
      },
    });
    expect(result.data.status).toBe('paused');
    expect(result.data.runId).toBe('run_screen_001');
    expect(result.data.screen?.nodeId).toBe('collect_details');
    expect(result.data.screen?.fields).toHaveLength(3);
    expect(result.data.screen?.fields[1].options?.[1].value).toBe('closed_won');
    expect(result.data.screen?.fields[2].visibleWhen).toContain('closed_won');
  });

  it('should preserve an object-form screen pause — the second screen kind', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        status: 'paused',
        runId: 'run_convert_002',
        screen: {
          nodeId: 'create_customer',
          kind: 'object-form',
          objectName: 'account',
          mode: 'create',
          fields: [],
          defaults: { name: 'Acme Corp' },
          idVariable: 'customerId',
        },
      },
    });
    expect(result.data.screen?.kind).toBe('object-form');
    expect(result.data.screen?.objectName).toBe('account');
    expect(result.data.screen?.defaults?.name).toBe('Acme Corp');
    expect(result.data.screen?.idVariable).toBe('customerId');
  });

  it('should preserve terminal message and summary on a finished run', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        status: 'completed',
        durationMs: 87,
        successMessage: 'Opportunity created.',
        summary: {
          selected: 1,
          acted: 1,
          skipped: 0,
          nodes: [],
          gates: [],
        },
      },
    });
    expect(result.data.successMessage).toBe('Opportunity created.');
    expect(result.data.summary?.acted).toBe(1);
  });

  it('should preserve the failure classification code alongside error', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: false,
        error: 'Flow is disabled',
        code: 'FLOW_DISABLED',
      },
    });
    expect(result.data.code).toBe('FLOW_DISABLED');
  });

  it('should reject a status or code outside the closed vocabulary, and a screen without its nodeId', () => {
    expect(() =>
      TriggerFlowResponseSchema.parse({
        success: true,
        data: { success: true, status: 'running' },
      })
    ).toThrow();

    expect(() =>
      TriggerFlowResponseSchema.parse({
        success: true,
        data: { success: false, code: 'SOMETHING_ELSE' },
      })
    ).toThrow();

    expect(() =>
      TriggerFlowResponseSchema.parse({
        success: true,
        data: {
          success: true,
          status: 'paused',
          runId: 'run_1',
          screen: { title: 'No node id', fields: [] },
        },
      })
    ).toThrow();
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
