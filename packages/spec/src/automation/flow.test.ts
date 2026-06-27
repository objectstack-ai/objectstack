import { describe, it, expect } from 'vitest';
import {
  FlowSchema,
  FlowNodeSchema,
  FlowEdgeSchema,
  FlowVariableSchema,
  FlowNodeAction,
  FlowVersionHistorySchema,
  defineFlow,
  type Flow,
  type FlowNode,
  type FlowEdge,
} from './flow.zod';

describe('FlowNodeAction', () => {
  it('should accept all node action types', () => {
    const actions = [
      'start', 'end', 'decision', 'assignment', 'loop',
      'create_record', 'update_record', 'delete_record', 'get_record',
      'http', 'notify', 'script', 'screen', 'wait', 'subflow', 'connector_action',
      'parallel_gateway', 'join_gateway', 'boundary_event',
    ];
    
    actions.forEach(action => {
      expect(() => FlowNodeAction.parse(action)).not.toThrow();
    });
  });

  it('should reject invalid action types', () => {
    expect(() => FlowNodeAction.parse('invalid')).toThrow();
    expect(() => FlowNodeAction.parse('custom_action')).toThrow();
  });
});

describe('FlowVariableSchema', () => {
  it('should accept basic variable', () => {
    const variable = {
      name: 'recordId',
      type: 'text',
    };

    const result = FlowVariableSchema.parse(variable);
    expect(result.isInput).toBe(false);
    expect(result.isOutput).toBe(false);
  });

  it('should accept input variable', () => {
    const variable = {
      name: 'accountId',
      type: 'text',
      isInput: true,
    };

    expect(() => FlowVariableSchema.parse(variable)).not.toThrow();
  });

  it('should accept output variable', () => {
    const variable = {
      name: 'totalAmount',
      type: 'number',
      isOutput: true,
    };

    expect(() => FlowVariableSchema.parse(variable)).not.toThrow();
  });

  it('should accept various data types', () => {
    const types = ['text', 'number', 'boolean', 'object', 'list'];
    
    types.forEach(type => {
      const variable = {
        name: 'testVar',
        type,
      };
      expect(() => FlowVariableSchema.parse(variable)).not.toThrow();
    });
  });
});

describe('FlowNodeSchema', () => {
  it('should accept minimal node', () => {
    const node: FlowNode = {
      id: 'node_1',
      type: 'start',
      label: 'Start',
    };

    expect(() => FlowNodeSchema.parse(node)).not.toThrow();
  });

  it('should accept node with position', () => {
    const node: FlowNode = {
      id: 'node_2',
      type: 'decision',
      label: 'Check Amount',
      position: { x: 100, y: 200 },
    };

    expect(() => FlowNodeSchema.parse(node)).not.toThrow();
  });

  it('should accept node with config', () => {
    const node: FlowNode = {
      id: 'node_3',
      type: 'create_record',
      label: 'Create Account',
      config: {
        object: 'account',
        fields: {
          name: '{input.companyName}',
          status: 'active',
        },
      },
    };

    expect(() => FlowNodeSchema.parse(node)).not.toThrow();
  });

  it('should accept all node types', () => {
    const types = [
      'start', 'end', 'decision', 'assignment', 'loop',
      'create_record', 'update_record', 'delete_record', 'get_record',
      'http', 'notify', 'script', 'screen', 'wait', 'subflow', 'connector_action',
      'parallel_gateway', 'join_gateway', 'boundary_event',
    ] as const;

    types.forEach(type => {
      const node: FlowNode = {
        id: `node_${type}`,
        type,
        label: type,
      };
      expect(() => FlowNodeSchema.parse(node)).not.toThrow();
    });
  });

  it('should accept node with timeoutMs', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'http_1',
      type: 'http',
      label: 'Call API',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutMs).toBe(5000);
    }
  });

  it('should accept node with inputSchema and outputSchema', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'script_1',
      type: 'script',
      label: 'Process Data',
      inputSchema: {
        name: { type: 'string', required: true, description: 'User name' },
        age: { type: 'number', required: false },
      },
      outputSchema: {
        greeting: { type: 'string', description: 'Generated greeting' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inputSchema).toBeDefined();
      expect(result.data.outputSchema).toBeDefined();
    }
  });
});

describe('FlowEdgeSchema', () => {
  it('should accept minimal edge', () => {
    const edge: FlowEdge = {
      id: 'edge_1',
      source: 'node_1',
      target: 'node_2',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });

  it('should accept edge with condition', () => {
    const edge: FlowEdge = {
      id: 'edge_2',
      source: 'decision_1',
      target: 'node_3',
      condition: 'amount > 1000',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });

  it('should accept edge with label', () => {
    const edge: FlowEdge = {
      id: 'edge_3',
      source: 'node_1',
      target: 'node_2',
      label: 'Yes',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });

  it('should accept edge with both condition and label', () => {
    const edge: FlowEdge = {
      id: 'edge_4',
      source: 'decision_1',
      target: 'approve_path',
      condition: 'status == "approved"',
      label: 'Approved',
    };

    expect(() => FlowEdgeSchema.parse(edge)).not.toThrow();
  });
});

describe('FlowSchema', () => {
  describe('Basic Properties', () => {
    it('should accept minimal flow', () => {
      const flow: Flow = {
        name: 'simple_flow',
        label: 'Simple Flow',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'edge_1', source: 'start', target: 'end' },
        ],
      };

      const result = FlowSchema.parse(flow);
      expect(result.active).toBe(false);
      expect(result.runAs).toBe('user');
    });

    it('should enforce snake_case for flow name', () => {
      const validNames = ['approval_flow', 'send_email', 'create_record', '_internal'];
      validNames.forEach(name => {
        expect(() => FlowSchema.parse({
          name,
          label: 'Test',
          type: 'autolaunched',
          nodes: [],
          edges: [],
        })).not.toThrow();
      });

      const invalidNames = ['approvalFlow', 'Approval-Flow', '123flow'];
      invalidNames.forEach(name => {
        expect(() => FlowSchema.parse({
          name,
          label: 'Test',
          type: 'autolaunched',
          nodes: [],
          edges: [],
        })).toThrow();
      });
    });

    it('should accept all flow types', () => {
      const types = ['autolaunched', 'record_change', 'schedule', 'screen', 'api'] as const;
      
      types.forEach(type => {
        const flow: Flow = {
          name: 'test_flow',
          label: 'Test Flow',
          type,
          nodes: [],
          edges: [],
        };
        expect(() => FlowSchema.parse(flow)).not.toThrow();
      });
    });

    it('should default active to false', () => {
      const flow = {
        name: 'test_flow',
        label: 'Test',
        type: 'autolaunched' as const,
        nodes: [],
        edges: [],
      };

      const result = FlowSchema.parse(flow);
      expect(result.active).toBe(false);
    });

    it('should default runAs to user', () => {
      const flow = {
        name: 'test_flow',
        label: 'Test',
        type: 'autolaunched' as const,
        nodes: [],
        edges: [],
      };

      const result = FlowSchema.parse(flow);
      expect(result.runAs).toBe('user');
    });
  });

  describe('Flow with Variables', () => {
    it('should accept flow with variables', () => {
      const flow: Flow = {
        name: 'data_flow',
        label: 'Data Processing Flow',
        type: 'autolaunched',
        variables: [
          { name: 'recordId', type: 'text', isInput: true },
          { name: 'amount', type: 'number', isInput: true },
          { name: 'result', type: 'boolean', isOutput: true },
        ],
        nodes: [],
        edges: [],
      };

      expect(() => FlowSchema.parse(flow)).not.toThrow();
    });
  });

  describe('Real-World Flow Examples', () => {
    it('should accept approval flow', () => {
      const approvalFlow: Flow = {
        name: 'opportunity_approval',
        label: 'Opportunity Approval Flow',
        description: 'Handles approval process for large opportunities',
        type: 'record_change',
        variables: [
          { name: 'opportunityId', type: 'text', isInput: true },
          { name: 'approvalRequired', type: 'boolean', isOutput: true },
        ],
        nodes: [
          {
            id: 'start',
            type: 'start',
            label: 'Start',
            position: { x: 100, y: 50 },
          },
          {
            id: 'get_opportunity',
            type: 'get_record',
            label: 'Get Opportunity',
            config: {
              object: 'opportunity',
              recordId: '{opportunityId}',
            },
            position: { x: 100, y: 150 },
          },
          {
            id: 'check_amount',
            type: 'decision',
            label: 'Amount > $100K?',
            config: {
              condition: '{opportunity.amount} > 100000',
            },
            position: { x: 100, y: 250 },
          },
          {
            id: 'auto_approve',
            type: 'update_record',
            label: 'Auto Approve',
            config: {
              recordId: '{opportunityId}',
              fields: {
                status: 'approved',
                approved_by: 'system',
              },
            },
            position: { x: 50, y: 350 },
          },
          {
            id: 'send_approval_request',
            type: 'http',
            label: 'Send to Manager',
            config: {
              url: '/api/approvals',
              method: 'POST',
              body: {
                recordId: '{opportunityId}',
                approver: '{opportunity.owner.manager}',
              },
            },
            position: { x: 250, y: 350 },
          },
          {
            id: 'end',
            type: 'end',
            label: 'End',
            position: { x: 100, y: 450 },
          },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'get_opportunity' },
          { id: 'e2', source: 'get_opportunity', target: 'check_amount' },
          {
            id: 'e3',
            source: 'check_amount',
            target: 'auto_approve',
            condition: '{opportunity.amount} <= 100000',
            label: 'No',
          },
          {
            id: 'e4',
            source: 'check_amount',
            target: 'send_approval_request',
            condition: '{opportunity.amount} > 100000',
            label: 'Yes',
          },
          { id: 'e5', source: 'auto_approve', target: 'end' },
          { id: 'e6', source: 'send_approval_request', target: 'end' },
        ],
        active: true,
        runAs: 'system',
      };

      expect(() => FlowSchema.parse(approvalFlow)).not.toThrow();
    });

    it('should accept screen flow for user input', () => {
      const screenFlow: Flow = {
        name: 'contact_creation_wizard',
        label: 'Contact Creation Wizard',
        type: 'screen',
        variables: [
          { name: 'firstName', type: 'text', isInput: true },
          { name: 'lastName', type: 'text', isInput: true },
          { name: 'email', type: 'text', isInput: true },
          { name: 'contactId', type: 'text', isOutput: true },
        ],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'create_contact',
            type: 'create_record',
            label: 'Create Contact',
            config: {
              object: 'contact',
              fields: {
                first_name: '{firstName}',
                last_name: '{lastName}',
                email: '{email}',
              },
            },
          },
          {
            id: 'assign_output',
            type: 'assignment',
            label: 'Set Output',
            config: {
              variable: 'contactId',
              value: '{create_contact.id}',
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'create_contact' },
          { id: 'e2', source: 'create_contact', target: 'assign_output' },
          { id: 'e3', source: 'assign_output', target: 'end' },
        ],
        active: true,
      };

      expect(() => FlowSchema.parse(screenFlow)).not.toThrow();
    });

    it('should accept scheduled flow', () => {
      const scheduledFlow: Flow = {
        name: 'daily_cleanup',
        label: 'Daily Data Cleanup',
        description: 'Runs daily to archive old records',
        type: 'schedule',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'get_old_records',
            type: 'get_record',
            label: 'Find Old Records',
            config: {
              object: 'log_entry',
              filter: 'created_at < DAYS_AGO(90)',
            },
          },
          {
            id: 'loop_records',
            type: 'loop',
            label: 'For Each Record',
            config: {
              collection: '{get_old_records.records}',
            },
          },
          {
            id: 'delete_record',
            type: 'delete_record',
            label: 'Delete Record',
            config: {
              recordId: '{loop_records.item.id}',
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'get_old_records' },
          { id: 'e2', source: 'get_old_records', target: 'loop_records' },
          { id: 'e3', source: 'loop_records', target: 'delete_record' },
          { id: 'e4', source: 'delete_record', target: 'loop_records' },
          { id: 'e5', source: 'loop_records', target: 'end', label: 'Done' },
        ],
        active: true,
        runAs: 'system',
      };

      expect(() => FlowSchema.parse(scheduledFlow)).not.toThrow();
    });

    it('should accept API flow with webhook', () => {
      const apiFlow: Flow = {
        name: 'external_api_integration',
        label: 'External API Integration',
        type: 'api',
        variables: [
          { name: 'payload', type: 'object', isInput: true },
          { name: 'response', type: 'object', isOutput: true },
        ],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'call_external_api',
            type: 'http',
            label: 'Call External API',
            config: {
              url: 'https://api.external.com/v1/data',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer {$Credential.token}',
              },
              body: '{payload}',
            },
          },
          {
            id: 'process_response',
            type: 'script',
            label: 'Process Response',
            config: {
              script: 'return JSON.parse(response.body);',
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'call_external_api' },
          { id: 'e2', source: 'call_external_api', target: 'process_response' },
          { id: 'e3', source: 'process_response', target: 'end' },
        ],
        active: true,
      };

      expect(() => FlowSchema.parse(apiFlow)).not.toThrow();
    });
  });
});

// ============================================================================
// Protocol Improvement Tests: Flow errorHandling
// ============================================================================

describe('FlowSchema - errorHandling', () => {
  it('should accept flow with errorHandling config', () => {
    const result = FlowSchema.parse({
      name: 'resilient_flow',
      label: 'Resilient Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
      errorHandling: {
        strategy: 'retry',
        maxRetries: 3,
        retryDelayMs: 2000,
      },
    });
    expect(result.errorHandling?.strategy).toBe('retry');
    expect(result.errorHandling?.maxRetries).toBe(3);
    expect(result.errorHandling?.retryDelayMs).toBe(2000);
  });

  it('should default errorHandling strategy to fail', () => {
    const result = FlowSchema.parse({
      name: 'default_flow',
      label: 'Default',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
      ],
      edges: [],
      errorHandling: {},
    });
    expect(result.errorHandling?.strategy).toBe('fail');
    expect(result.errorHandling?.maxRetries).toBe(0);
  });

  it('should accept continue strategy with fallback node', () => {
    const result = FlowSchema.parse({
      name: 'fallback_flow',
      label: 'Fallback',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'fallback', type: 'end', label: 'Fallback' },
      ],
      edges: [],
      errorHandling: {
        strategy: 'continue',
        fallbackNodeId: 'fallback',
      },
    });
    expect(result.errorHandling?.strategy).toBe('continue');
    expect(result.errorHandling?.fallbackNodeId).toBe('fallback');
  });

  it('should accept flow without errorHandling (optional)', () => {
    const result = FlowSchema.parse({
      name: 'simple_flow',
      label: 'Simple',
      type: 'autolaunched',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }],
      edges: [],
    });
    expect(result.errorHandling).toBeUndefined();
  });

  it('should accept exponential backoff configuration', () => {
    const result = FlowSchema.safeParse({
      name: 'backoff_flow',
      label: 'Backoff Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
      errorHandling: {
        strategy: 'retry',
        maxRetries: 5,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
        maxRetryDelayMs: 30000,
        jitter: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errorHandling!.backoffMultiplier).toBe(2);
      expect(result.data.errorHandling!.maxRetryDelayMs).toBe(30000);
      expect(result.data.errorHandling!.jitter).toBe(true);
    }
  });

  it('should use defaults for backoff fields', () => {
    const result = FlowSchema.safeParse({
      name: 'default_backoff',
      label: 'Default Backoff',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
      errorHandling: { strategy: 'retry' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errorHandling!.backoffMultiplier).toBe(1);
      expect(result.data.errorHandling!.maxRetryDelayMs).toBe(30000);
      expect(result.data.errorHandling!.jitter).toBe(false);
    }
  });
});

describe('defineFlow', () => {
  it('should return a parsed flow', () => {
    const result = defineFlow({
      name: 'on_task_create',
      label: 'On Task Create',
      type: 'record_change',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });
    expect(result.name).toBe('on_task_create');
    expect(result.label).toBe('On Task Create');
    expect(result.type).toBe('record_change');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('should apply defaults', () => {
    const result = defineFlow({
      name: 'simple',
      label: 'Simple',
      type: 'autolaunched',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }],
      edges: [],
    });
    expect(result.version).toBe(1);
    expect(result.status).toBe('draft');
    expect(result.active).toBe(false);
    expect(result.runAs).toBe('user');
  });

  it('should throw on invalid flow name', () => {
    expect(() => defineFlow({
      name: 'INVALID',
      label: 'Bad Flow',
      type: 'autolaunched',
      nodes: [],
      edges: [],
    })).toThrow();
  });
});

describe('FlowVersionHistorySchema', () => {
  it('should validate a flow version history entry', () => {
    const result = FlowVersionHistorySchema.safeParse({
      flowName: 'my_flow',
      version: 1,
      definition: {
        name: 'my_flow',
        label: 'My Flow',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: 'admin',
      changeNote: 'Initial version',
    });
    expect(result.success).toBe(true);
  });

  it('should require flowName, version, definition, and createdAt', () => {
    const result = FlowVersionHistorySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// BPMN Business Semantics Tests
// ============================================================================

describe('BPMN — Parallel Gateway & Join Gateway', () => {
  it('should accept parallel_gateway node type', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'pg_1',
      type: 'parallel_gateway',
      label: 'Fork — parallel approval',
      position: { x: 200, y: 100 },
    });
    expect(result.success).toBe(true);
  });

  it('should accept join_gateway node type', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'jg_1',
      type: 'join_gateway',
      label: 'Join — wait for all branches',
      position: { x: 200, y: 400 },
    });
    expect(result.success).toBe(true);
  });

  it('should validate a complete parallel approval flow', () => {
    const flow: Flow = {
      name: 'parallel_approval',
      label: 'Parallel Approval Flow',
      description: 'Demonstrates AND-split / AND-join for multi-department approval',
      type: 'record_change',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'fork', type: 'parallel_gateway', label: 'Fork — Parallel Approval' },
        { id: 'finance_review', type: 'connector_action', label: 'Finance Review' },
        { id: 'legal_review', type: 'connector_action', label: 'Legal Review' },
        { id: 'join', type: 'join_gateway', label: 'Join — All Approved' },
        { id: 'final_approve', type: 'update_record', label: 'Final Approve' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'fork' },
        { id: 'e2', source: 'fork', target: 'finance_review' },
        { id: 'e3', source: 'fork', target: 'legal_review' },
        { id: 'e4', source: 'finance_review', target: 'join' },
        { id: 'e5', source: 'legal_review', target: 'join' },
        { id: 'e6', source: 'join', target: 'final_approve' },
        { id: 'e7', source: 'final_approve', target: 'end' },
      ],
      active: true,
      runAs: 'system',
    };

    const result = FlowSchema.safeParse(flow);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes).toHaveLength(7);
      const gatewayTypes = result.data.nodes
        .filter(n => n.type === 'parallel_gateway' || n.type === 'join_gateway')
        .map(n => n.type);
      expect(gatewayTypes).toEqual(['parallel_gateway', 'join_gateway']);
    }
  });
});

describe('BPMN — Default Sequence Flow (isDefault)', () => {
  it('should default isDefault to false', () => {
    const result = FlowEdgeSchema.parse({
      id: 'e1',
      source: 'a',
      target: 'b',
    });
    expect(result.isDefault).toBe(false);
  });

  it('should accept isDefault: true on an edge', () => {
    const result = FlowEdgeSchema.parse({
      id: 'e_default',
      source: 'decision_1',
      target: 'fallback_node',
      isDefault: true,
      label: 'Default',
    });
    expect(result.isDefault).toBe(true);
  });

  it('should accept conditional edge type', () => {
    const result = FlowEdgeSchema.parse({
      id: 'e_cond',
      source: 'decision_1',
      target: 'branch_a',
      type: 'conditional',
      condition: '{amount} > 1000',
      label: 'High Value',
    });
    expect(result.type).toBe('conditional');
    expect(result.isDefault).toBe(false);
  });

  it('should validate a decision with default and conditional branches', () => {
    const flow: Flow = {
      name: 'default_branch_flow',
      label: 'Default Branch Flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'check_priority', type: 'decision', label: 'Check Priority' },
        { id: 'high_path', type: 'update_record', label: 'High Priority Handler' },
        { id: 'medium_path', type: 'update_record', label: 'Medium Priority Handler' },
        { id: 'default_path', type: 'update_record', label: 'Default Handler' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'check_priority' },
        { id: 'e2', source: 'check_priority', target: 'high_path', type: 'conditional', condition: '{priority} == "high"' },
        { id: 'e3', source: 'check_priority', target: 'medium_path', type: 'conditional', condition: '{priority} == "medium"' },
        { id: 'e4', source: 'check_priority', target: 'default_path', isDefault: true, label: 'Default' },
        { id: 'e5', source: 'high_path', target: 'end' },
        { id: 'e6', source: 'medium_path', target: 'end' },
        { id: 'e7', source: 'default_path', target: 'end' },
      ],
    };

    const result = FlowSchema.safeParse(flow);
    expect(result.success).toBe(true);
    if (result.success) {
      const defaultEdge = result.data.edges.find(e => e.isDefault);
      expect(defaultEdge).toBeDefined();
      expect(defaultEdge!.target).toBe('default_path');
    }
  });
});

describe('BPMN — Wait Event Configuration', () => {
  it('should accept wait node with timer event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_timer',
      type: 'wait',
      label: 'Wait 1 Hour',
      waitEventConfig: {
        eventType: 'timer',
        timerDuration: 'PT1H',
        timeoutMs: 7200000,
        onTimeout: 'fail',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waitEventConfig?.eventType).toBe('timer');
      expect(result.data.waitEventConfig?.timerDuration).toBe('PT1H');
    }
  });

  it('should accept wait node with webhook event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_webhook',
      type: 'wait',
      label: 'Wait for External Webhook',
      waitEventConfig: {
        eventType: 'webhook',
        signalName: 'payment_received',
        timeoutMs: 86400000,
        onTimeout: 'continue',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waitEventConfig?.eventType).toBe('webhook');
      expect(result.data.waitEventConfig?.signalName).toBe('payment_received');
      expect(result.data.waitEventConfig?.onTimeout).toBe('continue');
    }
  });

  it('should accept wait node with signal event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_signal',
      type: 'wait',
      label: 'Wait for Approval Signal',
      waitEventConfig: {
        eventType: 'signal',
        signalName: 'manager_approved',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waitEventConfig?.onTimeout).toBe('fail'); // default
    }
  });

  it('should accept wait node with manual resume', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_manual',
      type: 'wait',
      label: 'Wait for Manual Resume',
      waitEventConfig: { eventType: 'manual' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept wait node without waitEventConfig (backward compatible)', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'wait_simple',
      type: 'wait',
      label: 'Simple Wait',
    });
    expect(result.success).toBe(true);
    expect(result.data?.waitEventConfig).toBeUndefined();
  });
});

describe('BPMN — Boundary Event', () => {
  it('should accept boundary_event node with error event config', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_error',
      type: 'boundary_event',
      label: 'Catch API Error',
      boundaryConfig: {
        attachedToNodeId: 'http_call_1',
        eventType: 'error',
        interrupting: true,
        errorCode: 'HTTP_TIMEOUT',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryConfig?.attachedToNodeId).toBe('http_call_1');
      expect(result.data.boundaryConfig?.eventType).toBe('error');
      expect(result.data.boundaryConfig?.interrupting).toBe(true);
    }
  });

  it('should accept boundary_event with timer (non-interrupting)', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_timer',
      type: 'boundary_event',
      label: 'Escalation Timer',
      boundaryConfig: {
        attachedToNodeId: 'approval_node',
        eventType: 'timer',
        interrupting: false,
        timerDuration: 'P3D',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryConfig?.interrupting).toBe(false);
      expect(result.data.boundaryConfig?.timerDuration).toBe('P3D');
    }
  });

  it('should accept boundary_event with signal', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_signal',
      type: 'boundary_event',
      label: 'Catch Cancel Signal',
      boundaryConfig: {
        attachedToNodeId: 'long_task',
        eventType: 'signal',
        signalName: 'user_cancelled',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should default interrupting to true', () => {
    const result = FlowNodeSchema.safeParse({
      id: 'be_default',
      type: 'boundary_event',
      label: 'Default Boundary',
      boundaryConfig: {
        attachedToNodeId: 'some_node',
        eventType: 'cancel',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryConfig?.interrupting).toBe(true);
    }
  });

  it('should validate a flow with boundary error handling', () => {
    const flow: Flow = {
      name: 'boundary_error_flow',
      label: 'Flow with Boundary Error Handling',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'api_call', type: 'http', label: 'Call External API', timeoutMs: 5000 },
        {
          id: 'api_error_boundary',
          type: 'boundary_event',
          label: 'API Timeout Handler',
          boundaryConfig: {
            attachedToNodeId: 'api_call',
            eventType: 'error',
            interrupting: true,
            errorCode: 'TIMEOUT',
          },
        },
        { id: 'handle_error', type: 'update_record', label: 'Log Error' },
        { id: 'end_success', type: 'end', label: 'End Success' },
        { id: 'end_error', type: 'end', label: 'End Error' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'api_call' },
        { id: 'e2', source: 'api_call', target: 'end_success' },
        { id: 'e3', source: 'api_error_boundary', target: 'handle_error', type: 'fault' },
        { id: 'e4', source: 'handle_error', target: 'end_error' },
      ],
    };

    const result = FlowSchema.safeParse(flow);
    expect(result.success).toBe(true);
    if (result.success) {
      const boundaryNode = result.data.nodes.find(n => n.type === 'boundary_event');
      expect(boundaryNode).toBeDefined();
      expect(boundaryNode!.boundaryConfig?.attachedToNodeId).toBe('api_call');
      const faultEdge = result.data.edges.find(e => e.type === 'fault');
      expect(faultEdge).toBeDefined();
      expect(faultEdge!.source).toBe('api_error_boundary');
    }
  });
});

describe('BPMN — Fault Edge Enhancement', () => {
  it('should accept fault edge type', () => {
    const result = FlowEdgeSchema.parse({
      id: 'fault_1',
      source: 'node_a',
      target: 'error_handler',
      type: 'fault',
      label: 'On Error',
    });
    expect(result.type).toBe('fault');
  });

  it('should accept all edge types: default, fault, conditional', () => {
    const types = ['default', 'fault', 'conditional'] as const;
    types.forEach(type => {
      const result = FlowEdgeSchema.safeParse({
        id: `e_${type}`,
        source: 'a',
        target: 'b',
        type,
      });
      expect(result.success).toBe(true);
    });
  });
});
