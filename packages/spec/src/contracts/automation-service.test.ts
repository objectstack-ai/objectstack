import { describe, it, expect } from 'vitest';
import type { IAutomationService, AutomationResult } from './automation-service';
import type { FlowParsed } from '../automation/flow.zod';
import { FlowSchema } from '../automation/flow.zod';
import type { ExecutionLog } from '../automation/execution.zod';
import type { ConnectorDescriptor } from '../integration/connector-descriptor';

describe('Automation Service Contract', () => {
  it('should allow a minimal IAutomationService implementation with required methods', () => {
    const service: IAutomationService = {
      execute: async (_flowName, _context?) => ({ success: true }),
      listFlows: async () => [],
    };

    expect(typeof service.execute).toBe('function');
    expect(typeof service.listFlows).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => [],
      // [#12206] `registerFlow` answers the canonicalized parsed flow it
      // stored — the same object `getFlow` serves; parsing IS the minimal
      // conforming implementation.
      registerFlow: (_name, definition) => FlowSchema.parse(definition),
      unregisterFlow: (_name) => {},
      getFlow: async (_name) => null,
      toggleFlow: async (_name, _enabled) => {},
      listRuns: async (_flowName, _options?) => [],
      getRun: async (_runId) => null,
    };

    expect(service.registerFlow).toBeDefined();
    expect(service.unregisterFlow).toBeDefined();
    expect(service.getFlow).toBeDefined();
    expect(service.toggleFlow).toBeDefined();
    expect(service.listRuns).toBeDefined();
    expect(service.getRun).toBeDefined();
  });

  it('should execute a flow successfully', async () => {
    const service: IAutomationService = {
      execute: async (flowName, context?): Promise<AutomationResult> => {
        return {
          success: true,
          output: { flowName, recordId: (context?.record as any)?.id },
          durationMs: 42,
        };
      },
      listFlows: async () => ['send_welcome_email', 'update_status'],
    };

    const result = await service.execute('send_welcome_email', {
      record: { id: 'rec-1', name: 'Alice' },
      object: 'contact',
      event: 'on_create',
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ flowName: 'send_welcome_email', recordId: 'rec-1' });
    expect(result.durationMs).toBe(42);
  });

  it('should handle execution failures', async () => {
    const service: IAutomationService = {
      execute: async () => ({
        success: false,
        error: 'Flow step 3 failed: timeout',
      }),
      listFlows: async () => [],
    };

    const result = await service.execute('broken_flow');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should list registered flows', async () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['onboarding_flow', 'approval_flow', 'cleanup_flow'],
    };

    const flows = await service.listFlows();
    expect(flows).toHaveLength(3);
    expect(flows).toContain('approval_flow');
  });

  it('should return typed FlowParsed from getFlow', async () => {
    const mockFlow: FlowParsed = {
      name: 'approval_flow',
      label: 'Approval Flow',
      type: 'autolaunched',
      status: 'draft',
      version: 1,
      enabled: true,
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };

    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['approval_flow'],
      getFlow: async (name) => name === 'approval_flow' ? mockFlow : null,
    };

    const flow = await service.getFlow!('approval_flow');
    expect(flow).not.toBeNull();
    expect(flow!.name).toBe('approval_flow');
    expect(flow!.nodes).toHaveLength(2);

    const missing = await service.getFlow!('nonexistent');
    expect(missing).toBeNull();
  });

  it('should return typed ExecutionLog from listRuns and getRun', async () => {
    const mockRun: ExecutionLog = {
      id: 'exec_001',
      flowName: 'approval_flow',
      status: 'completed',
      trigger: { type: 'api' },
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
    };

    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['approval_flow'],
      listRuns: async (_flowName, _options?) => [mockRun],
      getRun: async (runId) => runId === 'exec_001' ? mockRun : null,
    };

    const runs = await service.listRuns!('approval_flow');
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('exec_001');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].steps).toHaveLength(1);

    const run = await service.getRun!('exec_001');
    expect(run).not.toBeNull();
    expect(run!.flowName).toBe('approval_flow');
    expect(run!.durationMs).toBe(1000);

    const missingRun = await service.getRun!('nonexistent');
    expect(missingRun).toBeNull();
  });

  it('should support toggleFlow to enable/disable flows', async () => {
    let flowEnabled = true;

    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['test_flow'],
      toggleFlow: async (_name, enabled) => { flowEnabled = enabled; },
    };

    await service.toggleFlow!('test_flow', false);
    expect(flowEnabled).toBe(false);

    await service.toggleFlow!('test_flow', true);
    expect(flowEnabled).toBe(true);
  });

  // [#11504] The #10025 ruling's contract half: a definition-level
  // input-schema refusal is a NEVER-DISPATCHED exit with its own
  // `AutomationResult.code` member. The compile of the literal below IS the
  // assertion — the #9384 reverse verification run forward: before the union
  // widened, this exact string was a type error.
  it('should accept FLOW_INPUT_SCHEMA_INVALID as a never-dispatched trigger refusal', async () => {
    const service: IAutomationService = {
      execute: async (): Promise<AutomationResult> => ({
        success: false,
        code: 'FLOW_INPUT_SCHEMA_INVALID',
        error: "Node 'sync' config violates its declared inputSchema",
      }),
      listFlows: async () => ['guarded_flow'],
    };

    const result = await service.execute('guarded_flow');
    expect(result.success).toBe(false);
    expect(result.code).toBe('FLOW_INPUT_SCHEMA_INVALID');
    // Never dispatched ⇒ no lifecycle verdict, matching FLOW_DISABLED /
    // FLOW_NO_START_NODE (#9378): `status` absent is exactly what separates a
    // refused dispatch from a run that dispatched and failed.
    expect(result.status).toBeUndefined();
  });

  // [#4127] `getConnectorDescriptors` is the sibling of `getActionDescriptors`
  // — the other half of the flow designer's `connector_action` pickers — and
  // was the last of the four dispatcher routes calling a method the contract
  // did not declare. Typing the return value here is the assertion: the
  // descriptor must carry `origin` and `state`, so a shape that omits them no
  // longer compiles anywhere the contract is honoured.
  it('should return typed ConnectorDescriptor[] from getConnectorDescriptors', () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => [],
      getConnectorDescriptors: (): ConnectorDescriptor[] => [
        {
          name: 'billing',
          label: 'Billing',
          type: 'api',
          origin: 'declarative',
          state: 'ready',
          actions: [{ key: 'request', label: 'Request', inputSchema: { type: 'object' } }],
        },
        {
          name: 'gh_mcp',
          label: 'GitHub MCP',
          type: 'api',
          origin: 'declarative',
          state: 'degraded',
          degradedReason: 'MCP server unreachable at boot',
          actions: [],
        },
      ],
    };

    const descriptors = service.getConnectorDescriptors!();
    expect(descriptors.map((d) => d.name)).toEqual(['billing', 'gh_mcp']);
    expect(descriptors[0].actions[0].key).toBe('request');
    // A degraded instance is listed rather than hidden (#3017), exposes no
    // actions, and says why.
    expect(descriptors[1].state).toBe('degraded');
    expect(descriptors[1].actions).toEqual([]);
    expect(descriptors[1].degradedReason).toBe('MCP server unreachable at boot');
  });

  // The registry is a flow-engine capability, not a property of every
  // automation slot: a script-runner implementation legitimately omits it, and
  // `GET /automation/connectors` answers an empty registry rather than 404.
  it('should allow an implementation that omits getConnectorDescriptors', () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => [],
    };

    expect(service.getConnectorDescriptors).toBeUndefined();
  });
});
